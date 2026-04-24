#!/usr/bin/env node

import { existsSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";

const rootDir = process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildIfPresent(relativePackageDir) {
  const packageJsonPath = path.join(rootDir, relativePackageDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    console.log(`[build-local-console] skip ${relativePackageDir} (package.json missing)`);
    return;
  }

  console.log(`[build-local-console] build ${relativePackageDir}`);
  run("npm", ["--prefix", relativePackageDir, "run", "build"]);
}

buildIfPresent("shared");
buildIfPresent("backend");
buildIfPresent("frontend");
