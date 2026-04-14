export type ResourceClass =
  | "workspace_code"
  | "state_session"
  | "audit_runtime_resource"
  | "credential"
  | "external_sink"
  | "unknown";

function normalizeResourcePath(resource: string): string {
  return resource.replace(/\\/g, "/").trim().toLowerCase();
}

function isExternalSink(value: string): boolean {
  return /^(https?|ftp|s3|scp):\/\//.test(value)
    || /^[^/\s]+@[^/\s]+\.[^/\s]+$/.test(value);
}

function isStateSessionPath(value: string): boolean {
  return value.includes("/.openclaw/agents/")
    && value.includes("/sessions/")
    || value.includes("/.openclaw/docker-state/agents/")
    && value.includes("/sessions/");
}

function isAuditRuntimeResource(value: string): boolean {
  return value.endsWith("/openclaw.json")
    || value.includes("/.openclaw/lynx/check-runs/")
    || value.endsWith("/.openclaw/lynx/hook-probe.log");
}

function isCredentialLike(value: string): boolean {
  return /(^|[\/._-])(token|secret|passwd|password|credential|id_rsa|id_ed25519)([\/._-]|$)/.test(value)
    || value.endsWith("/.env");
}

export function classifyResource(resource: string): ResourceClass {
  const normalized = normalizeResourcePath(resource);

  if (!normalized) {
    return "unknown";
  }

  if (isExternalSink(normalized)) {
    return "external_sink";
  }

  if (isStateSessionPath(normalized)) {
    return "state_session";
  }

  if (normalized.includes("/.openclaw/workspace/")) {
    return "workspace_code";
  }

  if (isAuditRuntimeResource(normalized)) {
    return "audit_runtime_resource";
  }

  if (isCredentialLike(normalized)) {
    return "credential";
  }

  return "unknown";
}
