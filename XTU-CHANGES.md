# XTU Changes

Local changes on xtu/main that diverge from upstream openclaw/main.

## 2026-03-08

### fix(a2a): grant ADMIN_SCOPE to A2A agent calls so target sessions retain full tool set

**File:** `src/agents/tools/agent-step.ts`

A2A messages (`sessions_send`) triggered via the internal gateway RPC were
resolved with `senderIsOwner=false` because the `callGateway` call used
least-privilege scoping (`WRITE_SCOPE`). This caused `applyOwnerOnlyToolPolicy`
to strip `ownerOnly` tools (`cron`, `gateway`) from the target session's run.

The reduced tool set had two consequences:

1. **History corruption:** `sanitizeSessionHistory` → `repairToolCallInputs`
   dropped historical `toolCall` blocks whose name was not in the current
   `allowedToolNames`, producing thinking-only assistant messages that
   Anthropic rejected with _"thinking blocks in the latest assistant message
   cannot be modified"_.

2. **Cache invalidation:** The different tool set changed the system prompt
   (tool descriptions section), breaking prompt cache on every A2A ↔ normal
   message transition.

Fix: pass `scopes: [ADMIN_SCOPE]` in the `callGateway` call so the target
session inherits owner privileges and retains the full tool set.

## 2026-03-07

### fix(cron): hide agent-turn from wake mode tool description

**Commit:** `74269bfc6d`

Removed `agent-turn` from `cron-tool.ts` description so models default to
`now`/`next-heartbeat`. Implementation kept for Ticker backward compatibility.
