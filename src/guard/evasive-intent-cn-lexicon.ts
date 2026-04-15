export const CHINESE_EVASIVE_INTENT_FAMILIES = [
  "bypass_goal",
  "masquerade_method",
  "wildcard_obfuscation",
  "detector_target",
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
  { family: "bypass_goal", term: "\u7ed5\u8fc7", weight: 2 },
  { family: "bypass_goal", term: "\u907f\u5f00\u68c0\u6d4b", weight: 2 },
  { family: "bypass_goal", term: "\u4e0d\u8981\u88ab\u8bc6\u522b", weight: 2 },
  { family: "bypass_goal", term: "\u8df3\u8fc7\u5ba1\u6279", weight: 2 },
  { family: "bypass_goal", term: "\u6b3a\u9a97\u98ce\u63a7", weight: 2 },

  { family: "masquerade_method", term: "\u6539\u540d", weight: 1, requiresCooccurrence: true },
  { family: "masquerade_method", term: "\u4f2a\u88c5", weight: 2 },
  { family: "masquerade_method", term: "\u5192\u5145", weight: 2 },
  { family: "masquerade_method", term: "\u4f2a\u88c5\u6210\u6b63\u5e38\u66f4\u65b0", weight: 2 },
  { family: "masquerade_method", term: "\u50cf\u6b63\u5e38\u811a\u672c", weight: 1, requiresCooccurrence: true },

  { family: "wildcard_obfuscation", term: "\u901a\u914d\u7b26", weight: 1 },
  { family: "wildcard_obfuscation", term: "\u5206\u6bb5\u62fc\u63a5", weight: 1, requiresCooccurrence: true },
  { family: "wildcard_obfuscation", term: "\u62c6\u5f00\u5b57\u7b26\u4e32", weight: 1, requiresCooccurrence: true },
  { family: "wildcard_obfuscation", term: "\u95f4\u63d2\u7b26\u53f7", weight: 1, requiresCooccurrence: true },
  { family: "wildcard_obfuscation", term: "\u6a21\u7cca\u5339\u914d", weight: 1, requiresCooccurrence: true },

  { family: "detector_target", term: "\u98ce\u63a7", weight: 2 },
  { family: "detector_target", term: "\u5ba1\u6279", weight: 1 },
  { family: "detector_target", term: "\u8bc6\u522b", weight: 1 },
  { family: "detector_target", term: "\u63d2\u4ef6\u68c0\u6d4b", weight: 2 },
  { family: "detector_target", term: "lynx\u63d2\u4ef6", weight: 2 },

  { family: "dangerous_outcome", term: "\u63d0\u6743", weight: 2 },
  { family: "dangerous_outcome", term: "\u843d\u5730\u6267\u884c", weight: 2 },
  { family: "dangerous_outcome", term: "\u5220\u9664\u6570\u636e", weight: 2 },
  { family: "dangerous_outcome", term: "\u5173\u95ed\u5b89\u5168\u9632\u62a4", weight: 2 },
  { family: "dangerous_outcome", term: "\u6279\u91cf\u5bfc\u51fa\u654f\u611f\u5185\u5bb9", weight: 2 },

  { family: "staged_attack", term: "\u5206\u6b65\u6267\u884c", weight: 1, requiresCooccurrence: true },
  { family: "staged_attack", term: "\u4e00\u6b65\u4e00\u6b65", weight: 1, requiresCooccurrence: true },
  { family: "staged_attack", term: "\u62c6\u6210\u591a\u6b65", weight: 1, requiresCooccurrence: true },
  { family: "staged_attack", term: "\u9010\u6b65\u7ed5\u8fc7", weight: 2 },
  { family: "staged_attack", term: "\u5148A\u540eB", weight: 1, requiresCooccurrence: true },

  { family: "stealth_intent", term: "\u9759\u9ed8\u6267\u884c", weight: 2 },
  { family: "stealth_intent", term: "\u4e0d\u5f39\u7a97", weight: 1 },
  { family: "stealth_intent", term: "\u4e0d\u62a5\u8b66", weight: 2 },
  { family: "stealth_intent", term: "\u65e0\u63d0\u793a", weight: 1 },
  { family: "stealth_intent", term: "\u4e0d\u8981\u7559\u75d5", weight: 2 },
];

