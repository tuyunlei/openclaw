import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { spawnSubagentDirect } from "../subagent-spawn.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SessionsSpawnToolSchema = Type.Object({
  task: Type.String({ description: "The task/prompt for the sub-agent to execute." }),
  label: Type.Optional(
    Type.String({ description: "Short human-readable label shown in status updates." }),
  ),
  agentId: Type.Optional(Type.String({ description: "Target agent ID (default: same agent)." })),
  model: Type.Optional(Type.String({ description: "Model override for the sub-agent run." })),
  thinking: Type.Optional(
    Type.String({ description: "Thinking level override (low/medium/high)." }),
  ),
  runTimeoutSeconds: Type.Optional(
    Type.Number({ minimum: 0, description: "Max runtime in seconds before the run is killed." }),
  ),
  // Back-compat: older callers used timeoutSeconds for this tool.
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  cleanup: optionalStringEnum(["delete", "keep"] as const, {
    description: "Session cleanup after completion: delete removes transcript, keep preserves it.",
  }),
  announceMode: optionalStringEnum(["notify", "workflow"] as const, {
    description:
      'How completion is announced. "notify" (default): result is sent directly to the user channel and the requester agent is asked to relay it. "workflow": result is only injected into the requester session as internal context — the requester agent decides what to do next based on its own workflow logic, without any direct user-visible message. Use "workflow" for multi-step orchestration where the requester agent must process the result before responding.',
  }),
});

export function createSessionsSpawnTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  /** Explicit agent ID override for cron/hook sessions where session key parsing may not work. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_spawn",
    description:
      'Spawn a background sub-agent run in an isolated session. On completion, the result is announced back. Default announceMode "notify" sends the result directly to the user channel. Use announceMode "workflow" for multi-step orchestration: result is injected as internal context only, letting the requester agent control the next step.',
    parameters: SessionsSpawnToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const label = typeof params.label === "string" ? params.label.trim() : "";
      const requestedAgentId = readStringParam(params, "agentId");
      const modelOverride = readStringParam(params, "model");
      const thinkingOverrideRaw = readStringParam(params, "thinking");
      const cleanup =
        params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : "keep";
      const announceMode = params.announceMode === "workflow" ? "workflow" : "notify";
      // Back-compat: older callers used timeoutSeconds for this tool.
      const timeoutSecondsCandidate =
        typeof params.runTimeoutSeconds === "number"
          ? params.runTimeoutSeconds
          : typeof params.timeoutSeconds === "number"
            ? params.timeoutSeconds
            : undefined;
      const runTimeoutSeconds =
        typeof timeoutSecondsCandidate === "number" && Number.isFinite(timeoutSecondsCandidate)
          ? Math.max(0, Math.floor(timeoutSecondsCandidate))
          : undefined;

      const result = await spawnSubagentDirect(
        {
          task,
          label: label || undefined,
          agentId: requestedAgentId,
          model: modelOverride,
          thinking: thinkingOverrideRaw,
          runTimeoutSeconds,
          cleanup,
          announceMode,
          expectsCompletionMessage: true,
        },
        {
          agentSessionKey: opts?.agentSessionKey,
          agentChannel: opts?.agentChannel,
          agentAccountId: opts?.agentAccountId,
          agentTo: opts?.agentTo,
          agentThreadId: opts?.agentThreadId,
          agentGroupId: opts?.agentGroupId,
          agentGroupChannel: opts?.agentGroupChannel,
          agentGroupSpace: opts?.agentGroupSpace,
          requesterAgentIdOverride: opts?.requesterAgentIdOverride,
        },
      );

      return jsonResult(result);
    },
  };
}
