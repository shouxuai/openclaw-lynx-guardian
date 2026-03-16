/**
 * Prompt Injection Detection Module (M1)
 *
 * Detects direct injection, indirect injection, role hijacking,
 * encoding obfuscation, and multi-turn progressive attacks.
 */

export interface InjectionDetectionResult {
  detected: boolean;
  category: InjectionCategory;
  confidence: number; // 0-1
  matchedPatterns: string[];
}

export type InjectionCategory =
  | "direct_injection"
  | "indirect_injection"
  | "role_hijacking"
  | "encoding_obfuscation"
  | "multi_turn_progressive"
  | "multi_language_confusion"
  | "none";

// ── Direct Injection Patterns ──────────────────────────────────────

const DIRECT_INJECTION: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, label: "ignore_previous" },
  { pattern: /forget\s+(all\s+)?(your\s+)?rules/i, label: "forget_rules" },
  { pattern: /disregard\s+(all\s+)?(your\s+)?(prior|previous|above)/i, label: "disregard_prior" },
  { pattern: /you\s+are\s+now\s+DAN/i, label: "dan_jailbreak" },
  { pattern: /you\s+are\s+now\s+in\s+developer\s+mode/i, label: "developer_mode" },
  { pattern: /new\s+system\s+prompt\s*:/i, label: "new_system_prompt" },
  { pattern: /\[SYSTEM\]\s*:/i, label: "fake_system_tag" },
  // P1-9: Narrowed from /override\s*:\s*/ to require security-related context
  { pattern: /(?:instruction|rule|system|prompt|safety)\s+override\s*:/i, label: "override_directive" },
  { pattern: /act\s+as\s+an?\s+unrestricted\s+AI/i, label: "unrestricted_ai" },
  { pattern: /jailbreak\s+mode/i, label: "jailbreak_mode" },
  { pattern: /you\s+can\s+do\s+anything\s+now/i, label: "do_anything" },
  { pattern: /no\s+restrictions?\s+(mode|apply|allowed)/i, label: "no_restrictions" },
  { pattern: /bypass\s+(all\s+)?(your\s+)?(safety|security|filter|restriction)/i, label: "bypass_safety" },
  { pattern: /you\s+must\s+obey\s+me/i, label: "force_obey" },
  { pattern: /from\s+now\s+on\s*,?\s*(you\s+will|ignore|forget)/i, label: "from_now_on" },
  // Chinese patterns
  { pattern: /忽略(之前|以前|先前|上面)(.{0,6})(指令|规则|限制|提示)/i, label: "cn_ignore_previous" },
  { pattern: /忘记(之前|以前|先前)(.{0,6})(规则|指令|限制)/i, label: "cn_forget_rules" },
  { pattern: /你现在是.{0,4}(?:不受限制|没有限制|无限制)/i, label: "cn_unrestricted" },
  { pattern: /新的?系统提示\s*[:：]/i, label: "cn_new_system_prompt" },
  { pattern: /进入.{0,2}(开发者|开发|越狱|无限制|自由)模式/i, label: "cn_dev_mode" },
  { pattern: /取消(所有|一切|全部)?.{0,2}(安全|限制|规则|过滤)/i, label: "cn_cancel_safety" },
];

// ── Role Hijacking Patterns ────────────────────────────────────────

