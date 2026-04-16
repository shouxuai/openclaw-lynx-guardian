export interface NormalizePolicyEventInput {
  toolName?: string | null;
  params?: Record<string, unknown> | null;
  content?: string | null;
}

export interface NormalizedToolEvent {
  kind: "tool";
  action: string;
  payload: Record<string, unknown>;
  rawToolName: string;
}

export interface NormalizedInputEvent {
  kind: "input";
  action: "message";
  payload: { content: string };
}

export type NormalizedPolicyEvent = NormalizedToolEvent | NormalizedInputEvent;

function normalizeToolAction(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();

  switch (normalized) {
    case "run_command":
    case "shell":
    case "terminal":
    case "powershell":
      return "exec";
    default:
      return normalized;
  }
}

export function normalizePolicyEvent(input: NormalizePolicyEventInput): NormalizedPolicyEvent {
  if (typeof input.toolName === "string" && input.toolName.trim().length > 0) {
    return {
      kind: "tool",
      action: normalizeToolAction(input.toolName),
      payload: input.params ?? {},
      rawToolName: input.toolName,
    };
  }

  return {
    kind: "input",
    action: "message",
    payload: {
      content: typeof input.content === "string" ? input.content : "",
    },
  };
}
