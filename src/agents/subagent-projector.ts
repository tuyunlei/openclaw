import crypto from "node:crypto";
import { callGateway } from "../gateway/call.js";
import type { AgentEventPayload } from "../infra/agent-events.js";

const LIVE_IDLE_FLUSH_MS = 750;
const LIVE_SOFT_FLUSH_CHARS = 220;
const LIVE_HARD_FLUSH_CHARS = 480;
const LIVE_IDLE_MIN_CHARS = 80;

function shouldFlushLiveBufferOnBoundary(text: string): boolean {
  if (!text) {
    return false;
  }
  if (text.length >= LIVE_HARD_FLUSH_CHARS) {
    return true;
  }
  if (text.endsWith("\n\n")) {
    return true;
  }
  if (/[.!?][)"'`]*\s$/.test(text)) {
    return true;
  }
  if (text.length >= LIVE_SOFT_FLUSH_CHARS && /\s$/.test(text)) {
    return true;
  }
  return false;
}

function shouldFlushLiveBufferOnIdle(text: string): boolean {
  if (!text) {
    return false;
  }
  if (text.length >= LIVE_IDLE_MIN_CHARS) {
    return true;
  }
  if (/[.!?][)"'`]*$/.test(text.trimEnd())) {
    return true;
  }
  if (text.includes("\n")) {
    return true;
  }
  return false;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 1) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - 1)}…`;
}

function summarizeToolEvent(evt: AgentEventPayload): string | undefined {
  if (evt.stream !== "tool") {
    return undefined;
  }
  const phase = typeof evt.data?.phase === "string" ? evt.data.phase.trim().toLowerCase() : "";
  const name = typeof evt.data?.name === "string" ? evt.data.name.trim() : "tool";
  if (phase === "start") {
    return `🧰 ${name} started`;
  }
  if (phase === "update") {
    return `🧰 ${name} running`;
  }
  if (phase === "result") {
    const isError = evt.data?.isError === true;
    return isError ? `🧰 ${name} failed` : `🧰 ${name} completed`;
  }
  return undefined;
}

export type SubagentThreadProjectionTarget = {
  channel: string;
  to: string;
  accountId?: string;
  threadId?: string;
};

export type SubagentReplyProjector = {
  onEvent: (evt: AgentEventPayload) => Promise<void>;
  flush: (force?: boolean) => Promise<void>;
  close: (opts?: { flush?: boolean }) => Promise<void>;
};

export function createSubagentReplyProjector(params: {
  runId: string;
  target: SubagentThreadProjectionTarget;
  includeToolSummaries?: boolean;
}): SubagentReplyProjector {
  const includeToolSummaries = params.includeToolSummaries !== false;
  let closed = false;
  let queue: Promise<void> = Promise.resolve();
  let assistantBuffer = "";
  let lastToolMessage: string | undefined;
  let idleTimer: NodeJS.Timeout | undefined;

  const clearIdleTimer = () => {
    if (!idleTimer) {
      return;
    }
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  const sendMessage = async (message: string) => {
    const text = message.trim();
    if (!text || closed) {
      return;
    }
    try {
      await callGateway({
        method: "send",
        params: {
          channel: params.target.channel,
          to: params.target.to,
          accountId: params.target.accountId,
          threadId: params.target.threadId,
          message: truncateText(text, 3900),
          idempotencyKey: crypto.randomUUID(),
        },
        timeoutMs: 10_000,
      });
    } catch {
      // Best-effort projection only.
    }
  };

  const flushAssistant = async (opts?: { force?: boolean; idle?: boolean }) => {
    if (!assistantBuffer) {
      return;
    }
    if (opts?.idle && !shouldFlushLiveBufferOnIdle(assistantBuffer)) {
      return;
    }
    const next = assistantBuffer;
    assistantBuffer = "";
    await sendMessage(next);
  };

  const scheduleIdleFlush = () => {
    clearIdleTimer();
    if (!assistantBuffer || closed) {
      return;
    }
    idleTimer = setTimeout(() => {
      void enqueue(async () => {
        await flushAssistant({ force: true, idle: true });
        if (assistantBuffer) {
          scheduleIdleFlush();
        }
      });
    }, LIVE_IDLE_FLUSH_MS);
  };

  const enqueue = (op: () => Promise<void>) => {
    queue = queue
      .then(async () => {
        if (closed) {
          return;
        }
        await op();
      })
      .catch(() => {
        // Ignore projector pipeline failures; projection is non-critical.
      });
    return queue;
  };

  const onEvent = async (evt: AgentEventPayload) =>
    enqueue(async () => {
      if (evt.runId !== params.runId || closed) {
        return;
      }

      if (evt.stream === "assistant") {
        const delta = typeof evt.data?.delta === "string" ? evt.data.delta : "";
        const full = typeof evt.data?.text === "string" ? evt.data.text : "";
        const chunk = delta || full;
        if (!chunk) {
          return;
        }
        assistantBuffer += chunk;
        if (shouldFlushLiveBufferOnBoundary(assistantBuffer)) {
          await flushAssistant({ force: false });
        }
        scheduleIdleFlush();
        return;
      }

      if (evt.stream === "tool" && includeToolSummaries) {
        await flushAssistant({ force: true });
        const summary = summarizeToolEvent(evt);
        if (!summary || summary === lastToolMessage) {
          return;
        }
        lastToolMessage = summary;
        await sendMessage(summary);
        return;
      }

      if (evt.stream === "lifecycle") {
        const phase =
          typeof evt.data?.phase === "string" ? evt.data.phase.trim().toLowerCase() : "";
        if (phase === "end" || phase === "error") {
          await flushAssistant({ force: true });
          clearIdleTimer();
        }
      }
    });

  const flush = async (_force = false) => {
    await enqueue(async () => {
      clearIdleTimer();
      await flushAssistant({ force: true });
    });
  };

  const close = async (opts?: { flush?: boolean }) => {
    if (closed) {
      return;
    }
    if (opts?.flush !== false) {
      await flush(true);
    }
    closed = true;
    clearIdleTimer();
    assistantBuffer = "";
  };

  return {
    onEvent,
    flush,
    close,
  };
}
