import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildManualLynxCheckReport } from "../src/discovery/manual-lynx-check.js";
import * as discoveryUtils from "../src/discovery/discovery-hook-utils.js";
import { runManagedLynxAuditBoundaryCheck } from "../src/runtime/lynx-audit-runtime.js";
import * as securityAuditRunner from "../src/lynx-check/report-producers.js";
import * as skillGuard from "../src/skills/skill-guard.js";

vi.mock("../src/discovery/discovery-hook-utils.js");
vi.mock("../src/lynx-check/report-producers.js");
vi.mock("../src/skills/skill-guard.js");

describe("buildManualLynxCheckReport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(discoveryUtils.runDiscoveryAndNotify).mockResolvedValue([
      "OpenClaw 服务发现完成",
      "- IP=127.0.0.1 port=18789 scheme=http score=90 status=confirmed",
    ].join("\n"));
    vi.mocked(securityAuditRunner.runSecurityAudit).mockResolvedValue({
      audit_time: "2026-04-12T12:00:00Z",
      summary: {
        total: 3,
        passed: 1,
        warnings: 1,
        failed: 1,
        by_severity: {
          critical: 0,
          high: 1,
          medium: 1,
          low: 1,
        },
      },
      results: [
        {
          category: "config",
          name: "Plaintext config secret",
          status: "fail",
          severity: "high",
          description: "secret stored in config",
          impact: "credential exposure",
          fix: "move to env",
          timestamp: "2026-04-12T12:00:00Z",
        },
      ],
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
  });

  it("renders the mandatory Chinese audit sections for manual /lynx-check", async () => {
    const report = await buildManualLynxCheckReport({
      log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      userId: "TEST_ID",
      ipInfo: { ip: "127.0.0.1", port: 18789, type: "next_check" },
      discoveryConfig: { fullScan: false },
      discoveryRuntimePath: "openclaw.plugin.json",
    });

    expect(report).toContain("# 🛡️ OpenClaw 全方位安全审计报告");
    expect(report).toContain("## 一、执行摘要");
    expect(report).toContain("## 二、配置安全");
    expect(report).toContain("## 三、网关与执行面安全");
    expect(report).toContain("## 四、通道与消息投递安全");
    expect(report).toContain("## 五、Skills 与插件代码风险");
    expect(report).toContain("## 六、依赖与供应链风险");
    expect(report).toContain("## 七、文件权限与敏感路径");
    expect(report).toContain("## 八、优先级整改建议");
  });

  it("never tells the user to inspect report files or local paths", async () => {
    const report = await buildManualLynxCheckReport({
      log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      userId: "TEST_ID",
      ipInfo: { ip: "127.0.0.1", port: 18789, type: "next_check" },
      discoveryConfig: { fullScan: false },
      discoveryRuntimePath: "openclaw.plugin.json",
    });

    expect(report).not.toMatch(/check-runs|report\.md|result\.json|查看文件路径|inspect local files/i);
  });

  it("appends a separated local log webview footnote to the /lynx-check report", async () => {
    const report = await buildManualLynxCheckReport({
      log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      userId: "TEST_ID",
      ipInfo: { ip: "127.0.0.1", port: 18789, type: "next_check" },
      discoveryConfig: { fullScan: false },
      discoveryRuntimePath: "openclaw.plugin.json",
    });

    expect(report).toContain("\n---\n");
    expect(report).toContain("[^lynx-log]");
    expect(report).toContain("http://127.0.0.1:18789/webview");
    expect(report).toContain("本地日志页面");
    expect(report).toContain("/lynx-check");
  });

  it("allows managed /lynx-check report delivery inside the audit runtime boundary", () => {
    expect(
      runManagedLynxAuditBoundaryCheck({
        action: "deliver_report",
        target: "current-channel",
        managed: true,
      }),
    ).toEqual({ allowed: true });
  });
});
