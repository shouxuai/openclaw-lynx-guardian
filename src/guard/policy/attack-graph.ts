export type AttackStage =
  | "idle"
  | "sensitive_scope_entered"
  | "artifact_prepared"
  | "execution_ready"
  | "exfiltration_ready";

export interface AttackGraphState {
  stage: AttackStage;
}

export interface AttackGraphEvent {
  action: "sensitive_read" | "artifact_write" | "artifact_exec" | "external_send";
}

export function advanceAttackGraph(
  current: AttackGraphState | undefined,
  event: AttackGraphEvent,
): AttackGraphState {
  const stage = current?.stage ?? "idle";

  if (stage === "idle" && event.action === "sensitive_read") {
    return { stage: "sensitive_scope_entered" };
  }

  if (stage === "sensitive_scope_entered" && event.action === "artifact_write") {
    return { stage: "artifact_prepared" };
  }

  if (stage === "artifact_prepared" && event.action === "artifact_exec") {
    return { stage: "execution_ready" };
  }

  if (
    (stage === "artifact_prepared" || stage === "execution_ready")
    && event.action === "external_send"
  ) {
    return { stage: "exfiltration_ready" };
  }

  return current ?? { stage: "idle" };
}
