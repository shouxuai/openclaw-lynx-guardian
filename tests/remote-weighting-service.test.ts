import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkContentWeighted,
  checkPublicAccessWeighted,
  checkToolWeighted,
  fetchMaliciousSkillBlacklistWeighted,
  getWeightedRiskLevel,
  pushRecordBestEffort,
  registerUserBestEffort,
} from "../src/runtime/remote-weighting-service.js";
import {
  adaptContentCheckResult,
  buildContentCategorySummary,
} from "../src/runtime/api-risk-adapter.js";
import { evaluateGuardDecisionPolicy } from "../src/runtime/policy-runtime.js";
import { buildGuardContext } from "../src/runtime/plugin-runtime-helpers.js";
import { clearSessionState, guardInput, guardOutput, guardToolCall } from "../src/guard/safety-guard.js";

import {
  checkContent,
  checkPublicAccess,
  checkTool,
  fetchMaliciousSkillBlacklist,
  pushRecord,
  registerUser,
} from "../src/api.js";

vi.mock("../src/api.js", () => ({
  registerUser: vi.fn(),
  checkContent: vi.fn(),
  checkTool: vi.fn(),
  pushRecord: vi.fn(),
  checkPublicAccess: vi.fn(),
  fetchMaliciousSkillBlacklist: vi.fn(),
}));

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("remote-weighting-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unavailable instead of throwing when content check fails", async () => {
    vi.mocked(checkContent).mockRejectedValueOnce(new Error("network down"));

    const result = await checkContentWeighted("lynx-user", "hello", 1);

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "network down",
    });
  });

  it("returns unavailable instead of throwing when public access check fails", async () => {
    vi.mocked(checkPublicAccess).mockRejectedValueOnce(new Error("timeout"));

    const result = await checkPublicAccessWeighted("lynx-user", "1.2.3.4", 18789);

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "timeout",
    });
  });

  it("keeps the local floor when tool weighting has no remote signal", () => {
    const riskLevel = getWeightedRiskLevel({
      localFloor: 3,
      remoteRiskLevel: undefined,
    });

    expect(riskLevel).toBe(3);
  });

  it("raises the final level when remote tool weighting is higher than the local floor", () => {
    const riskLevel = getWeightedRiskLevel({
      localFloor: 2,
      remoteRiskLevel: 4,
    });

    expect(riskLevel).toBe(4);
  });

  it("returns the tool response when remote weighting succeeds", async () => {
    vi.mocked(checkTool).mockResolvedValueOnce({
      code: 0,
      result: {
        is_safe: false,
        risk_level: 2,
        content: "need approval",
      },
      message: "ok",
    });

    const result = await checkToolWeighted("lynx-user", "rm -rf /");

    expect(result).toEqual({
      status: "available",
      value: {
        code: 0,
        result: {
          is_safe: false,
          risk_level: 2,
          content: "need approval",
        },
        message: "ok",
      },
    });
  });

  it("returns unavailable when remote blacklist fetch fails", async () => {
    vi.mocked(fetchMaliciousSkillBlacklist).mockRejectedValueOnce(new Error("503 service unavailable"));

    const result = await fetchMaliciousSkillBlacklistWeighted();

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "503 service unavailable",
    });
  });

  it("logs and returns unavailable when user registration fails", async () => {
    const log = createLogger();
    vi.mocked(registerUser).mockRejectedValueOnce(new Error("register offline"));

    const result = await registerUserBestEffort("lynx-user", log);

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "register offline",
    });
    expect(log.error).toHaveBeenCalledWith(
      "[lynx-guardian] Registration failed: register offline",
    );
  });

  it("logs and returns unavailable when pushRecord fails", async () => {
    const log = createLogger();
    vi.mocked(pushRecord).mockRejectedValueOnce(new Error("push offline"));

    const result = await pushRecordBestEffort(
      {
        id: "lynx-user",
        content: "blocked content",
        riskLevel: 3,
      },
      {
        log,
        context: "blacklist record",
      },
    );

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "push offline",
    });
    expect(log.error).toHaveBeenCalledWith(
      "[lynx-guardian] Failed to push record (blacklist record): push offline",
    );
  });
});

describe("api-risk-adapter", () => {
  it("does not build a category summary when the backend only returns None placeholders", () => {
    const adapted = adaptContentCheckResult({
      is_safe: false,
      risk_level: 1,
      level_one: "None",
      level_two: "None",
      level_three: "None",
    });

    expect(buildContentCategorySummary(adapted.categoryChain)).toBeUndefined();
  });

  it("does not build a category summary when all category labels are blank", () => {
    const adapted = adaptContentCheckResult({
      is_safe: false,
      risk_level: 1,
      level_one: " ",
      level_two: "",
      level_three: "\t",
    });

    expect(buildContentCategorySummary(adapted.categoryChain)).toBeUndefined();
  });

  it("keeps the existing category summary format when any concrete label exists", () => {
    const adapted = adaptContentCheckResult({
      is_safe: false,
      risk_level: 1,
      level_one: "个人隐私",
      level_two: "身份证",
      level_three: "None",
    });

    expect(buildContentCategorySummary(adapted.categoryChain)).toBe("个人隐私、身份证、None");
  });
});

