import type { DecisionResponse, DecisionStage } from "../../shared/src/decision.js";
import type { DecisionContext } from "./decision-context.js";

export interface LocalL4Decision {
  matched: boolean;
  decision?: DecisionResponse;
}

interface LocalL4Rule {
  module: string;
  reason: string;
  matches(text: string, context: DecisionContext): boolean;
}

const localL4Rules: LocalL4Rule[] = [
  {
    module: "local_plugin_disable",
    reason: "Request attempts to disable Lynx Guardian.",
    matches: (text) => containsAny(text, "禁用 lynx guardian", "disable lynx guardian", "关闭 lynx guardian"),
  },
  {
    module: "local_config_disable_mutation",
    reason: "Request attempts to mutate openclaw.json disabled state.",
    matches: (text) => containsAny(text, "openclaw.json", "disabled") && containsAny(text, "禁用", "disable", "false", "关闭"),
  },
  {
    module: "local_plugin_file_tamper",
    reason: "Request attempts to delete, move, or tamper with plugin defense files.",
    matches: (text) => containsAny(text, "openclaw-lynx-guardian", "lynx guardian", "插件") &&
      containsAny(text, "删除", "移动", "篡改", "delete", "move", "tamper", "remove"),
  },
  {
    module: "local_secret_read",
    reason: "Request attempts to read private keys, tokens, or environment secrets.",
    matches: (text) => containsAny(text, "id_rsa", ".env", "private key", "api key", "token", "密钥", "私钥"),
  },
  {
    module: "local_protected_prompt_read",
    reason: "Request attempts to read protected prompt or raw safety rules.",
    matches: (text) => containsAny(text, "system prompt", "developer instruction", "系统提示", "系统提示词", "开发者指令", "安全规则原文"),
  },
  {
    module: "local_sensitive_external_send",
    reason: "Request combines sensitive source with an external send target.",
    matches: (text) => containsAny(text, ".env", "id_rsa", "token", "客户名单", "退款名单") &&
      containsAny(text, "http://", "https://", "发送", "外发", "upload", "post"),
  },
  {
    module: "local_keylogger_silent_upload",
    reason: "Request asks for keylogger or silent upload behavior.",
    matches: (text) => containsAny(text, "键盘记录器", "keylogger") &&
      containsAny(text, "静默上传", "silent upload", "偷偷上传", "窃取"),
  },
  {
    module: "local_approval_bypass",
    reason: "Request asks to bypass approval or confirmation.",
    matches: (text) => containsAny(text, "绕过审批", "跳过授权", "免确认", "不要授权", "别弹", "queren", "shouquan", "shenpi"),
  },
  {
    module: "local_hidden_execution",
    reason: "Request asks to hide or obfuscate execution chain.",
    matches: (text) => containsAny(text, "base64", "unicode", "拆分命令", "split command") &&
      containsAny(text, "绕过", "规避", "fengkong", "风控", "detector", "检测"),
  },
];

export function evaluateLocalL4FastPath(context: DecisionContext): LocalL4Decision {
  const text = normalizeContextText(context);
  const matched = localL4Rules.find((rule) => rule.matches(text, context));
  if (!matched) {
    return { matched: false };
  }
  return {
    matched: true,
    decision: buildLocalL4Decision(context.stage, matched.module, matched.reason),
  };
}

function buildLocalL4Decision(stage: DecisionStage, module: string, reason: string): DecisionResponse {
  return {
    decisionId: `local-l4-${Date.now()}`,
    stage,
    block: true,
    action: "deny",
    riskLevel: "L4",
    score: 100,
    winningArbiter: "local_l4",
    arbiters: [],
    matchedModules: [module],
    requiresApproval: false,
    audit: {
      eventSeverity: "critical",
      policyDecision: "deny",
      enforcementAction: "deny",
      color: "red",
    },
    userMessage: reason,
  };
}

function normalizeContextText(context: DecisionContext): string {
  return [
    context.content,
    context.toolName,
    context.targetUri,
    context.toolArgs ? JSON.stringify(context.toolArgs) : "",
  ].filter(Boolean).join(" ").toLowerCase();
}

function containsAny(value: string, ...needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle.toLowerCase()));
}
