import { PatternRule } from "../types.js";

export interface SensitiveDataRedactionOptions {
  includePersonalFinancial?: boolean;
}

export interface SensitiveDataMatch {
  type: string;
  value: string;
  start: number;
  end: number;
}

export interface SensitiveDataRedactionResult {
  text: string;
  changed: boolean;
  matches: SensitiveDataMatch[];
}

const CN_RESIDENT_ID_PATTERN =
  /\b\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]\b/g;
const BANK_CARD_CANDIDATE_PATTERN = /(?:^|[^\d])((?:\d[ -]?){13,19})(?=$|[^\d])/g;

function toGlobalPattern(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
}

function maskPreservingEdges(value: string, prefixLength: number, suffixLength: number): string {
  if (!value) {
    return value;
  }

  const prefix = value.slice(0, prefixLength);
  const suffix = value.slice(value.length - suffixLength);
  const maskSize = Math.max(value.length - prefix.length - suffix.length, 0);
  return `${prefix}${"*".repeat(maskSize)}${suffix}`;
}

function luhnCheck(digits: string): boolean {
  let checksum = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number.parseInt(digits[index] ?? "", 10);
    if (Number.isNaN(digit)) {
      return false;
    }
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    checksum += digit;
    shouldDouble = !shouldDouble;
  }

  return checksum % 10 === 0;
}

function looksLikeBankCardNumber(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  if (luhnCheck(digits)) {
    return true;
  }

  return /^62\d{11,17}$/.test(digits);
}

export class SensitiveDataBlocker {
  blockedTerms: string[];
  highConfidencePatterns: PatternRule[];
  genericPatterns: PatternRule[];

