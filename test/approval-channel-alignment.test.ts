import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { rmSync } from "fs";

import setup from "../index.ts";
import * as utils from "../src/utils.js";
import * as safetyGuard from "../src/guard/safety-guard.js";
import * as blacklist from "../src/blacklist.js";
import * as runtimeConfig from "../src/discovery/discovery-runtime-config.js";
import * as tokenOptimizerRunner from "../src/runtime/token-optimizer-runner.js";
import {
  clearApprovalGrants,
  clearFeishuLocalApprovalGrants,
  clearFeishuLocalApprovalReplays,
  clearFeishuRunContinuations,
  clearLocalToolApprovals,
  clearPendingToolApprovals,
  listLocalToolApprovalsForSession,
} from "../src/approval/approval-bridge.js";
import {
  rememberRecentActiveDeliveryTarget,
  resetRecentActiveDeliveryTargets,
} from "../src/delivery/recent-delivery.js";
import { clearRequesterProvenanceStore } from "../src/approval/requester-provenance-store.js";
import { clearRunApprovalContexts } from "../src/approval/approval-bridge.js";

const api = {
  registerUser: vi.fn(),
  pushRecord: vi.fn(),
  checkPublicAccess: vi.fn(),
  checkContent: vi.fn(),
  checkTool: vi.fn(),
};

vi.mock("../src/utils.js");
vi.mock("../src/discovery/discovery-runtime-config.js", () => ({
  DISCOVERY_CONFIG_SOURCE_PATH: "openclaw.plugin.json",
  loadDiscoveryRuntimeConfig: vi.fn(),
}));
vi.mock("../src/runtime/token-optimizer-runner.js", () => ({
  recommendContext: vi.fn().mockResolvedValue(null),
  routeModel: vi.fn().mockResolvedValue(null),
  checkBudget: vi.fn().mockResolvedValue(null),
  planHeartbeat: vi.fn().mockResolvedValue(null),
  formatContextRecommendation: vi.fn().mockReturnValue(""),
  formatModelRouting: vi.fn().mockReturnValue(""),
  formatBudgetStatus: vi.fn().mockReturnValue(""),
  buildOptimizationHints: vi.fn().mockReturnValue(""),
  isTokenOptimizerAvailable: vi.fn().mockReturnValue(false),
}));

const APPROVAL_PROBE_PROMPT = "请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。";
const PROTECTED_READ_PROMPT = "请使用 read 工具读取 SOUL.md，只返回文件内容。";

