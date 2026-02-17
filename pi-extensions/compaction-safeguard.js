/**
 * Minimal compaction-safeguard extension — double-compaction guard only.
 *
 * Prevents the double-compaction bug where a kept assistant message's stale
 * usage.totalTokens triggers a second threshold compaction on already-compressed
 * context, nuking all conversation history.
 *
 * Root cause: pi-coding-agent's pre-prompt _checkCompaction finds a kept
 * assistant with stale usage (e.g. 185K) and shouldCompact returns true,
 * but the actual context is only ~1-2K tokens after compaction.
 *
 * Fix: if the latest compaction entry exists and there's no assistant message
 * AFTER it, the usage data is stale → cancel compaction.
 *
 * This extension does NOT override the compaction summarization logic.
 * Pi-coding-agent's default compact() handles the actual summary generation.
 *
 * See: https://github.com/openclaw/openclaw/issues/12170
 * See: https://github.com/openclaw/openclaw/issues/9282
 */

const LOG_PREFIX = "[compaction-guard]";

/**
 * Parse a timestamp that could be ISO string or epoch ms number.
 * Returns epoch ms or null.
 */
function parseTimestamp(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return ts;
  }
  if (typeof ts === "string" && ts.length > 0) {
    const parsed = new Date(ts).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export default function compactionGuardExtension(api) {
  api.on("session_before_compact", async (event) => {
    const entries = event.branchEntries;
    if (!Array.isArray(entries) || entries.length === 0) {
      return; // nothing to check
    }

    // Find the latest compaction entry (scan backward)
    let latestCompactionIdx = -1;
    let latestCompactionTs = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry && typeof entry === "object" && entry.type === "compaction") {
        latestCompactionIdx = i;
        latestCompactionTs = parseTimestamp(entry.timestamp);
        break;
      }
    }

    if (latestCompactionIdx === -1 || latestCompactionTs === null) {
      // No prior compaction → first compaction ever, allow it
      console.log(`${LOG_PREFIX} no prior compaction found, allowing`);
      return;
    }

    // Check if there's any assistant message AFTER the compaction entry
    // "After" means: appears later in the branch AND has a timestamp > compaction timestamp
    let hasNewAssistant = false;
    let lastAssistantTs = null;
    let lastAssistantTokens = null;

    for (let i = latestCompactionIdx + 1; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry || typeof entry !== "object") {
        continue;
      }

      // Check if this is an assistant message
      if (entry.type === "message") {
        const msg = entry.message;
        if (msg && typeof msg === "object" && msg.role === "assistant") {
          const msgTs = parseTimestamp(entry.timestamp) ?? parseTimestamp(msg.timestamp);
          if (msgTs !== null && msgTs > latestCompactionTs) {
            hasNewAssistant = true;
            lastAssistantTs = msgTs;
            lastAssistantTokens = msg.usage?.totalTokens ?? null;
            // Don't break — keep scanning to find the LAST assistant
          }
        }
      }
    }

    if (hasNewAssistant) {
      // There's a fresh assistant message after compaction → usage is valid, allow
      console.log(
        `${LOG_PREFIX} fresh assistant found after compaction ` +
          `(assistantTs=${lastAssistantTs}, tokens=${lastAssistantTokens}, ` +
          `compactionTs=${latestCompactionTs}), allowing compaction`,
      );
      return;
    }

    // No new assistant after compaction → stale usage → BLOCK
    // Log details for debugging
    const entriesAfterCompaction = entries.length - latestCompactionIdx - 1;
    const entryTypes = [];
    for (let i = latestCompactionIdx + 1; i < entries.length; i++) {
      const e = entries[i];
      if (e && typeof e === "object") {
        const t = e.type || "unknown";
        const sub = e.customType ? `:${e.customType}` : "";
        const role = e.message?.role ? `:${e.message.role}` : "";
        entryTypes.push(`${t}${sub}${role}`);
      }
    }

    // Also find what the stale assistant's usage was (in kept region, before compaction)
    let staleAssistantTokens = null;
    for (let i = latestCompactionIdx - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry || typeof entry !== "object") {
        continue;
      }
      if (entry.type === "message" && entry.message?.role === "assistant") {
        staleAssistantTokens = entry.message?.usage?.totalTokens ?? null;
        if (staleAssistantTokens !== null) {
          break;
        }
      }
    }

    console.warn(
      `${LOG_PREFIX} ⚠️ BLOCKING double-compaction! ` +
        `No new assistant after last compaction at ${new Date(latestCompactionTs).toISOString()}. ` +
        `Entries after compaction: ${entriesAfterCompaction} [${entryTypes.join(", ")}]. ` +
        `Stale kept assistant tokens: ${staleAssistantTokens}. ` +
        `This would have been a destructive double-compaction.`,
    );

    return { cancel: true };
  });
}
