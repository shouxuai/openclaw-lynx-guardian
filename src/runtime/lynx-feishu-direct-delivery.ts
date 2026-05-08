import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Logger } from "../types.js";
import { normalizeString, resolveRuntimeHomeDir } from "./plugin-runtime-helpers.js";

type FeishuReceiveIdType = "open_id" | "chat_id";

type FeishuDirectTarget = {
  receiveIdType: FeishuReceiveIdType;
  receiveId: string;
};

type FeishuCredentials = {
  appId: string;
  appSecret: string;
  baseUrl: string;
};

type FeishuConfigFailureReason =
  | "file_not_found"
  | "parse_failed"
  | "feishu_disabled"
  | "missing_credentials";

export interface DirectFeishuApprovalDeliveryInput {
  conversationId?: string;
  content: string;
  logger?: Pick<Logger, "warn">;
}

export interface DirectFeishuApprovalDeliveryResult {
  delivered: boolean;
  transport: "feishu-openapi-direct" | "none";
  reason?:
    | "missing_target"
    | "malformed_target"
    | "missing_config"
    | "runtime_unavailable"
    | "auth_failed"
    | "send_failed";
  configReason?: FeishuConfigFailureReason;
  errorMessage?: string;
  receiveIdType?: FeishuReceiveIdType;
  receiveId?: string;
  messageId?: string;
}

const tenantAccessTokenCache = new Map<string, {
  token: string;
  expiresAtMs: number;
}>();

function resolveFeishuBaseUrl(rawDomain: string): string {
  const normalizedDomain = rawDomain.trim();
  if (/^https?:\/\//i.test(normalizedDomain)) {
    return normalizedDomain.replace(/\/+$/, "");
  }

  if (/lark/i.test(normalizedDomain)) {
    return "https://open.larksuite.com";
  }

  return "https://open.feishu.cn";
}

function buildTenantTokenCacheKey(credentials: FeishuCredentials): string {
  return `${credentials.baseUrl}\n${credentials.appId}\n${credentials.appSecret}`;
}

function resolveFeishuCredentials(logger?: Pick<Logger, "warn">): (
  | { ok: true; credentials: FeishuCredentials }
  | { ok: false; reason: FeishuConfigFailureReason; errorMessage?: string }
) {
  const openclawConfigPath = join(resolveRuntimeHomeDir(), ".openclaw", "openclaw.json");
  if (!existsSync(openclawConfigPath)) {
    return {
      ok: false,
      reason: "file_not_found",
    };
  }

  try {
    const openclawConfig = JSON.parse(readFileSync(openclawConfigPath, "utf8")) as Record<string, any>;
    const feishu = openclawConfig?.channels?.feishu ?? {};
    const enabled = feishu?.enabled;
    if (enabled === false) {
      return {
        ok: false,
        reason: "feishu_disabled",
      };
    }

    const appId = normalizeString(feishu?.appId ?? feishu?.app_id);
    const appSecret = normalizeString(feishu?.appSecret ?? feishu?.app_secret);
    if (!appId || !appSecret) {
      return {
        ok: false,
        reason: "missing_credentials",
      };
    }

    const baseUrl = resolveFeishuBaseUrl(
      normalizeString(feishu?.openBaseUrl ?? feishu?.baseUrl ?? feishu?.domain ?? "feishu"),
    );
    return {
      ok: true,
      credentials: {
        appId,
        appSecret,
        baseUrl,
      },
    };
  } catch (error: any) {
    logger?.warn?.(`[lynx-guardian] Failed to read host openclaw.json feishu config: ${error.message}`);
    return {
      ok: false,
      reason: "parse_failed",
      errorMessage: error?.message ?? String(error),
    };
  }
}

function resolveFeishuTarget(conversationId?: string): (
  | { ok: true; target: FeishuDirectTarget }
  | { ok: false; reason: "missing_target" | "malformed_target" }
) {
  const normalizedConversationId = normalizeString(conversationId);
  if (!normalizedConversationId) {
    return {
      ok: false,
      reason: "missing_target",
    };
  }

  const prefixedTargetMatch = normalizedConversationId.match(/^(user|dm):(.*)$/i);
  if (prefixedTargetMatch) {
    const openId = normalizeString(prefixedTargetMatch[2]);
    if (!openId || !/^ou_[A-Za-z0-9_-]+$/i.test(openId)) {
      return {
        ok: false,
        reason: "malformed_target",
      };
    }

    return {
      ok: true,
      target: {
        receiveIdType: "open_id",
        receiveId: openId,
      },
    };
  }

  if (/^(user|dm):/i.test(normalizedConversationId)) {
    return {
      ok: false,
      reason: "malformed_target",
    };
  }

  return {
    ok: true,
    target: {
      receiveIdType: "chat_id",
      receiveId: normalizedConversationId,
    },
  };
}

