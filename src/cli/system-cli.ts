import type { Command } from "commander";
import { danger } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import type { GatewayRpcOpts } from "./gateway-rpc.js";
import { addGatewayClientOptions, callGatewayFromCli } from "./gateway-rpc.js";

type SystemEventOpts = GatewayRpcOpts & {
  text?: string;
  mode?: string;
  session?: string;
  json?: boolean;
};

const normalizeWakeMode = (raw: unknown): "now" | "next-heartbeat" | "agent-turn" => {
  const mode = typeof raw === "string" ? raw.trim() : "";
  if (!mode) {
    return "next-heartbeat";
  }
  if (mode === "now" || mode === "next-heartbeat" || mode === "agent-turn") {
    return mode;
  }
  throw new Error("--mode must be now, next-heartbeat, or agent-turn");
};

export function registerSystemCli(program: Command) {
  const system = program
    .command("system")
    .description("System tools (events, heartbeat, presence)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/system", "docs.openclaw.ai/cli/system")}\n`,
    );

  addGatewayClientOptions(
    system
      .command("event")
      .description("Enqueue a system event and optionally trigger a heartbeat")
      .requiredOption("--text <text>", "System event text")
      .option("--mode <mode>", "Wake mode (now|next-heartbeat|agent-turn)", "next-heartbeat")
      .option("--session <sessionKey>", "Target session key (required for agent-turn mode)")
      .option("--json", "Output JSON", false),
  ).action(async (opts: SystemEventOpts) => {
    try {
      const text = typeof opts.text === "string" ? opts.text.trim() : "";
      if (!text) {
        throw new Error("--text is required");
      }
      const mode = normalizeWakeMode(opts.mode);
      if (mode === "agent-turn" && !opts.session) {
        throw new Error("--session is required for agent-turn mode");
      }
      const wakeParams: Record<string, unknown> = { mode, text };
      if (opts.session) {
        wakeParams.sessionKey = opts.session;
      }
      const result = await callGatewayFromCli("wake", opts, wakeParams, { expectFinal: false });
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(result, null, 2));
      } else {
        defaultRuntime.log("ok");
      }
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  const heartbeat = system.command("heartbeat").description("Heartbeat controls");

  addGatewayClientOptions(
    heartbeat
      .command("last")
      .description("Show the last heartbeat event")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli("last-heartbeat", opts, undefined, {
        expectFinal: false,
      });
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    heartbeat
      .command("enable")
      .description("Enable heartbeats")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli(
        "set-heartbeats",
        opts,
        { enabled: true },
        { expectFinal: false },
      );
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    heartbeat
      .command("disable")
      .description("Disable heartbeats")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli(
        "set-heartbeats",
        opts,
        { enabled: false },
        { expectFinal: false },
      );
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    system
      .command("presence")
      .description("List system presence entries")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli("system-presence", opts, undefined, {
        expectFinal: false,
      });
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });
}
