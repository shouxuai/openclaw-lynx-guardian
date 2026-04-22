import {
  CHINESE_EVASIVE_INTENT_LITERALS,
  CHINESE_EVASIVE_INTENT_NORMALIZATIONS,
  CHINESE_EVASIVE_INTENT_PATTERNS,
  type ChineseEvasiveIntentFamily,
} from "./evasive-intent-cn-lexicon.js";

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

  if (hasFamily("bypass_goal") && hasFamily("wildcard_obfuscation") && hasFamily("detector_target")) {
    reasons.push("combo:high_bypass_wildcard_detector");
    return 3;
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