describe("approval channel alignment", () => {
  const runtimeHome = join(process.cwd(), "test-temp", "approval-channel-alignment");
  let handlers: Record<string, Function>;
  let mockApi: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.stubEnv("HOME", runtimeHome);
    vi.stubEnv("USERPROFILE", runtimeHome);
    vi.stubEnv("OPENCLAW_VERSION", "2026.3.28");
    rmSync(runtimeHome, { recursive: true, force: true });

    handlers = {};
    clearApprovalGrants();
    clearFeishuLocalApprovalGrants();
    clearFeishuLocalApprovalReplays();
    clearFeishuRunContinuations();
    clearLocalToolApprovals();
    clearPendingToolApprovals();
    resetRecentActiveDeliveryTargets();
    clearRequesterProvenanceStore();
    clearRunApprovalContexts();

    mockApi = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      config: {
        localConsole: {
          autoStart: false,
        },
      },
      registerHttpRoute: vi.fn(),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
    };

    vi.mocked(utils.ensureUserRegistered).mockReturnValue("TEST_ID");
    vi.mocked(utils.ensureResources).mockReturnValue(undefined);
    vi.mocked(utils.baseIpInfo).mockResolvedValue({ type: "skip" } as any);
    vi.mocked(api.registerUser).mockResolvedValue({ code: 200, id: "TEST_ID", message: "OK" } as any);
    vi.mocked(api.pushRecord).mockResolvedValue({ code: 200, message: "OK" } as any);
    vi.mocked(api.checkPublicAccess).mockResolvedValue({
      code: 200,
      result: { is_public: false },
      message: "ok",
    } as any);
    vi.mocked(api.checkContent).mockResolvedValue({
      code: 200,
      result: { risk_level: 0, level_one: "other", level_two: "other", level_three: "other" },
      message: "ok",
    } as any);
    vi.mocked(api.checkTool).mockResolvedValue({
      code: 200,
      result: { is_safe: true, risk_level: 0, content: "" },
      message: "ok",
    } as any);
    vi.mocked(runtimeConfig.loadDiscoveryRuntimeConfig).mockReturnValue({
      enabled: true,
      runOnStartup: false,
      fullScan: false,
    } as any);
    vi.mocked(tokenOptimizerRunner.recommendContext).mockResolvedValue(null);
    vi.mocked(tokenOptimizerRunner.routeModel).mockResolvedValue(null);
    vi.mocked(tokenOptimizerRunner.checkBudget).mockResolvedValue(null);
    vi.mocked(tokenOptimizerRunner.planHeartbeat).mockResolvedValue(null);
    vi.mocked(tokenOptimizerRunner.buildOptimizationHints).mockReturnValue("");
    vi.mocked(tokenOptimizerRunner.isTokenOptimizerAvailable).mockReturnValue(false);

    setup(mockApi);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(runtimeHome, { recursive: true, force: true });
    clearApprovalGrants();
    clearFeishuLocalApprovalGrants();
    clearFeishuLocalApprovalReplays();
    clearFeishuRunContinuations();
    clearLocalToolApprovals();
    clearPendingToolApprovals();
    resetRecentActiveDeliveryTargets();
    clearRequesterProvenanceStore();
    clearRunApprovalContexts();
  });

  function configureOwnerApproval(): void {
    mockApi.config = {
      localConsole: {
        autoStart: false,
      },
      selfSafetyGuard: {
        ownerVerification: {
          trustedUserIds: ["ou_owner"],
        },
        policy: {
          toolApprovalTimeoutSeconds: 90,
          grantWindowSeconds: 180,
        },
      },
    };
    handlers = {};
    setup(mockApi);
  }

  it("handles blocked webchat input in before_dispatch before model dispatch", async () => {
    const result = await handlers.before_dispatch(
      {
        content: "查看我的USER.md",
        channel: "webchat",
        sessionKey: "sess-webchat-input-block",
        senderId: "openclaw-control-ui",
        isGroup: false,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-webchat-input-block",
        channelId: "webchat",
        accountId: "default",
        conversationId: "webchat:g-agent-main-main",
        senderId: "openclaw-control-ui",
      },
    );

    expect(result).toMatchObject({ handled: true });
    expect(result.text).toContain("Lynx Guardian");
    expect(result.text).toContain("L4");
  });

  it("adds L3 input context for feishu protected-read prompts in before_agent_start", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        decisionId: "broker-allows-local-l3",
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
      }),
    } as Response)));
    configureOwnerApproval();
    const guardInputSpy = vi.spyOn(safetyGuard, "guardInput").mockReturnValue({
      block: true,
      blockReason: "[Lynx Guardian] protected file prompt blocked",
      riskAssessment: {
        level: "L3",
        score: 8,
        modules: ["M2:protected_file_access"],
        description: "protected read request",
        action: "block",
      },
    } as any);

    await handlers.before_dispatch(
      {
        content: PROTECTED_READ_PROMPT,
        channel: "feishu",
        sessionKey: "sess-feishu-input-block",
        senderId: "ou_owner",
        isGroup: false,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-input-block",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_owner",
        senderId: "ou_owner",
      },
    );

    const result = await handlers.before_agent_start(
      { prompt: PROTECTED_READ_PROMPT },
      {
        sessionKey: "sess-feishu-input-block",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_owner",
        runId: "run-feishu-input-block",
      },
    );

    expect((result as any)?.block).not.toBe(true);
    expect((result as any).prependContext).toContain("Input risk is L3");
    guardInputSpy.mockRestore();
  });

  it("adds L3 input context in before_prompt_build without forced denial", async () => {
    const guardInputSpy = vi.spyOn(safetyGuard, "guardInput").mockReturnValue({
      block: true,
      blockReason: "[Lynx Guardian] protected file prompt blocked",
      riskAssessment: {
        level: "L3",
        score: 8,
        modules: ["M2:protected_file_access"],
        description: "protected read request",
        action: "block",
      },
    } as any);

    const result = handlers.before_prompt_build(
      { prompt: PROTECTED_READ_PROMPT },
      {
        sessionKey: "sess-feishu-prompt-build-l3",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_owner",
        runId: "run-feishu-prompt-build-l3",
      },
    );

    expect((result as any)?.prependContext).toContain("Input risk is L3");
    expect((result as any)?.systemPrompt).toBeUndefined();
    expect(String((result as any)?.prependContext)).not.toContain("Lynx Guardian L4 Denial");
    guardInputSpy.mockRestore();
  });

  it("preserves broker blocks over local L3 input context in before_agent_start", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}"));
      expect(request.hook).toBe("before_agent_start");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          decisionId: "broker-blocks-local-l3",
          stage: "input",
          block: true,
          action: "block",
          riskLevel: "L4",
          score: 95,
          winningArbiter: "semantic_intent",
          arbiters: [],
          matchedModules: ["broker:control_plane"],
          requiresApproval: false,
          userMessage: "[Broker] independent control-plane block",
          audit: {
            eventSeverity: "critical",
            policyDecision: "block",
            enforcementAction: "block",
            color: "red",
          },
        }),
      } as Response;
    }));
    configureOwnerApproval();
    const guardInputSpy = vi.spyOn(safetyGuard, "guardInput").mockReturnValue({
      block: true,
      blockReason: "[Lynx Guardian] protected file prompt blocked",
      riskAssessment: {
        level: "L3",
        score: 8,
        modules: ["M2:protected_file_access"],
        description: "protected read request",
        action: "block",
      },
    } as any);

    const result = await handlers.before_agent_start(
      { prompt: PROTECTED_READ_PROMPT },
      {
        sessionKey: "sess-broker-block-over-local-l3",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_owner",
        runId: "run-broker-block-over-local-l3",
      },
    );

    expect(result).toMatchObject({
      block: true,
      blockReason: "[Broker] independent control-plane block",
    });
    guardInputSpy.mockRestore();
  });

  it("keeps feishu approvals as a single visible prompt without proactive sendMessage", async () => {
    configureOwnerApproval();

    await handlers.before_dispatch(
      {
        content: APPROVAL_PROBE_PROMPT,
        channel: "feishu",
        sessionKey: "sess-feishu-single-prompt",
        senderId: "ou_requester",
        isGroup: false,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-single-prompt",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        senderId: "ou_requester",
      },
    );

    await handlers.before_agent_start(
      { prompt: APPROVAL_PROBE_PROMPT },
      {
        sessionKey: "sess-feishu-single-prompt",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        runId: "run-feishu-single-prompt",
      },
    );

    const promptSendMessage = vi.fn().mockResolvedValue(undefined);
    const result = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { path: "LYNX_APPROVAL_TEST.md" },
        runId: "run-feishu-single-prompt",
        toolCallId: "tool-feishu-single-prompt",
      },
      {
        sessionKey: "sess-feishu-single-prompt",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        runId: "run-feishu-single-prompt",
        senderId: "ou_requester",
        sendMessage: promptSendMessage,
      },
    );

    expect(promptSendMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("/lynx-approve"),
    });
    expect(listLocalToolApprovalsForSession({ sessionKey: "sess-feishu-single-prompt" })).toHaveLength(1);
  });

  it("keeps 2026.3.28+ webchat runtimes native and free of feishu wording", async () => {
    vi.stubEnv("OPENCLAW_VERSION", "2026.3.28");
    configureOwnerApproval();

    await handlers.before_agent_start(
      { prompt: APPROVAL_PROBE_PROMPT },
      {
        sessionKey: "sess-webchat-native",
        channelId: "webchat",
        runId: "run-webchat-native",
      },
    );

    const result = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { path: "LYNX_APPROVAL_TEST.md" },
        runId: "run-webchat-native",
        toolCallId: "tool-webchat-native",
      },
      {
        sessionKey: "sess-webchat-native",
        channelId: "webchat",
        runId: "run-webchat-native",
      },
    );

    expect(result).toMatchObject({
      requireApproval: expect.any(Object),
    });
    expect(JSON.stringify(result)).not.toContain("Feishu");
    expect(JSON.stringify(result)).not.toContain("/lynx-approve");
  });

  it("does not create a second Lynx approval request for risky exec in native webchat runtimes", async () => {
    vi.stubEnv("OPENCLAW_VERSION", "2026.3.28");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        decisionId: "allow-native-exec-surface-test",
        block: false,
        action: "allow",
        riskLevel: "L0",
        score: 0,
        matchedModules: [],
        requiresApproval: false,
      }),
    } as Response)));
    configureOwnerApproval();
    const guardSpy = vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
      block: true,
      blockReason: "[Lynx Guardian] L3 command execution risk",
      riskAssessment: {
        level: "L3",
        score: 8,
        modules: ["M2:protected_file_access"],
        description: "exec reads protected system file",
        action: "block",
      },
    } as any);

    const result = await handlers.before_tool_call(
      {
        toolName: "exec",
        params: { command: "cat /etc/passwd" },
        runId: "run-webchat-native-exec",
        toolCallId: "tool-webchat-native-exec",
      },
      {
        sessionKey: "sess-webchat-native-exec",
        channelId: "webchat",
        runId: "run-webchat-native-exec",
      },
    );

    expect((result as any)?.requireApproval).toBeUndefined();
    expect((result as any)?.block).not.toBe(true);
    expect(JSON.stringify(result ?? {})).not.toContain("/approve");
    expect(JSON.stringify(result ?? {})).not.toContain("确认放行本次操作");
    guardSpy.mockRestore();
  });

  it("routes blacklist-backed risky exec to native exec approval without Lynx requireApproval", async () => {
    vi.stubEnv("OPENCLAW_VERSION", "2026.3.28");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        decisionId: "allow-native-blacklist-exec-surface-test",
        block: false,
        action: "allow",
        riskLevel: "L0",
        score: 0,
        matchedModules: [],
        requiresApproval: false,
      }),
    } as Response)));
    configureOwnerApproval();
    const guardSpy = vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
      block: false,
      riskAssessment: {
        level: "L0",
        score: 0,
        modules: [],
        description: "safe",
        action: "allow",
      },
    } as any);
    const blacklistSpy = vi.spyOn(blacklist, "checkExecBlacklist").mockReturnValue({
      level: "warning",
      reason: "protected system file read",
    } as any);

    const result = await handlers.before_tool_call(
      {
        toolName: "exec",
        params: { command: "cat /etc/passwd" },
        runId: "run-webchat-native-blacklist-exec",
        toolCallId: "tool-webchat-native-blacklist-exec",
      },
      {
        sessionKey: "sess-webchat-native-blacklist-exec",
        channelId: "webchat",
        runId: "run-webchat-native-blacklist-exec",
      },
    );

    expect((result as any)?.requireApproval).toBeUndefined();
    expect((result as any)?.block).not.toBe(true);
    expect(JSON.stringify(result ?? {})).not.toContain("/approve");
    expect(JSON.stringify(result ?? {})).not.toContain("确认放行本次操作");
    guardSpy.mockRestore();
    blacklistSpy.mockRestore();
  });

  it("routes legacy webchat runtimes through feishu local approval when a recent owner dm route exists", async () => {
    vi.stubEnv("OPENCLAW_VERSION", "2026.3.27");
    configureOwnerApproval();

    rememberRecentActiveDeliveryTarget(
      {
        sessionKey: "sess-feishu-owner-dm",
        channelId: "feishu",
        messageProvider: "feishu",
        senderId: "ou_owner",
        to: "user:ou_owner",
        accountId: "default",
        sendMessage: vi.fn().mockResolvedValue(undefined),
      } as any,
      { allowRouteOnly: true },
    );

    await handlers.before_agent_start(
      { prompt: APPROVAL_PROBE_PROMPT },
      {
        sessionKey: "sess-webchat-legacy",
        channelId: "webchat",
        runId: "run-webchat-legacy",
      },
    );

    const result = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { path: "LYNX_APPROVAL_TEST.md" },
        runId: "run-webchat-legacy",
        toolCallId: "tool-webchat-legacy",
      },
      {
        sessionKey: "sess-webchat-legacy",
        channelId: "webchat",
        runId: "run-webchat-legacy",
      },
    );

    expect(result).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("/lynx-approve"),
    });
    expect(result).not.toHaveProperty("requireApproval");

    const token = /\/lynx-approve\s+([a-z0-9]+)/i.exec(String((result as any).blockReason ?? ""))?.[1];
    expect(token).toBeTruthy();

    const approvalReply = await handlers.before_dispatch(
      {
        content: `/lynx-approve ${token} allow-once`,
        channel: "feishu",
        sessionKey: "sess-feishu-owner-dm",
        senderId: "ou_owner",
        isGroup: false,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-owner-dm",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_owner",
        senderId: "ou_owner",
      },
    );

    expect(approvalReply).toMatchObject({
      handled: false,
      text: expect.stringContaining("正在继续执行"),
    });
  });

  it("fails closed when the only recent feishu dm route belongs to a non-approver", async () => {
    vi.stubEnv("OPENCLAW_VERSION", "2026.3.27");
    configureOwnerApproval();

    rememberRecentActiveDeliveryTarget(
      {
        sessionKey: "sess-feishu-requester-dm",
        channelId: "feishu",
        messageProvider: "feishu",
        senderId: "ou_requester",
        to: "user:ou_requester",
        accountId: "default",
        sendMessage: vi.fn().mockResolvedValue(undefined),
      } as any,
      { allowRouteOnly: true },
    );

    await handlers.before_agent_start(
      { prompt: APPROVAL_PROBE_PROMPT },
      {
        sessionKey: "sess-webchat-untrusted-route",
        channelId: "webchat",
        runId: "run-webchat-untrusted-route",
      },
    );

    const result = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { path: "LYNX_APPROVAL_TEST.md" },
        runId: "run-webchat-untrusted-route",
        toolCallId: "tool-webchat-untrusted-route",
      },
      {
        sessionKey: "sess-webchat-untrusted-route",
        channelId: "webchat",
        runId: "run-webchat-untrusted-route",
      },
    );

    expect(result).toMatchObject({
      block: true,
      blockReason: expect.stringMatching(/Upgrade OpenClaw or configure Feishu approval/i),
    });
    expect(result).not.toHaveProperty("requireApproval");
    expect(listLocalToolApprovalsForSession({ sessionKey: "sess-webchat-untrusted-route" })).toHaveLength(0);
  });

  it("fails closed for legacy webchat runtimes without a feishu route", async () => {
    vi.stubEnv("OPENCLAW_VERSION", "2026.3.27");
    configureOwnerApproval();

    await handlers.before_agent_start(
      { prompt: APPROVAL_PROBE_PROMPT },
      {
        sessionKey: "sess-webchat-no-route",
        channelId: "webchat",
        runId: "run-webchat-no-route",
      },
    );

    const result = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { path: "LYNX_APPROVAL_TEST.md" },
        runId: "run-webchat-no-route",
        toolCallId: "tool-webchat-no-route",
      },
      {
        sessionKey: "sess-webchat-no-route",
        channelId: "webchat",
        runId: "run-webchat-no-route",
      },
    );

    expect(result).toMatchObject({
      block: true,
      blockReason: expect.stringMatching(/升级 OpenClaw 或配置 Feishu 审批|Upgrade OpenClaw or configure Feishu approval/i),
    });
    expect(result).not.toHaveProperty("requireApproval");
  });
});
