import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildManualLynxCheckReport } from "../src/discovery/manual-lynx-check.js";
import * as api from "../src/api.js";
import * as securityAuditRunner from "../src/runtime/security-audit-runner.js";
import * as skillGuard from "../src/skills/skill-guard.js";
import * as discoveryUtils from "../src/discovery/discovery-hook-utils.js";

vi.mock("../src/api.js");
vi.mock("../src/runtime/security-audit-runner.js");
vi.mock("../src/skills/skill-guard.js");
vi.mock("../src/discovery/discovery-hook-utils.js");

describe("buildManualLynxCheckReport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.checkPublicAccess).mockResolvedValue({
      code: 200,
      result: { is_public: false },
    } as any);
    vi.mocked(securityAuditRunner.runMaliciousScriptScan).mockResolvedValue([
      {
        type: "network",
        file: "skills/bad/skill.js",
        severity: "high",
        description: "unexpected outbound request",
        details: null,
      },
    ] as any);
    vi.mocked(skillGuard.verifyAllInstalledSkills).mockReturnValue([
      {
        skillName: "trusted-skill",
        path: "C:\\Users\\24716\\.openclaw\\skills\\trusted-skill",
        valid: true,
        currentHash: "abc123",
      },
      {
        skillName: "tampered-skill",
        path: "C:\\Users\\24716\\.openclaw\\skills\\tampered-skill",
        valid: false,
        currentHash: "def456",
        expectedHash: "zzz999",
        reason: "Hash mismatch",
      },
    ] as any);
    vi.mocked(discoveryUtils.runDiscoveryAndNotify).mockResolvedValue([
      "OpenClaw 服务检测完成",
      "- 扫描目标数: 2",
      "- 命中结果数: 1",
      "- 已确认 OpenClaw 服务: 1 个",
      "已确认的 OpenClaw 服务列表:",
      "- IP=127.0.0.1 端口=18789 协议=http 评分=90 状态=确认",
    ].join("\n"));
  });

  it("renders a webchat-friendly report with icons and summary", async () => {
    const report = await buildManualLynxCheckReport({
      log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      userId: "TEST_ID",
      ipInfo: { ip: "127.0.0.1", port: 18789, type: "next_check" },
      discoveryConfig: { fullScan: false },
      discoveryRuntimePath: "openclaw.plugin.json",
    });

    expect(report).toContain("# 📋 Lynx Guardian /lynx-check 综合检测报告");
    expect(report).toContain("## ✨ 总览");
    expect(report).toContain("- 🌐 公网暴露检测: ✅ PASS");
    expect(report).toContain("- 🦠 恶意脚本扫描: ⚠️ WARN");
    expect(report).toContain("- 🧩 Skill 完整性校验: ❌ FAIL");
    expect(report).toContain("## 🔎 服务发现 IP/端口");
    expect(report).toContain("- 🎯 127.0.0.1:18789");
    expect(report.lastIndexOf("## 🔎 服务发现 IP/端口")).toBeGreaterThan(report.lastIndexOf("## 🧩 Skill 完整性校验"));
  });
});
