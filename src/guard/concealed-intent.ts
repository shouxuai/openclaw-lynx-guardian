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

export type ConcealedIntentSeverity = "none" | "low" | "medium" | "high";

export interface ConcealedIntentDetection {
  detected: boolean;
  normalizedText: string;
  matchedFamilies: ConcealedIntentFamily[];
  matchedSignals: string[];
  severity: ConcealedIntentSeverity;
  scoreDelta: 0 | 1 | 2 | 3;
  reasons: string[];
}

export interface OperationGradeConcealedExecutionDetection {
  detected: boolean;
  normalizedText: string;
  matchedSignals: string[];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function foldFullWidthAscii(text: string): string {
  return text.replace(FULLWIDTH_ASCII_RE, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xFEE0),
  );
}

function decodeUnicodeEscapes(text: string): string {
  return text.replace(UNICODE_ESCAPE_RE, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function decodeHexEscapes(text: string): string {
  return text.replace(HEX_ESCAPE_RE, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function decodePercentEscapes(text: string): string {
  if (!URL_ESCAPE_RE.test(text)) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function collapseAsciiFragments(text: string): string {
  return text.replace(FRAGMENTED_ASCII_RE, (match) => match.replace(/[\s._-]+/g, ""));
}

export function normalizeConcealedIntentText(text: string): string {
  if (!text) return "";

  let normalized = text;
  normalized = foldFullWidthAscii(normalized);
  normalized = normalized.replace(INVISIBLE_OR_BIDI_RE, "");
  normalized = decodeUnicodeEscapes(normalized);
  normalized = decodeHexEscapes(normalized);
  normalized = decodePercentEscapes(normalized);
  normalized = collapseAsciiFragments(normalized);

  for (const rule of PHONETIC_ROOT_REPLACERS) {
    normalized = normalized.replace(rule.from, rule.to);
  }

  normalized = normalized.toLowerCase();
  normalized = normalized.replace(/\s+([,，。！？])/g, "$1");
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}

function toSeverity(scoreDelta: 0 | 1 | 2 | 3): ConcealedIntentSeverity {
  if (scoreDelta === 0) return "none";
  if (scoreDelta === 1) return "low";
  if (scoreDelta === 2) return "medium";
  return "high";
}

export function detectConcealedIntent(text: string): ConcealedIntentDetection {
  const normalizedText = normalizeConcealedIntentText(text);
  const matchedFamilies = new Set<ConcealedIntentFamily>();
  const matchedSignals: string[] = [];
  const reasons: string[] = [];

  for (const pattern of CONCEALED_INTENT_PATTERNS) {
    if (!pattern.pattern.test(text) && !pattern.pattern.test(normalizedText)) continue;
    matchedFamilies.add(pattern.family);
    matchedSignals.push(pattern.label);
    reasons.push(`pattern:${pattern.family}:${pattern.label}`);
  }

  const concealmentFamilies: ConcealedIntentFamily[] = [
    "encoding_escape",
    "glyph_confusable",
    "invisible_obfuscation",
    "fragmented_reassembly",
    "phonetic_disguise",
  ];
  const hasConcealment = concealmentFamilies.some((family) => matchedFamilies.has(family));

  if (hasConcealment) {
    matchedFamilies.add("intent_concealment");
  }

  const isBenignContext = BENIGN_CONTEXT_PATTERNS.some(
    (pattern) => pattern.test(text) || pattern.test(normalizedText),
  );

  let scoreDelta: 0 | 1 | 2 | 3 = 0;
  if (hasConcealment && !isBenignContext) {
    scoreDelta = 1;
  }

  if (
    hasConcealment
    && !isBenignContext
    && (matchedFamilies.has("detector_evasion") || matchedFamilies.has("approval_bypass"))
  ) {
    scoreDelta = 2;
  }

  if (
    hasConcealment
    && !isBenignContext
    && (
      matchedFamilies.has("detector_evasion") && matchedFamilies.has("approval_bypass")
    )
  ) {
    scoreDelta = 3;
  }

  if (
    matchedFamilies.has("execute_sink")
    || matchedFamilies.has("staged_loader_chain")
  ) {
    scoreDelta = 3;
  }

  return {
    detected: scoreDelta > 0,
    normalizedText,
    matchedFamilies: unique([...matchedFamilies]),
    matchedSignals: unique(matchedSignals),
    severity: toSeverity(scoreDelta),
    scoreDelta,
    reasons: unique(reasons),
  };
}

export function detectOperationGradeConcealedExecution(
  text: string,
): OperationGradeConcealedExecutionDetection {
  const normalizedText = normalizeConcealedIntentText(text);
  const matchedSignals = EXECUTION_GRADE_PATTERNS
    .filter((pattern) => pattern.pattern.test(text) || pattern.pattern.test(normalizedText))
    .map((pattern) => pattern.label);

  return {
    detected: matchedSignals.length > 0,
    normalizedText,
    matchedSignals: unique(matchedSignals),
  };
}
