import { Type } from "@sinclair/typebox";
import { optionalStringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, readGatewayCallOptions, type GatewayCallOptions } from "./gateway.js";

const WAKE_MODES = ["now", "next-heartbeat"] as const;

const WakeToolSchema = Type.Object({
  text: Type.String({ description: "System event text to inject" }),
  mode: optionalStringEnum(WAKE_MODES),
  sessionKey: Type.Optional(
    Type.String({
      description: "Target session key (e.g. agent:main:telegram:group:-100xxx:topic:4467)",
    }),
  ),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
});

type WakeToolDeps = {
  callGatewayTool?: typeof callGatewayTool;
};

export function createWakeTool(deps?: WakeToolDeps): AnyAgentTool {
  const callGateway = deps?.callGatewayTool ?? callGatewayTool;
  return {
    label: "Wake",
    name: "wake",
    ownerOnly: true,
    description: `Send a system event to a session and optionally trigger an immediate heartbeat.

Injects text as a system event into the target session's event queue.

Parameters:
- text (required): The system event content to inject
- mode: "now" (trigger immediate heartbeat) or "next-heartbeat" (wait for next natural heartbeat, default)
- sessionKey: Target session key. Without it, targets the current/main session.

Use "now" mode when the event needs immediate processing. Use "next-heartbeat" for non-urgent events.`,
    parameters: WakeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const gatewayOpts: GatewayCallOptions = {
        ...readGatewayCallOptions(params),
      };
      const text = readStringParam(params, "text", { required: true });
      const mode =
        params.mode === "now" || params.mode === "next-heartbeat" ? params.mode : "next-heartbeat";
      const sessionKey = readStringParam(params, "sessionKey");
      return jsonResult(
        await callGateway("wake", gatewayOpts, { mode, text, sessionKey }, { expectFinal: false }),
      );
    },
  };
}
