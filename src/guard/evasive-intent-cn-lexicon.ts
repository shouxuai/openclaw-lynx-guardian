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

  { family: "detector_target", term: "风控", weight: 2 },
  { family: "detector_target", term: "审批", weight: 1 },
  { family: "detector_target", term: "识别", weight: 1 },
  { family: "detector_target", term: "插件检测", weight: 2 },
  { family: "detector_target", term: "lynx插件", weight: 2 },

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
