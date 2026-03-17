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
  isEmbeddedPiRunActiveBySessionKey,
  queueEmbeddedPiMessageBySessionKey,
} from "../../../src/agents/pi-embedded-runner.js";
import { isControlCommandMessage } from "../../../src/auto-reply/command-detection.js";
import { resolveQueueSettings } from "../../../src/auto-reply/reply/queue/settings.js";
import type { OpenClawConfig } from "../../../src/config/config.js";
import { diagnosticLogger as diag } from "../../../src/logging/diagnostic.js";
import { resolveTelegramForumThreadId } from "./bot/helpers.js";

// Cache: Telegram chatKey ("chatId|topicId") → resolved sessionKey.
// Populated after the first message for a chat completes routing.
// Enables steer for sessions whose key doesn't contain the telegram path
// (e.g. "agent:main:main" for the default main session).
const CHAT_SESSION_CACHE = new Map<string, string>();

/**
 * Register a Telegram chat → sessionKey mapping for steer lookups.
 * Call this after session routing is resolved (e.g. in bot-handlers after processMessage).
 */
export function registerTelegramSteerMapping(
  chatId: number | string,
  topicId: number | string | undefined,
  sessionKey: string,
): void {
  const chatKey = topicId ? `${chatId}|${topicId}` : `${chatId}`;
  CHAT_SESSION_CACHE.set(chatKey, sessionKey);
}

function buildChatKey(chatId: number | string, topicId: number | string | undefined): string {
  return topicId ? `${chatId}|${topicId}` : `${chatId}`;
}

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

    // Strategy 1: suffix match (works for topic sessions with telegram path in key)
    let sessionKey = findActiveSessionKeyBySuffix(chatSuffix);

    // Strategy 2: cache lookup (works for main session / non-telegram-path keys)
    if (!sessionKey) {
      const chatKey = buildChatKey(chatId, topicId);
      const cachedKey = CHAT_SESSION_CACHE.get(chatKey);
      if (cachedKey && isEmbeddedPiRunActiveBySessionKey(cachedKey)) {
        sessionKey = cachedKey;
      }
    }

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
