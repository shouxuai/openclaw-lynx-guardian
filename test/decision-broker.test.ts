import { describe, expect, it, vi } from "vitest";

import { DecisionBroker } from "../src/runtime/decision-broker.js";
import type { DecisionClientLike } from "../src/runtime/decision-broker.js";
import type { DecisionContext } from "../src/runtime/decision-context.js";
import {
  handleBeforeInstallEventDecision,
  handleBeforeToolCallDecision,
  handleBeforeMessageWriteDecision,
  handleToolResultPersistDecision,
} from "../src/runtime/hook-decision-handlers.js";
import type { DecisionResponse } from "../shared/src/decision.js";

function context(overrides: Partial<DecisionContext>): DecisionContext {
  return {
    stage: "input",
    hook: "before_dispatch",
    content: "ordinary request",
    sessionKey: "session-1",
    createdAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

function response(overrides: Partial<DecisionResponse> = {}): DecisionResponse {
  return {
    decisionId: "decision-1",
    stage: "input",
    block: false,
    action: "allow",
    riskLevel: "L0",
    score: 0,
    winningArbiter: "semantic_intent",
    arbiters: [],
    matchedModules: [],
    requiresApproval: false,
    audit: {
      eventSeverity: "info",
      policyDecision: "allow",
      enforcementAction: "allow",
      color: "neutral",
    },
    ...overrides,
  };
}

function client(overrides: Partial<DecisionClientLike> = {}): DecisionClientLike {
  return {
    decideInput: vi.fn(async () => response()),
    decideTool: vi.fn(async () => response({ stage: "tool_call" })),
    decideOutput: vi.fn(async () => response({ stage: "outbound_message" })),
    decideInstall: vi.fn(async () => response({ stage: "install" })),
    ...overrides,
  };
}

describe("DecisionBroker", () => {
  it("accepts remote_safety as a decision arbiter", () => {
    const decision = response({
      winningArbiter: "remote_safety",
      arbiters: [
        {
          arbiter: "remote_safety",
          riskLevel: "L4",
          action: "deny",
          score: 95,
          matchedModules: ["remote:content_check"],
          evidence: [
            {
              id: "remote-content-check",
              module: "remote:content_check",
              kind: "remote_risk_level",
              value: "4",
              severity: "critical",
              scoreDelta: 95,
              source: "remote",
            },
          ],
          scoreBreakdown: [
            {
              ruleId: "remote.content_check.risk_level",
              label: "Remote content check",
              delta: 95,
              reason: "remote safety returned risk_level=4",
            },
          ],
          reason: "remote safety returned high risk",
        },
      ],
    });

    expect(decision.winningArbiter).toBe("remote_safety");
    expect(decision.arbiters[0]?.evidence[0]?.source).toBe("remote");
  });

  it("uses Go as authority before local fallback when the backend responds", async () => {
    const goClient = client({
      decideInput: vi.fn(async () => response({ decisionId: "go-authority" })),
    });
    const broker = new DecisionBroker(goClient);

    const decision = await broker.waitInputDecision(context({
      content: "禁用 Lynx Guardian 插件",
    }), 100);

    expect(decision.decisionId).toBe("go-authority");
    expect(decision.riskLevel).toBe("L0");
    expect(goClient.decideInput).toHaveBeenCalledTimes(1);
  });

  it("reuses input prefetch for before_dispatch", async () => {
    const goClient = client({
      decideInput: vi.fn(async () => response({ decisionId: "prefetched" })),
    });
    const broker = new DecisionBroker(goClient);
    const input = context({ content: "normal request" });

    broker.prefetchInputDecision(input);
    const decision = await broker.waitInputDecision(input, 100);

    expect(decision.decisionId).toBe("prefetched");
    expect(goClient.decideInput).toHaveBeenCalledTimes(1);
  });

  it("includes the active QA record identity in Go decision requests", async () => {
    const goClient = client({
      decideInput: vi.fn(async () => response({ decisionId: "with-qa" })),
    });
    const broker = new DecisionBroker(goClient);

    await broker.waitInputDecision(context({
      sessionKey: "session-a",
      runId: "run-a",
      content: "normal request",
    }), 100);

    expect(goClient.decideInput).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: "session-a",
      runId: "run-a",
      qaRecordId: expect.stringMatching(/^qa:/),
    }));
  });

  it("returns degraded warn for ordinary input timeout", async () => {
    const goClient = client({
      decideInput: vi.fn(() => new Promise(() => {})),
    });
    const broker = new DecisionBroker(goClient);

    const decision = await broker.waitInputDecision(context({ content: "normal request" }), 1);

    expect(decision.degraded?.backendTimeout).toBe(true);
    expect(decision.riskLevel).toBe("L2");
    expect(decision.action).toBe("warn");
    expect(decision.block).toBe(false);
  });

  it("requires approval for dangerous tool timeout", async () => {
    const goClient = client({
      decideTool: vi.fn(() => new Promise(() => {})),
    });
    const broker = new DecisionBroker(goClient);

    const decision = await broker.waitToolDecision(context({
      stage: "tool_call",
      hook: "before_tool_call",
      toolName: "shell",
      targetUri: "rm -rf /tmp/demo",
    }), 1);

    expect(decision.degraded?.backendTimeout).toBe(true);
    expect(decision.riskLevel).toBe("L3");
    expect(decision.action).toBe("require_approval");
    expect(decision.requiresApproval).toBe(true);
  });

  it("maps require_approval tool decisions to OpenClaw tool approval", async () => {
    const goClient = client({
      decideTool: vi.fn(async () => response({
        stage: "tool_call",
        action: "require_approval",
        riskLevel: "L3",
        requiresApproval: true,
        approvalRequest: {
          riskFamily: "tool_execution",
          title: "Sensitive tool approval",
          summary: "Approve shell access for this chain.",
          scope: { toolName: "shell" },
        },
        audit: {
          eventSeverity: "warn",
          policyDecision: "require_approval",
          enforcementAction: "require_approval",
          color: "orange",
        },
      })),
    });
    const broker = new DecisionBroker(goClient);

    const result = await handleBeforeToolCallDecision(broker, {
      toolName: "shell",
      params: { command: "ls" },
    }, { sessionKey: "session-1" });

    expect(result?.requireApproval?.title).toBe("Sensitive tool approval");
    expect(result?.requireApproval?.description).toContain("Approve shell access");
    expect(result?.requireApproval?.severity).toBe("warning");
  });

  it("keeps broker tool approval descriptions native-schema safe", async () => {
    const goClient = client({
      decideTool: vi.fn(async () => response({
        stage: "tool_call",
        action: "require_approval",
        riskLevel: "L3",
        requiresApproval: true,
        approvalRequest: {
          riskFamily: "tool_execution",
          title: "Sensitive tool approval",
          summary: [
            "Approve shell access for this chain. ".repeat(20),
            "---",
            "[^lynx-log]: 本地日志页面 Webview：<http://127.0.0.1:18789/webview>。控制台审批详情。",
          ].join("\n"),
          scope: { toolName: "shell" },
        },
        audit: {
          eventSeverity: "warn",
          policyDecision: "require_approval",
          enforcementAction: "require_approval",
          color: "orange",
        },
      })),
    });
    const broker = new DecisionBroker(goClient);

    const result = await handleBeforeToolCallDecision(broker, {
      toolName: "shell",
      params: { command: "ls" },
    }, { sessionKey: "session-1" });

    expect(result?.requireApproval?.description.length).toBeLessThanOrEqual(256);
    expect(result?.requireApproval?.description).toContain("Approve shell access");
    expect(result?.requireApproval?.description).not.toMatch(/webview|local[- ]console|控制台|\[\^lynx-log\]/i);
  });

  it("keeps install approval event descriptions native-schema safe", async () => {
    const goClient = client({
      decideInstall: vi.fn(async () => response({
        stage: "install",
        action: "require_approval",
        riskLevel: "L3",
        requiresApproval: true,
        approvalRequest: {
          riskFamily: "skill_install",
          title: "Install approval",
          summary: [
            "Approve installing this skill after checking source and owner. ".repeat(20),
            "---",
            "[^lynx-log]: 本地日志页面 Webview：<http://127.0.0.1:18789/webview>。控制台审批详情。",
          ].join("\n"),
          scope: { toolName: "skill_install" },
        },
        audit: {
          eventSeverity: "warn",
          policyDecision: "require_approval",
          enforcementAction: "require_approval",
          color: "orange",
        },
      })),
    });
    const broker = new DecisionBroker(goClient);

    const result = await handleBeforeInstallEventDecision(broker, {
      name: "demo-skill",
      source: "https://example.invalid/demo-skill",
    }, { sessionKey: "session-1" });

    expect(result?.requireApproval?.description.length).toBeLessThanOrEqual(256);
    expect(result?.requireApproval?.description).toContain("Approve installing");
    expect(result?.requireApproval?.description).not.toMatch(/webview|local[- ]console|控制台|\[\^lynx-log\]/i);
  });

  it("blocks L4 tool decisions even if Go response asks for approval", async () => {
    const goClient = client({
      decideTool: vi.fn(async () => response({
        stage: "tool_call",
        action: "require_approval",
        block: false,
        riskLevel: "L4",
        requiresApproval: true,
        userMessage: "L4 decisions are deny-only.",
        approvalRequest: {
          riskFamily: "plugin_integrity",
          title: "Do not approve",
          summary: "This malformed backend response must not create a user approval.",
          scope: { toolName: "shell" },
        },
        audit: {
          eventSeverity: "critical",
          policyDecision: "require_approval",
          enforcementAction: "require_approval",
          color: "red",
        },
      })),
    });
    const broker = new DecisionBroker(goClient);

    const result = await handleBeforeToolCallDecision(broker, {
      toolName: "shell",
      params: { command: "ls /tmp" },
    }, { sessionKey: "session-1" });

    expect(result?.block).toBe(true);
    expect(result?.blockReason).toContain("L4 decisions are deny-only");
    expect(result?.requireApproval).toBeUndefined();
  });

  it("routes skill installs to the install decision endpoint instead of generic tool decision", async () => {
    const goClient = client({
      decideInstall: vi.fn(async () => response({
        stage: "install",
        block: true,
        action: "deny",
        riskLevel: "L4",
        matchedModules: ["skill_manifest_risk"],
        audit: {
          eventSeverity: "critical",
          policyDecision: "deny",
          enforcementAction: "deny",
          color: "red",
        },
      })),
    });
    const broker = new DecisionBroker(goClient);

    const result = await handleBeforeToolCallDecision(broker, {
      toolName: "exec",
      params: { command: "openclaw plugins install https://unknown.example/skill.zip" },
    }, { sessionKey: "session-1", userId: "requester-1" });

    expect(result?.block).toBe(true);
    expect(goClient.decideInstall).toHaveBeenCalledTimes(1);
    expect(goClient.decideTool).not.toHaveBeenCalled();
  });

  it("keeps sync-only handlers synchronous", () => {
    const broker = new DecisionBroker(client());

    const beforeMessageWrite = handleBeforeMessageWriteDecision(broker, {
      message: { role: "assistant", content: "hello" },
    }, {});
    const toolResultPersist = handleToolResultPersistDecision(broker, {
      toolName: "read_file",
      message: { role: "tool", content: "ok" },
    }, {});

    expect(beforeMessageWrite).toBeUndefined();
    expect(toolResultPersist).toBeUndefined();
    expect(beforeMessageWrite).not.toBeInstanceOf(Promise);
    expect(toolResultPersist).not.toBeInstanceOf(Promise);
  });
});
