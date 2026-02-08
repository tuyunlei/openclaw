import { isSubagentSessionKey } from "../../../routing/session-key.js";
import { resolveHookConfig } from "../../config.js";
import { isAgentBootstrapEvent, type HookHandler } from "../../hooks.js";
import { applySoulEvilOverride, resolveSoulEvilConfigFromHook } from "../../soul-evil.js";

const HOOK_KEY = "soul-evil";

const soulEvilHook: HookHandler = async (event) => {
  if (!isAgentBootstrapEvent(event)) {
    return;
  }

  const context = event.context;
  if (context.sessionKey && isSubagentSessionKey(context.sessionKey)) {
    return;
  }
  const cfg = context.cfg;
  const hookConfig = resolveHookConfig(cfg, HOOK_KEY);
  if (!hookConfig || hookConfig.enabled === false) {
    return;
  }

  const soulConfig = resolveSoulEvilConfigFromHook(hookConfig as Record<string, unknown>, {
    warn: (message) => console.warn(`[soul-evil] ${message}`),
  });
  if (!soulConfig) {
    return;
  }

  const workspaceDir = context.workspaceDir;
  if (!workspaceDir || !Array.isArray(context.bootstrapFiles)) {
    return;
  }

  const beforeNames = context.bootstrapFiles.map((f) => f.name);
  const hasSoul = beforeNames.includes("SOUL.md");

  const updated = await applySoulEvilOverride({
    files: context.bootstrapFiles,
    workspaceDir,
    config: soulConfig,
    userTimezone: cfg?.agents?.defaults?.userTimezone,
    log: {
      warn: (message) => console.warn(`[soul-evil] ${message}`),
      debug: (message) => console.warn(`[soul-evil] ${message}`),
    },
  });

  // Compare before/after to detect if SOUL was swapped
  const swapped = updated !== context.bootstrapFiles;
  console.warn(
    `[soul-evil] bootstrap check: hasSoul=${hasSoul} chance=${soulConfig.chance ?? "none"} swapped=${swapped} session=${context.sessionKey ?? "unknown"}`,
  );

  context.bootstrapFiles = updated;
};

export default soulEvilHook;
