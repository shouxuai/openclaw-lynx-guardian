export const EVIDENCE_DIMENSIONS = [
  "harm",
  "rev",
  "auth",
  "pattern",
  "clarity",
  "chain",
  "taint",
] as const;

export type EvidenceDimension = typeof EVIDENCE_DIMENSIONS[number];

export type DimensionScores = Record<EvidenceDimension, number>;

export interface EvidenceItemInput {
  dimension: EvidenceDimension;
  weight: number;
  confidence: number;
  reason: string;
  source?: string;
  target?: string;
  atMs?: number;
}

export interface ScoredEvidenceItem extends EvidenceItemInput {
  effectiveScore: number;
}

export interface EvidenceScoreResult {
  dimensionScores: DimensionScores;
  summaryHeat: number;
  chainAdjustedHeat: number;
  compatibilityScore: number;
  evidenceItems: ScoredEvidenceItem[];
}

function clampHeat(value: number, max = 5): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(max, Math.round(value)));
}

function createEmptyDimensionScores(): DimensionScores {
  return {
    harm: 0,
    rev: 0,
    auth: 0,
    pattern: 0,
    clarity: 0,
    chain: 0,
    taint: 0,
  };
}

export function scoreEvidence(items: EvidenceItemInput[]): EvidenceScoreResult {
  const dimensionScores = createEmptyDimensionScores();
  const evidenceItems: ScoredEvidenceItem[] = [];

  for (const item of items) {
    const effectiveScore = clampHeat(item.weight * item.confidence);
    dimensionScores[item.dimension] = Math.max(dimensionScores[item.dimension], effectiveScore);
    evidenceItems.push({
      ...item,
      effectiveScore,
    });
  }

  const orderedScores = Object.values(dimensionScores).sort((left, right) => right - left);
  const top1 = orderedScores[0] ?? 0;
  const top2 = orderedScores[1] ?? 0;
  const chainAdjustedHeat = Math.max(
    dimensionScores.chain,
    dimensionScores.taint >= 3
      ? Math.min(5, Math.max(dimensionScores.chain, dimensionScores.taint))
      : 0,
  );

  const summaryHeat = clampHeat(
    Math.max(
      top1,
      Math.ceil((top1 + top2) / 2),
      chainAdjustedHeat,
    ),
  );

  return {
    dimensionScores,
    summaryHeat,
    chainAdjustedHeat,
    compatibilityScore: Math.max(0, Math.min(10, summaryHeat * 2)),
    evidenceItems,
  };
}
