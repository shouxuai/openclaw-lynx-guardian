import type {
  ProtectedResourcePreset,
  ResourceOperation,
  ResourcePolicyEvidence,
} from "../../shared/src/decision.js";
import type { ProtectedResourceRule } from "./types.js";
import { classifyToolResourceOperations } from "./tool-operation.js";

export type { ProtectedResourceRule };

export function operationAllowedByPreset(
  preset: ProtectedResourcePreset,
  operation: ResourceOperation,
): boolean {
  if (preset === "deny_all") return false;
  if (preset === "read_only") return operation === "read" || operation === "list" || operation === "search";
  if (preset === "no_modify") return operation === "read" || operation === "list" || operation === "search";
  if (preset === "no_delete") return operation !== "delete";
  return true;
}

export function collectResourcePolicyEvidence(input: {
  toolName: string;
  params?: Record<string, unknown>;
  protectedResources: ProtectedResourceRule[];
}): ResourcePolicyEvidence[] {
  const params = input.params ?? {};
  const operations = classifyToolResourceOperations(input.toolName, params);
  const text = Object.values(params).map((value) => String(value ?? "")).join(" ");
  const evidence: ResourcePolicyEvidence[] = [];

  for (const resource of input.protectedResources.filter((item) => item.enabled)) {
    if (!text.toLowerCase().includes(resource.path.toLowerCase())) continue;
    for (const operation of operations) {
      const allowed = operationAllowedByPreset(resource.preset, operation);
      evidence.push({
        evidenceId: `resource-${resource.resourceId}-${operation}`,
        resourceId: resource.resourceId,
        matchedPath: resource.path,
        realPath: resource.realPath,
        preset: resource.preset,
        operation,
        allowed,
        reason: allowed
          ? `${resource.preset} permits ${operation}`
          : `${resource.preset} forbids ${operation}`,
        policyVersion: resource.policyVersion,
      });
    }
  }

  return evidence;
}
