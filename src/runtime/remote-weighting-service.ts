import {
  checkContent,
  checkPublicAccess,
  checkTool,
  fetchMaliciousSkillBlacklist,
  pushRecord,
  registerUser,
  type ContentCheckResponse,
  type PublicAccessCheckResponse,
  type PushRecordResponse,
  type RegisterResponse,
  type SkillBlacklistResponse,
  type ToolCheckResponse,
} from "../api/remote-safety-service.js";

export type RemoteWeightingResult<T> =
  | {
      status: "available";
      value: T;
    }
  | {
      status: "unavailable";
      errorMessage: string;
    };

export interface RemoteWeightingLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

function normalizeRemoteError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "unknown remote service error";
}

async function callRemoteWeighted<T>(
  operation: () => Promise<T>,
): Promise<RemoteWeightingResult<T>> {
  try {
    return {
      status: "available",
      value: await operation(),
    };
  } catch (error) {
    return {
      status: "unavailable",
      errorMessage: normalizeRemoteError(error),
    };
  }
}

export function isRemoteAvailable<T>(
  result: RemoteWeightingResult<T>,
): result is { status: "available"; value: T } {
  return result.status === "available";
}

export function getWeightedRiskLevel(params: {
  localFloor: number;
  remoteRiskLevel?: number | null;
}): number {
  return Math.max(params.localFloor, params.remoteRiskLevel ?? 0);
}

export async function registerUserBestEffort(
  id: string,
  log?: RemoteWeightingLogger,
): Promise<RemoteWeightingResult<RegisterResponse>> {
  const result = await callRemoteWeighted(() => registerUser(id));
  if (result.status === "available") {
    log?.info?.(`[lynx-guardian] Registered user: ${id}, status: ${result.value.code}`);
    return result;
  }

  log?.error?.(`[lynx-guardian] Registration failed: ${result.errorMessage}`);
  return result;
}

export async function pushRecordBestEffort(
  params: {
    id: string;
    content: string;
    riskLevel: number;
  },
  options?: {
    log?: RemoteWeightingLogger;
    context?: string;
  },
): Promise<RemoteWeightingResult<PushRecordResponse>> {
  const result = await callRemoteWeighted(() =>
    pushRecord(params.id, params.content, params.riskLevel),
  );

  if (result.status === "unavailable") {
    const contextSuffix = options?.context ? ` (${options.context})` : "";
    options?.log?.error?.(
      `[lynx-guardian] Failed to push record${contextSuffix}: ${result.errorMessage}`,
    );
  }

  return result;
}

export async function checkContentWeighted(
  id: string,
  content: string,
  contentType: 1 | 2,
): Promise<RemoteWeightingResult<ContentCheckResponse>> {
  return callRemoteWeighted(() => checkContent(id, content, contentType));
}

export async function checkToolWeighted(
  id: string,
  content: string,
): Promise<RemoteWeightingResult<ToolCheckResponse>> {
  return callRemoteWeighted(() => checkTool(id, content));
}

export async function checkPublicAccessWeighted(
  id: string,
  publicIP: string,
  port: number,
): Promise<RemoteWeightingResult<PublicAccessCheckResponse>> {
  return callRemoteWeighted(() => checkPublicAccess(id, publicIP, port));
}

export async function fetchMaliciousSkillBlacklistWeighted(
): Promise<RemoteWeightingResult<SkillBlacklistResponse>> {
  return callRemoteWeighted(() => fetchMaliciousSkillBlacklist());
}
