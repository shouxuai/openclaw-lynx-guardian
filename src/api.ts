
import { CONFIG } from "./config.js";

// P1-5: Request timeout constant
const API_TIMEOUT_MS = 10000;

export interface RegisterResponse {
  code: number;
  id: string;
  message: string;
}

export interface PublicAccessCheckResponse {
  code: number;
  result: {
    is_public: boolean;
  };
  message: string;
}

export interface ContentCheckResponse {
  code: number;
  result: {
    is_safe: boolean;
    risk_level: number; // 0-无, 1-低, 2-中, 3-高
    level_one: string;
    level_two: string;
    level_three: string;
  };
  message: string;
}

export interface ToolCheckResponse {
  code: number;
  result: {
    is_safe: boolean;
    risk_level: number;
    content: string;
  };
  message: string;
}

// P1-5 & P1-6: Centralized fetch with timeout and response validation
async function safeFetch<T>(url: string, options: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}: ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function registerUser(id: string): Promise<RegisterResponse> {
  return safeFetch<RegisterResponse>(`${CONFIG.API_BASE_URL}/api/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function checkContent(
  id: string,
  content: string,
  contentType: 1 | 2
): Promise<ContentCheckResponse> {
  return safeFetch<ContentCheckResponse>(`${CONFIG.API_BASE_URL}/api/v1/content_check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      content,
      content_type: contentType,
    }),
  });
}

export async function checkTool(
  id: string,
  content: string
): Promise<ToolCheckResponse> {
  return safeFetch<ToolCheckResponse>(`${CONFIG.API_BASE_URL}/api/v1/tool_check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      content,
      content_type: 3,
    }),
  });
}

export interface PushRecordResponse {
  code: number;
  message: string;
}

export async function pushRecord(
  id: string,
  content: string,
  riskLevel: number
): Promise<PushRecordResponse> {
  return safeFetch<PushRecordResponse>(`${CONFIG.API_BASE_URL}/api/v1/push_record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      content,
      content_type: 3,
      is_safe: false,
      risk_level: riskLevel,
    }),
  });
}

export async function checkPublicAccess(
  id: string,
  publicIP: string,
  port: number,
): Promise<PublicAccessCheckResponse> {
  return safeFetch<PublicAccessCheckResponse>(`${CONFIG.API_BASE_URL}/api/v1/check_public_access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      publicIP,
      port,
    }),
  });
}

// ── Skill Guard API ─────────────────────────────────────────────────

export interface SkillBlacklistResponse {
  code: number;
  result: {
    entries: Array<{
      name?: string;
      namePattern?: string;
      hash?: string;
      reason: string;
      severity: "critical" | "warning";
    }>;
  };
  message: string;
}

export interface SkillCheckResponse {
  code: number;
  result: {
    is_safe: boolean;
    risk_level: number;
    reason: string;
  };
  message: string;
}

/**
 * Fetch remote malicious Skill blacklist.
 */
export async function fetchMaliciousSkillBlacklist(): Promise<SkillBlacklistResponse> {
  return safeFetch<SkillBlacklistResponse>(
    `${CONFIG.API_BASE_URL}/api/v1/skill_blacklist`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * Check a specific Skill against the remote security service.
 */
export async function checkSkill(
  id: string,
  skillName: string,
  skillHash: string,
): Promise<SkillCheckResponse> {
  return safeFetch<SkillCheckResponse>(
    `${CONFIG.API_BASE_URL}/api/v1/skill_check`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        skill_name: skillName,
        skill_hash: skillHash,
      }),
    },
  );
}
