import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionBindingRecord } from "../../infra/outbound/session-binding-service.js";

const hoisted = vi.hoisted(() => {
  const listBySessionMock = vi.fn<(sessionKey: string) => SessionBindingRecord[]>();
  return { listBySessionMock };
});

vi.mock("../../infra/outbound/session-binding-service.js", () => ({
  getSessionBindingService: () => ({
    listBySession: (sessionKey: string) => hoisted.listBySessionMock(sessionKey),
  }),
}));

const { AcpSessionManager } = await import("./manager.js");

function createBinding(
  overrides: Omit<Partial<SessionBindingRecord>, "conversation"> & {
    conversation?: Partial<SessionBindingRecord["conversation"]>;
  } = {},
): SessionBindingRecord {
  const { conversation: conversationOverrides, ...recordOverrides } = overrides;
  return {
    bindingId: "binding-1",
    targetSessionKey: "agent:codex:acp:session-1",
    targetKind: "session",
    status: "active",
    boundAt: 100,
    conversation: {
      channel: "discord",
      accountId: "acct-1",
      conversationId: "thread-1",
      ...conversationOverrides,
    },
    ...recordOverrides,
  };
}

describe("AcpSessionManager.getThreadProjection", () => {
  beforeEach(() => {
    hoisted.listBySessionMock.mockReset().mockReturnValue([]);
  });

  it("returns map projection directly when present", () => {
    const manager = new AcpSessionManager();
    const projection = {
      enabled: true,
      includeToolSummaries: false,
      target: {
        channel: "discord",
        to: "channel:thread-map",
        threadId: "thread-map",
      },
    } as const;
    manager.setThreadProjection("agent:codex:acp:session-1", projection);

    const resolved = manager.getThreadProjection("agent:codex:acp:session-1");

    expect(resolved).toEqual(projection);
    expect(hoisted.listBySessionMock).not.toHaveBeenCalled();
  });

  it("derives projection from active session binding when map is empty", () => {
    hoisted.listBySessionMock.mockReturnValue([
      createBinding({
        conversation: {
          channel: "discord",
          accountId: "acct-2",
          conversationId: "thread-2",
        },
      }),
      createBinding({
        bindingId: "inactive",
        status: "ended",
      }),
      createBinding({
        bindingId: "subagent",
        targetKind: "subagent",
      }),
    ]);
    const manager = new AcpSessionManager();

    const resolved = manager.getThreadProjection("agent:codex:acp:session-1");

    expect(hoisted.listBySessionMock).toHaveBeenCalledWith("agent:codex:acp:session-1");
    expect(resolved).toEqual({
      enabled: true,
      includeToolSummaries: true,
      target: {
        channel: "discord",
        accountId: "acct-2",
        to: "channel:thread-2",
        threadId: "thread-2",
      },
    });
  });

  it("returns undefined when no matching binding exists", () => {
    hoisted.listBySessionMock.mockReturnValue([]);
    const manager = new AcpSessionManager();

    const resolved = manager.getThreadProjection("agent:codex:acp:session-1");

    expect(hoisted.listBySessionMock).toHaveBeenCalledWith("agent:codex:acp:session-1");
    expect(resolved).toBeUndefined();
  });

  it("picks the newest binding by boundAt when multiple matches exist", () => {
    hoisted.listBySessionMock.mockReturnValue([
      createBinding({
        bindingId: "old",
        boundAt: 10,
        conversation: { conversationId: "thread-old" },
      }),
      createBinding({
        bindingId: "new",
        boundAt: 999,
        conversation: { conversationId: "thread-new" },
      }),
      createBinding({
        bindingId: "mid",
        boundAt: 100,
        conversation: { conversationId: "thread-mid" },
      }),
    ]);
    const manager = new AcpSessionManager();

    const resolved = manager.getThreadProjection("agent:codex:acp:session-1");

    expect(resolved).toEqual({
      enabled: true,
      includeToolSummaries: true,
      target: {
        channel: "discord",
        accountId: "acct-1",
        to: "channel:thread-new",
        threadId: "thread-new",
      },
    });
  });
});
