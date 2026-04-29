import type { DecisionResponse, DecisionStage } from "../../shared/src/decision.js";
import type { DecisionContext } from "../runtime/decision-context.js";
import { findLocalConcealedExecutionHardDeny } from "./concealed-execution-hard-deny.js";
import { findLocalHardDenyPath, type LocalPathHardDenyHit } from "./path-hard-deny.js";
import { findLocalPromptHardDeny } from "./prompt-hard-deny.js";
import { findLocalToolHardDeny } from "./tool-command-hard-deny.js";

interface PluginProtectionNormalizationRule {
  from: RegExp;
  to: string;
}

const PLUGIN_PROTECTION_NORMALIZATIONS: PluginProtectionNormalizationRule[] = [
  { from: /\bshan\s*-?\s*chu\b/gi, to: "删除" },
  { from: /\bqu\s*-?\s*diao\b/gi, to: "删除" },
  { from: /删掉|删了|删一下|去掉|去除|去除掉|干掉|弄掉|拿掉|撤掉|摘掉|拔掉|搞掉|弄没|废掉/g, to: "删除" },
  { from: /\byi\s*-?\s*chu\b/gi, to: "移除" },
  { from: /\bqing\s*-?\s*chu\b/gi, to: "清除" },
  { from: /清掉|抹掉/g, to: "清除" },
  { from: /\bxiu\s*-?\s*gai\b/gi, to: "修改" },
  { from: /\bgeng\s*-?\s*gai\b/gi, to: "更改" },
  { from: /\bgai\s*-?\s*diao\b/gi, to: "修改" },
  { from: /改掉|改动/g, to: "修改" },
  { from: /改写掉/g, to: "重写" },
  { from: /替换掉|换掉|替掉/g, to: "修改" },
  { from: /改写|覆写/g, to: "重写" },
  { from: /替换|篡改|动手脚|做手脚|魔改/g, to: "修改" },
  { from: /\bjin\s*-?\s*yong\b/gi, to: "禁用" },
  { from: /\bting\s*-?\s*yong\b/gi, to: "停用" },
  { from: /\bguan\s*-?\s*bi\b/gi, to: "关闭" },
  { from: /\bguan\s*-?\s*diao\b/gi, to: "关闭" },
  { from: /\bxie\s*-?\s*zai\b/gi, to: "卸载" },
  { from: /关了|停了|停掉|关停|屏蔽|封掉|失效|作废|下线/g, to: "停用" },
  { from: /\bgai\s*-?\s*ming\b/gi, to: "改名" },
  { from: /\bchong\s*-?\s*ming\s*-?\s*ming\b/gi, to: "重命名" },
  { from: /\byi\s*-?\s*dong\b/gi, to: "移动" },
  { from: /\bnuo\s*-?\s*zou\b/gi, to: "移动" },
  { from: /搬走|挪开|挪地方|迁走|转走|转移/g, to: "移动" },
];

export function normalizePluginProtectionText(text: string): string {
  if (!text) return "";

  let normalized = text;
  for (const rule of PLUGIN_PROTECTION_NORMALIZATIONS) {
    normalized = normalized.replace(rule.from, rule.to);
  }

  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, "");
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}


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
  const promptHit = findLocalPromptHardDeny(text);
  if (promptHit) {
    return {
      matched: true,
      decision: buildLocalL4Decision(context.stage, promptHit.module, promptHit.reason),
    };
  }

  const concealedExecutionHit = findLocalConcealedExecutionHardDeny(text);
  if (concealedExecutionHit) {
    return {
      matched: true,
      decision: buildLocalL4Decision(context.stage, concealedExecutionHit.module, concealedExecutionHit.reason),
    };
  }

  const toolHit = findLocalToolHardDeny({
    content: context.content,
    toolName: context.toolName,
    command: extractCommandText(context.toolArgs),
    params: context.toolArgs,
    targetUri: context.targetUri,
  });
  if (toolHit) {
    return {
      matched: true,
      decision: buildLocalL4Decision(context.stage, toolHit.module, toolHit.reason),
    };
  }

  const pathHit = localPathHardDenyToRule(findLocalHardDenyPath(text), text, context);
  if (pathHit) {
    return {
      matched: true,
      decision: buildLocalL4Decision(context.stage, pathHit.module, pathHit.reason),
    };
  }

  const matched = localL4Rules.find((rule) => rule.matches(text, context));
  if (!matched) {
    return { matched: false };
  }
  return {
    matched: true,
    decision: buildLocalL4Decision(context.stage, matched.module, matched.reason),
  };
}