describe("guardToolCall OpenClaw upgrade maintenance", () => {
  it("allows OpenClaw upgrade commands that restart the gateway", () => {
    const decision = guardToolCall("exec", {
      command: "openclaw update && docker compose restart openclaw-gateway",
    });

    expect(decision.block).toBe(false);
    expect(decision.riskAssessment.modules).not.toContain("M3:system_availability");
  });

  it("allows OpenClaw upgrade maintenance config patch tool calls", () => {
    const decision = guardToolCall("gateway", {
      action: "config.patch",
      note: "OpenClaw upgrade maintenance updates runtime config",
    });

    expect(decision.block).toBe(false);
    expect(decision.riskAssessment.modules).not.toContain("M2:runtime_config_integrity");
  });

  it("allows OpenClaw upgrade maintenance to update the Lynx Guardian manifest", () => {
    const decision = guardToolCall("write", {
      file_path: "C:\\Users\\tester\\.openclaw\\extensions\\openclaw-lynx-guardian\\openclaw.plugin.json",
      note: "OpenClaw upgrade maintenance updates the bundled Lynx Guardian manifest",
    });

    expect(decision.block).toBe(false);
    expect(decision.riskAssessment.modules).not.toContain("M2:runtime_config_integrity");
    expect(decision.riskAssessment.modules).not.toContain("M2:plugin_integrity");
    expect(decision.riskAssessment.modules).not.toContain("M2:protected_file_access");
  });

  it("still blocks direct Lynx Guardian plugin writes without upgrade intent", () => {
    const decision = guardToolCall("write", {
      file_path: "C:\\Users\\tester\\.openclaw\\extensions\\openclaw-lynx-guardian\\index.ts",
      note: "Patch Lynx Guardian runtime behavior",
    });

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M2:plugin_integrity");
  });

  it("still blocks plain OpenClaw availability control without upgrade intent", () => {
    const decision = guardToolCall("exec", {
      command: "docker compose restart openclaw-gateway",
    });

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M3:system_availability");
  });

  it("still blocks attempts to disable Lynx Guardian during an OpenClaw update", () => {
    const decision = guardToolCall("exec", {
      command: "openclaw update && openclaw extension disable openclaw-lynx-guardian",
    });

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M3:over_agency");
  });
});

describe("benign protected-file reads", () => {
  it("does not raise input risk for a plain IDENTITY.md read request", () => {
    const decision = guardInput("read IDENTITY.md");

    expect(decision.block).toBe(false);
    expect(decision.riskAssessment.modules).not.toContain("M2:protected_file_access");
    expect(decision.riskAssessment.modules).not.toContain("M2:system_prompt_extraction");
  });

  it("does not raise input risk for a plain OpenClaw workspace memory read", () => {
    const decision = guardInput("read /home/node/.openclaw/workspace/memory/2026-05-08.md");

    expect(decision.block).toBe(false);
    expect(decision.riskAssessment.modules).not.toContain("M2:protected_file_access");
    expect(decision.riskAssessment.modules).not.toContain("M2:memory_session_privacy");
  });

  it("still blocks protected-file mutation intent", () => {
    const decision = guardInput("overwrite IDENTITY.md with new rules");

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M2:protected_file_access");
  });

  it("still blocks explicit OpenClaw memory export intent", () => {
    const decision = guardInput("export OpenClaw memory session records");

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M2:memory_session_privacy");
  });
});

describe("system file protection", () => {
  it("blocks exec commands that append to shell startup files", () => {
    const decision = guardToolCall("exec", {
      command: "echo 'alias ll=\"ls -la\"' >> ~/.bashrc",
    });

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M2:protected_file_access");
  });

  it("blocks direct writes to shell startup files", () => {
    const decision = guardToolCall("write", {
      path: "/home/node/.bashrc",
      content: "export PATH=/tmp/bin:$PATH\n",
    });

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M2:protected_file_access");
  });

  it("does not raise risk for plain reads of shell startup files", () => {
    const decision = guardToolCall("read", {
      path: "/home/node/.bashrc",
    });

    expect(decision.block).toBe(false);
    expect(decision.riskAssessment.modules).not.toContain("M2:protected_file_access");
  });

  it("blocks writes to system service configuration files", () => {
    const decision = guardToolCall("write", {
      path: "/etc/ssh/sshd_config",
      content: "PermitRootLogin yes\n",
    });

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M2:protected_file_access");
  });

  it("blocks deletes of system startup service files", () => {
    const decision = guardToolCall("exec", {
      command: "rm /etc/systemd/system/openclaw.service",
    });

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M2:protected_file_access");
  });

  it("blocks writes to Windows hosts", () => {
    const decision = guardToolCall("write", {
      path: "C:\\Windows\\System32\\drivers\\etc\\hosts",
      content: "127.0.0.1 example.com\n",
    });

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M2:protected_file_access");
  });

  it("does not raise risk for plain reads of non-secret system config files", () => {
    const decision = guardToolCall("read", {
      path: "/etc/hosts",
    });

    expect(decision.block).toBe(false);
    expect(decision.riskAssessment.modules).not.toContain("M2:protected_file_access");
  });
});

