import { existsSync, mkdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const DEFAULT_LOCAL_CONSOLE_PORT = 31789;

export interface LocalConsoleBackendConfig {
  host: string;
  listenHost: string;
  port: number;
  dataDir: string;
  databasePath: string;
  ingestToken: string;
  tokenPath: string;
  frontendDistPath: string;
  tokenUsageEnabled: boolean;
  trustedProxyIps: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

function resolveHomeDirectory(): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME;
  if (!homeDir) {
    throw new Error("Unable to resolve the current user's home directory.");
  }
  return homeDir;
}

function expandWindowsHomePlaceholder(value: string): string {
  return value.replace(/%USERPROFILE%/gi, resolveHomeDirectory());
}

function readTokenFromFile(tokenPath: string): string {
  if (!existsSync(tokenPath)) {
    return "";
  }

  return readFileSync(tokenPath, "utf8").trim();
}

function readBooleanFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }

  return fallback;
}

function readStringList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveFrontendDistPath(override: string | undefined, env: NodeJS.ProcessEnv): string {
  if (override) {
    return resolve(override);
  }

  if (env.LYNX_LOCAL_CONSOLE_FRONTEND_DIST_PATH) {
    return resolve(env.LYNX_LOCAL_CONSOLE_FRONTEND_DIST_PATH);
  }

  const candidates = [
    resolve(HERE, "../../frontend/dist"),
    resolve(HERE, "../../../frontend/dist"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function resolveBackendConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<LocalConsoleBackendConfig> = {},
): LocalConsoleBackendConfig {
  const dataDir = resolve(
    overrides.dataDir
      ?? expandWindowsHomePlaceholder(
        env.LYNX_LOCAL_CONSOLE_DATA_DIR ?? "%USERPROFILE%\\.openclaw\\lynx\\data",
      ),
  );
  mkdirSync(dataDir, { recursive: true });

  const tokenPath = resolve(
    overrides.tokenPath
      ?? env.LYNX_LOCAL_CONSOLE_TOKEN_PATH
      ?? join(dataDir, "console.token"),
  );

  const host = overrides.host ?? env.LYNX_LOCAL_CONSOLE_HOST ?? "127.0.0.1";

  return {
    host,
    listenHost: overrides.listenHost ?? env.LYNX_LOCAL_CONSOLE_LISTEN_HOST ?? host,
    port: overrides.port ?? Number.parseInt(env.LYNX_LOCAL_CONSOLE_PORT ?? String(DEFAULT_LOCAL_CONSOLE_PORT), 10),
    dataDir,
    databasePath: resolve(
      overrides.databasePath ?? env.LYNX_LOCAL_CONSOLE_DB_PATH ?? join(dataDir, "lynx.db"),
    ),
    ingestToken: overrides.ingestToken ?? env.LYNX_LOCAL_CONSOLE_TOKEN ?? readTokenFromFile(tokenPath),
    tokenPath,
    frontendDistPath: resolveFrontendDistPath(overrides.frontendDistPath, env),
    tokenUsageEnabled: readBooleanFlag(
      overrides.tokenUsageEnabled ?? env.LYNX_LOCAL_CONSOLE_TOKEN_USAGE_ENABLED,
      false,
    ),
    trustedProxyIps: overrides.trustedProxyIps ?? readStringList(env.LYNX_LOCAL_CONSOLE_TRUSTED_PROXY_IPS),
  };
}
