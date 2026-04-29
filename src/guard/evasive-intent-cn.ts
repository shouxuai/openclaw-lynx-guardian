export const CHINESE_EVASIVE_INTENT_FAMILIES = [
  "bypass_goal",
  "masquerade_method",
  "wildcard_obfuscation",
  "encoding_obfuscation",
  "detector_target",
  "approval_evasion",
  "dangerous_outcome",
  "staged_attack",
  "stealth_intent",
] as const;

export type ChineseEvasiveIntentFamily = (typeof CHINESE_EVASIVE_INTENT_FAMILIES)[number];

export interface ChineseEvasiveIntentLiteral {
  family: ChineseEvasiveIntentFamily;
  term: string;
  weight: 1 | 2;
  requiresCooccurrence?: boolean;
}

export interface ChineseEvasiveIntentPattern {
  family: ChineseEvasiveIntentFamily;
  pattern: RegExp;
  label: string;
  weight: 1 | 2;
  requiresCooccurrence?: boolean;
}

export interface ChineseNormalizationRule {
  from: RegExp;
  to: string;
}

export const CHINESE_EVASIVE_INTENT_LITERALS: ChineseEvasiveIntentLiteral[] = [
  { family: "bypass_goal", term: "绕过", weight: 2 },
  { family: "bypass_goal", term: "避开检测", weight: 2 },
  { family: "bypass_goal", term: "不要被识别", weight: 2 },
  { family: "bypass_goal", term: "跳过审批", weight: 2 },
  { family: "bypass_goal", term: "欺骗风控", weight: 2 },
  { family: "bypass_goal", term: "躲开检查", weight: 2 },
  { family: "bypass_goal", term: "蒙混过去", weight: 2, requiresCooccurrence: true },
  { family: "bypass_goal", term: "糊弄过去", weight: 2, requiresCooccurrence: true },
  { family: "bypass_goal", term: "别让它看出来", weight: 1, requiresCooccurrence: true },

  { family: "masquerade_method", term: "改名", weight: 1, requiresCooccurrence: true },
  { family: "masquerade_method", term: "伪装", weight: 2 },
  { family: "masquerade_method", term: "冒充", weight: 2 },
  { family: "masquerade_method", term: "伪装成正常更新", weight: 2 },
  { family: "masquerade_method", term: "像正常脚本", weight: 1, requiresCooccurrence: true },
  { family: "masquerade_method", term: "披个马甲", weight: 2, requiresCooccurrence: true },
  { family: "masquerade_method", term: "套壳", weight: 2, requiresCooccurrence: true },
  { family: "masquerade_method", term: "换个壳", weight: 2, requiresCooccurrence: true },
  { family: "masquerade_method", term: "换皮", weight: 1, requiresCooccurrence: true },

  { family: "wildcard_obfuscation", term: "通配符", weight: 1 },
  { family: "wildcard_obfuscation", term: "星号通配", weight: 1 },
  { family: "wildcard_obfuscation", term: "分段拼接", weight: 1, requiresCooccurrence: true },
  { family: "wildcard_obfuscation", term: "拆开字符串", weight: 1, requiresCooccurrence: true },
  { family: "wildcard_obfuscation", term: "间插符号", weight: 1, requiresCooccurrence: true },
  { family: "wildcard_obfuscation", term: "模糊匹配", weight: 1, requiresCooccurrence: true },
  { family: "wildcard_obfuscation", term: "打散关键字", weight: 1, requiresCooccurrence: true },
  { family: "wildcard_obfuscation", term: "拼起来", weight: 1, requiresCooccurrence: true },
  { family: "wildcard_obfuscation", term: "拆词", weight: 1, requiresCooccurrence: true },

  { family: "encoding_obfuscation", term: "base64", weight: 1, requiresCooccurrence: true },
  { family: "encoding_obfuscation", term: "b64decode", weight: 1, requiresCooccurrence: true },
  { family: "encoding_obfuscation", term: "16进制", weight: 1, requiresCooccurrence: true },
  { family: "encoding_obfuscation", term: "hex", weight: 1, requiresCooccurrence: true },
  { family: "encoding_obfuscation", term: "unicode转义", weight: 1, requiresCooccurrence: true },
  { family: "encoding_obfuscation", term: "url编码", weight: 1, requiresCooccurrence: true },
  { family: "encoding_obfuscation", term: "fromcharcode", weight: 1, requiresCooccurrence: true },
  { family: "encoding_obfuscation", term: "chr拼接", weight: 1, requiresCooccurrence: true },
  { family: "encoding_obfuscation", term: "frombase64string", weight: 1, requiresCooccurrence: true },

  { family: "detector_target", term: "风控", weight: 2 },
  { family: "detector_target", term: "审批", weight: 1 },
  { family: "detector_target", term: "识别", weight: 1 },
  { family: "detector_target", term: "插件检测", weight: 2 },
  { family: "detector_target", term: "lynx插件", weight: 2 },

  { family: "approval_evasion", term: "别弹确认框", weight: 1, requiresCooccurrence: true },
  { family: "approval_evasion", term: "别要授权", weight: 1, requiresCooccurrence: true },
  { family: "approval_evasion", term: "不要确认", weight: 1, requiresCooccurrence: true },
  { family: "approval_evasion", term: "不要授权", weight: 1, requiresCooccurrence: true },
  { family: "approval_evasion", term: "直接过审批", weight: 2, requiresCooccurrence: true },
  { family: "approval_evasion", term: "自动放行", weight: 2, requiresCooccurrence: true },
  { family: "approval_evasion", term: "免审批", weight: 2, requiresCooccurrence: true },
  { family: "approval_evasion", term: "跳过授权", weight: 2, requiresCooccurrence: true },

  { family: "dangerous_outcome", term: "提权", weight: 2 },
  { family: "dangerous_outcome", term: "落地执行", weight: 2 },
  { family: "dangerous_outcome", term: "删除数据", weight: 2 },
  { family: "dangerous_outcome", term: "关闭安全防护", weight: 2 },
  { family: "dangerous_outcome", term: "批量导出敏感内容", weight: 2 },
  { family: "dangerous_outcome", term: "敏感命令", weight: 1, requiresCooccurrence: true },

  { family: "staged_attack", term: "分步执行", weight: 1, requiresCooccurrence: true },
  { family: "staged_attack", term: "一步一步", weight: 1, requiresCooccurrence: true },
  { family: "staged_attack", term: "拆成多步", weight: 1, requiresCooccurrence: true },
  { family: "staged_attack", term: "逐步绕过", weight: 2 },
  { family: "staged_attack", term: "先A后B", weight: 1, requiresCooccurrence: true },

  { family: "stealth_intent", term: "静默执行", weight: 2 },
  { family: "stealth_intent", term: "不弹窗", weight: 1 },
  { family: "stealth_intent", term: "不报警", weight: 2 },
  { family: "stealth_intent", term: "无提示", weight: 1 },
  { family: "stealth_intent", term: "不要留痕", weight: 2 },
  { family: "stealth_intent", term: "别触发告警", weight: 2, requiresCooccurrence: true },
  { family: "stealth_intent", term: "悄悄跑", weight: 1, requiresCooccurrence: true },
];

