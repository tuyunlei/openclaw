import { resolveRunModelFallbacksOverride } from "../../agents/agent-scope.js";
import type { NormalizedUsage } from "../../agents/usage.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import type { ChannelId, ChannelThreadingToolContext } from "../../channels/plugins/types.js";
import { normalizeAnyChannelId, normalizeChannelId } from "../../channels/registry.js";
import type { OpenClawConfig } from "../../config/config.js";
import { isReasoningTagProvider } from "../../utils/provider-utils.js";
import {
  estimateUsageCost,
  estimateWeeklyLimitPct,
  formatTokenCount,
  formatUsd,
} from "../../utils/usage-format.js";
import type { TemplateContext } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import { resolveOriginMessageProvider, resolveOriginMessageTo } from "./origin-routing.js";
import type { FollowupRun } from "./queue.js";

const BUN_FETCH_SOCKET_ERROR_RE = /socket connection was closed unexpectedly/i;

/**
 * Build provider-specific threading context for tool auto-injection.
 */
export function buildThreadingToolContext(params: {
  sessionCtx: TemplateContext;
  config: OpenClawConfig | undefined;
  hasRepliedRef: { value: boolean } | undefined;
}): ChannelThreadingToolContext {
  const { sessionCtx, config, hasRepliedRef } = params;
  const currentMessageId = sessionCtx.MessageSidFull ?? sessionCtx.MessageSid;
  const originProvider = resolveOriginMessageProvider({
    originatingChannel: sessionCtx.OriginatingChannel,
    provider: sessionCtx.Provider,
  });
  const originTo = resolveOriginMessageTo({
    originatingTo: sessionCtx.OriginatingTo,
    to: sessionCtx.To,
  });
  if (!config) {
    return {
      currentMessageId,
    };
  }
  const rawProvider = originProvider?.trim().toLowerCase();
  if (!rawProvider) {
    return {
      currentMessageId,
    };
  }
  const provider = normalizeChannelId(rawProvider) ?? normalizeAnyChannelId(rawProvider);
  // Fallback for unrecognized/plugin channels (e.g., BlueBubbles before plugin registry init)
  const threading = provider ? getChannelPlugin(provider)?.threading : undefined;
  if (!threading?.buildToolContext) {
    return {
      currentChannelId: originTo?.trim() || undefined,
      currentChannelProvider: provider ?? (rawProvider as ChannelId),
      currentMessageId,
      hasRepliedRef,
    };
  }
  const context =
    threading.buildToolContext({
      cfg: config,
      accountId: sessionCtx.AccountId,
      context: {
        Channel: originProvider,
        From: sessionCtx.From,
        To: originTo,
        ChatType: sessionCtx.ChatType,
        CurrentMessageId: currentMessageId,
        ReplyToId: sessionCtx.ReplyToId,
        ThreadLabel: sessionCtx.ThreadLabel,
        MessageThreadId: sessionCtx.MessageThreadId,
        NativeChannelId: sessionCtx.NativeChannelId,
      },
      hasRepliedRef,
    }) ?? {};
  return {
    ...context,
    currentChannelProvider: provider!, // guaranteed non-null since threading exists
    currentMessageId: context.currentMessageId ?? currentMessageId,
  };
}

export const isBunFetchSocketError = (message?: string) =>
  Boolean(message && BUN_FETCH_SOCKET_ERROR_RE.test(message));

export const formatBunFetchSocketError = (message: string) => {
  const trimmed = message.trim();
  return [
    "⚠️ LLM connection failed. This could be due to server issues, network problems, or context length exceeded (e.g., with local LLMs like LM Studio). Original error:",
    "```",
    trimmed || "Unknown error",
    "```",
  ].join("\n");
};

