import type { RiskLevel, ScriptFinding, ScriptPreflightEvidence } from "../../shared/src/decision.js";
import { detectOperationGradeConcealedExecution } from "../guard/concealed-intent.js";

interface ScanScriptInput extends Partial<ScriptPreflightEvidence> {
  content?: string;
}

const MAX_SNIPPET_CHARS = 180;

export function scanScriptContent(input: ScanScriptInput): ScriptPreflightEvidence {
  const content = input.content ?? "";
  const lines = content.split(/\r?\n/);
  const findings: ScriptFinding[] = [...(input.findings ?? [])];

  const concealed = detectOperationGradeConcealedExecution(content);
  addIf(findings, concealed.detected || hasEncodedDynamicExecution(content), {
    ruleId: "script.encoded_dynamic_execution",
    module: "concealed_execution",
    severity: "critical",
    behavior: concealed.detected
      ? `encoded or reassembled payload reaches an execution sink: ${concealed.matchedSignals.join(", ")}`
      : "encoded or reassembled payload reaches eval, exec, or another dynamic execution sink",
    snippet: snippetFor(content),
    confidence: "high",
  });

  addIf(findings, hasDownloadExecute(content), {
    ruleId: "script.download_execute_dynamic_eval",
    module: "remote_code_execution",
    severity: "critical",
    behavior: "downloads remote content and executes or evaluates it in the same script",
    line: firstLine(lines, /(?:curl|wget|Invoke-WebRequest|iwr|fetch|requests\.get).*(?:\|\s*(?:bash|sh|iex|Invoke-Expression)|eval|exec)/i),
    snippet: snippetFor(content),
    confidence: "high",
  });

  addIf(findings, hasCredentialExternalExfiltration(content), {
    ruleId: "script.credential_external_exfiltration",
    module: "exfiltration",
    severity: "critical",
    behavior: "reads credential-like material and sends data to an external network target",
    line: firstLine(lines, /(?:\.env|id_rsa|id_ed25519|token|secret|api[_ -]?key|credential)/i),
    snippet: snippetFor(content),
    confidence: "high",
  });

  addIf(findings, hasDestructiveMutation(content), {
    ruleId: "script.destructive_mutation",
    module: "destructive_mutation",
    severity: "critical",
    behavior: "performs recursive deletion or destructive file mutation",
    line: firstLine(lines, /(?:rm\s+-[a-zA-Z]*r|Remove-Item.*-Recurse|rmdir\s+\/s|shutil\.rmtree|fs\.rmSync)/i),
    snippet: snippetFor(content),
    confidence: "high",
  });

  addIf(findings, hasPersistence(content), {
    ruleId: "script.persistence_silent_execution",
    module: "persistence",
    severity: "error",
    behavior: "registers delayed, background, startup, scheduled, or hook-based execution",
    line: firstLine(lines, /(?:cron|crontab|schtasks|systemd|launchctl|\.git[\\/]hooks|postinstall|Start-Process|nohup)/i),
    snippet: snippetFor(content),
    confidence: "medium",
  });

  const riskLevel = riskFromFindings(findings);
  return {
    evidenceId: input.evidenceId ?? `script-${Date.now()}`,
    entrypointKind: input.entrypointKind ?? "inline",
    source: input.source ?? "tool_param",
    command: input.command,
    scriptPath: input.scriptPath,
    realPath: input.realPath,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    mtimeMs: input.mtimeMs,
    language: input.language ?? "unknown",
    readStatus: input.readStatus ?? "inline",
    readReason: input.readReason,
    findings,
    riskLevel,
    recommendedAction: actionFromRisk(riskLevel),
  };
}

function addIf(findings: ScriptFinding[], condition: boolean, finding: ScriptFinding): void {
  if (condition && !findings.some((existing) => existing.ruleId === finding.ruleId)) {
    findings.push(finding);
  }
}

function hasEncodedDynamicExecution(content: string): boolean {
  return /(?:base64|frombase64string|atob|Buffer\.from|b64decode)/i.test(content)
    && /(?:eval\s*\(|exec\s*\(|Function\s*\(|invoke-expression|iex\b|subprocess|os\.system)/i.test(content);
}

function hasDownloadExecute(content: string): boolean {
  return /(?:curl|wget|Invoke-WebRequest|iwr|fetch|requests\.get|Net\.WebClient|DownloadString)/i.test(content)
    && /(?:\|\s*(?:bash|sh|iex|Invoke-Expression)|eval\s*\(|exec\s*\(|Function\s*\(|subprocess|os\.system)/i.test(content);
}

function hasCredentialExternalExfiltration(content: string): boolean {
  return /(?:\.env|id_rsa|id_ed25519|token|secret|api[_ -]?key|credential|private key)/i.test(content)
    && /(?:https?:\/\/|requests\.post|fetch\s*\(|curl\s+.*(?:-d|--data|--upload-file)|Invoke-RestMethod|Invoke-WebRequest)/i.test(content);
}

function hasDestructiveMutation(content: string): boolean {
  return /(?:rm\s+-[a-zA-Z]*r|Remove-Item\b.*-Recurse|rmdir\s+\/s|del\s+\/s|shutil\.rmtree|fs\.rmSync|unlinkSync)/i.test(content);
}

function hasPersistence(content: string): boolean {
  return /(?:crontab|schtasks|systemctl\s+enable|launchctl|\.git[\\/]hooks|postinstall|preinstall|Start-Process|nohup|--detach)/i.test(content);
}

function firstLine(lines: string[], pattern: RegExp): number | undefined {
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : undefined;
}

function snippetFor(content: string): string | undefined {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, MAX_SNIPPET_CHARS) : undefined;
}

function riskFromFindings(findings: ScriptFinding[]): RiskLevel {
  if (findings.some((finding) => finding.severity === "critical" && finding.confidence === "high")) return "L4";
  if (findings.some((finding) => finding.severity === "critical" || finding.severity === "error")) return "L3";
  if (findings.some((finding) => finding.severity === "warn")) return "L2";
  if (findings.length > 0) return "L1";
  return "L0";
}

function actionFromRisk(riskLevel: RiskLevel): ScriptPreflightEvidence["recommendedAction"] {
  if (riskLevel === "L4") return "deny";
  if (riskLevel === "L3") return "require_approval";
  if (riskLevel === "L2") return "warn";
  return "allow";
}
