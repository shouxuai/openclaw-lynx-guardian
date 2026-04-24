import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
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

function buildServerReadme() {
  return [
    "# Lynx Local Console Server Package",
    "",
    "This directory contains the compiled local-console backend and frontend deliverables only.",
    "",
    "## Backend runtime setup",
    "",
    "Install backend production dependencies on the target machine before starting the server:",
    "",
    "```bash",
    "cd backend",
    "npm ci --omit=dev",
    "node dist/main.js",
    "```",
    "",
    "The backend will serve the frontend from `../frontend/dist` automatically when this layout is preserved.",
    "When this package is bundled under the Lynx plugin `server/` directory, the plugin will also try to install",
    "the backend production dependencies automatically on first startup if they are missing.",
    "",
    "Useful runtime environment variables:",
    "",
    "- `LYNX_LOCAL_CONSOLE_PORT`",
    "- `LYNX_LOCAL_CONSOLE_HOST`",
    "- `LYNX_LOCAL_CONSOLE_DATA_DIR`",
    "- `LYNX_LOCAL_CONSOLE_DB_PATH`",
    "- `LYNX_LOCAL_CONSOLE_FRONTEND_DIST_PATH`",
    "",
    "If you are packaging for Linux, do not reuse Windows-built `node_modules`; install dependencies on the target platform.",
    "",
  ].join("\n");
}

export function packageLocalConsoleServer(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(repoRoot, "server"));

  const backendDistDir = join(repoRoot, "backend", "dist");
  const backendEntryPath = join(backendDistDir, "main.js");
  const backendMigrationsDir = join(backendDistDir, "migrations");
  const backendPackageJsonPath = join(repoRoot, "backend", "package.json");
  const backendLockfilePath = join(repoRoot, "backend", "package-lock.json");
  const frontendDistDir = join(repoRoot, "frontend", "dist");
  const frontendIndexPath = join(frontendDistDir, "index.html");

  ensureFileExists(backendEntryPath, "backend/dist/main.js");
  ensureFileExists(join(backendMigrationsDir, "001_init.sql"), "backend/dist/migrations/001_init.sql");
  ensureFileExists(backendPackageJsonPath, "backend/package.json");
  ensureFileExists(backendLockfilePath, "backend/package-lock.json");
  ensureFileExists(frontendIndexPath, "frontend/dist/index.html");

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  copyFile(backendEntryPath, join(outputDir, "backend", "dist", "main.js"));
  copyDirectory(backendMigrationsDir, join(outputDir, "backend", "dist", "migrations"));
  copyFile(backendPackageJsonPath, join(outputDir, "backend", "package.json"));
  copyFile(backendLockfilePath, join(outputDir, "backend", "package-lock.json"));
  copyDirectory(frontendDistDir, join(outputDir, "frontend", "dist"));
  writeFileSync(join(outputDir, "README.md"), buildServerReadme(), "utf8");

  return {
    outputDir,
    backendDir: join(outputDir, "backend"),
    frontendDir: join(outputDir, "frontend"),
    readmePath: join(outputDir, "README.md"),
  };
}