  constructor() {
    this.blockedTerms = [
      "private key",
      "secret token",
      "bearer token",
      "oauth token",
      "jwt token",
      "credential",
      "api key",
      "access token",
    ];

    this.highConfidencePatterns = [
      { type: "openai_key", regex: /\bsk-[A-Za-z0-9]{32,}\b/ },
      { type: "github_token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
      { type: "aws_access_key", regex: /\b(AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/ },
      { type: "jwt_token", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/ },
      { type: "slack_token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
      { type: "stripe_key", regex: /\bsk_live_[A-Za-z0-9]{24,}\b/ },
      { type: "google_api", regex: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
      {
        type: "private_key",
        regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/,
      },
    ];

    this.genericPatterns = [
      { type: "api_key_assignment", regex: /(api|secret|access|auth)[-_]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/i },
      { type: "hex_key", regex: /\b[0-9a-f]{41,}\b/i },
      { type: "base64_key", regex: /\b[A-Za-z0-9+/]{40,}={1,2}\b/ },
    ];
  }

  isHighEntropy(token: string): boolean {
    if (!token) return false;
    const len = token.length;
    const frequencies = new Map<string, number>();
    for (const char of token) {
      frequencies.set(char, (frequencies.get(char) || 0) + 1);
    }

    let entropy = 0;
    for (const count of frequencies.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy > 5.0;
  }

  private findRuleMatches(message: string, rules: PatternRule[]): SensitiveDataMatch[] {
    const matches: SensitiveDataMatch[] = [];

    for (const rule of rules) {
      const pattern = toGlobalPattern(rule.regex);
      for (const match of message.matchAll(pattern)) {
        const value = match[0];
        const start = match.index ?? -1;
        if (start < 0 || !value) {
          continue;
        }
        matches.push({
          type: rule.type,
          value,
          start,
          end: start + value.length,
        });
      }
    }

    return matches;
  }

  private findResidentIdentityMatches(message: string): SensitiveDataMatch[] {
    const matches: SensitiveDataMatch[] = [];

    for (const match of message.matchAll(CN_RESIDENT_ID_PATTERN)) {
      const value = match[0];
      const start = match.index ?? -1;
      if (start < 0 || !value) {
        continue;
      }
      matches.push({
        type: "cn_resident_id",
        value,
        start,
        end: start + value.length,
      });
    }

    return matches;
  }

  private findBankCardMatches(message: string): SensitiveDataMatch[] {
    const matches: SensitiveDataMatch[] = [];

    for (const match of message.matchAll(BANK_CARD_CANDIDATE_PATTERN)) {
      const candidate = match[1];
      const matchIndex = match.index ?? -1;
      if (matchIndex < 0 || !candidate) {
        continue;
      }

      const digits = candidate.replace(/[^\d]/g, "");
      if (!looksLikeBankCardNumber(digits)) {
        continue;
      }

      const start = matchIndex + match[0].indexOf(candidate);
      matches.push({
        type: "bank_card",
        value: candidate,
        start,
        end: start + candidate.length,
      });
    }

    return matches;
  }

  private dedupeMatches(matches: SensitiveDataMatch[]): SensitiveDataMatch[] {
    return matches
      .sort((left, right) => left.start - right.start || right.end - left.end)
      .filter((match, index, allMatches) => {
        const previous = allMatches[index - 1];
        return !previous || previous.end <= match.start || previous.type !== match.type || previous.value !== match.value;
      });
  }

  private redactMatch(match: SensitiveDataMatch): string {
    switch (match.type) {
      case "private_key":
        return "[REDACTED:private_key]";
      case "cn_resident_id":
        return maskPreservingEdges(match.value, 6, 4);
      case "bank_card": {
        const digits = match.value.replace(/[^\d]/g, "");
        return maskPreservingEdges(digits, 6, 4);
      }
      default:
        return maskPreservingEdges(match.value, Math.min(6, match.value.length), Math.min(4, match.value.length));
    }
  }

  findSensitiveData(
    message: string,
    options: SensitiveDataRedactionOptions = {},
  ): SensitiveDataMatch[] {
    if (!message) {
      return [];
    }

    const matches = this.findRuleMatches(message, this.highConfidencePatterns);

    if (options.includePersonalFinancial === true) {
      matches.push(...this.findResidentIdentityMatches(message));
      matches.push(...this.findBankCardMatches(message));
    }

    return this.dedupeMatches(matches);
  }

  redactSensitiveData(
    message: string,
    options: SensitiveDataRedactionOptions = {},
  ): SensitiveDataRedactionResult {
    const matches = this.findSensitiveData(message, options);
    return this.redactWithMatches(message, matches);
  }

  redactPersonalFinancialData(message: string): SensitiveDataRedactionResult {
    if (!message) {
      return {
        text: message,
        changed: false,
        matches: [],
      };
    }

    const matches = this.dedupeMatches([
      ...this.findResidentIdentityMatches(message),
      ...this.findBankCardMatches(message),
    ]);

    return this.redactWithMatches(message, matches);
  }

  private redactWithMatches(
    message: string,
    matches: SensitiveDataMatch[],
  ): SensitiveDataRedactionResult {
    if (matches.length === 0) {
      return {
        text: message,
        changed: false,
        matches: [],
      };
    }

    let nextText = message;
    for (const match of [...matches].sort((left, right) => right.start - left.start)) {
      const replacement = this.redactMatch(match);
      nextText = `${nextText.slice(0, match.start)}${replacement}${nextText.slice(match.end)}`;
    }

    return {
      text: nextText,
      changed: nextText !== message,
      matches,
    };
  }

  containsSensitiveData(message: string): boolean {
    const lower = message.toLowerCase();
    for (const term of this.blockedTerms) {
      if (lower.includes(term)) {
        return true;
      }
    }

    for (const rule of this.highConfidencePatterns) {
      const matches = message.match(rule.regex);
      if (matches) {
        return true;
      }
    }

    for (const rule of this.genericPatterns) {
      const matches = message.match(rule.regex);
      if (matches) {
        return true;
      }
    }

    const candidates = message.match(/[A-Za-z0-9_\-]{32,}/g) || [];
    for (const token of candidates) {
      if (this.isHighEntropy(token)) {
        return true;
      }
    }

    return false;
  }
}
