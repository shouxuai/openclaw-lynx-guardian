import { writeFileSync } from "fs";
import { shouldSkipRoutineHeartbeatProbe } from "../console/runtime.js";
import { ensureParentDirectory } from "../discovery/pending-discovery-store.js";

export type HookRuntimeLogger = {
  error: (message: string) => void;
  warn: (message: string) => void;
};

export function appendHookLifecycleProbe(params: {
  hookName: string;
  payload: unknown;
  ctx: unknown;
  hookProbeLogPath: string;
  log: Pick<HookRuntimeLogger, "error">;
}): void {
  try {
    if (shouldSkipRoutineHeartbeatProbe(params.hookName, params.payload, params.ctx)) {
      return;
    }
    ensureParentDirectory(params.hookProbeLogPath);
    writeFileSync(
      params.hookProbeLogPath,
      `${JSON.stringify({
        hookName: params.hookName,
        payload: params.payload,
        ctx: params.ctx,
        timestamp: new Date().toISOString(),
      })}\n`,
      { encoding: "utf8", flag: "a" },
    );
  } catch (err: any) {
    params.log.error(`[lynx-guardian] Failed to append lifecycle probe: ${err.message}`);
  }
}

export async function sendHookFeedbackMessage(
  ctx: any,
  content: string,
  log: Pick<HookRuntimeLogger, "warn">,
): Promise<void> {
  if (typeof ctx?.sendMessage !== "function" || content.trim().length === 0) {
    return;
  }

  try {
    await ctx.sendMessage({
      role: "assistant",
      content,
    });
  } catch (err: any) {
    log.warn(`[lynx-guardian] Failed to send hook feedback: ${err.message}`);
  }
}
