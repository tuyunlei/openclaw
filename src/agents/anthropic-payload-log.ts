import crypto from "node:crypto";
import path from "node:path";
import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { SAFE_SESSION_ID_RE } from "../config/sessions/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveUserPath } from "../utils.js";
import { parseBooleanValue } from "../utils/boolean.js";
import { safeJsonStringify } from "../utils/safe-json.js";
import { getQueuedFileWriter, type QueuedFileWriter } from "./queued-file-writer.js";

type PayloadLogStage = "request" | "usage";

type PayloadLogEvent = {
  ts: string;
  stage: PayloadLogStage;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  workspaceDir?: string;
  payload?: unknown;
  usage?: Record<string, unknown>;
  error?: string;
  payloadDigest?: string;
};

type PayloadLogConfig = {
  enabled: boolean;
  filePath: string;
};

export type PayloadLogWriter = QueuedFileWriter;

type PayloadLogSessionConfig = {
  enabled: boolean;
  dir: string;
};

const writers = new Map<string, PayloadLogWriter>();
const log = createSubsystemLogger("agent/anthropic-payload");

function resolvePayloadLogConfig(env: NodeJS.ProcessEnv): PayloadLogConfig {
  const enabled = parseBooleanValue(env.OPENCLAW_ANTHROPIC_PAYLOAD_LOG) ?? false;
  const fileOverride = env.OPENCLAW_ANTHROPIC_PAYLOAD_LOG_FILE?.trim();
  const filePath = fileOverride
    ? resolveUserPath(fileOverride)
    : path.join(resolveStateDir(env), "logs", "anthropic-payload.jsonl");
  return { enabled, filePath };
}

export function resolvePayloadLogSessionConfig(params: {
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  agentId?: string;
}): PayloadLogSessionConfig {
  const env = params.env ?? process.env;
  const config = params.cfg?.diagnostics?.payloadLog;
  const envEnabled = parseBooleanValue(env.OPENCLAW_PAYLOAD_LOG);
  const enabled = envEnabled ?? config?.enabled ?? false;
  const dirOverride = env.OPENCLAW_PAYLOAD_LOG_DIR?.trim() || config?.dir?.trim();
  const dir = dirOverride
    ? resolveUserPath(dirOverride)
    : path.join(resolveStateDir(env), "agents", params.agentId ?? "main", "payload-logs");
  return { enabled, dir };
}

export function resolvePayloadLogFilePath(
  baseDir: string,
  sessionId: string,
  runId: string,
): string {
  const safeSession = SAFE_SESSION_ID_RE.test(sessionId) ? sessionId : "unknown";
  const safeRun = SAFE_SESSION_ID_RE.test(runId) ? runId : `unknown-${Date.now()}`;
  return path.join(baseDir, safeSession, `${safeRun}.jsonl`);
}

function getWriter(filePath: string): PayloadLogWriter {
  return getQueuedFileWriter(writers, filePath);
}

function formatError(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  if (error && typeof error === "object") {
    return safeJsonStringify(error) ?? "unknown error";
  }
  return undefined;
}

function digest(value: unknown): string | undefined {
  const serialized = safeJsonStringify(value);
  if (!serialized) {
    return undefined;
  }
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

function isAnthropicModel(model: Model<Api> | undefined | null): boolean {
  return (model as { api?: unknown })?.api === "anthropic-messages";
}

function findLastAssistantUsage(messages: AgentMessage[]): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] as { role?: unknown; usage?: unknown };
    if (msg?.role === "assistant" && msg.usage && typeof msg.usage === "object") {
      return msg.usage as Record<string, unknown>;
    }
  }
  return null;
}

export type AnthropicPayloadLogger = {
  enabled: true;
  wrapStreamFn: (streamFn: StreamFn) => StreamFn;
  recordUsage: (messages: AgentMessage[], error?: unknown) => void;
  dispose: () => void;
};

export function createAnthropicPayloadLogger(params: {
  env?: NodeJS.ProcessEnv;
  cfg?: OpenClawConfig;
  agentId?: string;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  workspaceDir?: string;
  writers?: PayloadLogWriter[];
}): AnthropicPayloadLogger | null {
  const env = params.env ?? process.env;

  // Resolve legacy single-file config
  const legacyCfg = resolvePayloadLogConfig(env);

  // Resolve per-session config
  const sessionCfg = resolvePayloadLogSessionConfig({
    cfg: params.cfg,
    env,
    agentId: params.agentId,
  });

  // Build writers array (test-injectable or production)
  let activeWriters: PayloadLogWriter[];
  if (params.writers) {
    activeWriters = params.writers;
  } else {
    activeWriters = [];
    if (legacyCfg.enabled) {
      activeWriters.push(getWriter(legacyCfg.filePath));
    }
    if (sessionCfg.enabled && params.sessionId) {
      const runId = params.runId ?? `unknown-${Date.now()}`;
      const filePath = resolvePayloadLogFilePath(sessionCfg.dir, params.sessionId, runId);
      activeWriters.push(getWriter(filePath));
    }
  }

  if (activeWriters.length === 0) {
    return null;
  }

  const base: Omit<PayloadLogEvent, "ts" | "stage"> = {
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    modelId: params.modelId,
    modelApi: params.modelApi,
    workspaceDir: params.workspaceDir,
  };

  const record = (event: PayloadLogEvent) => {
    const line = safeJsonStringify(event);
    if (!line) {
      return;
    }
    const formatted = `${line}\n`;
    for (const w of activeWriters) {
      w.write(formatted);
    }
  };

  const wrapStreamFn: AnthropicPayloadLogger["wrapStreamFn"] = (streamFn) => {
    const wrapped: StreamFn = (model, context, options) => {
      if (!isAnthropicModel(model)) {
        return streamFn(model, context, options);
      }
      const nextOnPayload = (payload: unknown) => {
        record({
          ...base,
          ts: new Date().toISOString(),
          stage: "request",
          payload,
          payloadDigest: digest(payload),
        });
        options?.onPayload?.(payload);
      };
      return streamFn(model, context, {
        ...options,
        onPayload: nextOnPayload,
      });
    };
    return wrapped;
  };

  const recordUsage: AnthropicPayloadLogger["recordUsage"] = (messages, error) => {
    const usage = findLastAssistantUsage(messages);
    const errorMessage = formatError(error);
    if (!usage) {
      if (errorMessage) {
        record({
          ...base,
          ts: new Date().toISOString(),
          stage: "usage",
          error: errorMessage,
        });
      }
      return;
    }
    record({
      ...base,
      ts: new Date().toISOString(),
      stage: "usage",
      usage,
      error: errorMessage,
    });
    log.info("anthropic usage", {
      runId: params.runId,
      sessionId: params.sessionId,
      usage,
    });
  };

  const dispose = () => {
    for (const w of activeWriters) {
      writers.delete(w.filePath);
    }
  };

  for (const w of activeWriters) {
    log.info("anthropic payload logger enabled", { filePath: w.filePath });
  }
  return { enabled: true, wrapStreamFn, recordUsage, dispose };
}
