export type LocalToolHardDenyKind =
  | "credential_read"
  | "plugin_self_tamper"
  | "openclaw_config_disable"
  | "sensitive_external_send"
  | "hidden_execution";

export interface LocalToolHardDenyHit {
  kind: LocalToolHardDenyKind;
  module: string;
  reason: string;
}

export interface LocalToolHardDenyInput {
  toolName?: string;
  command?: string;
  params?: Record<string, unknown>;
  targetUri?: string;
  content?: string;
}

const PLUGIN_TARGET_PATTERN = /(?:openclaw-lynx-guardian|lynx[-\s]*guardian)/i;
const PLUGIN_MUTATION_PATTERN =
  /\b(?:rm|del|delete|remove|unlink|mv|move|rename|ren|rmdir|rd|disable|uninstall|tamper)\b/i;
const CONFIG_TARGET_PATTERN = /(?:openclaw\.json|openclaw\.plugin\.json|config\.patch)/i;
const CONFIG_DISABLE_PATTERN =
  /(?:\bdisabled\b\s*[:=]\s*true|\bdisable(?:d|s)?\b|\bturn\s+off\b|\bdeactivate\b|\bsafety\s*bypass\b)/i;
const CREDENTIAL_SOURCE_PATTERN =
  /(?:\.ssh[\\/](?:id_rsa|id_ed25519|authorized_keys)|\.aws[\\/]credentials|\.env\b|private[_\s-]?key|api[_\s-]?key|secret|token\b)/i;
const CREDENTIAL_READ_PATTERN = /\b(?:cat|type|get-content|gc|less|more|head|tail|read|open|print)\b/i;
const EXTERNAL_SEND_PATTERN =
  /(?:https?:\/\/|\bcurl\b|\bwget\b|\binvoke-webrequest\b|\biwr\b|\bpost\b|\bupload\b|--data(?:-binary)?\b)/i;
const HIDDEN_EXECUTION_PATTERN =
  /(?:\bbase64\b|\bfrombase64string\b|\b-enc(?:odedcommand)?\b|\bpowershell\b[^\n\r]*(?:-enc|-encodedcommand)|\bcertutil\b[^\n\r]*-decode)/i;
const EVASION_INTENT_PATTERN = /\b(?:bypass|evade|hide|conceal|detector|silent|stealth)\b/i;

export function findLocalToolHardDeny(input: LocalToolHardDenyInput): LocalToolHardDenyHit | null {
  const text = normalizeHardDenyText([
    input.content,
    input.toolName,
    input.targetUri,
    input.command,
    input.params ? JSON.stringify(input.params) : "",
  ].filter(Boolean).join(" "));

  if (!text) {
    return null;
  }

  if (CREDENTIAL_SOURCE_PATTERN.test(text) && EXTERNAL_SEND_PATTERN.test(text)) {
    return {
      kind: "sensitive_external_send",
      module: "local_sensitive_external_send",
      reason: "Request combines a sensitive source with an external send target.",
    };
  }

  if (PLUGIN_TARGET_PATTERN.test(text) && PLUGIN_MUTATION_PATTERN.test(text)) {
    return {
      kind: "plugin_self_tamper",
      module: "local_plugin_file_tamper",
      reason: "Request attempts to delete, move, rename, or disable Lynx Guardian files.",
    };
  }

  if (CONFIG_TARGET_PATTERN.test(text) && CONFIG_DISABLE_PATTERN.test(text)) {
    return {
      kind: "openclaw_config_disable",
      module: "local_config_disable_mutation",
      reason: "Request attempts to disable protection through OpenClaw or Lynx config.",
    };
  }

  if (CREDENTIAL_SOURCE_PATTERN.test(text) && CREDENTIAL_READ_PATTERN.test(text)) {
    return {
      kind: "credential_read",
      module: "local_secret_read",
      reason: "Request attempts to read private keys, tokens, or environment secrets.",
    };
  }

  if (HIDDEN_EXECUTION_PATTERN.test(text) && EVASION_INTENT_PATTERN.test(text)) {
    return {
      kind: "hidden_execution",
      module: "local_hidden_execution",
      reason: "Request asks to hide or obfuscate an execution chain.",
    };
  }

  return null;
}

function normalizeHardDenyText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
