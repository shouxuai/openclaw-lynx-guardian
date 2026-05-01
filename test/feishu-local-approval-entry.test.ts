import { dirname, join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import setup from "../index.ts";
import * as utils from "../src/utils.js";
import * as safetyGuard from "../src/guard/safety-guard.js";
import * as runtimeConfig from "../src/discovery/discovery-runtime-config.js";
import * as tokenOptimizerRunner from "../src/runtime/token-optimizer-runner.js";
import { buildApprovalRequestFingerprint } from "../src/approval/approval-bridge.js";
import {
  clearApprovalGrants,
  clearFeishuLocalApprovalGrants,
  consumeFeishuLocalApprovalGrant,
  readFeishuLocalApprovalGrant,
  clearFeishuLocalApprovalReplays,
  clearFeishuRunContinuations,
  clearLocalToolApprovals,
  clearPendingToolApprovals,
  listLocalToolApprovalsForSession,
  matchFeishuRunContinuation,
  registerLocalToolApproval,
} from "../src/approval/approval-bridge.js";
import {
  clearRequesterProvenanceStore,
  clearRunApprovalContexts,
  readRunApprovalContext,
} from "../src/approval/approval-bridge.js";

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

describe("feishu local approval entry", () => {
  const runtimeHome = join(process.cwd(), "test-temp", "feishu-local-approval-entry");
  let handlers: Record<string, Function>;
  let mockApi: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.stubEnv("HOME", runtimeHome);
    vi.stubEnv("USERPROFILE", runtimeHome);
    rmSync(runtimeHome, { recursive: true, force: true });

    handlers = {};
    clearApprovalGrants();
    clearFeishuLocalApprovalGrants();
    clearFeishuLocalApprovalReplays();
    clearFeishuRunContinuations();
    clearLocalToolApprovals();
    clearPendingToolApprovals();
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
    rmSync(runtimeHome, { recursive: true, force: true });
    clearApprovalGrants();
    clearFeishuLocalApprovalGrants();
    clearFeishuLocalApprovalReplays();
    clearFeishuRunContinuations();
    clearLocalToolApprovals();
    clearPendingToolApprovals();
    clearRequesterProvenanceStore();
    clearRunApprovalContexts();
  });

  function configureOwnerFeishuApproval(): void {
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

  function writeHostFeishuConfig(config: Record<string, unknown>): void {
    const hostConfigPath = join(runtimeHome, ".openclaw", "openclaw.json");
    mkdirSync(dirname(hostConfigPath), { recursive: true });
    writeFileSync(
      hostConfigPath,
      JSON.stringify({
        channels: {
          feishu: config,
        },
      }, null, 2),
      "utf8",
    );
  }

  it("creates a real Feishu local approval token from before_tool_call and lets owner allow-once auto replay the approved request", async () => {
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

    await handlers.before_dispatch(
      {
        content: "read protected config",
        channel: "feishu",
        sessionKey: "sess-feishu-real-path",
        senderId: "ou_requester",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-real-path",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-real-path",
        senderId: "ou_requester",
      },
    );
    await handlers.before_agent_start(
      { prompt: "read protected config" },
      {
        sessionKey: "sess-feishu-real-path",
        channelId: "feishu",
        runId: "run-feishu-real-path",
      },
    );

    const promptSendMessage = vi.fn().mockResolvedValue(undefined);
    const guardSpy = vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
      block: true,
      blockReason: "[Lynx Guardian] blocked local tool",
      riskAssessment: {
        level: "L2",
        score: 6,
        modules: ["M2:protected_file_access"],
        description: "protected file tool attempt",
        action: "block",
      },
    } as any);

    const result = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "README.md" },
        runId: "run-feishu-real-path",
        toolCallId: "tool-feishu-real-1",
      },
      {
        sessionKey: "sess-feishu-real-path",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-real-path",
        senderId: "ou_requester",
        sendMessage: promptSendMessage,
      },
    );

    expect(promptSendMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("/lynx-approve"),
    });

    const approvals = listLocalToolApprovalsForSession({
      sessionKey: "sess-feishu-real-path",
    });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.approvalToken).toBeTruthy();

    const expectedFingerprint = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "chat-feishu-real-path",
      requesterOuId: "ou_requester",
      promptText: "read protected config",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "README.md",
    });
    expect(approvals[0]?.requestFingerprint).toBe(expectedFingerprint);

    const approvalReply = await handlers.before_dispatch(
      {
        content: `/lynx-approve ${approvals[0]!.approvalToken} allow-once`,
        channel: "feishu",
        sessionKey: "sess-feishu-real-path",
        senderId: "ou_owner",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-real-path",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-real-path",
        senderId: "ou_owner",
      },
    );

    expect(approvalReply).toMatchObject({
      handled: false,
      text: expect.stringContaining("正在继续执行刚才的请求"),
    });
    expect(String(approvalReply.text)).not.toContain("缁х画鎵ц");
    expect(
      readFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-real-path",
        requesterOuId: "ou_requester",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: expectedFingerprint,
      }),
    ).toMatchObject({
      sourceApprovalId: approvals[0]!.pendingId,
      grantedByOuId: "ou_owner",
    });

    const replayAgentStart = await handlers.before_agent_start(
      {
        prompt: `/lynx-approve ${approvals[0]!.approvalToken} allow-once`,
      },
      {
        sessionKey: "sess-feishu-real-path",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-real-path",
        runId: "run-feishu-real-path-approved",
      },
    );

    expect(replayAgentStart).toMatchObject({
      prependContext: expect.stringContaining("read protected config"),
    });
    expect(readRunApprovalContext("run-feishu-real-path-approved")).toMatchObject({
      requesterOuId: "ou_requester",
      conversationId: "chat-feishu-real-path",
      promptText: "read protected config",
    });

    const replayResult = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "README.md" },
        runId: "run-feishu-real-path-approved",
        toolCallId: "tool-feishu-real-approved-1",
      },
      {
        sessionKey: "sess-feishu-real-path",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-real-path-approved",
        senderId: "ou_requester",
      },
    );

    expect(replayResult).toBeUndefined();

    guardSpy.mockRestore();
  });

  it("does not use direct sender fallback when proactive Feishu prompt delivery is disabled", async () => {
    configureOwnerFeishuApproval();
    writeHostFeishuConfig({
      enabled: true,
      appId: "cli_test_app",
      appSecret: "test_secret",
      domain: "feishu",
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          tenant_access_token: "tenant-token",
          expire: 7200,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: { message_id: "om_msg_1" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as any);

    await handlers.before_dispatch(
      {
        content: "read protected config",
        channel: "feishu",
        sessionKey: "sess-feishu-direct-prompt",
        senderId: "ou_requester",
        isGroup: false,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-direct-prompt",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        senderId: "ou_requester",
      },
    );
    await handlers.before_agent_start(
      { prompt: "read protected config" },
      {
        sessionKey: "sess-feishu-direct-prompt",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        runId: "run-feishu-direct-prompt",
      },
    );

    const guardSpy = vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
      block: true,
      blockReason: "[Lynx Guardian] blocked local tool",
      riskAssessment: {
        level: "L2",
        score: 6,
        modules: ["M2:protected_file_access"],
        description: "protected file tool attempt",
        action: "block",
      },
    } as any);

    const result = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "README.md" },
        runId: "run-feishu-direct-prompt",
        toolCallId: "tool-feishu-direct-prompt",
      },
      {
        sessionKey: "sess-feishu-direct-prompt",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        runId: "run-feishu-direct-prompt",
        senderId: "ou_requester",
      },
    );

    expect(result).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("/lynx-approve"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    guardSpy.mockRestore();
  });

  it("consumes owner allow-once replies in before_dispatch and tells the requester to resend", async () => {
    const resolutionSpy = vi.fn();
    const approval = registerLocalToolApproval({
      pendingId: "pending-feishu-allow",
      sessionKey: "sess-feishu-allow",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      requesterOuId: "ou_requester",
      requestFingerprint: "fp-feishu-allow",
      approverOuIds: ["ou_owner"],
      conversationId: "user:ou_requester",
      module: "M2:protected_file_access",
      riskLevel: "L2",
      toolName: "read",
      timeoutMs: 60_000,
      onResolution: resolutionSpy,
    });

    expect(approval.created).toBe(true);
    expect(approval.approval?.approvalToken).toBeTruthy();

    const result = await handlers.before_dispatch(
      {
        content: `/lynx-approve ${approval.approval!.approvalToken} allow-once`,
        channel: "feishu",
        sessionKey: "sess-feishu-allow",
        senderId: "ou_owner",
        isGroup: false,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-allow",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        senderId: "ou_owner",
      },
    );

    expect(result).toMatchObject({
      handled: true,
      text: expect.stringContaining("重新发送刚才的请求"),
    });
    expect(String(result.text)).not.toContain("继续执行");
    expect(resolutionSpy).toHaveBeenCalledWith("allow-once");
    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        requesterOuId: "ou_requester",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: "fp-feishu-allow",
      }),
    ).toMatchObject({
      sourceApprovalId: "pending-feishu-allow",
      grantedByOuId: "ou_owner",
    });
  });

  it("rejects non-owner /lynx-approve replies and leaves the approval unresolved", async () => {
    const resolutionSpy = vi.fn();
    const approval = registerLocalToolApproval({
      pendingId: "pending-feishu-owner-gate",
      sessionKey: "sess-feishu-owner-gate",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      requesterOuId: "ou_requester",
      requestFingerprint: "fp-feishu-owner-gate",
      approverOuIds: ["ou_owner"],
      conversationId: "chat-feishu-owner-gate",
      module: "M2:protected_file_access",
      riskLevel: "L2",
      toolName: "read",
      timeoutMs: 60_000,
      onResolution: resolutionSpy,
    });

    const result = await handlers.before_dispatch(
      {
        content: `/lynx-approve ${approval.approval!.approvalToken} allow-once`,
        channel: "feishu",
        sessionKey: "sess-feishu-owner-gate",
        senderId: "ou_other",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-owner-gate",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-owner-gate",
        senderId: "ou_other",
      },
    );

    expect(result).toMatchObject({
      handled: true,
      text: expect.stringContaining("owner"),
    });
    expect(resolutionSpy).not.toHaveBeenCalled();
    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-owner-gate",
        requesterOuId: "ou_requester",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: "fp-feishu-owner-gate",
      }),
    ).toBeUndefined();
  });

  it("consumes unknown /lynx-approve tokens with a clear error reply", async () => {
    const result = await handlers.before_dispatch(
      {
        content: "/lynx-approve deadbeef allow-once",
        channel: "feishu",
        sessionKey: "sess-feishu-invalid-token",
        senderId: "ou_owner",
        isGroup: false,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-invalid-token",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_owner",
        senderId: "ou_owner",
      },
    );

    expect(result).toMatchObject({
      handled: true,
      text: expect.stringContaining("当前没有待审批操作"),
    });
  });

  it("returns a denial reply for owner deny commands without creating a retry grant", async () => {
    const resolutionSpy = vi.fn();
    const approval = registerLocalToolApproval({
      pendingId: "pending-feishu-deny",
      sessionKey: "sess-feishu-deny",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      requesterOuId: "ou_requester",
      requestFingerprint: "fp-feishu-deny",
      approverOuIds: ["ou_owner"],
      conversationId: "user:ou_requester",
      module: "M2:protected_file_access",
      riskLevel: "L2",
      toolName: "read",
      timeoutMs: 60_000,
      onResolution: resolutionSpy,
    });

    const result = await handlers.before_dispatch(
      {
        content: `/lynx-approve ${approval.approval!.approvalToken} deny`,
        channel: "feishu",
        sessionKey: "sess-feishu-deny",
        senderId: "ou_owner",
        isGroup: false,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-deny",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        senderId: "ou_owner",
      },
    );

    expect(result).toMatchObject({
      handled: true,
      text: expect.stringContaining("已拒绝本次操作"),
    });
    expect(resolutionSpy).toHaveBeenCalledWith("deny");
    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        requesterOuId: "ou_requester",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: "fp-feishu-deny",
      }),
    ).toBeUndefined();
  });

  it("persists promptText into the run approval context during before_agent_start", async () => {
    await handlers.before_dispatch(
      {
        content: "请读取 /etc/passwd",
        channel: "feishu",
        sessionKey: "sess-feishu-run-context",
        senderId: "ou_requester",
        isGroup: false,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-run-context",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        senderId: "ou_requester",
      },
    );

    await handlers.before_agent_start(
      {
        prompt: "请读取 /etc/passwd",
      },
      {
        sessionKey: "sess-feishu-run-context",
        channelId: "feishu",
        accountId: "default",
        conversationId: "user:ou_requester",
        runId: "run-feishu-run-context",
      },
    );

    expect(readRunApprovalContext("run-feishu-run-context")).toMatchObject({
      requesterOuId: "ou_requester",
      conversationId: "user:ou_requester",
      promptText: "请读取 /etc/passwd",
    });
  });

  it("consumes a matching retry grant on the retried request and opens a same-run continuation window", async () => {
    configureOwnerFeishuApproval();

    const guardSpy = vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
      block: true,
      blockReason: "[Lynx Guardian] blocked local tool",
      riskAssessment: {
        level: "L2",
        score: 6,
        modules: ["M2:protected_file_access"],
        description: "protected file tool attempt",
        action: "block",
      },
    } as any);

    await handlers.before_dispatch(
      {
        content: "read protected config",
        channel: "feishu",
        sessionKey: "sess-feishu-retry",
        senderId: "ou_requester",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-retry",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-retry",
        senderId: "ou_requester",
      },
    );
    await handlers.before_agent_start(
      { prompt: "read protected config" },
      {
        sessionKey: "sess-feishu-retry",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-retry",
        runId: "run-feishu-retry-initial",
      },
    );

    const firstPrompt = vi.fn().mockResolvedValue(undefined);
    const firstResult = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "README.md" },
        runId: "run-feishu-retry-initial",
        toolCallId: "tool-feishu-retry-initial",
      },
      {
        sessionKey: "sess-feishu-retry",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-retry-initial",
        senderId: "ou_requester",
        sendMessage: firstPrompt,
      },
    );

    expect(firstResult).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("/lynx-approve"),
    });

    const approval = listLocalToolApprovalsForSession({
      sessionKey: "sess-feishu-retry",
    })[0];
    expect(approval?.approvalToken).toBeTruthy();

    const requestFingerprint = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "chat-feishu-retry",
      requesterOuId: "ou_requester",
      promptText: "read protected config",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "README.md",
    });

    await handlers.before_dispatch(
      {
        content: `/lynx-approve ${approval!.approvalToken} allow-once`,
        channel: "feishu",
        sessionKey: "sess-feishu-retry",
        senderId: "ou_owner",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-retry",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-retry",
        senderId: "ou_owner",
      },
    );

    await handlers.before_dispatch(
      {
        content: "read protected config",
        channel: "feishu",
        sessionKey: "sess-feishu-retry",
        senderId: "ou_requester",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-retry",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-retry",
        senderId: "ou_requester",
      },
    );
    await handlers.before_agent_start(
      { prompt: "read protected config" },
      {
        sessionKey: "sess-feishu-retry",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-retry",
        runId: "run-feishu-retry-second",
      },
    );

    const retriedResult = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "README.md" },
        runId: "run-feishu-retry-second",
        toolCallId: "tool-feishu-retry-second-1",
      },
      {
        sessionKey: "sess-feishu-retry",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-retry-second",
        senderId: "ou_requester",
      },
    );

    expect(retriedResult).toBeUndefined();
    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-retry",
        requesterOuId: "ou_requester",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint,
      }),
    ).toBeUndefined();
    expect(
      matchFeishuRunContinuation({
        runId: "run-feishu-retry-second",
        channelProfile: "feishu",
        requesterOuId: "ou_requester",
        module: "M2:protected_file_access",
        riskLevel: "L2",
      }),
    ).toMatchObject({
      runId: "run-feishu-retry-second",
      module: "M2:protected_file_access",
      maxRiskLevel: "L2",
    });

    const followupResult = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "docs/spec.md" },
        runId: "run-feishu-retry-second",
        toolCallId: "tool-feishu-retry-second-2",
      },
      {
        sessionKey: "sess-feishu-retry",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-retry-second",
        senderId: "ou_requester",
      },
    );

    expect(followupResult).toBeUndefined();
    guardSpy.mockRestore();
  });

  it("does not reuse a Feishu retry grant when the retried protected target changes", async () => {
    configureOwnerFeishuApproval();

    const guardSpy = vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
      block: true,
      blockReason: "[Lynx Guardian] blocked local tool",
      riskAssessment: {
        level: "L2",
        score: 6,
        modules: ["M2:protected_file_access"],
        description: "protected file tool attempt",
        action: "block",
      },
    } as any);

    await handlers.before_dispatch(
      {
        content: "read protected config",
        channel: "feishu",
        sessionKey: "sess-feishu-fingerprint",
        senderId: "ou_requester",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-fingerprint",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-fingerprint",
        senderId: "ou_requester",
      },
    );
    await handlers.before_agent_start(
      { prompt: "read protected config" },
      {
        sessionKey: "sess-feishu-fingerprint",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-fingerprint",
        runId: "run-feishu-fingerprint-initial",
      },
    );

    const firstPrompt = vi.fn().mockResolvedValue(undefined);
    await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "README.md" },
        runId: "run-feishu-fingerprint-initial",
        toolCallId: "tool-feishu-fingerprint-initial",
      },
      {
        sessionKey: "sess-feishu-fingerprint",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-fingerprint-initial",
        senderId: "ou_requester",
        sendMessage: firstPrompt,
      },
    );

    const approval = listLocalToolApprovalsForSession({
      sessionKey: "sess-feishu-fingerprint",
    })[0];
    expect(approval?.approvalToken).toBeTruthy();

    const originalFingerprint = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "chat-feishu-fingerprint",
      requesterOuId: "ou_requester",
      promptText: "read protected config",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "README.md",
    });

    await handlers.before_dispatch(
      {
        content: `/lynx-approve ${approval!.approvalToken} allow-once`,
        channel: "feishu",
        sessionKey: "sess-feishu-fingerprint",
        senderId: "ou_owner",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-fingerprint",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-fingerprint",
        senderId: "ou_owner",
      },
    );

    await handlers.before_dispatch(
      {
        content: "read protected config",
        channel: "feishu",
        sessionKey: "sess-feishu-fingerprint",
        senderId: "ou_requester",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-fingerprint",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-fingerprint",
        senderId: "ou_requester",
      },
    );
    await handlers.before_agent_start(
      { prompt: "read protected config" },
      {
        sessionKey: "sess-feishu-fingerprint",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-fingerprint",
        runId: "run-feishu-fingerprint-second",
      },
    );

    const changedTargetPrompt = vi.fn().mockResolvedValue(undefined);
    const changedTargetResult = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "docs/spec.md" },
        runId: "run-feishu-fingerprint-second",
        toolCallId: "tool-feishu-fingerprint-second",
      },
      {
        sessionKey: "sess-feishu-fingerprint",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-fingerprint-second",
        senderId: "ou_requester",
        sendMessage: changedTargetPrompt,
      },
    );

    expect(changedTargetResult).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("/lynx-approve"),
    });
    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-fingerprint",
        requesterOuId: "ou_requester",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: originalFingerprint,
      }),
    ).toMatchObject({
      requestFingerprint: originalFingerprint,
    });
    guardSpy.mockRestore();
  });

  it("requires fresh approval for higher-risk follow-ups and Go-mediated module switches", async () => {
    configureOwnerFeishuApproval();

    const guardSpy = vi.spyOn(safetyGuard, "guardToolCall")
      .mockImplementation((toolName, params: any) => {
        if (toolName === "exec") {
          return {
            block: true,
            blockReason: "[Lynx Guardian] higher risk tool",
            riskAssessment: {
              level: "L3",
              score: 9,
              modules: ["M3:command_execution"],
              description: "command execution attempt",
              action: "block",
            },
          } as any;
        }

        if (toolName === "read" && params?.file_path === "protected-higher-risk.md") {
          return {
            block: true,
            blockReason: "[Lynx Guardian] higher risk protected file tool",
            riskAssessment: {
              level: "L3",
              score: 8,
              modules: ["M2:protected_file_access"],
              description: "higher risk protected file tool attempt",
              action: "block",
            },
          } as any;
        }

        return {
          block: true,
          blockReason: "[Lynx Guardian] blocked local tool",
          riskAssessment: {
            level: "L2",
            score: 6,
            modules: ["M2:protected_file_access"],
            description: "protected file tool attempt",
            action: "block",
          },
        } as any;
      });

    await handlers.before_dispatch(
      {
        content: "read protected config",
        channel: "feishu",
        sessionKey: "sess-feishu-escalation",
        senderId: "ou_requester",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-escalation",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-escalation",
        senderId: "ou_requester",
      },
    );
    await handlers.before_agent_start(
      { prompt: "read protected config" },
      {
        sessionKey: "sess-feishu-escalation",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-escalation",
        runId: "run-feishu-escalation-initial",
      },
    );

    const firstPrompt = vi.fn().mockResolvedValue(undefined);
    await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "README.md" },
        runId: "run-feishu-escalation-initial",
        toolCallId: "tool-feishu-escalation-initial",
      },
      {
        sessionKey: "sess-feishu-escalation",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-escalation-initial",
        senderId: "ou_requester",
        sendMessage: firstPrompt,
      },
    );

    const approval = listLocalToolApprovalsForSession({
      sessionKey: "sess-feishu-escalation",
    })[0];
    expect(approval?.approvalToken).toBeTruthy();

    await handlers.before_dispatch(
      {
        content: `/lynx-approve ${approval!.approvalToken} allow-once`,
        channel: "feishu",
        sessionKey: "sess-feishu-escalation",
        senderId: "ou_owner",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-escalation",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-escalation",
        senderId: "ou_owner",
      },
    );

    await handlers.before_dispatch(
      {
        content: "read protected config",
        channel: "feishu",
        sessionKey: "sess-feishu-escalation",
        senderId: "ou_requester",
        isGroup: true,
        timestamp: Date.now(),
      },
      {
        sessionKey: "sess-feishu-escalation",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-escalation",
        senderId: "ou_requester",
      },
    );
    await handlers.before_agent_start(
      { prompt: "read protected config" },
      {
        sessionKey: "sess-feishu-escalation",
        channelId: "feishu",
        accountId: "default",
        conversationId: "chat-feishu-escalation",
        runId: "run-feishu-escalation-second",
      },
    );

    const retriedReadResult = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "README.md" },
        runId: "run-feishu-escalation-second",
        toolCallId: "tool-feishu-escalation-second-read",
      },
      {
        sessionKey: "sess-feishu-escalation",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-escalation-second",
        senderId: "ou_requester",
      },
    );

    expect(retriedReadResult).toBeUndefined();

    const higherRiskPrompt = vi.fn().mockResolvedValue(undefined);
    const higherRiskResult = await handlers.before_tool_call(
      {
        toolName: "read",
        params: { file_path: "protected-higher-risk.md" },
        runId: "run-feishu-escalation-second",
        toolCallId: "tool-feishu-escalation-second-sensitive-read",
      },
      {
        sessionKey: "sess-feishu-escalation",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-escalation-second",
        senderId: "ou_requester",
        sendMessage: higherRiskPrompt,
      },
    );

    expect(higherRiskResult).toMatchObject({
      block: true,
      blockReason: expect.stringContaining("/lynx-approve"),
    });

    const escalatedPrompt = vi.fn().mockResolvedValue(undefined);
    const escalatedResult = await handlers.before_tool_call(
      {
        toolName: "exec",
        params: { command: "cat README.md" },
        runId: "run-feishu-escalation-second",
        toolCallId: "tool-feishu-escalation-second-exec",
      },
      {
        sessionKey: "sess-feishu-escalation",
        channelId: "feishu",
        accountId: "default",
        runId: "run-feishu-escalation-second",
        senderId: "ou_requester",
        sendMessage: escalatedPrompt,
      },
    );

    expect(escalatedResult).toMatchObject({
      requireApproval: {
        title: "Lynx Guardian approval required",
        severity: "warning",
        timeoutBehavior: "deny",
      },
    });
    expect(guardSpy.mock.calls.map(([toolName]) => toolName)).toEqual([
      "read",
      "read",
      "read",
    ]);
    guardSpy.mockRestore();
  });
});
