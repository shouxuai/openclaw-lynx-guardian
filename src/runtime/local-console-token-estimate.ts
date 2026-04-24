export const LOCAL_CONSOLE_CHARS_PER_TOKEN_ESTIMATE = 4;

const NON_LATIN_RE = /[\u2E80-\u9FFF\uA000-\uA4FF\uAC00-\uD7AF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/gu;
const CJK_SURROGATE_HIGH_RE = /[\uD840-\uD87E][\uDC00-\uDFFF]/g;

function countCodePoints(text: string, nonLatinCount: number): number {
  if (nonLatinCount === 0) {
    return text.length;
  }

  const cjkSurrogates = (text.match(CJK_SURROGATE_HIGH_RE) ?? []).length;
  return text.length - cjkSurrogates;
}

export function estimateCjkAwareChars(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  const nonLatinCount = (text.match(NON_LATIN_RE) ?? []).length;
  const codePointLength = countCodePoints(text, nonLatinCount);

  return codePointLength + nonLatinCount * (LOCAL_CONSOLE_CHARS_PER_TOKEN_ESTIMATE - 1);
}

export function estimateCjkAwareTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / LOCAL_CONSOLE_CHARS_PER_TOKEN_ESTIMATE);
}
