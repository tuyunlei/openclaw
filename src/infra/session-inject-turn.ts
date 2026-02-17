import type { ReplyPayload } from "../auto-reply/types.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { appendCronStyleCurrentTimeLine } from "../agents/current-time.js";
import { resolveEmbeddedSessionLane } from "../agents/pi-embedded-runner/lanes.js";
import { withReplyDispatcher } from "../auto-reply/dispatch.js";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import { dispatchReplyFromConfig } from "../auto-reply/reply/dispatch-from-config.js";
import { finalizeInboundContext } from "../auto-reply/reply/inbound-context.js";
import { createReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";
import { loadConfig, type OpenClawConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveStorePath,
} from "../config/sessions.js";
import { getQueueSize } from "../process/command-queue.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";
import {
  resolveHeartbeatDeliveryTarget,
  resolveHeartbeatSenderContext,
} from "./outbound/targets.js";

type HeartbeatDeps = NonNullable<Parameters<typeof runHeartbeatOnce>[0]["deps"]>;

/**
 * Parse channel routing info from a session key.
 * Session keys follow the pattern: `agent:<agentId>:<channel>:<kind>:<id>[:topic:<threadId>]`
 * Example: `agent:main:telegram:group:-1003806272588:topic:9793`
 *
 * Returns the originating channel fields that match what channel plugins set
 * (e.g. Telegram sets `OriginatingChannel: "telegram"`, `OriginatingTo: "telegram:<chatId>"`).
 *
 * This ensures inject turns carry correct channel metadata so that
 * `initSessionState` preserves delivery context even after a session reset.
 */
function parseChannelFromSessionKey(sessionKey: string): {
  channel?: string;
  to?: string;
  threadId?: string;
} {
  // agent:main:telegram:group:-1003806272588:topic:9793
  const parts = sessionKey.split(":");
  if (parts.length < 3 || parts[0] !== "agent") {
    return {};
  }
  const channel = parts[2];
  // "main" is the DM/main session bucket, not a channel name
  if (!channel || channel === "main") {
    return {};
  }

  // Extract group/channel ID: look for "group" or "channel" kind
  const kindIdx = parts.indexOf("group", 3);
  const chanIdx = kindIdx < 0 ? parts.indexOf("channel", 3) : kindIdx;
  let to: string | undefined;
  if (chanIdx >= 0 && chanIdx + 1 < parts.length) {
    // Reconstruct the chat ID — may contain colons (rare) so join remaining
    // parts up to "topic" marker or end
    const topicIdx = parts.indexOf("topic", chanIdx + 1);
    const idParts = topicIdx > 0 ? parts.slice(chanIdx + 1, topicIdx) : parts.slice(chanIdx + 1);
    const chatId = idParts.join(":");
    // Channel plugins use format `<channel>:<chatId>` (e.g. "telegram:-1003806272588")
    to = `${channel}:${chatId}`;
  }

  // Extract thread/topic ID
  const topicIdx = parts.indexOf("topic");
  const threadId = topicIdx >= 0 && topicIdx + 1 < parts.length ? parts[topicIdx + 1] : undefined;

  return { channel, to, threadId };
}

type InjectTurnResult = {
  status: "ok" | "error" | "skipped";
  text?: string;
  reason?: string;
};

/** Extract the last non-empty text from a reply result for the caller's status. */
function extractReplyText(reply: ReplyPayload | ReplyPayload[] | undefined): string | undefined {
  const payloads = Array.isArray(reply) ? reply : reply ? [reply] : [];
  for (let i = payloads.length - 1; i >= 0; i--) {
    const text = payloads[i]?.text?.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

export async function runSessionInjectTurn(opts: {
  cfg?: OpenClawConfig;
  sessionKey: string;
  text?: string;
  reason?: string;
  deps?: HeartbeatDeps;
}): Promise<InjectTurnResult> {
  void opts.reason;
  const cfg = opts.cfg ?? loadConfig();
  const sessionKey = opts.sessionKey.trim();
  if (!sessionKey) {
    return { status: "error", reason: "session-not-found" };
  }

  const sessionAgentId = resolveAgentIdFromSessionKey(sessionKey) ?? resolveDefaultAgentId(cfg);
  const storePath = resolveStorePath(cfg.session?.store, { agentId: sessionAgentId });
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  if (!entry) {
    return { status: "error", reason: "session-not-found" };
  }

  const sessionLane = resolveEmbeddedSessionLane(sessionKey);
  const queueSize = (opts.deps?.getQueueSize ?? getQueueSize)(sessionLane);
  if (queueSize > 0) {
    return { status: "skipped", reason: "requests-in-flight" };
  }

  // Parse channel routing from the session key so that inject turns
  // can deliver correctly even when session state is empty (e.g. after reset).
  // Also sets OriginatingChannel/OriginatingTo on ctx so that initSessionState
  // writes correct lastChannel/lastTo for future turns.
  const parsed = parseChannelFromSessionKey(sessionKey);

  const delivery = resolveHeartbeatDeliveryTarget({ cfg, entry });
  // Fall back to session-key-derived values when entry has no delivery
  // context (e.g. fresh session after reset).
  const effectiveChannel =
    delivery.channel && delivery.channel !== "none" ? delivery.channel : parsed.channel;
  const effectiveTo = delivery.to ?? parsed.to;
  const effectiveThreadId =
    delivery.threadId ?? parsed.threadId ?? entry.lastThreadId ?? entry.deliveryContext?.threadId;

  if (!effectiveChannel || effectiveChannel === "none" || !effectiveTo) {
    return { status: "error", reason: "no-delivery-target" };
  }

  const { sender } = resolveHeartbeatSenderContext({ cfg, entry, delivery });
  const startedAt = opts.deps?.nowMs?.() ?? Date.now();
  // Embed the wake text directly into the body instead of relying on
  // enqueueSystemEvent, which can be drained by a concurrent turn.
  const bodyText = opts.text?.trim()
    ? opts.text.trim()
    : "You received a system event. Process it and respond.";

  const ctx = {
    Body: appendCronStyleCurrentTimeLine(bodyText, cfg, startedAt),
    From: sender,
    To: effectiveTo ?? sender,
    Provider: "system-inject",
    SessionKey: sessionKey,
    ConversationLabel: entry.origin?.label ?? entry.displayName,
    ChatType: entry.chatType,
    OriginatingChannel: parsed.channel,
    OriginatingTo: parsed.to,
    MessageThreadId: parsed.threadId ?? effectiveThreadId,
  };

  let replyText: string | undefined;
  const dispatcher = createReplyDispatcher({
    deliver: async (payload) => {
      await deliverOutboundPayloads({
        cfg,
        channel: effectiveChannel,
        to: effectiveTo,
        threadId: effectiveThreadId,
        accountId: delivery.accountId,
        payloads: [payload],
        deps: opts.deps,
      });
    },
  });

  await withReplyDispatcher({
    dispatcher,
    run: async () => {
      await dispatchReplyFromConfig({
        ctx: finalizeInboundContext(ctx),
        cfg,
        dispatcher,
        replyResolver: async (replyCtx, options, config) => {
          const result = await getReplyFromConfig(replyCtx, options, config);
          replyText = extractReplyText(result);
          return result;
        },
      });
    },
  });

  return { status: "ok", text: replyText };
}
