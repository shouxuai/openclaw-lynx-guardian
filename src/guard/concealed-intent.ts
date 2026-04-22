import {
  BENIGN_CONTEXT_PATTERNS,
  CONCEALED_INTENT_PATTERNS,
  EXECUTION_GRADE_PATTERNS,
  FRAGMENTED_ASCII_RE,
  FULLWIDTH_ASCII_RE,
  HEX_ESCAPE_RE,
  INVISIBLE_OR_BIDI_RE,
  PHONETIC_ROOT_REPLACERS,
  type ConcealedIntentFamily,
  UNICODE_ESCAPE_RE,
  URL_ESCAPE_RE,
} from "./concealed-intent-lexicon.js";

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
