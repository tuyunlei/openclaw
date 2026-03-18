import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveEmbeddedSessionLane } from "../agents/pi-embedded-runner/lanes.js";
import { withReplyDispatcher } from "../auto-reply/dispatch.js";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import { dispatchReplyFromConfig } from "../auto-reply/reply/dispatch-from-config.js";
import { finalizeInboundContext } from "../auto-reply/reply/inbound-context.js";
import { createReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { loadConfig, type OpenClawConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveStorePath,
} from "../config/sessions.js";
import { getQueueSize } from "../process/command-queue.js";
import type { HeartbeatRunResult } from "./heartbeat-wake.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";
import {
  resolveHeartbeatDeliveryTarget,
  resolveHeartbeatSenderContext,
} from "./outbound/targets.js";
import { drainSystemEvents } from "./system-events.js";
import {
  applySessionGroupContext,
  buildSystemTurnBody,
  parseSessionKeyChannelRoute,
} from "./system-turn-context.js";

type EventDrivenTurnDeps = {
  getQueueSize?: (lane?: string) => number;
  nowMs?: () => number;
  runtime?: Parameters<typeof deliverOutboundPayloads>[0]["deps"] extends { runtime?: infer R }
    ? R
    : unknown;
} & Parameters<typeof deliverOutboundPayloads>[0]["deps"];

export type EventDrivenTurnResult = HeartbeatRunResult & {
  text?: string;
  delivered?: boolean;
};

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

export async function runEventDrivenTurn(opts: {
  cfg?: OpenClawConfig;
  sessionKey: string;
  text?: string;
  reason?: string;
  deps?: EventDrivenTurnDeps;
}): Promise<EventDrivenTurnResult> {
  void opts.reason;
  const cfg = opts.cfg ?? loadConfig();
  const sessionKey = opts.sessionKey.trim();
  if (!sessionKey) {
    return { status: "failed", reason: "session-not-found" };
  }

  const sessionAgentId = resolveAgentIdFromSessionKey(sessionKey) ?? resolveDefaultAgentId(cfg);
  const storePath = resolveStorePath(cfg.session?.store, { agentId: sessionAgentId });
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  if (!entry) {
    return { status: "failed", reason: "session-not-found" };
  }

  const sessionLane = resolveEmbeddedSessionLane(sessionKey);
  const queueSize = (opts.deps?.getQueueSize ?? getQueueSize)(sessionLane);
  if (queueSize > 0) {
    return { status: "skipped", reason: "requests-in-flight" };
  }

  // Drain system events AFTER confirming the session is free.
  // If we drained before the queueSize check and the turn was skipped,
  // events would be lost — the wake layer retries 1s later but the
  // queue would already be empty.
  const pendingEvents = drainSystemEvents(sessionKey);
  const eventText = [opts.text, ...pendingEvents].filter(Boolean).join("\n").trim() || undefined;

  const parsed = parseSessionKeyChannelRoute(sessionKey);
  // Do NOT pass heartbeat config here — event-driven turns should not go through
  // heartbeat delivery resolution (which uses mode:"heartbeat" and can fail).
  // Without a heartbeat param, target defaults to "none", and the fallback to
  // session-key-derived channel/to values kicks in correctly.
  const delivery = resolveHeartbeatDeliveryTarget({ cfg, entry });
  const effectiveChannel =
    delivery.channel && delivery.channel !== "none" ? delivery.channel : parsed.channel;
  const effectiveTo = delivery.to ?? parsed.to;
  const effectiveThreadId =
    delivery.threadId ?? parsed.threadId ?? entry.lastThreadId ?? entry.deliveryContext?.threadId;
  const hasDeliveryTarget = effectiveChannel && effectiveChannel !== "none" && effectiveTo;

  const { sender } = resolveHeartbeatSenderContext({ cfg, entry, delivery });
  const startedAt = opts.deps?.nowMs?.() ?? Date.now();

  const injectProvider = parsed.channel ?? entry.lastChannel ?? "system-inject";
  const ctx: Record<string, unknown> = {
    Body: buildSystemTurnBody(eventText, cfg, startedAt),
    From: sender,
    To: effectiveTo ?? sender,
    Provider: injectProvider,
    SessionKey: sessionKey,
    ConversationLabel: entry.origin?.label ?? entry.displayName,
    ChatType: entry.chatType,
    OriginatingChannel: parsed.channel,
    OriginatingTo: parsed.to,
    MessageThreadId: parsed.threadId ?? effectiveThreadId,
  };
  applySessionGroupContext(ctx, entry);

  let replyText: string | undefined;
  let delivered = false;
  const dispatcher = createReplyDispatcher({
    deliver: hasDeliveryTarget
      ? async (payload) => {
          await deliverOutboundPayloads({
            cfg,
            channel: effectiveChannel,
            to: effectiveTo,
            threadId: effectiveThreadId,
            accountId: delivery.accountId,
            payloads: [payload],
            deps: opts.deps,
          });
          delivered = true;
        }
      : async () => {
          // Agent/internal sessions may have no external target; keep the turn in transcript only.
        },
  });

  try {
    await withReplyDispatcher({
      dispatcher,
      run: async () => {
        await dispatchReplyFromConfig({
          ctx: finalizeInboundContext(ctx),
          cfg,
          dispatcher,
          replyOptions: { senderIsOwner: true },
          replyResolver: async (replyCtx, options, config) => {
            const result = await getReplyFromConfig(replyCtx, options, config);
            replyText = extractReplyText(result);
            return result;
          },
        });
      },
    });
  } catch (err) {
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
      text: replyText,
      delivered,
    };
  }

  return {
    status: "ran",
    durationMs: Date.now() - startedAt,
    text: replyText,
    delivered,
  };
}
