#!/usr/bin/env node

import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";

const rootDir = process.cwd();
const requiredProjects = ["backend", "frontend"];

for (const project of requiredProjects) {
  if (!existsSync(path.join(rootDir, project, "package.json"))) {
    console.error(`[start-local-console-dev] missing ${project}/package.json`);
    process.exit(1);
  }
}

const children = requiredProjects.map((project) => {
  const child = spawn("npm", ["--prefix", project, "run", "dev"], {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.exit(code);
    }
  });

  return child;
});

function shutdown(signalCode = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
  process.exit(signalCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
