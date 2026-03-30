import { checkPublicAccess } from "./api.js";
import { runMaliciousScriptScan } from "./security-audit-runner.js";
import { verifyAllInstalledSkills } from "./skill-guard.js";
import { runDiscoveryAndNotify } from "./discovery-hook-utils.js";

type SectionState = "PASS" | "WARN" | "FAIL";

interface SectionDescriptor {
  icon: string;
  title: string;
  state: SectionState;
  lines: string[];
}

function stateBadge(state: SectionState): string {
  switch (state) {
    case "PASS":
      return "✅ PASS";
    case "WARN":
      return "⚠️ WARN";
    case "FAIL":
      return "❌ FAIL";
  }
}

function renderSection(section: SectionDescriptor): string {
  return [
    `## ${section.icon} ${section.title}`,
    `状态: ${stateBadge(section.state)}`,
    ...section.lines,
  ].join("\n");
}

function formatPublicAccessSection(ipInfo: any, publicAccessResult: any): SectionDescriptor {
  if (!ipInfo) {
    return {
      icon: "🌐",
      title: "公网暴露检测",
      state: "WARN",
      lines: [
        "- ℹ️ 无法获取当前 OpenClaw 网关监听信息",
      ],
    };
  }

  if (ipInfo.type === "next_check") {
    const isPublic = publicAccessResult?.result?.is_public === true;
    return {
      icon: "🌐",
      title: "公网暴露检测",
      state: isPublic ? "FAIL" : "PASS",
      lines: [
        `- 📍 地址: ${ipInfo.ip}:${ipInfo.port}`,
        `- ${isPublic ? "🚨 检测到公网暴露风险" : "🛡️ 未检测到公网暴露"}`,
      ],
    };
  }

  if (ipInfo.type === "loopback") {
    return {
      icon: "🌐",
      title: "公网暴露检测",
      state: "PASS",
      lines: [
        `- 📍 地址: 127.0.0.1:${ipInfo.port}`,
        "- 🏠 当前仅本地回环可访问",
      ],
    };
  }

  if (ipInfo.type === "closed") {
    return {
      icon: "🌐",
      title: "公网暴露检测",
      state: "WARN",
      lines: [
        `- 📪 端口: ${ipInfo.port}`,
        "- ℹ️ 未检测到网关监听端口",
      ],
    };
  }

  return {
    icon: "🌐",
    title: "公网暴露检测",
    state: "WARN",
    lines: [
      `- 📍 地址: ${ipInfo.ip ?? "unknown"}:${ipInfo.port ?? "unknown"}`,
      "- 🤔 当前状态未知，建议结合服务发现结果人工复核",
    ],
  };
}

async function formatMaliciousScriptSection(): Promise<SectionDescriptor> {
  const findings = await runMaliciousScriptScan();
  if (findings == null) {
    return {
      icon: "🦠",
      title: "恶意脚本扫描",
      state: "WARN",
      lines: [
        "- ℹ️ 扫描器不可用，暂未返回结果",
      ],
    };
  }

  if (findings.length === 0) {
    return {
      icon: "🦠",
      title: "恶意脚本扫描",
      state: "PASS",
      lines: [
        "- 🎉 未发现可疑脚本",
      ],
    };
  }

  return {
    icon: "🦠",
    title: "恶意脚本扫描",
    state: "WARN",
    lines: [
      `- 🔍 发现 ${findings.length} 条可疑项`,
      ...findings.slice(0, 5).map((finding) => (
        `- [${finding.severity}] ${finding.file}: ${finding.description}`
      )),
    ],
  };
}

function formatSkillIntegritySection(): SectionDescriptor {
  const results = verifyAllInstalledSkills();
  if (results.length === 0) {
    return {
      icon: "🧩",
      title: "Skill 完整性校验",
      state: "WARN",
      lines: [
        "- ℹ️ 当前未发现可校验的已安装 Skill",
      ],
    };
  }

  const invalid = results.filter((result) => !result.valid);
  if (invalid.length === 0) {
    return {
      icon: "🧩",
      title: "Skill 完整性校验",
      state: "PASS",
      lines: [
        `- ✅ ${results.length} 个 Skill 校验通过`,
      ],
    };
  }

  return {
    icon: "🧩",
    title: "Skill 完整性校验",
    state: "FAIL",
    lines: [
      `- 🚨 异常 Skill: ${invalid.length}/${results.length}`,
      ...invalid.slice(0, 5).map((result) => (
        `- ${result.skillName}: ${result.reason ?? "Hash mismatch"}`
      )),
    ],
  };
}

function extractDiscoveryTargets(discoverySummary: string): string[] {
  return discoverySummary
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- IP="))
    .map((line) => {
      const ipMatch = line.match(/IP=([^\s]+)/);
      const portMatch = line.match(/端口=([^\s]+)/);
      if (!ipMatch || !portMatch) {
        return line;
      }
      return `${ipMatch[1]}:${portMatch[1]}`;
    });
}

function formatDiscoverySection(discoverySummary: string): SectionDescriptor {
  const targets = extractDiscoveryTargets(discoverySummary);
  const confirmed = /已确认 OpenClaw 服务:\s*(\d+)/.exec(discoverySummary);
  const confirmedCount = confirmed ? Number(confirmed[1]) : targets.length;
  const state: SectionState = confirmedCount > 0 ? "PASS" : "WARN";

  return {
    icon: "🔎",
    title: "服务发现 IP/端口",
    state,
    lines: [
      confirmedCount > 0
        ? `- 🛰️ 命中 ${confirmedCount} 个高置信服务`
        : "- 🤔 暂未发现高置信服务，请人工复核原始探测结果",
      ...targets.slice(0, 10).map((target) => `- 🎯 ${target}`),
      "",
      "```text",
      discoverySummary,
      "```",
    ],
  };
}

function renderOverview(sections: SectionDescriptor[]): string {
  return [
    "## ✨ 总览",
    ...sections.map((section) => `- ${section.icon} ${section.title}: ${stateBadge(section.state)}`),
  ].join("\n");
}

export async function buildManualLynxCheckReport(options: {
  log: any;
  userId: string;
  ipInfo: any;
  publicAccessResult?: any;
  discoveryConfig: any;
  discoveryRuntimePath: string;
}): Promise<string> {
  const {
    log,
    userId,
    ipInfo,
    publicAccessResult,
    discoveryConfig,
    discoveryRuntimePath,
  } = options;

  let nextPublicAccessResult = publicAccessResult;
  if (!nextPublicAccessResult && ipInfo?.type === "next_check") {
    try {
      nextPublicAccessResult = await checkPublicAccess(userId, ipInfo.ip, ipInfo.port);
    } catch (err: any) {
      log.error(`[lynx-guardian] Manual public access check failed: ${err.message}`);
    }
  }

  const publicAccessSection = formatPublicAccessSection(ipInfo, nextPublicAccessResult);
  const maliciousScriptSection = await formatMaliciousScriptSection();
  const skillIntegritySection = formatSkillIntegritySection();
  const discoverySummary = await runDiscoveryAndNotify(log, null, discoveryConfig, discoveryRuntimePath);
  const discoverySection = formatDiscoverySection(discoverySummary);

  const sections = [
    publicAccessSection,
    maliciousScriptSection,
    skillIntegritySection,
    discoverySection,
  ];

  return [
    "# 📋 Lynx Guardian /lynx-check 综合检测报告",
    "这次我把关键检测结果整理成了更适合 WebChat 阅读的摘要卡片，详细探测结果放在最后。",
    renderOverview(sections),
    ...sections.map((section) => renderSection(section)),
  ].join("\n\n");
}
