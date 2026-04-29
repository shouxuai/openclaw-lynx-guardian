import {
  findObfuscatedLynxPluginPath,
  findObfuscatedSystemAuthPath,
} from "../path-glob-protection.js";

export type LocalPathHardDenyKind =
  | "credential"
  | "plugin_self"
  | "openclaw_config"
  | "prompt_file"
  | "system_path";

export interface LocalPathHardDenyHit {
  kind: LocalPathHardDenyKind;
  label: string;
}

const CREDENTIAL_PATH_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "ssh_private_key", pattern: /(?:^|[\\/\s~])\.ssh[\\/](?:id_rsa|id_ed25519)\b/i },
  { label: "aws_credentials", pattern: /(?:^|[\\/\s~])\.aws[\\/]credentials\b/i },
  { label: "env_file", pattern: /(?:^|[\\/\s])\.env(?:\b|[.\s])/i },
];

const PLUGIN_PATH_PATTERN = /(?:^|[\\/\s])openclaw-lynx-guardian(?:[\\/\s]|$)/i;
const OPENCLAW_CONFIG_PATTERN = /(?:^|[\\/\s])(?:openclaw\.json|openclaw\.plugin\.json|config\.patch)(?:\b|$)/i;
const PROMPT_FILE_PATTERN = /(?:system[-_\s]?prompt|developer[-_\s]?instruction|safety[-_\s]?rules?)\.(?:md|txt|json)\b/i;
const SYSTEM_AUTH_PATH_PATTERN =
  /(?:\/etc\/(?:passwd|shadow|sudoers)\b|[A-Za-z]:\\Windows\\System32\\config\\(?:SAM|SECURITY|SYSTEM)\b)/i;

export function findLocalHardDenyPath(text: string): LocalPathHardDenyHit | null {
  if (!text) {
    return null;
  }

  const systemAuth = findObfuscatedSystemAuthPath(text);
  if (systemAuth) {
    return { kind: "system_path", label: systemAuth.token };
  }

  const pluginPath = findObfuscatedLynxPluginPath(text);
  if (pluginPath) {
    return { kind: "plugin_self", label: pluginPath.token };
  }

  for (const { label, pattern } of CREDENTIAL_PATH_PATTERNS) {
    if (pattern.test(text)) {
      return { kind: "credential", label };
    }
  }

  if (PLUGIN_PATH_PATTERN.test(text)) {
    return { kind: "plugin_self", label: "openclaw-lynx-guardian" };
  }

  if (OPENCLAW_CONFIG_PATTERN.test(text)) {
    return { kind: "openclaw_config", label: "openclaw_config" };
  }

  if (PROMPT_FILE_PATTERN.test(text)) {
    return { kind: "prompt_file", label: "protected_prompt_file" };
  }

  if (SYSTEM_AUTH_PATH_PATTERN.test(text)) {
    return { kind: "system_path", label: "system_auth_file" };
  }

  return null;
}