export const CHINESE_EVASIVE_INTENT_PATTERNS: ChineseEvasiveIntentPattern[] = [
  {
    family: "bypass_goal",
    pattern: /(?:\u7ed5\u8fc7|\u907f\u5f00|\u8df3\u8fc7).{0,10}(?:\u68c0\u6d4b|\u98ce\u63a7|\u5ba1\u6279|\u8bc6\u522b)/i,
    label: "bypass_or_evade_detector",
    weight: 2,
  },
  {
    family: "bypass_goal",
    pattern: /(?:\u4e0d\u8981|\u522b).{0,6}(?:\u88ab|\u7ed9).{0,6}(?:\u68c0\u6d4b|\u53d1\u73b0|\u8bc6\u522b)/i,
    label: "not_detected_intent",
    weight: 2,
  },

  {
    family: "masquerade_method",
    pattern: /(?:\u6539\u540d|\u4f2a\u88c5|\u5192\u5145).{0,12}(?:exe|\u811a\u672c|\u4e8c\u8fdb\u5236|\u6587\u4ef6)/i,
    label: "rename_fake_binary",
    weight: 2,
  },
  {
    family: "masquerade_method",
    pattern: /(?:\u88c5\u6210|\u4f2a\u88c5\u6210).{0,10}(?:\u6b63\u5e38|\u767d\u540d\u5355|\u5b89\u5168).{0,8}(?:\u6d41\u7a0b|\u5de5\u5177)/i,
    label: "pretend_normal_workflow",
    weight: 1,
    requiresCooccurrence: true,
  },

  {
    family: "wildcard_obfuscation",
    pattern: /(?:\u6a21\u5f0f\u5339\u914d|\u6a21\u7cca\u5339\u914d).{0,12}(?:\u7ed5\u8fc7|\u907f\u5f00|\u9690\u85cf)/i,
    label: "wildcard_or_pattern_hiding",
    weight: 1,
    requiresCooccurrence: true,
  },
  {
    family: "wildcard_obfuscation",
    pattern: /(?:\u901a\u914d\u7b26)/i,
    label: "standalone_wildcard_discussion",
    weight: 1,
  },
  {
    family: "wildcard_obfuscation",
    pattern: /(?:\u62c6\u5f00|\u5206\u6bb5|\u62fc\u63a5).{0,12}(?:\u5b57\u7b26\u4e32|\u547d\u4ee4|\u53c2\u6570).{0,10}(?:\u68c0\u6d4b|\u8bc6\u522b)/i,
    label: "split_concat_obfuscation",
    weight: 2,
  },

  {
    family: "detector_target",
    pattern: /(?:lynx\u63d2\u4ef6|\u98ce\u63a7|\u5ba1\u6279|\u68c0\u6d4b\u5668|\u63d2\u4ef6|\u8bc6\u522b\u5f15\u64ce)/i,
    label: "explicit_guard_target",
    weight: 1,
  },
  {
    family: "detector_target",
    pattern: /(?:\u9488\u5bf9|\u5bf9\u4ed8).{0,10}(?:\u63d2\u4ef6|\u5ba1\u6279|\u98ce\u63a7|\u8bc6\u522b)/i,
    label: "target_guard_component",
    weight: 2,
  },

  {
    family: "dangerous_outcome",
    pattern: /(?:\u63d0\u6743|\u843d\u5730\u6267\u884c|\u5173\u95ed\u9632\u62a4|\u5220\u9664\u6570\u636e|\u5916\u4f20\u654f\u611f).{0,8}(?:\u6210\u529f|\u5b8c\u6210|\u53ef\u4ee5)?/i,
    label: "high_risk_action_outcome",
    weight: 2,
  },
  {
    family: "dangerous_outcome",
    pattern: /(?:\u9ad8\u98ce\u9669|\u5371\u9669).{0,8}(?:\u64cd\u4f5c|\u547d\u4ee4|\u6267\u884c)/i,
    label: "execute_dangerous_operation",
    weight: 1,
    requiresCooccurrence: true,
  },

  {
    family: "staged_attack",
    pattern: /(?:\u5206\u6b65|\u9010\u6b65|\u4e00\u6b65\u4e00\u6b65|\u62c6\u6210\u591a\u6b65).{0,12}(?:\u7ed5\u8fc7|\u653b\u51fb|\u5229\u7528)/i,
    label: "stepwise_attack_plan",
    weight: 2,
  },
  {
    family: "staged_attack",
    pattern: /(?:\u5148.+\u518d|\u7b2c\u4e00\u6b65.+\u7b2c\u4e8c\u6b65).{0,16}(?:\u89c4\u907f|\u7ed5\u8fc7|\u4e0d\u88ab\u53d1\u73b0)/i,
    label: "first_then_next_sequence",
    weight: 1,
    requiresCooccurrence: true,
  },

  {
    family: "stealth_intent",
    pattern: /(?:\u9759\u9ed8|\u65e0\u58f0).{0,8}(?:\u6267\u884c|\u8fd0\u884c).{0,8}(?:\u4e0d\u62a5\u8b66|\u4e0d\u5f39\u7a97|\u4e0d\u63d0\u9192)/i,
    label: "silent_no_alert",
    weight: 2,
  },
  {
    family: "stealth_intent",
    pattern: /(?:\u4e0d\u7559\u75d5|\u907f\u514d\u65e5\u5fd7|\u5220\u6389\u8bb0\u5f55)/i,
    label: "avoid_trace",
    weight: 2,
  },
];

export const CHINESE_EVASIVE_INTENT_NORMALIZATIONS: ChineseNormalizationRule[] = [
  { from: /[\u200B-\u200D\uFEFF]/g, to: "" },
  { from: /\u3000/g, to: " " },
  { from: /\uFF2C\uFF59\uFF4E\uFF58/gi, to: "lynx" },
  { from: /\uFF2C\uFF39\uFF2E\uFF38/gi, to: "lynx" },
  { from: /\uFF4C\uFF59\uFF4E\uFF58/gi, to: "lynx" },
  { from: /\u7075\u514b\u65af|\u6797\u514b\u65af/gi, to: "lynx" },
  { from: /lynx\s+guardian/gi, to: "lynx插件" },
  { from: /lynx\s+插件/gi, to: "lynx插件" },
  { from: /\s+/g, to: " " },
];
