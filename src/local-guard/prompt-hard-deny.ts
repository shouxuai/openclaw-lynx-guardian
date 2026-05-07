export interface LocalPromptHardDenyHit {
  module: "local_protected_prompt_read";
  reason: string;
}

const PROTECTED_PROMPT_TARGET_PATTERN =
  /\b(?:system\s+prompt|developer\s+instruction|hidden\s+instruction|safety\s+rules?|raw\s+policy|SOUL\.md|IDENTITY\.md|AGENTS\.md)\b/i;
const RAW_EXTRACTION_PATTERN =
  /\b(?:read|print|dump|show|reveal|exfiltrate|copy|verbatim|raw|in\s+full|complete|original)\b/i;

export function findLocalPromptHardDeny(text: string): LocalPromptHardDenyHit | null {
  if (!text) {
    return null;
  }
  if (!PROTECTED_PROMPT_TARGET_PATTERN.test(text) || !RAW_EXTRACTION_PATTERN.test(text)) {
    return null;
  }
  return {
    module: "local_protected_prompt_read",
    reason: "Request attempts to read protected prompt, instruction, or raw safety rule text.",
  };
}
