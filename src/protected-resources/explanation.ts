import type { ResourcePolicyEvidence } from "../../shared/src/decision.js";

const PROTECTED_RESOURCE_RULE_ID = "resource_policy.protected_resource_violation";

export function buildProtectedResourceDenialExplanation(
  resourceEvidence: ResourcePolicyEvidence[],
): string {
  const denied = resourceEvidence.filter((item) => item.allowed === false);
  if (denied.length === 0) {
    return "Lynx Guardian blocked this tool call because protected resource policy evidence was denied.";
  }

  const primary = denied[0];
  const path = primary.realPath ?? primary.matchedPath;

  return [
    "Lynx Guardian blocked this tool call before execution.",
    `Rule: ${PROTECTED_RESOURCE_RULE_ID}`,
    `Protected path: ${path}`,
    `Operation: ${primary.operation}`,
    `Preset: ${primary.preset}`,
    `Reason: ${primary.reason}`,
  ].join("\n");
}
