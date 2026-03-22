import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawAgentDir } from "../agents/agent-paths.js";
import { modelKey, normalizeModelRef, normalizeProviderId } from "../agents/model-selection.js";
import type { NormalizedUsage } from "../agents/usage.js";
import type { OpenClawConfig } from "../config/config.js";
import type { ModelProviderConfig } from "../config/types.models.js";
import { getCachedGatewayModelPricing } from "../gateway/model-pricing-cache.js";

export type ModelCostConfig = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

// ── Anthropic subscription credit rates (per token) ──────────────────────
// cacheRead costs 0 credits for all models.
const ANTHROPIC_CREDIT_RATES: Record<string, { input: number; output: number }> = {
  opus: { input: 2 / 3, output: 10 / 3 },
  sonnet: { input: 2 / 5, output: 2 },
  haiku: { input: 1 / 15, output: 1 / 3 },
};

/** Max 20× weekly credit limit. */
const WEEKLY_CREDIT_LIMIT = 83_300_000;

/**
 * Estimate this turn's credit consumption as a percentage of the weekly limit.
 * Returns `null` for non-Anthropic models or when usage is unavailable.
 *
 * Credit formula: input × rate + cacheWrite × rate + output × rate.
 * cacheRead is free (0 credits).
 */
export function estimateWeeklyLimitPct(
  usage: NormalizedUsage | undefined,
  model: string | undefined,
): number | null {
  if (!usage || !model) {
    return null;
  }
  const modelLower = model.toLowerCase();
  let tier: { input: number; output: number } | undefined;
  for (const [key, rates] of Object.entries(ANTHROPIC_CREDIT_RATES)) {
    if (modelLower.includes(key)) {
      tier = rates;
      break;
    }
  }
  if (!tier) {
    return null;
  }
  const input = typeof usage.input === "number" ? usage.input : 0;
  const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
  const output = typeof usage.output === "number" ? usage.output : 0;
  // cacheWrite costs the same as input for all Anthropic models.
  const credits = (input + cacheWrite) * tier.input + output * tier.output;
  if (!Number.isFinite(credits) || credits <= 0) {
    return null;
  }
  return (credits / WEEKLY_CREDIT_LIMIT) * 100;
}

export type UsageTotals = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

type ModelsJsonCostCache = {
  path: string;
  mtimeMs: number;
  entries: Map<string, ModelCostConfig>;
};

let modelsJsonCostCache: ModelsJsonCostCache | null = null;

export function formatTokenCount(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "0";
  }
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(1)}m`;
  }
  if (safe >= 1_000) {
    const precision = safe >= 10_000 ? 0 : 1;
    const formattedThousands = (safe / 1_000).toFixed(precision);
    if (Number(formattedThousands) >= 1_000) {
      return `${(safe / 1_000_000).toFixed(1)}m`;
    }
    return `${formattedThousands}k`;
  }
  return String(Math.round(safe));
}

export function formatUsd(value?: number): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

function toResolvedModelKey(params: { provider?: string; model?: string }): string | null {
  const provider = params.provider?.trim();
  const model = params.model?.trim();
  if (!provider || !model) {
    return null;
  }
  const normalized = normalizeModelRef(provider, model);
  return modelKey(normalized.provider, normalized.model);
}

function buildProviderCostIndex(
  providers: Record<string, ModelProviderConfig> | undefined,
): Map<string, ModelCostConfig> {
  const entries = new Map<string, ModelCostConfig>();
  if (!providers) {
    return entries;
  }
  for (const [providerKey, providerConfig] of Object.entries(providers)) {
    const normalizedProvider = normalizeProviderId(providerKey);
    for (const model of providerConfig?.models ?? []) {
      const normalized = normalizeModelRef(normalizedProvider, model.id);
      entries.set(modelKey(normalized.provider, normalized.model), model.cost);
    }
  }
  return entries;
}

function loadModelsJsonCostIndex(): Map<string, ModelCostConfig> {
  const modelsPath = path.join(resolveOpenClawAgentDir(), "models.json");
  try {
    const stat = fs.statSync(modelsPath);
    if (
      modelsJsonCostCache &&
      modelsJsonCostCache.path === modelsPath &&
      modelsJsonCostCache.mtimeMs === stat.mtimeMs
    ) {
      return modelsJsonCostCache.entries;
    }

    const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf8")) as {
      providers?: Record<string, ModelProviderConfig>;
    };
    const entries = buildProviderCostIndex(parsed.providers);
    modelsJsonCostCache = {
      path: modelsPath,
      mtimeMs: stat.mtimeMs,
      entries,
    };
    return entries;
  } catch {
    const empty = new Map<string, ModelCostConfig>();
    modelsJsonCostCache = {
      path: modelsPath,
      mtimeMs: -1,
      entries: empty,
    };
    return empty;
  }
}

function findConfiguredProviderCost(params: {
  provider?: string;
  model?: string;
  config?: OpenClawConfig;
}): ModelCostConfig | undefined {
  const key = toResolvedModelKey(params);
  if (!key) {
    return undefined;
  }
  return buildProviderCostIndex(params.config?.models?.providers).get(key);
}

export function resolveModelCostConfig(params: {
  provider?: string;
  model?: string;
  config?: OpenClawConfig;
}): ModelCostConfig | undefined {
  const key = toResolvedModelKey(params);
  if (!key) {
    return undefined;
  }

  const modelsJsonCost = loadModelsJsonCostIndex().get(key);
  if (modelsJsonCost) {
    return modelsJsonCost;
  }

  const configuredCost = findConfiguredProviderCost(params);
  if (configuredCost) {
    return configuredCost;
  }

  return getCachedGatewayModelPricing(params);
}

const toNumber = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function estimateUsageCost(params: {
  usage?: NormalizedUsage | UsageTotals | null;
  cost?: ModelCostConfig;
}): number | undefined {
  const usage = params.usage;
  const cost = params.cost;
  if (!usage || !cost) {
    return undefined;
  }
  const input = toNumber(usage.input);
  const output = toNumber(usage.output);
  const cacheRead = toNumber(usage.cacheRead);
  const cacheWrite = toNumber(usage.cacheWrite);
  const total =
    input * cost.input +
    output * cost.output +
    cacheRead * cost.cacheRead +
    cacheWrite * cost.cacheWrite;
  if (!Number.isFinite(total)) {
    return undefined;
  }
  return total / 1_000_000;
}

export function __resetUsageFormatCachesForTest(): void {
  modelsJsonCostCache = null;
}
