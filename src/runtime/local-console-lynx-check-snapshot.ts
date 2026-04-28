import type { LynxCheckSnapshotInput } from "./local-console-event-builder.js";
import type { LynxCheckRunIntent, LynxCheckRunResult } from "./lynx-check-run-store.js";

export function buildLocalConsoleLynxCheckSnapshot(
  intent: LynxCheckRunIntent,
  result: LynxCheckRunResult,
): LynxCheckSnapshotInput {
  return {
    requestId: intent.requestId,
    source: intent.source,
    trigger: intent.trigger,
    preferredTargetKind: intent.preferredTargetKind,
    sessionKey: intent.sessionKey,
    targetKey: intent.routeHint?.targetKey,
    channelId: intent.routeHint?.channelId,
    messageProvider: intent.routeHint?.messageProvider,
    status: result.status,
    sendAttempted: result.sendAttempted,
    sendSucceeded: result.sendSucceeded,
    transport: result.transport,
    reportPath: result.reportPath,
    errorMessage: result.errorMessage,
    deliveryAttemptsJson: result.deliveryAttempts?.map((attempt) => ({ ...attempt })),
    createdAtMs: intent.createdAtMs,
    completedAtMs: result.status === "completed" || result.status === "failed"
      ? result.completedAtMs
      : undefined,
  };
}
