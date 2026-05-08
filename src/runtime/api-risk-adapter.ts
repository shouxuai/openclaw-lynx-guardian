import type { ContentCheckResultPayload, ToolCheckResultPayload } from "../api.js";

export interface CategoryChain {
  levelOne: string;
  levelTwo: string;
  levelThree: string;
}

export interface AdaptedContentCheckResult {
  isSafe: boolean;
  externalRiskLevel: 0 | 1 | 2 | 3 | 4;
  categoryChain: CategoryChain;
}

export interface AdaptedToolCheckResult {
  isSafe: boolean;
  externalRiskLevel: 0 | 1 | 2 | 3 | 4;
  content: string;
}

function normalizeCategoryLabel(value: string | undefined): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "None";
}

function isPlaceholderCategoryLabel(value: string): boolean {
  return normalizeCategoryLabel(value).toLowerCase() === "none";
}

export function toLegacyRiskLevel(riskLevelValue: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(riskLevelValue)) {
    return 0;
  }

  return Math.max(0, Math.min(4, Math.round(riskLevelValue))) as 0 | 1 | 2 | 3 | 4;
}

export function buildContentCategorySummary(categoryChain: CategoryChain): string | undefined {
  const labels = [
    normalizeCategoryLabel(categoryChain.levelOne),
    normalizeCategoryLabel(categoryChain.levelTwo),
    normalizeCategoryLabel(categoryChain.levelThree),
  ];

  return labels.every(isPlaceholderCategoryLabel) ? undefined : labels.join("、");
}

export function adaptContentCheckResult(
  input: ContentCheckResultPayload,
): AdaptedContentCheckResult {
  return {
    isSafe: input.is_safe,
    externalRiskLevel: toLegacyRiskLevel(input.risk_level),
    categoryChain: {
      levelOne: normalizeCategoryLabel(input.level_one),
      levelTwo: normalizeCategoryLabel(input.level_two),
      levelThree: normalizeCategoryLabel(input.level_three),
    },
  };
}

export function adaptToolCheckResult(
  input: ToolCheckResultPayload,
): AdaptedToolCheckResult {
  return {
    isSafe: input.is_safe,
    externalRiskLevel: toLegacyRiskLevel(input.risk_level),
    content: typeof input.content === "string" ? input.content : "",
  };
}
