import { createHash } from "crypto";
import { isAbsolute, join } from "path";
import type {
  ResourcePolicyEvidence,
  RiskLevel,
  ScriptPreflightEvidence,
} from "../../shared/src/decision.js";
import type { ToolCallEvent } from "../types.js";
import { resolveScriptEntrypoints } from "./entrypoint-resolver.js";
import { readScriptForPreflight } from "./safe-script-reader.js";
import { scanScriptContent } from "./script-scanner.js";

export interface DecisionEvidenceBundle {
  scriptEvidence?: ScriptPreflightEvidence[];
  resourceEvidence?: ResourcePolicyEvidence[];
  policyVersion?: number;
}

export interface ScriptPreflightMetadata {
  count: number;
  maxRiskLevel: RiskLevel;
  deniedRuleIds: string[];
  items: ScriptPreflightEvidence[];
}

export type ToolCallEventWithEvidence = ToolCallEvent & DecisionEvidenceBundle;

const DEFAULT_MAX_SCRIPT_BYTES = 512 * 1024;
const RISK_ORDER: Record<RiskLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

export function buildDecisionOnlyToolEvent(
  event: ToolCallEvent,
  evidence: DecisionEvidenceBundle,
): ToolCallEventWithEvidence {
  return {
    ...event,
    params: event.params,
    scriptEvidence: evidence.scriptEvidence,
    resourceEvidence: evidence.resourceEvidence,
    policyVersion: evidence.policyVersion,
  };
}

export function collectScriptPreflightEvidence(input: {
  toolName: string;
  params?: Record<string, unknown>;
  cwd?: string;
  maxBytes?: number;
}): ScriptPreflightEvidence[] {
  const entries = resolveScriptEntrypoints(input);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_SCRIPT_BYTES;

  return entries.map((entry) => {
    if (entry.inlineText) {
      const bytes = Buffer.from(entry.inlineText, "utf8");
      return scanScriptContent({
        entrypointKind: entry.entrypointKind,
        source: entry.source,
        command: entry.command,
        scriptPath: entry.scriptPath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
        language: entry.language,
        readStatus: "inline",
        content: entry.inlineText,
      });
    }

    if (entry.scriptPath) {
      const resolvedPath = resolveReadableScriptPath(entry.scriptPath, input.cwd);
      const read = readScriptForPreflight({ scriptPath: resolvedPath, maxBytes });
      return scanScriptContent({
        entrypointKind: entry.entrypointKind,
        source: entry.source,
        command: entry.command,
        scriptPath: entry.scriptPath,
        realPath: read.realPath,
        sha256: read.sha256,
        sizeBytes: read.sizeBytes,
        mtimeMs: read.mtimeMs,
        language: entry.language,
        readStatus: read.readStatus,
        readReason: read.readReason,
        content: read.content,
      });
    }

    return scanScriptContent({
      entrypointKind: entry.entrypointKind,
      source: entry.source,
      command: entry.command,
      scriptPath: entry.dispatcherPath,
      language: entry.language,
      readStatus: "skipped",
      readReason: entry.dispatcherKey
        ? `dispatcher key ${entry.dispatcherKey} requires dispatcher expansion`
        : "no readable script path",
      content: "",
    });
  });
}

export function buildScriptPreflightMetadata(
  scriptEvidence: ScriptPreflightEvidence[],
): ScriptPreflightMetadata | undefined {
  if (scriptEvidence.length === 0) {
    return undefined;
  }

  return {
    count: scriptEvidence.length,
    maxRiskLevel: scriptEvidence.reduce(
      (max, item) => (RISK_ORDER[item.riskLevel] > RISK_ORDER[max] ? item.riskLevel : max),
      "L0" as RiskLevel,
    ),
    deniedRuleIds: scriptEvidence.flatMap((item) =>
      item.findings
        .filter((finding) => finding.severity === "critical")
        .map((finding) => finding.ruleId),
    ),
    items: scriptEvidence,
  };
}

function resolveReadableScriptPath(scriptPath: string, cwd?: string): string {
  if (isAbsolute(scriptPath) || !cwd) {
    return scriptPath;
  }
  return join(cwd, scriptPath);
}
