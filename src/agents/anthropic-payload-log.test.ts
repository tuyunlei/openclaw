import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { PayloadLogWriter } from "./anthropic-payload-log.js";
import {
  createAnthropicPayloadLogger,
  resolvePayloadLogFilePath,
  resolvePayloadLogSessionConfig,
} from "./anthropic-payload-log.js";

function makeMockWriter(filePath = "/mock/path.jsonl"): PayloadLogWriter & { lines: string[] } {
  const lines: string[] = [];
  return {
    filePath,
    lines,
    write: (line: string) => {
      lines.push(line);
    },
  };
}

describe("resolvePayloadLogSessionConfig", () => {
  it("defaults to disabled when nothing is configured", () => {
    const result = resolvePayloadLogSessionConfig({ env: {} });
    expect(result.enabled).toBe(false);
  });

  it("reads enabled from config diagnostics.payloadLog.enabled", () => {
    const cfg = { diagnostics: { payloadLog: { enabled: true } } };
    const result = resolvePayloadLogSessionConfig({ cfg, env: {} });
    expect(result.enabled).toBe(true);
  });

  it("env OPENCLAW_PAYLOAD_LOG overrides config", () => {
    const cfg = { diagnostics: { payloadLog: { enabled: false } } };
    const result = resolvePayloadLogSessionConfig({
      cfg,
      env: { OPENCLAW_PAYLOAD_LOG: "true" },
    });
    expect(result.enabled).toBe(true);
  });

  it("env OPENCLAW_PAYLOAD_LOG=false overrides config enabled", () => {
    const cfg = { diagnostics: { payloadLog: { enabled: true } } };
    const result = resolvePayloadLogSessionConfig({
      cfg,
      env: { OPENCLAW_PAYLOAD_LOG: "false" },
    });
    expect(result.enabled).toBe(false);
  });

  it("uses default dir based on agentId", () => {
    const result = resolvePayloadLogSessionConfig({
      env: { HOME: "/home/test" },
      agentId: "myagent",
    });
    expect(result.dir).toContain(path.join("agents", "myagent", "payload-logs"));
  });

  it("falls back to 'main' when agentId is undefined", () => {
    const result = resolvePayloadLogSessionConfig({
      env: { HOME: "/home/test" },
    });
    expect(result.dir).toContain(path.join("agents", "main", "payload-logs"));
  });

  it("config dir overrides default", () => {
    const cfg = { diagnostics: { payloadLog: { dir: "/custom/dir" } } };
    const result = resolvePayloadLogSessionConfig({ cfg, env: {} });
    expect(result.dir).toBe("/custom/dir");
  });

  it("env OPENCLAW_PAYLOAD_LOG_DIR overrides config dir", () => {
    const cfg = { diagnostics: { payloadLog: { dir: "/config/dir" } } };
    const result = resolvePayloadLogSessionConfig({
      cfg,
      env: { OPENCLAW_PAYLOAD_LOG_DIR: "/env/dir" },
    });
    expect(result.dir).toBe("/env/dir");
  });
});

describe("resolvePayloadLogFilePath", () => {
  it("produces correct two-level path for valid sessionId and runId", () => {
    const result = resolvePayloadLogFilePath("/base", "abc-123", "run-456");
    expect(result).toBe(path.join("/base", "abc-123", "run-456.jsonl"));
  });

  it("falls back to 'unknown' for invalid sessionId", () => {
    const result = resolvePayloadLogFilePath("/base", "../evil", "run-1");
    expect(result).toBe(path.join("/base", "unknown", "run-1.jsonl"));
  });

  it("falls back to 'unknown' for empty sessionId", () => {
    const result = resolvePayloadLogFilePath("/base", "", "run-1");
    expect(result).toBe(path.join("/base", "unknown", "run-1.jsonl"));
  });

  it("falls back to 'unknown-*' for invalid runId", () => {
    const result = resolvePayloadLogFilePath("/base", "abc-123", "../evil");
    expect(result).toMatch(/\/base\/abc-123\/unknown-\d+\.jsonl$/);
  });
});

describe("createAnthropicPayloadLogger", () => {
  it("returns null when both legacy and per-session are disabled", () => {
    const result = createAnthropicPayloadLogger({
      env: {},
      cfg: {},
      sessionId: "test-session",
    });
    expect(result).toBeNull();
  });

  it("returns logger when per-session is enabled via injected writers", () => {
    const writer = makeMockWriter();
    const result = createAnthropicPayloadLogger({
      env: {},
      cfg: {},
      sessionId: "test-session",
      writers: [writer],
    });
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(true);
  });

  it("does not create per-session writer when sessionId is missing", () => {
    // per-session enabled but no sessionId — should not crash and should not create writer
    const result = createAnthropicPayloadLogger({
      env: { OPENCLAW_PAYLOAD_LOG: "true" },
      cfg: {},
      // sessionId intentionally omitted
    });
    // No legacy writer either since OPENCLAW_ANTHROPIC_PAYLOAD_LOG is not set
    expect(result).toBeNull();
  });

  it("writes to all injected writers (dual-write)", () => {
    const writer1 = makeMockWriter("/mock/legacy.jsonl");
    const writer2 = makeMockWriter("/mock/session.jsonl");
    const logger = createAnthropicPayloadLogger({
      env: {},
      cfg: {},
      sessionId: "test-session",
      runId: "run-1",
      writers: [writer1, writer2],
    });
    expect(logger).not.toBeNull();

    // recordUsage with a mock assistant message carrying usage
    const messages = [
      {
        role: "assistant",
        content: "hi",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ];
    logger!.recordUsage(messages as AgentMessage[]);

    expect(writer1.lines.length).toBe(1);
    expect(writer2.lines.length).toBe(1);

    const parsed1 = JSON.parse(writer1.lines[0]);
    const parsed2 = JSON.parse(writer2.lines[0]);
    expect(parsed1.stage).toBe("usage");
    expect(parsed2.stage).toBe("usage");
    expect(parsed1.sessionId).toBe("test-session");
    expect(parsed2.usage.input_tokens).toBe(10);
  });

  it("records error-only usage when no assistant message found", () => {
    const writer = makeMockWriter();
    const logger = createAnthropicPayloadLogger({
      env: {},
      writers: [writer],
    });
    expect(logger).not.toBeNull();

    logger!.recordUsage([], new Error("boom"));

    expect(writer.lines.length).toBe(1);
    const parsed = JSON.parse(writer.lines[0]);
    expect(parsed.stage).toBe("usage");
    expect(parsed.error).toBe("boom");
  });

  it("does not record usage when no assistant and no error", () => {
    const writer = makeMockWriter();
    const logger = createAnthropicPayloadLogger({
      env: {},
      writers: [writer],
    });
    logger!.recordUsage([]);
    expect(writer.lines.length).toBe(0);
  });

  it("dispose is callable on injected-writer logger", () => {
    const writer = makeMockWriter();
    const logger = createAnthropicPayloadLogger({
      env: {},
      writers: [writer],
    });
    expect(logger).not.toBeNull();
    // dispose should not throw even for injected writers
    expect(() => logger!.dispose()).not.toThrow();
  });
});
