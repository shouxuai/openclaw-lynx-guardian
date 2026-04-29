import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { rmSync } from "fs";

import setup from "../index.ts";
import * as utils from "../src/utils.js";
import * as api from "../src/api.js";
import * as safetyGuard from "../src/guard/safety-guard.js";
import * as runtimeConfig from "../src/discovery/discovery-runtime-config.js";
import * as tokenOptimizerRunner from "../src/runtime/token-optimizer-runner.js";
import { clearApprovalGrants } from "../src/runtime/approval-grant-store.js";
import { clearFeishuLocalApprovalGrants } from "../src/runtime/feishu-local-approval-grant-store.js";
import { clearFeishuLocalApprovalReplays } from "../src/runtime/feishu-local-approval-replay-store.js";
import { clearFeishuRunContinuations } from "../src/runtime/feishu-run-continuation-store.js";
import { clearLocalToolApprovals, listLocalToolApprovalsForSession } from "../src/runtime/local-tool-approval-store.js";
import { clearPendingToolApprovals } from "../src/runtime/pending-tool-approval-store.js";
import {
  rememberRecentActiveDeliveryTarget,
  resetRecentActiveDeliveryTargets,
} from "../src/runtime/recent-active-delivery.js";
import { clearRequesterProvenanceStore } from "../src/runtime/requester-provenance-store.js";
import { clearRunApprovalContexts } from "../src/runtime/run-approval-context-store.js";

vi.mock("../src/utils.js");
vi.mock("../src/api.js");
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

  it("blocks feishu protected-read prompts in before_agent_start instead of deferring them", async () => {
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

    expect(result).toMatchObject({
      block: true,
      blockReason: "[Lynx Guardian] protected file prompt blocked",
    });
    expect((result as any).prependContext).toBeUndefined();
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
