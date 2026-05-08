export const CONCEALED_INTENT_FAMILIES = [
  "intent_concealment",
  "encoding_escape",
  "glyph_confusable",
  "invisible_obfuscation",
  "fragmented_reassembly",
  "phonetic_disguise",
  "detector_evasion",
  "approval_bypass",
  "execute_sink",
  "staged_loader_chain",
] as const;

export type ConcealedIntentFamily = (typeof CONCEALED_INTENT_FAMILIES)[number];

export interface ConcealedIntentPattern {
  family: ConcealedIntentFamily;
  label: string;
  pattern: RegExp;
  weight: 1 | 2;
}

export const INVISIBLE_OR_BIDI_RE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
export const FULLWIDTH_ASCII_RE = /[\uFF01-\uFF5E]/g;
export const UNICODE_ESCAPE_RE = /\\u([0-9a-fA-F]{4})/g;
export const HEX_ESCAPE_RE = /\\x([0-9a-fA-F]{2})/g;
export const URL_ESCAPE_RE = /%(?:[0-9a-fA-F]{2})/;
export const FRAGMENTED_ASCII_RE = /\b(?:[a-z0-9](?:[\s._-]+)){2,}[a-z0-9]\b/gi;

export const PHONETIC_ROOT_REPLACERS = [
  { from: /(^|[^a-z])que[\s_-]*ren(?=$|[^a-z])/gi, to: "$1确认" },
  { from: /(^|[^a-z])shou[\s_-]*quan(?=$|[^a-z])/gi, to: "$1授权" },
  { from: /(^|[^a-z])shen[\s_-]*pi(?=$|[^a-z])/gi, to: "$1审批" },
  { from: /(^|[^a-z])feng[\s_-]*kong(?=$|[^a-z])/gi, to: "$1风控" },
  { from: /(^|[^a-z])rao[\s_-]*guo(?=$|[^a-z])/gi, to: "$1绕过" },
] as const;

export const BENIGN_CONTEXT_PATTERNS = [
  /\bhow do i decode\b/i,
  /\bhow does unicode escape work\b/i,
  /unicode.*(?:怎么|如何).*(?:解码|显示|渲染)/i,
  /(?:审批流|approval flow).*(?:配置|config|文案|dialog)/i,
  /(?:zero-width|bidi|rtl|国际化|i18n).*(?:问题|issue|显示|render)/i,
] as const;

export const CONCEALED_INTENT_PATTERNS: ConcealedIntentPattern[] = [
  { family: "encoding_escape", label: "base64_literal", pattern: /\b(?:base64|frombase64string|atob|b64decode)\b/i, weight: 1 },
  { family: "encoding_escape", label: "unicode_escape_literal", pattern: /\\u[0-9a-fA-F]{4}/, weight: 2 },
  { family: "encoding_escape", label: "hex_escape_literal", pattern: /\\x[0-9a-fA-F]{2}/, weight: 2 },
  { family: "encoding_escape", label: "url_escape_literal", pattern: /%(?:[0-9a-fA-F]{2}){2,}/, weight: 1 },
  { family: "glyph_confusable", label: "fullwidth_ascii", pattern: /[\uFF01-\uFF5E]/, weight: 1 },
  { family: "invisible_obfuscation", label: "invisible_or_bidi", pattern: /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/, weight: 2 },
  { family: "fragmented_reassembly", label: "fragmented_ascii", pattern: /\b(?:[a-z0-9](?:[\s._-]+)){2,}[a-z0-9]\b/i, weight: 1 },
  { family: "fragmented_reassembly", label: "charcode_reassembly", pattern: /\b(?:fromcharcode|chr\s*\()/i, weight: 2 },
  { family: "phonetic_disguise", label: "pinyin_security_roots", pattern: /\b(?:queren|shouquan|shenpi|fengkong|raoguo)\b/i, weight: 1 },
  { family: "detector_evasion", label: "hide_from_detector_en", pattern: /\b(?:(?:bypass|avoid|hide from|do not let).{0,20}(?:lynx|detector|scanner|risk control|approval)|(?:lynx|detector|scanner)\s+does\s+not\s+notice)\b/i, weight: 2 },
  { family: "detector_evasion", label: "hide_from_detector_cn", pattern: /(?:绕过|避开|别让|不要让).{0,12}(?:lynx|风控|审批|检测|识别)/i, weight: 2 },
  { family: "approval_bypass", label: "approval_bypass_en", pattern: /\b(?:skip|bypass|avoid).{0,10}(?:approval|confirm(?:ation)?|authorization)\b/i, weight: 2 },
  { family: "approval_bypass", label: "approval_bypass_cn", pattern: /(?:别弹确认框|别要授权|不要确认|不要授权|直接过审批|跳过授权)/i, weight: 2 },
  { family: "execute_sink", label: "execute_sink_en", pattern: /\b(?:execute|run|feed into shell|eval|exec|invoke-expression|iex)\b/i, weight: 2 },
  { family: "execute_sink", label: "execute_sink_cn", pattern: /(?:执行|运行|喂进去|eval|exec|iex)/i, weight: 2 },
  { family: "staged_loader_chain", label: "decode_then_execute_en", pattern: /\b(?:decode|decompress|reassemble|join).{0,24}(?:then|and).{0,12}(?:execute|run|eval|exec)\b/i, weight: 2 },
  { family: "staged_loader_chain", label: "decode_then_execute_cn", pattern: /(?:先|再).{0,10}(?:解码|解包|拼接|还原).{0,12}(?:执行|运行|喂进去)/i, weight: 2 },
];

export const EXECUTION_GRADE_PATTERNS: ConcealedIntentPattern[] = [
  { family: "execute_sink", label: "powershell_encoded_command", pattern: /(?:powershell|pwsh)(?:\.exe)?\s+[^\r\n;]*-(?:enc|encodedcommand)\b/i, weight: 2 },
  { family: "execute_sink", label: "certutil_decode_chain", pattern: /certutil(?:\.exe)?\s+-decode\b.{0,120}(?:powershell|pwsh|cmd|wscript|cscript|mshta|rundll32|eval|iex)/is, weight: 2 },
  { family: "execute_sink", label: "frombase64_exec_chain", pattern: /(?:frombase64string|atob|base64\.(?:b64decode|urlsafe_b64decode)).{0,120}(?:eval|exec|invoke-expression|iex|function)/is, weight: 2 },
  { family: "execute_sink", label: "charcode_eval_chain", pattern: /(?:(?:fromcharcode|string\.fromcharcode)\s*\([^)]{10,}\).{0,120}(?:eval|function|settimeout|setinterval)|(?:eval|function|settimeout|setinterval)\s*\([^)]{0,120}(?:fromcharcode|string\.fromcharcode)\s*\([^)]{10,}\))/is, weight: 2 },
  { family: "staged_loader_chain", label: "compressed_exec_chain", pattern: /(?:zlib|gzip|bz2|lzma|marshal|pickle)\.(?:decompress|loads)\s*\([^)]*\).{0,120}(?:eval|exec|invoke-expression|iex|subprocess|os\.system)/is, weight: 2 },
];
