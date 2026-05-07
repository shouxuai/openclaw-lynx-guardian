import { describe, expect, it, vi } from "vitest";

import { registerLifecycleHooks } from "../src/hooks/lifecycle-hooks.js";
import { registerOutputHooks } from "../src/hooks/output-hooks.js";

function createHookApi() {
  const handlers: Record<string, (event: any, ctx: any) => any> = {};
  return {
    handlers,
    api: {
      on: vi.fn((event: string, handler: (event: any, ctx: any) => any) => {
        handlers[event] = handler;
      }),
    },
  };
}

function createRuntime(overrides: Record<string, unknown> = {}) {
  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    appendLifecycleProbe: vi.fn(),
    clearRecentActiveDeliveryTargetForContext: vi.fn(),
    localConsoleHooks: undefined,
    normalizeString: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
    resolveChannelProfile: () => "webchat",
    revokeApprovalGrantsForLifecycle: vi.fn(),
    ...overrides,
  };
}

describe("approval grant lifecycle hooks", () => {
  it("revokes in-memory grants on session_end", async () => {
    const { api, handlers } = createHookApi();
    const revokeApprovalGrantsForLifecycle = vi.fn(() => 1);
    registerLifecycleHooks(api as any, createRuntime({ revokeApprovalGrantsForLifecycle }) as any);

    await handlers.session_end?.(
      { chainId: "chain-1", runId: "run-1" },
      { sessionKey: "session-1", runId: "run-1" },
    );

    expect(revokeApprovalGrantsForLifecycle).toHaveBeenCalledWith({
      sessionKey: "session-1",
      chainId: "chain-1",
      runId: "run-1",
      reason: "session_end",
    });
  });

  it("revokes in-memory grants before agent_end returns early for empty messages", async () => {
    const { api, handlers } = createHookApi();
    const revokeApprovalGrantsForLifecycle = vi.fn(() => 1);
    registerOutputHooks(api as any, createRuntime({ revokeApprovalGrantsForLifecycle }) as any);

    await handlers.agent_end?.(
      { messages: [], chainId: "chain-1", runId: "run-1" },
      { sessionKey: "session-1", runId: "run-1" },
    );

    expect(revokeApprovalGrantsForLifecycle).toHaveBeenCalledWith({
      sessionKey: "session-1",
      chainId: "chain-1",
      runId: "run-1",
      reason: "agent_end",
    });
  });
});