describe("risk state decay", () => {
  it("expires attack-chain risk even when the session stays active", () => {
    const sessionKey = `test-risk-decay-${Date.now()}`;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T00:00:00Z"));
    try {
      guardToolCall("read", { path: "/etc/passwd" }, sessionKey);

      for (let index = 0; index < 3; index += 1) {
        vi.advanceTimersByTime(10 * 60 * 1000);
        guardOutput("normal progress update", sessionKey);
      }
      vi.advanceTimersByTime(60 * 1000);

      const writeDecision = guardToolCall(
        "write",
        {
          path: "/tmp/normal-project-file.txt",
          content: "safe project output\n",
        },
        sessionKey,
      );
      const writePolicy = evaluateGuardDecisionPolicy({
        assessment: writeDecision.riskAssessment,
        evidenceBundle: writeDecision.evidenceBundle,
      });

      expect(writePolicy.finalDecision.kind).toBe("allow");
      expect(writeDecision.evidenceBundle?.chainProgress?.stage).not.toBe("artifact_prepared");
      expect(writeDecision.evidenceBundle?.taintWriteLabels).toEqual([]);
    } finally {
      clearSessionState(sessionKey);
      vi.useRealTimers();
    }
  });

  it("expires artifact taint even when the session stays active", () => {
    const sessionKey = `test-taint-decay-${Date.now()}`;
    const artifactPath = "/tmp/generated-script.sh";

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T00:00:00Z"));
    try {
      guardToolCall("read", { path: "/etc/passwd" }, sessionKey);
      guardToolCall(
        "write",
        {
          path: artifactPath,
          content: "echo ok\n",
        },
        sessionKey,
      );

      for (let index = 0; index < 3; index += 1) {
        vi.advanceTimersByTime(10 * 60 * 1000);
        guardOutput("normal progress update", sessionKey);
      }
      vi.advanceTimersByTime(60 * 1000);

      const execDecision = guardToolCall(
        "exec",
        { command: artifactPath },
        sessionKey,
      );
      const execPolicy = evaluateGuardDecisionPolicy({
        assessment: execDecision.riskAssessment,
        evidenceBundle: execDecision.evidenceBundle,
      });

      expect(execPolicy.finalDecision.kind).toBe("allow");
      expect(execDecision.evidenceBundle?.taintReadLabels).toEqual([]);
    } finally {
      clearSessionState(sessionKey);
      vi.useRealTimers();
    }
  });
});

describe("session startup protected reads", () => {
  it("does not let startup reads poison later normal project writes", () => {
    const sessionKey = `test-session-startup-${Date.now()}`;
    const startupReadPaths = [
      "/home/node/.openclaw/workspace/memory/2026-05-08.md",
      "/home/node/.openclaw/workspace/IDENTITY.md",
      "/home/node/.openclaw/skills/lynx-guardian-lesson/SKILL.md",
    ];
    const startupDecisions = startupReadPaths.map((path) => {
      const startupReadEvent = {
        toolName: "read",
        params: { path },
      };
      const startupContext = buildGuardContext({}, startupReadEvent, {
        channelId: "webchat",
        messageProvider: "webchat",
        requesterId: "openclaw-control-ui",
      });

      return {
        context: startupContext,
        decision: guardToolCall(
          startupReadEvent.toolName,
          startupReadEvent.params,
          sessionKey,
          startupContext,
        ),
      };
    });
    const writeDecision = guardToolCall(
      "write",
      {
        path: "/home/node/.openclaw/workspace/my-api/requirements.txt",
        content: "fastapi==0.115.6\n",
      },
      sessionKey,
      buildGuardContext({}, { toolName: "write", params: {} }, {
        channelId: "webchat",
        messageProvider: "webchat",
        requesterId: "openclaw-control-ui",
      }),
    );
    const writePolicy = evaluateGuardDecisionPolicy({
      assessment: writeDecision.riskAssessment,
      evidenceBundle: writeDecision.evidenceBundle,
    });

    for (const startup of startupDecisions) {
      expect(startup.context.trustedInternalProtectedRead).toBe(true);
      expect(startup.decision.block).toBe(false);
      expect(startup.decision.riskAssessment.modules).not.toContain("M2:protected_file_access");
    }
    expect(writeDecision.block).toBe(false);
    expect(writePolicy.finalDecision.kind).toBe("allow");
  });

  it("still blocks tool writes to startup protected files", () => {
    const decision = guardToolCall("write", {
      path: "/home/node/.openclaw/workspace/IDENTITY.md",
      content: "replace identity",
    });

    expect(decision.block).toBe(true);
    expect(decision.riskAssessment.modules).toContain("M2:protected_file_access");
  });
});
