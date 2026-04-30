import type { ProtectedResourcePreset } from "../../shared/src/decision.js";

export interface ProtectedResourceRule {
  resourceId: string;
  path: string;
  realPath?: string;
  preset: ProtectedResourcePreset;
  enabled: boolean;
  policyVersion?: number;
}
