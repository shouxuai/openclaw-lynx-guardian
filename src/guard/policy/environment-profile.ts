import { homedir, platform as osPlatform } from "os";
import { posix, win32 } from "path";

export type RuntimePlatform =
  | "windows-host"
  | "mac-host"
  | "linux-host"
  | "docker-runtime"
  | "unknown";

export interface EnvironmentProfile {
  platform: RuntimePlatform;
  pluginSourceRoot: string;
  pluginRuntimeRoot: string;
  openclawHome: string;
  workspaceMountRoot: string;
  stateDir: string;
  sessionStoreRoot: string;
}

type PathFlavor = "win32" | "posix";

function normalizeString(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function detectPathFlavor(...candidates: Array<string | undefined>): PathFlavor {
  for (const candidate of candidates) {
    const value = normalizeString(candidate);
    if (!value) {
      continue;
    }

    if (/^[a-zA-Z]:[\\/]/.test(value) || value.includes("\\")) {
      return "win32";
    }
  }

  return "posix";
}

function getPathApi(flavor: PathFlavor) {
  return flavor === "win32" ? win32 : posix;
}

function normalizeAbsolute(flavor: PathFlavor, value: string): string {
  const pathApi = getPathApi(flavor);
  return pathApi.normalize(pathApi.resolve(value));
}

export function buildEnvironmentProfile(input: {
  cwd: string;
  pluginSourceRoot: string;
}): EnvironmentProfile {
  const envHome = normalizeString(process.env.HOME) || normalizeString(process.env.USERPROFILE) || homedir();
  const rawStateDir = normalizeString(process.env.OPENCLAW_STATE_DIR);
  const rawWorkspaceDir = normalizeString(process.env.OPENCLAW_WORKSPACE_DIR);
  const flavor = detectPathFlavor(input.cwd, input.pluginSourceRoot, rawStateDir, rawWorkspaceDir, envHome);
  const pathApi = getPathApi(flavor);

  const pluginRuntimeRoot = normalizeAbsolute(flavor, input.cwd);
  const pluginSourceRoot = normalizeAbsolute(flavor, input.pluginSourceRoot);
  const homeRoot = normalizeAbsolute(flavor, envHome);
  const openclawHome = normalizeAbsolute(flavor, pathApi.join(homeRoot, ".openclaw"));

  let runtimePlatform: RuntimePlatform = "unknown";
  if (pluginRuntimeRoot.startsWith("/app/")) {
    runtimePlatform = "docker-runtime";
  } else if (flavor === "win32" || osPlatform() === "win32") {
    runtimePlatform = "windows-host";
  } else if (osPlatform() === "darwin") {
    runtimePlatform = "mac-host";
  } else if (osPlatform() === "linux") {
    runtimePlatform = "linux-host";
  }

  const stateDir = rawStateDir
    ? normalizeAbsolute(flavor, rawStateDir)
    : openclawHome;
  const workspaceMountRoot = runtimePlatform === "docker-runtime"
    ? normalizeAbsolute(flavor, pathApi.join(openclawHome, "workspace"))
    : rawWorkspaceDir
      ? normalizeAbsolute(flavor, rawWorkspaceDir)
      : normalizeAbsolute(flavor, pathApi.join(openclawHome, "workspace"));

  return {
    platform: runtimePlatform,
    pluginSourceRoot,
    pluginRuntimeRoot,
    openclawHome,
    workspaceMountRoot,
    stateDir,
    sessionStoreRoot: normalizeAbsolute(flavor, pathApi.join(stateDir, "agents", "main", "sessions")),
  };
}