function getGlobalFetch(): typeof fetch | null {
  return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
}

async function fetchTenantAccessToken(
  credentials: FeishuCredentials,
): Promise<{ ok: true; token: string } | { ok: false; errorMessage: string }> {
  const cacheKey = buildTenantTokenCacheKey(credentials);
  const cachedEntry = tenantAccessTokenCache.get(cacheKey);
  if (
    cachedEntry
    && cachedEntry.expiresAtMs > Date.now() + 30_000
  ) {
    return {
      ok: true,
      token: cachedEntry.token,
    };
  }

  const fetchFn = getGlobalFetch();
  if (!fetchFn) {
    return {
      ok: false,
      errorMessage: "Global fetch is unavailable",
    };
  }

  try {
    const response = await fetchFn(
      `${credentials.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: credentials.appId,
          app_secret: credentials.appSecret,
        }),
      },
    );

    const payload = await response.json() as Record<string, any>;
    if (!response.ok || payload?.code !== 0 || !normalizeString(payload?.tenant_access_token)) {
      return {
        ok: false,
        errorMessage: `Feishu tenant token request failed (status=${response.status}, code=${String(payload?.code ?? "")})`,
      };
    }

    const token = normalizeString(payload.tenant_access_token);
    const expireSeconds = Number.isFinite(payload?.expire) ? Number(payload.expire) : 3600;
    tenantAccessTokenCache.set(cacheKey, {
      token,
      expiresAtMs: Date.now() + Math.max(60, expireSeconds) * 1000,
    });
    return {
      ok: true,
      token,
    };
  } catch (error: any) {
    return {
      ok: false,
      errorMessage: error?.message ?? String(error),
    };
  }
}

export async function deliverLynxFeishuApprovalPromptDirectly(
  input: DirectFeishuApprovalDeliveryInput,
): Promise<DirectFeishuApprovalDeliveryResult> {
  const targetResult = resolveFeishuTarget(input.conversationId);
  if (!targetResult.ok) {
    return {
      delivered: false,
      transport: "none",
      reason: targetResult.reason,
    };
  }
  const target = targetResult.target;

  const credentialsResult = resolveFeishuCredentials(input.logger);
  if (!credentialsResult.ok) {
    return {
      delivered: false,
      transport: "none",
      reason: "missing_config",
      configReason: credentialsResult.reason,
      errorMessage: credentialsResult.errorMessage,
      receiveIdType: target.receiveIdType,
      receiveId: target.receiveId,
    };
  }
  const credentials = credentialsResult.credentials;

  const fetchFn = getGlobalFetch();
  if (!fetchFn) {
    return {
      delivered: false,
      transport: "none",
      reason: "runtime_unavailable",
      errorMessage: "Global fetch is unavailable",
      receiveIdType: target.receiveIdType,
      receiveId: target.receiveId,
    };
  }

  const tokenResult = await fetchTenantAccessToken(credentials);
  if (!tokenResult.ok) {
    return {
      delivered: false,
      transport: "none",
      reason: "auth_failed",
      errorMessage: tokenResult.errorMessage,
      receiveIdType: target.receiveIdType,
      receiveId: target.receiveId,
    };
  }

  try {
    const response = await fetchFn(
      `${credentials.baseUrl}/open-apis/im/v1/messages?receive_id_type=${target.receiveIdType}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenResult.token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          receive_id: target.receiveId,
          msg_type: "text",
          content: JSON.stringify({
            text: input.content,
          }),
        }),
      },
    );

    const payload = await response.json() as Record<string, any>;
    if (!response.ok || payload?.code !== 0) {
      return {
        delivered: false,
        transport: "none",
        reason: "send_failed",
        errorMessage: `Feishu message send failed (status=${response.status}, code=${String(payload?.code ?? "")})`,
        receiveIdType: target.receiveIdType,
        receiveId: target.receiveId,
      };
    }

    return {
      delivered: true,
      transport: "feishu-openapi-direct",
      receiveIdType: target.receiveIdType,
      receiveId: target.receiveId,
      messageId: normalizeString(payload?.data?.message_id) || undefined,
    };
  } catch (error: any) {
    return {
      delivered: false,
      transport: "none",
      reason: "send_failed",
      errorMessage: error?.message ?? String(error),
      receiveIdType: target.receiveIdType,
      receiveId: target.receiveId,
    };
  }
}

export function resetDirectFeishuApprovalDeliveryForTests(): void {
  tenantAccessTokenCache.clear();
}
