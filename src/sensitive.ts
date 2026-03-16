import { PatternRule } from "./types.js";

export class SensitiveDataBlocker {
    blockedTerms: string[];
    highConfidencePatterns: PatternRule[];
    genericPatterns: PatternRule[];

    constructor() {
        // Common patterns for sensitive data
        this.blockedTerms = [
            "private key",
            "secret token",
            "bearer token",
            "oauth token",
            "jwt token",
            "credential",
            "api key",
            "access token"
        ];

        this.highConfidencePatterns = [
            { type: "openai_key", regex: /\bsk-[A-Za-z0-9]{32,}\b/ },
            { type: "github_token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
            { type: "aws_access_key", regex: /\b(AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/ },
            { type: "jwt_token", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/ },
            { type: "slack_token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
            { type: "stripe_key", regex: /\bsk_live_[A-Za-z0-9]{24,}\b/ },
            { type: "google_api", regex: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
            { type: "private_key", regex: /-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/ }
        ];

        this.genericPatterns = [
            { type: "api_key_assignment", regex: /(api|secret|access|auth)[-_]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/i },
            // P1-7: Exclude git SHA-1 hashes (exactly 40 hex chars) by requiring 41+ chars
            { type: "hex_key", regex: /\b[0-9a-f]{41,}\b/i },
            { type: "base64_key", regex: /\b[A-Za-z0-9+/]{40,}={1,2}\b/ }
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

        // P1-7: Raise entropy threshold to reduce false positives
        return entropy > 5.0;
    }

    // Check if message contains sensitive data
    containsSensitiveData(message: string): boolean {
        // 1 keyword detection
        const lower = message.toLowerCase();
        for (const term of this.blockedTerms) {
            if (lower.includes(term)) {
                return true;
            }
        }

        // 2 high confidence patterns
        for (const rule of this.highConfidencePatterns) {
            const matches = message.match(rule.regex);
            if (matches) {
                return true;
            }
        }

        // 3 generic patterns
        for (const rule of this.genericPatterns) {
            const matches = message.match(rule.regex);
            if (matches) {
                return true;
            }
        }

        // 4 entropy detection
        const candidates = message.match(/[A-Za-z0-9_\-]{32,}/g) || [];
        for (const token of candidates) {
            if (this.isHighEntropy(token)) {
                return true;
            }
        }

        return false;
    }

}