import type { SessionEntry } from "../../config/sessions.js";
import type { CommandHandler } from "./commands-types.js";
import { resolveCanonicalConfigPath } from "../../config/paths.js";
import { updateSessionStore } from "../../config/sessions.js";
import { execFileUtf8 } from "../../daemon/exec-file.js";
import { logVerbose } from "../../globals.js";
import { parseWarmCommand } from "../warm-command.js";

export const handleWarmCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const parsed = parseWarmCommand(params.command.commandBodyNormalized);
  if (!parsed.hasCommand) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /warm from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!parsed.mode) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /warm on|off" },
    };
  }

  if (parsed.mode === "on") {
    return handleWarmOn(params);
  }
  return handleWarmOff(params);
};

async function handleWarmOn(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  storePath?: string;
}): Promise<{ shouldContinue: false; reply: { text: string } }> {
  if (params.sessionEntry?.warmJobId) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Cache warming already enabled." },
    };
  }

  const sessionKey = params.sessionKey;
  const jobId = `warm:${sessionKey}`;
  const port = process.env.OPENCLAW_GATEWAY_PORT || "18789";
  const gatewayUrl = `http://127.0.0.1:${port}`;
  const tokenFrom = resolveCanonicalConfigPath();
  const job = JSON.stringify({
    id: jobId,
    schedule: { every: "50m" },
    action: {
      mode: "inject",
      gatewayUrl,
      tokenFrom,
      sessionKey,
      message: "Cache keep-alive. Reply HEARTBEAT_OK.",
    },
  });

  const result = await execFileUtf8("ticker", ["add", job]);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || "unknown error";
    logVerbose(`ticker add failed: code=${result.code} stderr=${detail}`);
    return {
      shouldContinue: false,
      reply: { text: `⚠️ Failed to add ticker job: ${detail}` },
    };
  }

  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    params.sessionEntry.warmJobId = jobId;
    params.sessionEntry.updatedAt = Date.now();
    params.sessionStore[params.sessionKey] = params.sessionEntry;
    if (params.storePath) {
      await updateSessionStore(params.storePath, (store) => {
        store[params.sessionKey] = params.sessionEntry as SessionEntry;
      });
    }
  }

  return {
    shouldContinue: false,
    reply: { text: "⚙️ Cache warming enabled (every 50m)." },
  };
}

async function handleWarmOff(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  storePath?: string;
}): Promise<{ shouldContinue: false; reply: { text: string } }> {
  const jobId = params.sessionEntry?.warmJobId;
  if (!jobId) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Cache warming not enabled." },
    };
  }

  const result = await execFileUtf8("ticker", ["rm", jobId]);
  if (result.code !== 0) {
    logVerbose(`ticker rm failed: code=${result.code} stderr=${result.stderr.trim()}`);
  }

  // Clear warmJobId regardless of ticker rm result to avoid deadlock state
  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    delete params.sessionEntry.warmJobId;
    params.sessionEntry.updatedAt = Date.now();
    params.sessionStore[params.sessionKey] = params.sessionEntry;
    if (params.storePath) {
      await updateSessionStore(params.storePath, (store) => {
        store[params.sessionKey] = params.sessionEntry as SessionEntry;
      });
    }
  }

  return {
    shouldContinue: false,
    reply: { text: "⚙️ Cache warming disabled." },
  };
}
