import { loadConfig, type OpenClawConfig } from "../config/config.js";
import { runEventDrivenTurn } from "./event-driven-turn.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";

type HeartbeatDeps = NonNullable<Parameters<typeof runHeartbeatOnce>[0]["deps"]>;

type InjectTurnResult = {
  status: "ok" | "error" | "skipped";
  text?: string;
  reason?: string;
};

export async function runSessionInjectTurn(opts: {
  cfg?: OpenClawConfig;
  sessionKey: string;
  text?: string;
  reason?: string;
  deps?: HeartbeatDeps;
}): Promise<InjectTurnResult> {
  const cfg = opts.cfg ?? loadConfig();
  const result = await runEventDrivenTurn({
    cfg,
    sessionKey: opts.sessionKey,
    text: opts.text,
    reason: opts.reason,
    deps: opts.deps,
  });

  if (result.status === "ran") {
    return { status: "ok", text: result.text };
  }
  if (result.status === "skipped") {
    return { status: "skipped", reason: result.reason, text: result.text };
  }
  return { status: "error", reason: result.reason, text: result.text };
}