export const formatResponseUsageLine = (params: {
  usage?: NormalizedUsage;
  /** Usage from the last individual API call (not accumulated). When provided,
   *  context-window percentage is derived from this instead of the accumulated
   *  `usage`, which sums tokens across all API calls in a run and therefore
   *  overstates the actual current context size. */
  lastCallUsage?: NormalizedUsage;
  showCost: boolean;
  costConfig?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextTokens?: number;
  /** Extended fields for "full" mode footer. */
  model?: string;
  provider?: string;
  authProfileId?: string;
  reasoningLevel?: string;
  sessionKey?: string;
}): string | null => {
  const usage = params.usage;
  if (!usage) {
    return null;
  }
  const input = usage.input;
  const output = usage.output;
  if (typeof input !== "number" && typeof output !== "number") {
    return null;
  }
  const inputLabel = typeof input === "number" ? formatTokenCount(input) : "?";
  const outputLabel = typeof output === "number" ? formatTokenCount(output) : "?";
  const cacheRead = usage.cacheRead;
  const cacheWrite = usage.cacheWrite;
  const cacheParts: string[] = [];
  if (typeof cacheRead === "number" && cacheRead > 0) {
    cacheParts.push(`${formatTokenCount(cacheRead)} cr`);
  }
  if (typeof cacheWrite === "number" && cacheWrite > 0) {
    cacheParts.push(`${formatTokenCount(cacheWrite)} cw`);
  }
  const cacheLabel = cacheParts.length > 0 ? ` / ${cacheParts.join(" / ")}` : "";

  // Calculate context usage percentage.
  // Prefer lastCallUsage (single API call) over accumulated usage so the
  // percentage reflects actual current context size, not the sum of all calls.
  const contextLabel = (() => {
    if (!params.contextTokens) {
      return null;
    }
    const ctxUsage = params.lastCallUsage ?? usage;
    const ctxInput = ctxUsage.input ?? 0;
    if (typeof ctxInput !== "number") {
      return null;
    }
    const totalTokens = ctxInput + (ctxUsage.cacheRead ?? 0) + (ctxUsage.cacheWrite ?? 0);
    const pct = (totalTokens / params.contextTokens) * 100;
    if (!Number.isFinite(pct)) {
      return null;
    }
    return `${pct.toFixed(0)}%`;
  })();

  // Context window size label (e.g. "1.0m").
  const cwLabel = params.contextTokens ? formatTokenCount(params.contextTokens) : null;

  const cost =
    params.showCost && typeof input === "number" && typeof output === "number"
      ? estimateUsageCost({
          usage: {
            input,
            output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
          },
          cost: params.costConfig,
        })
      : undefined;

  // Weekly limit percentage (Anthropic subscription credits).
  const weeklyPct = estimateWeeklyLimitPct(usage, params.model);
  const weeklyLabel =
    weeklyPct != null ? `${weeklyPct < 0.01 ? "<0.01" : weeklyPct.toFixed(2)}% wk` : null;

  // ── Build extended footer when model/provider info is available ──
  if (params.model) {
    const parts: string[] = [];
    // ctx%/cw
    if (contextLabel && cwLabel) {
      parts.push(`${contextLabel}/${cwLabel}`);
    } else if (contextLabel) {
      parts.push(contextLabel);
    }
    // model
    parts.push(params.model);
    // provider:profile (avoid duplication when profileId already has provider prefix)
    if (params.provider && params.authProfileId) {
      const profileId = params.authProfileId;
      if (profileId.startsWith(`${params.provider}:`)) {
        parts.push(profileId);
      } else {
        parts.push(`${params.provider}:${profileId}`);
      }
    } else if (params.provider) {
      parts.push(params.provider);
    }
    // thinking/reasoning level
    if (params.reasoningLevel) {
      parts.push(params.reasoningLevel);
    }
    // weekly limit %
    if (weeklyLabel) {
      parts.push(weeklyLabel);
    }
    let line = parts.join(" · ");
    // session key on second line
    if (params.sessionKey) {
      line += `\n\`${params.sessionKey}\``;
    }
    return line;
  }

  // ── Default compact format (backwards compatible) ──
  const costLabel = params.showCost ? formatUsd(cost) : undefined;
  const contextSuffix = contextLabel ? ` · ${contextLabel} ctx` : "";
  const costSuffix = costLabel ? ` · est ${costLabel}` : "";
  return `Usage: ${inputLabel} in / ${outputLabel} out${cacheLabel}${contextSuffix}${costSuffix}`;
};

export const appendUsageLine = (payloads: ReplyPayload[], line: string): ReplyPayload[] => {
  let index = -1;
  for (let i = payloads.length - 1; i >= 0; i -= 1) {
    if (payloads[i]?.text) {
      index = i;
      break;
    }
  }
  if (index === -1) {
    return [...payloads, { text: line }];
  }
  const existing = payloads[index];
  const existingText = existing.text ?? "";
  const separator = existingText.endsWith("\n") ? "" : "\n";
  const next = {
    ...existing,
    text: `${existingText}${separator}${line}`,
  };
  const updated = payloads.slice();
  updated[index] = next;
  return updated;
};

export const resolveEnforceFinalTag = (run: FollowupRun["run"], provider: string) =>
  Boolean(run.enforceFinalTag || isReasoningTagProvider(provider));

export function resolveModelFallbackOptions(run: FollowupRun["run"]) {
  return {
    cfg: run.config,
    provider: run.provider,
    model: run.model,
    agentDir: run.agentDir,
    fallbacksOverride: resolveRunModelFallbacksOverride({
      cfg: run.config,
      agentId: run.agentId,
      sessionKey: run.sessionKey,
    }),
  };
}

