/**
 * Telegram steer middleware — intercepts messages BEFORE sequentialize
 * and injects them directly into active pi-agent runs via steer queue.
 *
 * Without this middleware, messages are blocked by the sequential lock
 * until the current run finishes, making steer mode equivalent to followup.
 * This middleware checks if there's an active run for the session and,
 * if so, injects the message directly — bypassing the lock entirely.
 */
import {
  findActiveSessionKeyBySuffix,
  queueEmbeddedPiMessageBySessionKey,
} from "../../../src/agents/pi-embedded-runner.js";
import { isControlCommandMessage } from "../../../src/auto-reply/command-detection.js";
import { resolveQueueSettings } from "../../../src/auto-reply/reply/queue/settings.js";
import type { OpenClawConfig } from "../../../src/config/config.js";
import { diagnosticLogger as diag } from "../../../src/logging/diagnostic.js";
import { resolveTelegramForumThreadId } from "./bot/helpers.js";

/**
 * Creates middleware that attempts to steer incoming messages into active runs
 * before they reach sequentialize. This allows injecting messages during tool
 * execution without blocking on the sequential lock.
 */
// biome-ignore lint/suspicious/noExplicitAny: grammy context is untyped here
export function createSteerMiddleware(cfg: OpenClawConfig) {
  // biome-ignore lint/suspicious/noExplicitAny: grammy context
  return async (ctx: any, next: () => Promise<void>) => {
    const msg = ctx.message ?? ctx.update?.message ?? ctx.update?.edited_message;
    if (!msg) {
      return next();
    }

    const chatId = msg.chat?.id;
    const chatType = msg.chat?.type;
    if (!chatId) {
      return next();
    }

    // Only steer in steer/steer-backlog queue modes
    const queueSettings = resolveQueueSettings({ cfg, channel: "telegram" });
    const isSteerMode = queueSettings.mode === "steer" || queueSettings.mode === "steer-backlog";
    if (!isSteerMode) {
      return next();
    }

    // Build the chat suffix (agent-independent) to match any active session
    const isGroup = chatType === "group" || chatType === "supergroup";
    const topicId = resolveTelegramForumThreadId({
      isForum: msg.chat && "is_forum" in msg.chat ? msg.chat.is_forum : false,
      messageThreadId: msg.message_thread_id,
    });

    let chatSuffix: string;
    if (isGroup) {
      chatSuffix = topicId
        ? `telegram:group:${chatId}:topic:${topicId}`
        : `telegram:group:${chatId}`;
    } else {
      chatSuffix = `telegram:dm:${chatId}`;
    }

    // Find any active run whose sessionKey ends with this chat suffix
    const sessionKey = findActiveSessionKeyBySuffix(chatSuffix);
    if (!sessionKey) {
      return next();
    }

    // Extract text
    const text = (msg.text ?? msg.caption ?? "").trim();
    if (!text) {
      return next();
    }

    // Don't steer control commands (slash commands, etc.)
    if (isControlCommandMessage(text, cfg, {})) {
      return next();
    }

    // Try to inject into the active run
    const senderName = msg.from?.first_name ?? msg.from?.username ?? "Unknown";
    const steerText = `[Telegram ${senderName}]: ${text}`;

    const result = queueEmbeddedPiMessageBySessionKey(sessionKey, steerText);
    if (result) {
      diag.debug(
        `steer: middleware injected sessionKey=${sessionKey} sessionId=${result.sessionId}`,
      );
      // Message was injected into the active run — don't continue to sequentialize
      return;
    }

    // Injection failed (e.g. compacting), fall through to normal flow
    diag.debug(`steer: middleware fallback sessionKey=${sessionKey}`);
    return next();
  };
}
