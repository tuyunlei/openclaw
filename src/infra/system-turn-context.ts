import { appendCronStyleCurrentTimeLine } from "../agents/current-time.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";

export function parseSessionKeyChannelRoute(sessionKey: string): {
  channel?: string;
  to?: string;
  threadId?: string;
} {
  const parts = sessionKey.split(":");
  if (parts.length < 3 || parts[0] !== "agent") {
    return {};
  }
  const channel = parts[2];
  if (!channel || channel === "main") {
    return {};
  }

  const kindIdx = parts.indexOf("group", 3);
  const chanIdx = kindIdx < 0 ? parts.indexOf("channel", 3) : kindIdx;
  let to: string | undefined;
  if (chanIdx >= 0 && chanIdx + 1 < parts.length) {
    const topicIdx = parts.indexOf("topic", chanIdx + 1);
    const idParts = topicIdx > 0 ? parts.slice(chanIdx + 1, topicIdx) : parts.slice(chanIdx + 1);
    to = `${channel}:${idParts.join(":")}`;
  }

  const topicIdx = parts.indexOf("topic");
  const threadId = topicIdx >= 0 && topicIdx + 1 < parts.length ? parts[topicIdx + 1] : undefined;
  return { channel, to, threadId };
}

export function applySessionGroupContext(ctx: Record<string, unknown>, entry?: SessionEntry) {
  if (!entry) {
    return ctx;
  }
  if (entry.chatType) {
    ctx.ChatType = entry.chatType;
  }
  if (entry.lastAccountId) {
    ctx.AccountId = entry.lastAccountId;
  }
  if (entry.subject) {
    ctx.GroupSubject = entry.subject;
  }
  if (entry.groupMembers) {
    ctx.GroupMembers = entry.groupMembers;
  }
  if (entry.groupSystemPrompt) {
    ctx.GroupSystemPrompt = entry.groupSystemPrompt;
  }
  if (entry.groupChannel) {
    ctx.GroupChannel = entry.groupChannel;
  }
  if (entry.space) {
    ctx.GroupSpace = entry.space;
  }
  return ctx;
}

export function buildSystemTurnBody(
  text: string | undefined,
  cfg: OpenClawConfig,
  startedAt: number,
) {
  const bodyText = text?.trim()
    ? text.trim()
    : "You received a system event. Process it and respond.";
  return appendCronStyleCurrentTimeLine(bodyText, cfg, startedAt);
}
