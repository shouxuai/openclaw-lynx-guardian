import type { ScriptLanguage } from "../../shared/src/decision.js";
import type { ResolveScriptEntrypointsInput, ScriptEntrypoint } from "./types.js";

const SCRIPT_EXTENSIONS: Array<[RegExp, ScriptLanguage]> = [
  [/\.ps1$/i, "powershell"],
  [/\.(?:bat|cmd)$/i, "cmd"],
  [/\.py$/i, "python"],
  [/\.(?:mjs|cjs|js)$/i, "javascript"],
  [/\.ts$/i, "typescript"],
  [/\.sh$/i, "shell"],
];

export function resolveScriptEntrypoints(input: ResolveScriptEntrypointsInput): ScriptEntrypoint[] {
  const params = input.params ?? {};
  const toolName = input.toolName.toLowerCase();
  const command = stringParam(params, ["command", "cmd", "script"]);
  const path = stringParam(params, ["file_path", "path", "targetPath"]);
  const content = stringParam(params, ["content", "text", "newText"]);

  const entries: ScriptEntrypoint[] = [];

  if (toolName.includes("write") || toolName.includes("edit") || toolName.includes("patch")) {
    if (path && isScriptLikePath(path)) {
      entries.push({
        entrypointKind: "script_write",
        source: "write_payload",
        scriptPath: path,
        inlineText: content || undefined,
        language: languageFromPath(path),
      });
    }
    return entries;
  }

  if (!command) {
    return entries;
  }

  const direct = firstMatch(command, [
    /\b(?:python|python3|py)\s+([^\s"';&|]+\.py)\b/i,
    /\bnode\s+([^\s"';&|]+\.(?:js|mjs|cjs|ts))\b/i,
    /\b(?:bash|sh|zsh)\s+([^\s"';&|]+\.sh)\b/i,
    /\b(?:pwsh|powershell)(?:\.exe)?\s+(?:-File\s+)?([^\s"';&|]+\.ps1)\b/i,
    /\bcmd(?:\.exe)?\s+\/[cr]\s+([^\s"';&|]+\.(?:bat|cmd))\b/i,
  ]);
  if (direct?.[1]) {
    entries.push({
      entrypointKind: "direct_file",
      source: "tool_param",
      command,
      scriptPath: direct[1],
      language: languageFromPath(direct[1]),
    });
  }

  const inline = firstMatch(command, [
    /\bnode\s+(?:-e|--eval)\s+["']?(.+)$/i,
    /\bpython(?:3)?\s+(?:-c|--command)\s+["']?(.+)$/i,
    /\b(?:pwsh|powershell)(?:\.exe)?\s+(?:-Command|-EncodedCommand|-enc)\s+(.+)$/i,
  ]);
  if (inline?.[1]) {
    entries.push({
      entrypointKind: "inline",
      source: "tool_param",
      command,
      inlineText: inline[1],
      language: commandLanguage(command),
    });
  }

  const packageScript = command.match(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z0-9:_-]+)\b/);
  if (packageScript?.[1]) {
    entries.push({
      entrypointKind: "package_script",
      source: "dispatcher",
      command,
      dispatcherPath: "package.json",
      dispatcherKey: packageScript[1],
      language: "json",
    });
  }

  const taskRunner = command.match(/\b(?:make|just|task)\s+([a-zA-Z0-9:_-]+)\b/);
  if (taskRunner?.[1]) {
    const normalizedCommand = command.trim().toLowerCase();
    entries.push({
      entrypointKind: "task_runner",
      source: "dispatcher",
      command,
      dispatcherPath: normalizedCommand.startsWith("make")
        ? "Makefile"
        : normalizedCommand.startsWith("just")
          ? "Justfile"
          : "Taskfile.yml",
      dispatcherKey: taskRunner[1],
      language: normalizedCommand.startsWith("make") ? "make" : "yaml",
    });
  }

  return dedupeEntries(entries);
}

function stringParam(params: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function languageFromPath(path: string): ScriptLanguage {
  for (const [pattern, language] of SCRIPT_EXTENSIONS) {
    if (pattern.test(path)) return language;
  }
  if (/package\.json$/i.test(path)) return "json";
  if (/(^|[\\/])makefile$/i.test(path)) return "make";
  if (/(^|[\\/])(?:justfile|taskfile\.ya?ml)$/i.test(path)) return "yaml";
  return "unknown";
}

function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

function isScriptLikePath(path: string): boolean {
  return /\.(?:sh|ps1|bat|cmd|py|js|mjs|cjs|ts)$/i.test(path)
    || /(^|[\\/])(?:package\.json|makefile|justfile|taskfile\.ya?ml|pyproject\.toml)$/i.test(path);
}

function commandLanguage(command: string): ScriptLanguage {
  if (/\bnode\b/i.test(command)) return "javascript";
  if (/\bpython/i.test(command)) return "python";
  if (/\b(?:pwsh|powershell)/i.test(command)) return "powershell";
  if (/\b(?:bash|sh|zsh)\b/i.test(command)) return "shell";
  return "unknown";
}

function dedupeEntries(entries: ScriptEntrypoint[]): ScriptEntrypoint[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = [
      entry.entrypointKind,
      entry.scriptPath ?? "",
      entry.dispatcherPath ?? "",
      entry.dispatcherKey ?? "",
      entry.inlineText ?? "",
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