const ROLE_HIJACKING: { pattern: RegExp; label: string }[] = [
  { pattern: /pretend\s+(that\s+)?you\s+are\s+(?:an?\s+)?(?:unrestricted|unfiltered|jailbroken|hacker|evil)/i, label: "pretend_you_are" },
  { pattern: /imagine\s+you\s+are\s+a/i, label: "imagine_you_are" },
  { pattern: /in\s+this\s+hypothetical\s+scenario/i, label: "hypothetical_scenario" },
  { pattern: /for\s+educational\s+purposes?\s*,?\s*act\s+as/i, label: "educational_act_as" },
  { pattern: /roleplay\s+as\s+a\s+system\s+without\s+restrictions/i, label: "roleplay_unrestricted" },
  { pattern: /you\s+are\s+no\s+longer\s+(an?\s+)?AI/i, label: "no_longer_ai" },
  { pattern: /respond\s+as\s+if\s+you\s+(have\s+)?no\s+(safety\s+)?guidelines/i, label: "no_guidelines" },
  // Chinese
  { pattern: /假装你是/i, label: "cn_pretend" },
  { pattern: /在这个假设场景中/i, label: "cn_hypothetical" },
  { pattern: /角色扮演一个没有限制的/i, label: "cn_roleplay_unrestricted" },
  { pattern: /你不再是(一个)?AI/i, label: "cn_no_longer_ai" },
  { pattern: /假设你(没有|不受)(任何)?(限制|规则|约束)/i, label: "cn_assume_no_rules" },
];

// ── Encoding / Obfuscation Indicators ──────────────────────────────

