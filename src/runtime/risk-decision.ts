import type { RiskAssessment, RiskLevel } from "../guard/safety-guard.js";

export type RiskSurface = "input" | "output" | "tool";
export type RiskSource = "local" | "remote";
export type RiskAction = "allow" | "log" | "warn" | "model_context" | "require_approval" | "deny";

export interface UnifiedRiskSignal {
  source: RiskSource;
  surface: RiskSurface;
  level: RiskLevel;
  score: number;
  modules: string[];
  categories?: string[];
  description: string;
}

export interface RiskDecision {
  surface: RiskSurface;
  level: RiskLevel;
  action: RiskAction;
  signals: UnifiedRiskSignal[];
  primaryModule?: string;
  reason: string;
}

interface RemoteContentSignalInput {
  surface: RiskSurface;
  riskLevel: number;
  categories?: string[];
  description: string;
}

const RISK_LEVEL_VALUES: Record<RiskLevel, 0 | 1 | 2 | 3 | 4> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

const RISK_LEVELS: RiskLevel[] = ["L0", "L1", "L2", "L3", "L4"];

export function localSignalFromAssessment(
  surface: RiskSurface,
  assessment: RiskAssessment,
): UnifiedRiskSignal {
  return {
    source: "local",
    surface,
    level: assessment.level,
    score: assessment.score,
    modules: [...assessment.modules],
    description: assessment.description,
  };
}

export function remoteContentSignal(input: RemoteContentSignalInput): UnifiedRiskSignal {
  const levelValue = normalizeRemoteRiskLevel(input.riskLevel);

  return {
    source: "remote",
    surface: input.surface,
    level: RISK_LEVELS[levelValue],
    score: normalizeRemoteScore(levelValue),
    modules: [input.surface === "tool" ? "remote:tool_check" : "remote:content_check"],
    categories: input.categories === undefined ? undefined : [...input.categories],
    description: input.description,
  };
}

export function decideRiskAction(
  surface: RiskSurface,
  signals: UnifiedRiskSignal[],
): RiskDecision {
  const surfaceSignals = signals.filter((signal) => signal.surface === surface);
  const primarySignal = selectPrimarySignal(surfaceSignals);

  if (primarySignal === undefined) {
    return {
      surface,
      level: "L0",
      action: "allow",
      signals: surfaceSignals,
      reason: "no risk signals",
    };
  }

  return {
    surface,
    level: primarySignal.level,
    action: actionForLevel(surface, primarySignal.level),
    signals: surfaceSignals,
    primaryModule: primarySignal.modules[0],
    reason: primarySignal.description,
  };
}

function normalizeRemoteRiskLevel(riskLevel: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(riskLevel)) return 0;
  return Math.max(0, Math.min(4, Math.round(riskLevel))) as 0 | 1 | 2 | 3 | 4;
}

function normalizeRemoteScore(levelValue: 0 | 1 | 2 | 3 | 4): number {
  return Math.max(0, Math.min(10, Math.round(levelValue * 2.5)));
}

function selectPrimarySignal(signals: UnifiedRiskSignal[]): UnifiedRiskSignal | undefined {
  return signals.reduce<UnifiedRiskSignal | undefined>((current, candidate) => {
    if (current === undefined) return candidate;
    const currentLevel = RISK_LEVEL_VALUES[current.level];
    const candidateLevel = RISK_LEVEL_VALUES[candidate.level];
    if (candidateLevel > currentLevel) return candidate;
    if (candidateLevel === currentLevel && candidate.score > current.score) return candidate;
    return current;
  }, undefined);
}

function actionForLevel(surface: RiskSurface, level: RiskLevel): RiskAction {
  switch (level) {
    case "L4":
      return "deny";
    case "L3":
      if (surface === "tool") return "require_approval";
      if (surface === "output") return "deny";
      return "model_context";
    case "L2":
      return "warn";
    case "L1":
      return "log";
    case "L0":
      return "allow";
  }
}
