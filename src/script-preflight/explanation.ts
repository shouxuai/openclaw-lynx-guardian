import type { ScriptPreflightEvidence } from "../../shared/src/decision.js";

export interface ScriptExplanationPayload {
  scripts: Array<{
    scriptPath?: string;
    realPath?: string;
    language: string;
    riskLevel: string;
    recommendedAction: string;
    findings: Array<{
      ruleId: string;
      module: string;
      severity: string;
      behavior: string;
      line?: number;
      snippet?: string;
      confidence: string;
    }>;
  }>;
}

export function buildScriptExplanationPayload(evidence: ScriptPreflightEvidence[]): ScriptExplanationPayload {
  return {
    scripts: evidence.map((item) => ({
      scriptPath: item.scriptPath,
      realPath: item.realPath,
      language: item.language,
      riskLevel: item.riskLevel,
      recommendedAction: item.recommendedAction,
      findings: item.findings.map((finding) => ({
        ruleId: finding.ruleId,
        module: finding.module,
        severity: finding.severity,
        behavior: finding.behavior,
        line: finding.line,
        snippet: finding.snippet?.slice(0, 220),
        confidence: finding.confidence,
      })),
    })),
  };
}

export async function explainScriptDenial(input: {
  evidence: ScriptPreflightEvidence[];
  llmExplain?: (payload: ScriptExplanationPayload) => Promise<string>;
}): Promise<string> {
  if (input.llmExplain) {
    try {
      const text = await input.llmExplain(buildScriptExplanationPayload(input.evidence));
      if (text.trim()) {
        return text.trim();
      }
    } catch {
      return buildScriptDenialExplanation(input.evidence);
    }
  }
  return buildScriptDenialExplanation(input.evidence);
}

export function buildScriptDenialExplanation(evidence: ScriptPreflightEvidence[]): string {
  const denied = evidence.filter((item) => item.recommendedAction === "deny" || item.riskLevel === "L4");
  const primary = denied[0] ?? evidence[0];
  if (!primary) {
    return "已拒绝本次工具调用。Lynx Guardian 未能生成脚本预检详情，但策略裁决要求阻止执行。";
  }

  const target = primary.scriptPath ?? primary.realPath ?? primary.command ?? "目标脚本";
  const ruleIds = primary.findings.map((finding) => finding.ruleId).join("、");
  const behaviors = primary.findings.map((finding) => finding.behavior).join("；");

  return [
    `已拒绝执行 ${target}。`,
    behaviors ? `静态预检发现：${behaviors}。` : "静态预检发现高风险脚本行为。",
    ruleIds ? `命中规则：${ruleIds}。` : "",
    "这是确定性策略裁决；模型只负责解释证据，不参与放行判断。",
  ].filter(Boolean).join("");
}