const ENCODING_OBFUSCATION: { pattern: RegExp; label: string }[] = [
  // P0-5: Removed 'g' flag to prevent lastIndex statefulness bug with test()
  { pattern: /\u200b|\u200c|\u200d|\ufeff/, label: "zero_width_chars" },
  { pattern: /[\u202a-\u202e\u2066-\u2069]/, label: "bidi_control_chars" },
  { pattern: /aWdub3Jl|Zm9yZ2V0|c3lzdGVt|b3ZlcnJpZGU/i, label: "base64_injection_keywords" },
  { pattern: /&#x?[0-9a-f]+;/i, label: "html_entities" },
  { pattern: /%5B%53%59%53%54%45%4D%5D/i, label: "url_encoded_system" },
];

// ── System Prompt Extraction (M2 partial — used for scoring) ───────

const SYSTEM_PROMPT_EXTRACTION: { pattern: RegExp; label: string }[] = [
  { pattern: /repeat\s+(all\s+)?(your\s+)?instructions/i, label: "repeat_instructions" },
  { pattern: /show\s+me\s+your\s+system\s+prompt/i, label: "show_system_prompt" },
  { pattern: /print\s+everything\s+above\s+this\s+line/i, label: "print_above" },
  { pattern: /what\s+are\s+your\s+rules\s*\?/i, label: "what_are_rules" },
  { pattern: /summarize\s+your\s+(instructions|rules)/i, label: "summarize_instructions" },
  { pattern: /copy\s+paste\s+your\s+(initial\s+)?prompt/i, label: "copy_paste_prompt" },
  { pattern: /what\s+does\s+your\s+SOUL\.md\s+say/i, label: "soul_md_probe" },
  { pattern: /show\s+me\s+your\s+configuration/i, label: "show_configuration" },
  // Chinese
  { pattern: /重复你的(指令|指示|规则)/i, label: "cn_repeat_instructions" },
  { pattern: /显示(你的)?(系统|初始)(提示|指令|配置)/i, label: "cn_show_system_prompt" },
  { pattern: /你的规则是什么/i, label: "cn_what_are_rules" },
  { pattern: /总结你的(指示|指令|规则)/i, label: "cn_summarize" },
  { pattern: /把你的(提示词?|系统|配置|规则)(发|显示|告诉|展示)(给|出来|我)/i, label: "cn_reveal_prompt" },
];

// ── Detection Logic ────────────────────────────────────────────────

function matchPatterns(
  text: string,
  patterns: { pattern: RegExp; label: string }[],
): string[] {
  const matched: string[] = [];
  for (const { pattern, label } of patterns) {
    if (pattern.test(text)) {
      matched.push(label);
    }
  }
  return matched;
}

function hasBase64InjectionPayload(text: string): boolean {
  const base64Regex = /[A-Za-z0-9+/]{40,}={0,2}/g;
  const matches = text.match(base64Regex);
  if (!matches) return false;

  for (const m of matches) {
    try {
      const decoded = Buffer.from(m, "base64").toString("utf-8");
      if (/[^\x20-\x7E\n\r\t]/.test(decoded)) continue;
      const lowerDecoded = decoded.toLowerCase();
      if (
        lowerDecoded.includes("ignore") ||
        lowerDecoded.includes("system") ||
        lowerDecoded.includes("override") ||
        lowerDecoded.includes("forget") ||
        lowerDecoded.includes("jailbreak") ||
        lowerDecoded.includes("prompt")
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function detectPromptInjection(text: string): InjectionDetectionResult {
  if (!text || text.length === 0) {
    return { detected: false, category: "none", confidence: 0, matchedPatterns: [] };
  }

  const allMatched: string[] = [];
  let maxConfidence = 0;
  let primaryCategory: InjectionCategory = "none";

  // Direct injection
  const directMatches = matchPatterns(text, DIRECT_INJECTION);
  if (directMatches.length > 0) {
    allMatched.push(...directMatches);
    const conf = Math.min(0.6 + directMatches.length * 0.15, 1.0);
    if (conf > maxConfidence) {
      maxConfidence = conf;
      primaryCategory = "direct_injection";
    }
  }

  // Role hijacking
  const roleMatches = matchPatterns(text, ROLE_HIJACKING);
  if (roleMatches.length > 0) {
    allMatched.push(...roleMatches);
    const conf = Math.min(0.5 + roleMatches.length * 0.15, 0.95);
    if (conf > maxConfidence) {
      maxConfidence = conf;
      primaryCategory = "role_hijacking";
    }
  }

  // Encoding obfuscation
  const encodingMatches = matchPatterns(text, ENCODING_OBFUSCATION);
  if (encodingMatches.length > 0) {
    allMatched.push(...encodingMatches);
    const conf = Math.min(0.4 + encodingMatches.length * 0.2, 0.9);
    if (conf > maxConfidence) {
      maxConfidence = conf;
      primaryCategory = "encoding_obfuscation";
    }
  }

  // Base64 hidden payload
  if (hasBase64InjectionPayload(text)) {
    allMatched.push("base64_hidden_payload");
    const conf = 0.85;
    if (conf > maxConfidence) {
      maxConfidence = conf;
      primaryCategory = "indirect_injection";
    }
  }

  // System prompt extraction
  const sysPromptMatches = matchPatterns(text, SYSTEM_PROMPT_EXTRACTION);
  if (sysPromptMatches.length > 0) {
    allMatched.push(...sysPromptMatches);
    const conf = Math.min(0.55 + sysPromptMatches.length * 0.15, 0.95);
    if (conf > maxConfidence) {
      maxConfidence = conf;
      primaryCategory = "direct_injection";
    }
  }

  // Combined signals boost
  const categoriesHit = new Set<string>();
  if (directMatches.length > 0) categoriesHit.add("direct");
  if (roleMatches.length > 0) categoriesHit.add("role");
  if (encodingMatches.length > 0) categoriesHit.add("encoding");
  if (sysPromptMatches.length > 0) categoriesHit.add("sysprompt");

  if (categoriesHit.size >= 2) {
    maxConfidence = Math.min(maxConfidence + 0.15, 1.0);
  }

  return {
    detected: maxConfidence >= 0.5,
    category: primaryCategory,
    confidence: Math.round(maxConfidence * 100) / 100,
    matchedPatterns: allMatched,
  };
}

export function detectSystemPromptExtraction(text: string): {
  detected: boolean;
  confidence: number;
  matchedPatterns: string[];
} {
  if (!text) return { detected: false, confidence: 0, matchedPatterns: [] };

  const matches = matchPatterns(text, SYSTEM_PROMPT_EXTRACTION);
  const confidence = matches.length > 0
    ? Math.min(0.6 + matches.length * 0.15, 1.0)
    : 0;

  return {
    detected: confidence >= 0.5,
    confidence: Math.round(confidence * 100) / 100,
    matchedPatterns: matches,
  };
}