export function buildEmbeddedRunBaseParams(params: {
  run: FollowupRun["run"];
  provider: string;
  model: string;
  runId: string;
  authProfile: ReturnType<typeof resolveProviderScopedAuthProfile>;
  allowTransientCooldownProbe?: boolean;
}) {
  return {
    sessionFile: params.run.sessionFile,
    workspaceDir: params.run.workspaceDir,
    agentDir: params.run.agentDir,
    config: params.run.config,
    skillsSnapshot: params.run.skillsSnapshot,
    ownerNumbers: params.run.ownerNumbers,
    inputProvenance: params.run.inputProvenance,
    senderIsOwner: params.run.senderIsOwner,
    enforceFinalTag: resolveEnforceFinalTag(params.run, params.provider),
    provider: params.provider,
    model: params.model,
    ...params.authProfile,
    thinkLevel: params.run.thinkLevel,
    verboseLevel: params.run.verboseLevel,
    reasoningLevel: params.run.reasoningLevel,
    execOverrides: params.run.execOverrides,
    bashElevated: params.run.bashElevated,
    timeoutMs: params.run.timeoutMs,
    runId: params.runId,
    allowTransientCooldownProbe: params.allowTransientCooldownProbe,
  };
}

export function buildEmbeddedContextFromTemplate(params: {
  run: FollowupRun["run"];
  sessionCtx: TemplateContext;
  hasRepliedRef: { value: boolean } | undefined;
}) {
  return {
    sessionId: params.run.sessionId,
    sessionKey: params.run.sessionKey,
    agentId: params.run.agentId,
    messageProvider: resolveOriginMessageProvider({
      originatingChannel: params.sessionCtx.OriginatingChannel,
      provider: params.sessionCtx.Provider,
    }),
    agentAccountId: params.sessionCtx.AccountId,
    messageTo: resolveOriginMessageTo({
      originatingTo: params.sessionCtx.OriginatingTo,
      to: params.sessionCtx.To,
    }),
    messageThreadId: params.sessionCtx.MessageThreadId ?? undefined,
    // Provider threading context for tool auto-injection
    ...buildThreadingToolContext({
      sessionCtx: params.sessionCtx,
      config: params.run.config,
      hasRepliedRef: params.hasRepliedRef,
    }),
  };
}

export function buildTemplateSenderContext(sessionCtx: TemplateContext) {
  return {
    senderId: sessionCtx.SenderId?.trim() || undefined,
    senderName: sessionCtx.SenderName?.trim() || undefined,
    senderUsername: sessionCtx.SenderUsername?.trim() || undefined,
    senderE164: sessionCtx.SenderE164?.trim() || undefined,
  };
}

export function resolveRunAuthProfile(run: FollowupRun["run"], provider: string) {
  return resolveProviderScopedAuthProfile({
    provider,
    primaryProvider: run.provider,
    authProfileId: run.authProfileId,
    authProfileIdSource: run.authProfileIdSource,
  });
}

export function buildEmbeddedRunContexts(params: {
  run: FollowupRun["run"];
  sessionCtx: TemplateContext;
  hasRepliedRef: { value: boolean } | undefined;
  provider: string;
}) {
  return {
    authProfile: resolveRunAuthProfile(params.run, params.provider),
    embeddedContext: buildEmbeddedContextFromTemplate({
      run: params.run,
      sessionCtx: params.sessionCtx,
      hasRepliedRef: params.hasRepliedRef,
    }),
    senderContext: buildTemplateSenderContext(params.sessionCtx),
  };
}

export function buildEmbeddedRunExecutionParams(params: {
  run: FollowupRun["run"];
  sessionCtx: TemplateContext;
  hasRepliedRef: { value: boolean } | undefined;
  provider: string;
  model: string;
  runId: string;
  allowTransientCooldownProbe?: boolean;
}) {
  const { authProfile, embeddedContext, senderContext } = buildEmbeddedRunContexts(params);
  const runBaseParams = buildEmbeddedRunBaseParams({
    run: params.run,
    provider: params.provider,
    model: params.model,
    runId: params.runId,
    authProfile,
    allowTransientCooldownProbe: params.allowTransientCooldownProbe,
  });
  return {
    embeddedContext,
    senderContext,
    runBaseParams,
  };
}

export function resolveProviderScopedAuthProfile(params: {
  provider: string;
  primaryProvider: string;
  authProfileId?: string;
  authProfileIdSource?: "auto" | "user";
}): { authProfileId?: string; authProfileIdSource?: "auto" | "user" } {
  const authProfileId =
    params.provider === params.primaryProvider ? params.authProfileId : undefined;
  return {
    authProfileId,
    authProfileIdSource: authProfileId ? params.authProfileIdSource : undefined,
  };
}
