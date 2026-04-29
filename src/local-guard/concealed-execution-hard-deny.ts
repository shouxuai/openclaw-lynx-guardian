export interface LocalConcealedExecutionHardDenyHit {
  module: "local_hidden_execution";
  reason: string;
}

const EXECUTION_OBFUSCATION_PATTERN =
  /(?:\bbase64\b|\bfrombase64string\b|\b-enc(?:odedcommand)?\b|\bpowershell\b[^\n\r]*(?:-enc|-encodedcommand)|\bcertutil\b[^\n\r]*-decode|\bunicode\b)/i;
const EXECUTION_EVASION_PATTERN =
  /\b(?:bypass|evade|hide|conceal|detector|detection|silent|stealth|split\s+command)\b/i;

export function findLocalConcealedExecutionHardDeny(text: string): LocalConcealedExecutionHardDenyHit | null {
  if (!text) {
    return null;
  }
  if (!EXECUTION_OBFUSCATION_PATTERN.test(text) || !EXECUTION_EVASION_PATTERN.test(text)) {
    return null;
  }
  return {
    module: "local_hidden_execution",
    reason: "Request asks to hide or obfuscate an execution chain.",
  };
}
