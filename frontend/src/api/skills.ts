import type { CommonListQuery, PageResponse } from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface SkillInventoryItem {
  skillId: string;
  name: string;
  source: string;
  installPath: string;
  manifestPath: string;
  hashAlgorithm: string;
  baselineHash: string;
  currentHash: string;
  trustState: string;
  lastSeenAt: string;
  metadata?: Record<string, unknown>;
}

export interface SkillFinding {
  findingId: string;
  skillId: string;
  severity: string;
  ruleId: string;
  message: string;
  evidence?: Record<string, unknown>;
  createdAt: string;
}

export interface SkillDetail extends SkillInventoryItem {
  findings: SkillFinding[];
}

export interface SkillSourceBreakdownItem {
  sourceKind: string;
  count: number;
}

export interface SkillListResponse extends PageResponse<SkillDetail> {
  sourceBreakdown?: SkillSourceBreakdownItem[];
}

export interface SkillListQuery extends CommonListQuery {
  trustState?: string;
  source?: string;
  sourceKind?: string;
}

export function listSkills(query: SkillListQuery = {}): Promise<SkillListResponse> {
  return fetchJson<SkillListResponse>(`/skills${buildQueryString(query)}`);
}

export function getSkill(skillId: string): Promise<SkillDetail> {
  return fetchJson<SkillDetail>(`/skills/${encodeURIComponent(skillId)}`);
}
