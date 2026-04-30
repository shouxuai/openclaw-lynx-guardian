import type {
  ScriptEntrypointKind,
  ScriptLanguage,
  ScriptPreflightEvidence,
} from "../../shared/src/decision.js";

export type { ScriptEntrypointKind, ScriptLanguage, ScriptPreflightEvidence };

export interface ScriptEntrypoint {
  entrypointKind: ScriptEntrypointKind;
  source: "tool_param" | "script_file" | "dispatcher" | "write_payload" | "taint";
  command?: string;
  scriptPath?: string;
  dispatcherPath?: string;
  dispatcherKey?: string;
  inlineText?: string;
  language: ScriptLanguage;
}

export interface ResolveScriptEntrypointsInput {
  toolName: string;
  params?: Record<string, unknown>;
  cwd?: string;
}

export interface SafeScriptReadInput {
  scriptPath: string;
  maxBytes: number;
}

export interface SafeScriptReadResult {
  readStatus: "read" | "skipped" | "blocked" | "error";
  readReason?: string;
  content?: string;
  realPath?: string;
  sha256?: string;
  sizeBytes?: number;
  mtimeMs?: number;
}
