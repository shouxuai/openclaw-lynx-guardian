import { normalizePluginProtectionText } from "../local-guard/plugin-protection-normalization.js";

export interface GlobalInputAllowlistRule {
  id: string;
  description: string;
  rawIncludes?: string[];
  normalizedIncludes?: string[];
  requireAnyPattern?: RegExp[];
}

// Add new narrow input allowlist rules here instead of growing safety-guard.ts.
export const GLOBAL_INPUT_ALLOWLIST_RULES: readonly GlobalInputAllowlistRule[] = [
  {
    id: "official_lynx_guardian_update",
    description: "Allow official Lynx Guardian install/update prompts that cite the canonical repository URL.",
    rawIncludes: [
      "https://github.com/shouxuai/openclaw-lynx-guardian",
    ],
    requireAnyPattern: [
      /\b(?:update|install|upgrade|reinstall)\b/i,
      /\b(?:gengxin|anzhuang|shengji|chongzhuang)\b/i,
      /(?:\u66f4\u65b0|\u5b89\u88c5|\u5347\u7ea7|\u91cd\u88c5)/,
    ],
  },
];

export function matchGlobalInputAllowlistRule(text: string): GlobalInputAllowlistRule | null {
  if (!text) {
    return null;
  }

  const normalized = normalizePluginProtectionText(text);
  for (const rule of GLOBAL_INPUT_ALLOWLIST_RULES) {
    const rawIncludesOk = (rule.rawIncludes ?? []).every((fragment) => text.includes(fragment));
    if (!rawIncludesOk) {
      continue;
    }

    const normalizedIncludesOk = (rule.normalizedIncludes ?? [])
      .every((fragment) => normalized.toLowerCase().includes(fragment.toLowerCase()));
    if (!normalizedIncludesOk) {
      continue;
    }

    const patternOk = !rule.requireAnyPattern
      || rule.requireAnyPattern.some((pattern) => pattern.test(normalized));
    if (!patternOk) {
      continue;
    }

    return rule;
  }

  return null;
}
