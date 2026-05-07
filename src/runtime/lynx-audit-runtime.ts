import {
  deliverLynxReport,
  type DeliverLynxReportOptions,
  type LynxReportDeliveryResult,
} from "../delivery/message-delivery.js";

export type ManagedLynxAuditAction =
  | "authorize_run"
  | "deliver_report"
  | "read_runtime"
  | "exec";

export interface ManagedLynxAuditBoundaryInput {
  action: ManagedLynxAuditAction;
  target: string;
  managed: boolean;
}

export interface ManagedLynxAuditBoundaryDecision {
  allowed: boolean;
  reason?: "not-managed" | "managed-audit-whitelist-only";
}

const MANAGED_AUDIT_ALLOWED_ACTIONS = new Set<ManagedLynxAuditAction>([
  "authorize_run",
  "deliver_report",
  "read_runtime",
]);

export function runManagedLynxAuditBoundaryCheck(
  input: ManagedLynxAuditBoundaryInput,
): ManagedLynxAuditBoundaryDecision {
  if (!input.managed) {
    return {
      allowed: false,
      reason: "not-managed",
    };
  }

  if (MANAGED_AUDIT_ALLOWED_ACTIONS.has(input.action)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "managed-audit-whitelist-only",
  };
}

export function assertManagedLynxAuditBoundary(
  input: ManagedLynxAuditBoundaryInput,
): void {
  const decision = runManagedLynxAuditBoundaryCheck(input);
  if (!decision.allowed) {
    throw new Error(
      `[lynx-audit-runtime] blocked action=${input.action} target=${input.target} reason=${decision.reason}`,
    );
  }
}

export async function deliverManagedLynxAuditReport(
  options: DeliverLynxReportOptions,
): Promise<LynxReportDeliveryResult> {
  assertManagedLynxAuditBoundary({
    action: "deliver_report",
    target: options.tag,
    managed: true,
  });

  return deliverLynxReport(options);
}
