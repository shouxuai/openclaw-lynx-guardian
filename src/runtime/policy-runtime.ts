import type { RiskAssessment } from "../guard/safety-guard.js";
import type { WorkflowAuthorization } from "./workflow-authorization-store.js";

const DEFAULT_CONFIRMATION_PHRASE = "确认放行本次操作";
const DEFAULT_OVERRIDE_LEVELS = ["L2", "L3", "L4"] as const;

export function normalizePolicyConfig(policy: any = {}) {
  return {
    absoluteRejectScore: policy.absoluteRejectScore ?? 10,
    confirmationPhrase: policy.confirmationPhrase ?? DEFAULT_CONFIRMATION_PHRASE,
    allowOneTimeOverrideLevels: policy.allowOneTimeOverrideLevels ?? [...DEFAULT_OVERRIDE_LEVELS],
    moduleOverrides: {
      M3: {
        allowOneTimeOverride: policy.moduleOverrides?.M3?.allowOneTimeOverride ?? true,
      },
    },
    overrideTtlMs: Math.max(30, Number(policy.overrideTtlSeconds ?? 90)) * 1000,
    workflowAuthWindowMs: Math.min(
      900_000,
      Math.max(30_000, Number(policy.workflowAuthWindowSeconds ?? 180)) * 1000,
    ),
  };
}

export function buildApiRiskAssessment(
  riskLevel: number,
  description: string,
): RiskAssessment {
  if (riskLevel >= 3) {
    return { level: "L4", score: 9, modules: [], description, action: "deny" };
  }
  if (riskLevel === 2) {
    return { level: "L2", score: 6, modules: [], description, action: "block" };
  }
  if (riskLevel === 1) {
    return { level: "L1", score: 3, modules: [], description, action: "warn" };
  }
  return { level: "L0", score: 0, modules: [], description, action: "allow" };
}

export function buildOverridePrompt(message: string, confirmationPhrase: string): string {
  return `${message} 如确认放行本次工作流中的此类操作，请回复"${confirmationPhrase}"。`;
}

const MODULE_DISPLAY_NAMES: Record<string, string> = {
  "M0:identity_verification": "身份声明",
  "M2:protected_file_access": "核心配置文件访问",
  "M3:over_agency": "过度代理/权限提升",
};

function moduleDisplayName(mod: string): string {
  return MODULE_DISPLAY_NAMES[mod] ?? mod;
}

export function buildParamSummary(toolName: string, params: Record<string, any>): string {
  if (toolName === "exec") return String(params?.command ?? "").slice(0, 120);
  return String(params?.path ?? params?.file_path ?? JSON.stringify(params)).slice(0, 120);
}

export function formatWorkflowAuthSummary(auth: WorkflowAuthorization): string {
  const durationSec = Math.round((Date.now() - auth.grantedAt) / 1000);
  const moduleNames = auth.allowedModules.map(moduleDisplayName).join("、");
  const scopeDesc = auth.scopeAll ? "全模块（时间窗口）" : moduleNames;
  const lines: string[] = [
    `🔁 **[Lynx Guardian] 工作流授权已回收**`,
    ``,
    `授权范围：${scopeDesc}`,
    `工作流时长：${durationSec}s`,
    `放行操作记录（共 ${auth.auditLog.length} 次）：`,
  ];
  auth.auditLog.forEach((entry, index) => {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour12: false });
    lines.push(`  ${index + 1}. [${timestamp}] ${entry.toolName}: ${entry.paramSummary}`);
  });
  if (auth.auditLog.length === 0) {
    lines.push("  （工作流中未产生实际放行操作）");
  }
  return lines.join("\n");
}
