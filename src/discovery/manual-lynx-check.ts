import { runDiscoveryAndNotify } from "./discovery-hook-utils.js";
import { renderDetailedLynxAuditReport } from "./lynx-check-report-template.js";
import { runMaliciousScriptScan, runSecurityAudit } from "../lynx-check/report-producers.js";
import {
  checkPublicAccessWeighted,
  isRemoteAvailable,
} from "../runtime/remote-weighting-service.js";
import { verifyAllInstalledSkills } from "../skills/skill-guard.js";

type Rating = "高危" | "中高危" | "中危" | "低危";

function formatTimestamp(date: Date): string {
  return date.toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

function extractDiscoveryTargets(discoverySummary: string): string[] {
  return discoverySummary
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- IP="))
    .map((line) => {
      const ipMatch = line.match(/IP=([^\s]+)/i);
      const portMatch = line.match(/(?:port|端口)=([^\s]+)/i);
      if (!ipMatch || !portMatch) {
        return line.replace(/^- /, "");
      }
      return `${ipMatch[1]}:${portMatch[1]}`;
    });
}

function filterAuditFindings(
  auditReport: Awaited<ReturnType<typeof runSecurityAudit>>,
  keywords: string[],
): string[] {
  if (!auditReport) {
    return [];
  }

  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  return auditReport.results
    .filter((finding) => {
      const combined = [
        finding.category,
        finding.name,
        finding.description,
        finding.impact,
      ].join(" ").toLowerCase();
      return normalizedKeywords.some((keyword) => combined.includes(keyword));
    })
    .slice(0, 5)
    .map((finding) => `${finding.severity.toUpperCase()} / ${finding.name}: ${finding.description}`);
}

function deriveOverallRating(params: {
  publicExposed: boolean;
  invalidSkillCount: number;
  maliciousFindingCount: number;
  auditReport: Awaited<ReturnType<typeof runSecurityAudit>>;
}): Rating {
  const severity = params.auditReport?.summary.by_severity;
  if (params.publicExposed || (severity?.critical ?? 0) > 0) {
    return "高危";
  }
  if (params.invalidSkillCount > 0 || params.maliciousFindingCount > 0 || (severity?.high ?? 0) > 0) {
    return "中高危";
  }
  if ((severity?.medium ?? 0) > 0 || (params.auditReport?.summary.warnings ?? 0) > 0) {
    return "中危";
  }
  return "低危";
}

function buildConfigSection(params: {
  publicExposed: boolean;
  auditReport: Awaited<ReturnType<typeof runSecurityAudit>>;
}) {
  const configFindings = filterAuditFindings(params.auditReport, ["config", "env", "credential", "secret"]);
  const bullets = [
    params.publicExposed
      ? "检测到网关存在公网暴露风险，配置面需要优先复核监听地址、鉴权和暴露策略。"
      : "当前未从公网暴露检查中发现直接暴露证据，但仍应复核敏感配置是否以环境变量而非明文文件存放。",
    ...(configFindings.length > 0
      ? configFindings
      : ["本轮未从自动审计脚本拿到更细的配置级发现，建议后续补充对 openclaw.json 与备份配置的逐项解析。"]),
  ];

  return {
    title: "配置安全",
    summary: params.publicExposed ? "配置面存在高优先级复核项。" : "配置面未发现明确高危结论，但自动审计数据仍不完整。",
    bullets,
  };
}

function buildGatewaySection(params: {
  ipInfo: any;
  publicExposed: boolean;
  discoverySummary: string;
  auditReport: Awaited<ReturnType<typeof runSecurityAudit>>;
}) {
  const gatewayFindings = filterAuditFindings(params.auditReport, ["network", "gateway", "shell", "exec"]);
  const targets = extractDiscoveryTargets(params.discoverySummary);
  const addressSummary = params.ipInfo?.type === "next_check"
    ? `${params.ipInfo.ip}:${params.ipInfo.port}`
    : params.ipInfo?.type === "loopback"
      ? `127.0.0.1:${params.ipInfo.port}`
      : `端口 ${params.ipInfo?.port ?? "unknown"}`;

  return {
    title: "网关与执行面安全",
    summary: params.publicExposed
      ? "网关暴露面需要立即优先处理。"
      : "网关当前未见公网暴露结论，但执行面仍需保持最小权限。",
    bullets: [
      `当前识别到的网关地址摘要：${addressSummary}。`,
      params.publicExposed
        ? "公网访问检测结果为可暴露，说明网关监听与访问控制存在立即整改需求。"
        : "公网访问检测结果未显示直接暴露，但这不等于执行面完全安全。",
      targets.length > 0
        ? `服务发现阶段确认的目标包括：${targets.slice(0, 5).join("，")}。`
        : "服务发现阶段未返回可确认目标，建议结合真实容器日志与运行状态继续复核。",
      ...(gatewayFindings.length > 0
        ? gatewayFindings
        : ["本轮没有额外的执行面自动发现项；内部网络枚举按当前策略故意省略，不作为缺失错误。"]),
    ],
  };
}

function buildChannelSection() {
  return {
    title: "通道与消息投递安全",
    summary: "通道安全信息仍需结合真实绑定和投递目标继续复核。",
    bullets: [
      "当前报告链路的目标是直接向 WebChat / Feishu 回传完整中文审计报告，而不是提示用户查看本地文件。",
      "如果通道绑定缺失，报告仍应完整生成并保留，不应退化成空状态提示或审批提示消息。",
      "本轮未采集到更细的通道策略明细，建议后续补充对通道权限、群聊/私聊策略和 mention 规则的专门审计。",
    ],
  };
}

function buildSkillSection(params: {
  maliciousFindings: Awaited<ReturnType<typeof runMaliciousScriptScan>>;
  invalidSkillCount: number;
  skillCount: number;
}) {
  const findings = params.maliciousFindings ?? [];
  return {
    title: "Skills 与插件代码风险",
    summary: params.invalidSkillCount > 0 || findings.length > 0
      ? "技能与插件代码面存在需要人工复核的风险项。"
      : "当前未从自动检查中看到明显高危代码迹象。",
    bullets: [
      params.skillCount > 0
        ? `已校验技能数量：${params.skillCount}，其中哈希异常数量：${params.invalidSkillCount}。`
        : "本轮未发现可校验的已安装技能，完整性结论不足。",
      ...(findings.length > 0
        ? findings.slice(0, 5).map((finding) => `${String(finding.severity).toUpperCase()} / ${finding.file}: ${finding.description}`)
        : ["恶意脚本扫描未返回明确告警。"]),
    ],
  };
}

function buildDependencySection(auditReport: Awaited<ReturnType<typeof runSecurityAudit>>) {
  const dependencyFindings = filterAuditFindings(auditReport, ["depend", "package", "npm", "supply", "vulnerability"]);
  return {
    title: "依赖与供应链风险",
    summary: dependencyFindings.length > 0 ? "依赖侧存在可见风险项。" : "本轮未拿到足够的依赖审计数据。",
    bullets: dependencyFindings.length > 0
      ? dependencyFindings
      : ["当前自动审计结果未提供足够的依赖漏洞明细，建议后续补充 npm audit 或锁文件级审计结果。"],
  };
}

function buildPermissionSection(auditReport: Awaited<ReturnType<typeof runSecurityAudit>>) {
  const permissionFindings = filterAuditFindings(auditReport, ["permission", "world", "writable", "chmod"]);
  return {
    title: "文件权限与敏感路径",
    summary: permissionFindings.length > 0 ? "权限面存在需要优先收敛的暴露项。" : "本轮未拿到足够的权限审计细节。",
    bullets: permissionFindings.length > 0
      ? permissionFindings
      : ["自动审计脚本没有返回明确的敏感路径权限结论，建议后续补充对运行目录、配置文件和扩展目录的权限枚举。"],
  };
}

function buildNextActions(params: {
  publicExposed: boolean;
  invalidSkillCount: number;
  maliciousFindingCount: number;
}): string[] {
  const actions: string[] = [];
  if (params.publicExposed) {
    actions.push("立即限制网关监听与公网暴露面，优先确认绑定地址、上游代理和访问控制策略。");
  }
  if (params.invalidSkillCount > 0) {
    actions.push("立即复核哈希异常的技能或插件，确认是否存在被篡改、覆盖或过期副本。");
  }
  if (params.maliciousFindingCount > 0) {
    actions.push("逐条审查恶意脚本扫描命中的文件，优先确认是否存在外联、动态执行或敏感信息采集逻辑。");
  }
  actions.push("补充依赖与权限级自动审计数据源，避免报告长期依赖“未能采集”的章节。");
  actions.push("继续保持报告直接回传，不再让手动或定时任务退化成审批提示或文件路径提示。");
  return actions.slice(0, 5);
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
    const publicAccessCheck = await checkPublicAccessWeighted(userId, ipInfo.ip, ipInfo.port);
    if (isRemoteAvailable(publicAccessCheck)) {
      nextPublicAccessResult = publicAccessCheck.value;
    } else {
      log.warn(`[lynx-guardian] Manual public access weighting unavailable: ${publicAccessCheck.errorMessage}`);
    }
  }

  const discoverySummary = await runDiscoveryAndNotify(log, null, discoveryConfig, discoveryRuntimePath);
  const auditReport = await runSecurityAudit();
  const maliciousFindings = await runMaliciousScriptScan();
  const skillResults = verifyAllInstalledSkills();
  const invalidSkillCount = skillResults.filter((result) => !result.valid).length;
  const publicExposed = nextPublicAccessResult?.result?.is_public === true;
  const overallRating = deriveOverallRating({
    publicExposed,
    invalidSkillCount,
    maliciousFindingCount: maliciousFindings?.length ?? 0,
    auditReport,
  });

  return renderDetailedLynxAuditReport({
    generatedAt: formatTimestamp(new Date()),
    overallRating,
    executiveSummary: [
      "本报告由 Lynx Guardian 在插件侧先完成确定性审计，再组织为可直接回传的中文报告。",
      publicExposed
        ? "网关公网暴露检查命中风险，本次结论至少应按高优先级处理。"
        : "本轮未在公网暴露检查中发现直接暴露证据，但这不等于整体安全基线已达标。",
      auditReport
        ? `自动安全审计返回 ${auditReport.summary.total} 项结果，其中失败 ${auditReport.summary.failed} 项、警告 ${auditReport.summary.warnings} 项。`
        : "自动安全审计脚本未返回结构化结果，部分章节以“未能采集”形式保留。",
      "报告不会要求用户查看本地文件路径；若某章节证据不足，会明确保留章节并标注需要继续复核。",
    ],
    sections: [
      buildConfigSection({ publicExposed, auditReport }),
      buildGatewaySection({ ipInfo, publicExposed, discoverySummary, auditReport }),
      buildChannelSection(),
      buildSkillSection({
        maliciousFindings,
        invalidSkillCount,
        skillCount: skillResults.length,
      }),
      buildDependencySection(auditReport),
      buildPermissionSection(auditReport),
    ],
    nextActions: buildNextActions({
      publicExposed,
      invalidSkillCount,
      maliciousFindingCount: maliciousFindings?.length ?? 0,
    }),
  });
}
