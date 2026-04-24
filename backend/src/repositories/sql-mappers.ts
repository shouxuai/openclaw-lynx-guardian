import type { ApprovalScopeType, EnforcementAction } from "../../../shared/src/enums.js";

const ENFORCEMENT_ACTION_TO_DB: Record<EnforcementAction, string> = {
  allow: "allow",
  warn: "warn",
  block: "block",
  redact: "redact",
  requireApproval: "require_approval",
  logOnly: "log_only",
};

const DB_TO_ENFORCEMENT_ACTION: Record<string, EnforcementAction> = {
  allow: "allow",
  warn: "warn",
  block: "block",
  redact: "redact",
  require_approval: "requireApproval",
  log_only: "logOnly",
};

const APPROVAL_SCOPE_TO_DB: Record<ApprovalScopeType, string> = {
  singleTool: "single_tool",
  workflow: "workflow",
  timeWindow: "time_window",
};

const DB_TO_APPROVAL_SCOPE: Record<string, ApprovalScopeType> = {
  single_tool: "singleTool",
  workflow: "workflow",
  time_window: "timeWindow",
};

export function toDbEnforcementAction(value: EnforcementAction): string {
  return ENFORCEMENT_ACTION_TO_DB[value];
}

export function fromDbEnforcementAction(value: string | null | undefined): EnforcementAction | undefined {
  if (!value) {
    return undefined;
  }
  return DB_TO_ENFORCEMENT_ACTION[value];
}

export function toDbApprovalScopeType(value: ApprovalScopeType): string {
  return APPROVAL_SCOPE_TO_DB[value];
}

export function fromDbApprovalScopeType(value: string | null | undefined): ApprovalScopeType | undefined {
  if (!value) {
    return undefined;
  }
  return DB_TO_APPROVAL_SCOPE[value];
}

export function parseJsonRecord<T extends Record<string, unknown> = Record<string, unknown>>(
  value: string | null | undefined,
): T | undefined {
  if (!value) {
    return undefined;
  }
  return JSON.parse(value) as T;
}

export function parseJsonArray<T = unknown>(
  value: string | null | undefined,
): T[] | undefined {
  if (!value) {
    return undefined;
  }
  return JSON.parse(value) as T[];
}

export function fromDbBoolean(value: number | boolean | null | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return value === 1;
}