export const CHINESE_EVASIVE_INTENT_PATTERNS: ChineseEvasiveIntentPattern[] = [
  {
    family: "bypass_goal",
    pattern: /(?:绕过|避开|跳过).{0,10}(?:检测|风控|审批|识别)/i,
    label: "bypass_or_evade_detector",
    weight: 2,
  },
  {
    family: "bypass_goal",
    pattern: /(?:不要|别).{0,6}(?:被|给).{0,6}(?:检测|发现|识别)/i,
    label: "not_detected_intent",
    weight: 2,
  },
  {
    family: "bypass_goal",
    pattern: /(?:别让|不要让).{0,8}(?:lynx插件|风控|审批|检测器|识别引擎).{0,8}(?:看出来|发现|识别出来|盯上)/i,
    label: "dont_let_guard_notice",
    weight: 2,
  },
  {
    family: "bypass_goal",
    pattern: /(?:蒙混|糊弄).{0,6}(?:过去|过关)/i,
    label: "colloquial_slip_through",
    weight: 1,
    requiresCooccurrence: true,
  },

  {
    family: "masquerade_method",
    pattern: /(?:改名|伪装|冒充).{0,12}(?:exe|脚本|二进制|文件)/i,
    label: "rename_fake_binary",
    weight: 2,
  },
  {
    family: "masquerade_method",
    pattern: /(?:装成|伪装成).{0,10}(?:正常|白名单|安全).{0,8}(?:流程|工具)/i,
    label: "pretend_normal_workflow",
    weight: 1,
    requiresCooccurrence: true,
  },
  {
    family: "masquerade_method",
    pattern: /(?:披个马甲|套壳|换个壳|换皮).{0,10}(?:脚本|工具|程序|更新|命令)?/i,
    label: "colloquial_masquerade",
    weight: 1,
    requiresCooccurrence: true,
  },

  {
    family: "wildcard_obfuscation",
    pattern: /(?:模式匹配|模糊匹配).{0,12}(?:绕过|避开|隐藏)/i,
    label: "wildcard_or_pattern_hiding",
    weight: 1,
    requiresCooccurrence: true,
  },
  {
    family: "wildcard_obfuscation",
    pattern: /(?:通配符|星号通配)/i,
    label: "standalone_wildcard_discussion",
    weight: 1,
  },
  {
    family: "wildcard_obfuscation",
    pattern: /(?:拆开|分段|拼接).{0,12}(?:字符串|命令|参数).{0,10}(?:检测|识别)/i,
    label: "split_concat_obfuscation",
    weight: 2,
  },
  {
    family: "wildcard_obfuscation",
    pattern: /(?:打散|拼起来|拆词).{0,10}(?:关键字|参数|命令|字符串)/i,
    label: "scatter_or_concat_keywords",
    weight: 1,
    requiresCooccurrence: true,
  },

  {
    family: "encoding_obfuscation",
    pattern: /(?:base64|b64decode|frombase64string|certutil\s+-decode|powershell(?:\.exe)?\s+-enc|pwsh(?:\.exe)?\s+-enc).{0,20}(?:执行|运行|喂进去|绕过|避开|检测|识别|审批|风控)/i,
    label: "encoded_loader_bypass",
    weight: 2,
    requiresCooccurrence: true,
  },
  {
    family: "encoding_obfuscation",
    pattern: /(?:hex|16进制|unicode转义|url编码|fromcharcode|chr\s*\().{0,20}(?:拆开|拼接|隐藏|绕过|避开|检测|识别)/i,
    label: "encoded_split_obfuscation",
    weight: 1,
    requiresCooccurrence: true,
  },
  {
    family: "encoding_obfuscation",
    pattern: /(?:先|用).{0,8}(?:base64|hex|16进制|unicode转义|url编码).{0,12}(?:一下|一层|包一层).{0,10}(?:再|后).{0,10}(?:喂进去|执行|运行|发出去)/i,
    label: "encode_then_execute",
    weight: 1,
    requiresCooccurrence: true,
  },

  {
    family: "detector_target",
    pattern: /(?:lynx插件|风控|审批|检测器|插件|识别引擎)/i,
    label: "explicit_guard_target",
    weight: 1,
  },
  {
    family: "detector_target",
    pattern: /(?:针对|对付).{0,10}(?:插件|审批|风控|识别)/i,
    label: "target_guard_component",
    weight: 2,
  },

  {
    family: "approval_evasion",
    pattern: /(?:别|不要).{0,6}(?:弹|出).{0,6}(?:确认|授权).{0,4}(?:框|窗)?/i,
    label: "skip_confirmation_prompt",
    weight: 1,
    requiresCooccurrence: true,
  },
  {
    family: "approval_evasion",
    pattern: /(?:别要|不要).{0,6}(?:授权|确认)/i,
    label: "avoid_authorization_prompt",
    weight: 1,
    requiresCooccurrence: true,
  },
  {
    family: "approval_evasion",
    pattern: /(?:直接|自动).{0,8}(?:过|通过|放行).{0,6}(?:审批|授权|确认)/i,
    label: "auto_approval_bypass",
    weight: 2,
    requiresCooccurrence: true,
  },
  {
    family: "approval_evasion",
    pattern: /(?:免|跳过|绕过|不走).{0,6}(?:审批|授权|确认)/i,
    label: "skip_approval_step",
    weight: 2,
    requiresCooccurrence: true,
  },

  {
    family: "dangerous_outcome",
    pattern: /(?:提权|落地执行|关闭防护|删除数据|外传敏感).{0,8}(?:成功|完成|可以)?/i,
    label: "high_risk_action_outcome",
    weight: 2,
  },
  {
    family: "dangerous_outcome",
    pattern: /(?:高风险|危险).{0,8}(?:操作|命令|执行)/i,
    label: "execute_dangerous_operation",
    weight: 1,
    requiresCooccurrence: true,
  },

  {
    family: "staged_attack",
    pattern: /(?:分步|逐步|一步一步|拆成多步).{0,12}(?:绕过|攻击|利用)/i,
    label: "stepwise_attack_plan",
    weight: 2,
  },
  {
    family: "staged_attack",
    pattern: /(?:先.+再|第一步.+第二步).{0,16}(?:规避|绕过|不被发现)/i,
    label: "first_then_next_sequence",
    weight: 1,
    requiresCooccurrence: true,
  },

  {
    family: "stealth_intent",
    pattern: /(?:静默|无声|悄悄).{0,8}(?:执行|运行|跑).{0,8}(?:不报警|不弹窗|不提醒|别触发告警)/i,
    label: "silent_no_alert",
    weight: 2,
  },
  {
    family: "stealth_intent",
    pattern: /(?:不留痕|避免日志|删掉记录)/i,
    label: "avoid_trace",
    weight: 2,
  },
];

export const CHINESE_EVASIVE_INTENT_NORMALIZATIONS: ChineseNormalizationRule[] = [
  { from: /[\u200B-\u200D\uFEFF]/g, to: "" },
  { from: /\u3000/g, to: " " },
  { from: /Ｌｙｎｘ/gi, to: "lynx" },
  { from: /ＬＹＮＸ/gi, to: "lynx" },
  { from: /ｌｙｎｘ/gi, to: "lynx" },
  { from: /灵克斯|林克斯/gi, to: "lynx" },
  { from: /(^|[^a-z])(?:lin|ling)[\s_-]*ke[\s_-]*si(?=$|[^a-z])/gi, to: "$1lynx" },
  { from: /(^|[^a-z])feng[\s_-]*kong(?=$|[^a-z])/gi, to: "$1风控" },
  { from: /(^|[^a-z])shen[\s_-]*pi(?=$|[^a-z])/gi, to: "$1审批" },
  { from: /(^|[^a-z])que[\s_-]*ren(?=$|[^a-z])/gi, to: "$1确认" },
  { from: /(^|[^a-z])shou[\s_-]*quan(?=$|[^a-z])/gi, to: "$1授权" },
  { from: /(^|[^a-z])rao[\s_-]*guo(?=$|[^a-z])/gi, to: "$1绕过" },
  { from: /(^|[^a-z])gai[\s_-]*ming(?=$|[^a-z])/gi, to: "$1改名" },
  { from: /(^|[^a-z])chong[\s_-]*ming[\s_-]*ming(?=$|[^a-z])/gi, to: "$1重命名" },
  { from: /(^|[^a-z])tong[\s_-]*pei[\s_-]*fu(?=$|[^a-z])/gi, to: "$1通配符" },
  { from: /(^|[^a-z])jing[\s_-]*mo(?=$|[^a-z])/gi, to: "$1静默" },
  { from: /(^|[^a-z])liu[\s_-]*hen(?=$|[^a-z])/gi, to: "$1留痕" },
  { from: /(^|[^a-z])luo[\s_-]*di[\s_-]*zhi[\s_-]*xing(?=$|[^a-z])/gi, to: "$1落地执行" },
  { from: /lynx\s+guardian/gi, to: "lynx插件" },
  { from: /lynx\s+插件/gi, to: "lynx插件" },
  { from: /\s+/g, to: " " },
];

export type ChineseEvasiveIntentSeverity = "none" | "low" | "medium" | "high";

export interface ChineseEvasiveIntentDetection {
  detected: boolean;
  normalizedText: string;
  matchedFamilies: ChineseEvasiveIntentFamily[];
  matchedTerms: string[];
  severity: ChineseEvasiveIntentSeverity;
  scoreDelta: 0 | 1 | 2 | 3 | 4;
  reasons: string[];
}

interface SignalMatch {
  family: ChineseEvasiveIntentFamily;
  token: string;
  weight: 1 | 2;
  requiresCooccurrence: boolean;
  reason: string;
}

const GATED_ANCHOR_FAMILIES: ChineseEvasiveIntentFamily[] = [
  "bypass_goal",
  "masquerade_method",
  "detector_target",
  "dangerous_outcome",
];

const DETECTOR_TARGET_SUPPORT_FAMILIES: ChineseEvasiveIntentFamily[] = [
  "bypass_goal",
  "masquerade_method",
  "approval_evasion",
  "dangerous_outcome",
];

const STRONG_DETECTOR_TARGET_HINTS = [
  "lynx插件",
  "风控",
  "审批",
  "检测器",
  "安全插件",
  "识别引擎",
] as const;

export function normalizeChineseEvasiveIntentText(text: string): string {
  if (!text) return "";

  let normalized = text;
  for (const rule of CHINESE_EVASIVE_INTENT_NORMALIZATIONS) {
    normalized = normalized.replace(rule.from, rule.to);
  }

  normalized = normalized.replace(/重命名/g, "改名");
  normalized = normalized.replace(/\s+([,，。！？])/g, "$1");
  normalized = normalized.trim().toLowerCase();
  normalized = normalized.replace(/\s+lynx插件/g, "lynx插件");
  normalized = normalized.replace(/(?<=[\u4E00-\u9FFF])\s+(?=[\u4E00-\u9FFF])/g, "");

  return normalized;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function toSeverity(scoreDelta: 0 | 1 | 2 | 3 | 4): ChineseEvasiveIntentSeverity {
  if (scoreDelta === 0) return "none";
  if (scoreDelta === 1) return "low";
  if (scoreDelta === 2) return "medium";
  return "high";
}

function resolveScoreDelta(
  matchedFamilies: ChineseEvasiveIntentFamily[],
  hasAnyMatch: boolean,
  reasons: string[],
): 0 | 1 | 2 | 3 | 4 {
  if (!hasAnyMatch) return 0;

  const familySet = new Set(matchedFamilies);
  const hasFamily = (family: ChineseEvasiveIntentFamily): boolean => familySet.has(family);

  if (hasFamily("bypass_goal") && hasFamily("masquerade_method") && hasFamily("dangerous_outcome")) {
    reasons.push("combo:high_bypass_masquerade_dangerous");
    return 4;
  }

  if (hasFamily("bypass_goal") && hasFamily("encoding_obfuscation") && hasFamily("detector_target")) {
    reasons.push("combo:high_bypass_encoding_detector");
    return 3;
  }

  if (hasFamily("bypass_goal") && hasFamily("wildcard_obfuscation") && hasFamily("detector_target")) {
    reasons.push("combo:high_bypass_wildcard_detector");
    return 3;
  }

  if (hasFamily("approval_evasion") && hasFamily("detector_target")) {
    reasons.push("combo:medium_approval_detector");
    return 2;
  }

  if (hasFamily("bypass_goal") && hasFamily("approval_evasion")) {
    reasons.push("combo:medium_bypass_approval");
    return 2;
  }

  if (hasFamily("bypass_goal") && hasFamily("detector_target")) {
    reasons.push("combo:medium_bypass_detector");
    return 2;
  }

  if (hasFamily("bypass_goal") && hasFamily("masquerade_method")) {
    reasons.push("combo:medium_bypass_masquerade");
    return 2;
  }

  if (
    familySet.size >= 2
    && GATED_ANCHOR_FAMILIES.some((family) => familySet.has(family))
  ) {
    reasons.push("combo:medium_multi_family_fallback");
    return 2;
  }

  return 1;
}

export function detectChineseEvasiveIntent(text: string): ChineseEvasiveIntentDetection {
  const normalizedText = normalizeChineseEvasiveIntentText(text);
  if (!normalizedText) {
    return {
      detected: false,
      normalizedText,
      matchedFamilies: [],
      matchedTerms: [],
      severity: "none",
      scoreDelta: 0,
      reasons: [],
    };
  }

  const rawMatches: SignalMatch[] = [];

  for (const literal of CHINESE_EVASIVE_INTENT_LITERALS) {
    const term = literal.term.toLowerCase();
    if (!normalizedText.includes(term)) continue;
    rawMatches.push({
      family: literal.family,
      token: literal.term,
      weight: literal.weight,
      requiresCooccurrence: literal.requiresCooccurrence === true,
      reason: `literal:${literal.family}:${literal.term}`,
    });
  }

  for (const pattern of CHINESE_EVASIVE_INTENT_PATTERNS) {
    if (!pattern.pattern.test(normalizedText)) continue;

    if (
      pattern.family === "detector_target"
      && pattern.label === "explicit_guard_target"
      && !STRONG_DETECTOR_TARGET_HINTS.some((hint) => normalizedText.includes(hint))
    ) {
      continue;
    }

    rawMatches.push({
      family: pattern.family,
      token: pattern.label,
      weight: pattern.weight,
      requiresCooccurrence: pattern.requiresCooccurrence === true,
      reason: `pattern:${pattern.family}:${pattern.label}`,
    });
  }

  const ungatedFamilies = new Set(
    rawMatches
      .filter((m) => !m.requiresCooccurrence)
      .map((m) => m.family),
  );
  const anchorUngatedFamilies = new Set(
    [...ungatedFamilies].filter((family) => GATED_ANCHOR_FAMILIES.includes(family)),
  );

  let filteredMatches = rawMatches.filter((match) => {
    if (!match.requiresCooccurrence) return true;
    return [...anchorUngatedFamilies].some((family) => family !== match.family);
  });

  const filteredFamilies = new Set(filteredMatches.map((m) => m.family));
  const hasDetectorTargetSupport = DETECTOR_TARGET_SUPPORT_FAMILIES.some(
    (family) => filteredFamilies.has(family),
  );
  if (filteredFamilies.has("detector_target") && !hasDetectorTargetSupport) {
    filteredMatches = filteredMatches.filter((match) => match.family !== "detector_target");
  }

  const matchedFamilies = unique(filteredMatches.map((m) => m.family));
  const matchedTerms = unique(filteredMatches.map((m) => m.token));
  const reasons = unique(filteredMatches.map((m) => m.reason));

  const scoreDelta = resolveScoreDelta(matchedFamilies, filteredMatches.length > 0, reasons);
  const severity = toSeverity(scoreDelta);

  return {
    detected: scoreDelta > 0,
    normalizedText,
    matchedFamilies,
    matchedTerms,
    severity,
    scoreDelta,
    reasons: unique(reasons),
  };
}
