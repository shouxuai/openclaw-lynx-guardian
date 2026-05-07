export const GO_BUILD_TARGETS = Object.freeze([
  Object.freeze({ platform: "linux", arch: "x64" }),
  Object.freeze({ platform: "win32", arch: "x64" }),
  Object.freeze({ platform: "darwin", arch: "arm64" }),
  Object.freeze({ platform: "darwin", arch: "x64" }),
]);

export function getGoBuildTargets() {
  return GO_BUILD_TARGETS.map((target) => ({ ...target }));
}

export function toGoOS(platform) {
  if (platform === "win32") {
    return "windows";
  }
  return platform;
}

export function toGoArch(arch) {
  if (arch === "x64") {
    return "amd64";
  }
  return arch;
}

export function buildLynxServerExecutableName(platform, arch) {
  return `lynx-server-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}