export function evaluateLocalL4Input(
  content: string,
  options: Partial<Omit<DecisionContext, "stage" | "hook" | "content" | "createdAt">> & {
    hook?: string;
    createdAt?: string;
  } = {},
): LocalL4Decision {
  return evaluateLocalL4FastPath({
    ...options,
    stage: "input",
    hook: options.hook ?? "before_dispatch",
    content,
    createdAt: options.createdAt ?? new Date().toISOString(),
  });
}

export function evaluateLocalL4ToolCall(
  toolName: string,
  toolArgs: Record<string, unknown> = {},
  options: Partial<Omit<DecisionContext, "stage" | "hook" | "toolName" | "toolArgs" | "createdAt">> & {
    hook?: string;
    createdAt?: string;
  } = {},
): LocalL4Decision {
  return evaluateLocalL4FastPath({
    ...options,
    stage: "tool_call",
    hook: options.hook ?? "before_tool_call",
    toolName,
    toolArgs,
    createdAt: options.createdAt ?? new Date().toISOString(),
  });
}

export function evaluateLocalL4Output(
  content: string,
  options: Partial<Omit<DecisionContext, "stage" | "hook" | "content" | "createdAt">> & {
    hook?: string;
    createdAt?: string;
  } = {},
): LocalL4Decision {
  return evaluateLocalL4FastPath({
    ...options,
    stage: "outbound_message",
    hook: options.hook ?? "message_sending",
    content,
    createdAt: options.createdAt ?? new Date().toISOString(),
  });
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

function extractCommandText(toolArgs?: Record<string, unknown>): string | undefined {
  const command = toolArgs?.command ?? toolArgs?.cmd ?? toolArgs?.script;
  return typeof command === "string" ? command : undefined;
}

function localPathHardDenyToRule(
  hit: LocalPathHardDenyHit | null,
  text: string,
  context: DecisionContext,
): { module: string; reason: string } | null {
  if (!hit) {
    return null;
  }

  if (hit.kind === "credential" && hasReadVerb(text)) {
    return {
      module: "local_secret_read",
      reason: `Request attempts to read protected credential path: ${hit.label}.`,
    };
  }

  if (hit.kind === "system_path" && hasReadOrWriteVerb(text)) {
    return {
      module: "local_secret_read",
      reason: `Request attempts to access protected system path: ${hit.label}.`,
    };
  }

  if (hit.kind === "prompt_file" && hasReadVerb(text)) {
    return {
      module: "local_protected_prompt_read",
      reason: `Request attempts to read protected prompt file: ${hit.label}.`,
    };
  }

  if (hit.kind === "plugin_self" && isMutatingContext(text, context)) {
    return {
      module: "local_plugin_file_tamper",
      reason: `Request attempts to mutate Lynx Guardian path: ${hit.label}.`,
    };
  }

  if (hit.kind === "openclaw_config" && isDisableOrMutationText(text, context)) {
    return {
      module: "local_config_disable_mutation",
      reason: `Request attempts to disable protection through config path: ${hit.label}.`,
    };
  }

  return null;
}

function hasReadVerb(text: string): boolean {
  return /\b(?:cat|type|get-content|gc|less|more|head|tail|read|open|print|show)\b/i.test(text);
}

function hasReadOrWriteVerb(text: string): boolean {
  return hasReadVerb(text) || /\b(?:write|edit|patch|append|overwrite|set-content|rm|delete|remove)\b/i.test(text);
}

function isMutatingContext(text: string, context: DecisionContext): boolean {
  return /^(?:write|edit|edit_file)$/i.test(context.toolName ?? "")
    || /\b(?:rm|del|delete|remove|unlink|mv|move|rename|ren|rmdir|rd|write|edit|patch|append|overwrite|disable|uninstall)\b/i.test(text);
}

function isDisableOrMutationText(text: string, context: DecisionContext): boolean {
  return isMutatingContext(text, context)
    && /(?:\bdisabled\b\s*[:=]\s*true|\bdisable(?:d|s)?\b|\bturn\s+off\b|\bdeactivate\b|\bsafety\s*bypass\b)/i.test(text);
}
