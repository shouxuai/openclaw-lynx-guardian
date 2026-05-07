import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

function ensureFileExists(filePath, description) {
  if (!existsSync(filePath)) {
    throw new Error(`Required local console artifact is missing: ${description} (${filePath})`);
  }
}

function copyFile(sourcePath, targetPath) {
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { force: true });
}

function copyDirectory(sourcePath, targetPath) {
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true, force: true });
}

function copyLynxServerExecutables(sourceDir, targetDir) {
  const executableNames = readdirSync(sourceDir)
    .filter((entry) => /^lynx-server-(linux|win32|darwin)-/.test(entry))
    .sort();

  mkdirSync(targetDir, { recursive: true });
  for (const executableName of executableNames) {
    copyFile(join(sourceDir, executableName), join(targetDir, executableName));
  }
}

function buildServerReadme() {
  return [
    "# Lynx Server Package",
    "",
    "This directory contains the compiled Lynx backend and frontend deliverables only.",
    "",
    "## Backend runtime setup",
    "",
    "The backend is a self-contained Go executable:",
    "",
    "```bash",
    "cd backend",
    "./lynx-server-linux-x64",
    "```",
    "",
    "The backend will serve the frontend from `../frontend/dist` automatically when this layout is preserved.",
    "No Node production dependencies are required for the backend.",
    "",
    "This package is built as a multi-platform release bundle and normally includes the Linux, Windows, and macOS backend executables for the supported targets.",
    "",
    "Useful runtime environment variables:",
    "",
    "- `LYNX_LOCAL_CONSOLE_PORT`",
    "- `LYNX_LOCAL_CONSOLE_HOST`",
    "- `LYNX_LOCAL_CONSOLE_DATA_DIR`",
    "- `LYNX_LOCAL_CONSOLE_DB_PATH`",
    "- `LYNX_LOCAL_CONSOLE_FRONTEND_DIST_PATH`",
    "",
    "The runtime selects the matching `lynx-server-<platform>-<arch>` executable automatically.",
    "",
  ].join("\n");
}

export function packageLocalConsoleServer(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(repoRoot, "server"));

  const backendGoDistDir = join(repoRoot, "backend", "dist");
  const backendGoLinuxEntryPath = join(backendGoDistDir, "lynx-server-linux-x64");
  const frontendDistDir = join(repoRoot, "frontend", "dist");
  const frontendIndexPath = join(frontendDistDir, "index.html");

  ensureFileExists(backendGoLinuxEntryPath, "backend/dist/lynx-server-linux-x64");
  ensureFileExists(frontendIndexPath, "frontend/dist/index.html");

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  copyLynxServerExecutables(backendGoDistDir, join(outputDir, "backend"));
  copyDirectory(frontendDistDir, join(outputDir, "frontend", "dist"));
  writeFileSync(join(outputDir, "README.md"), buildServerReadme(), "utf8");

  return {
    outputDir,
    backendDir: join(outputDir, "backend"),
    frontendDir: join(outputDir, "frontend"),
    readmePath: join(outputDir, "README.md"),
  };
}
