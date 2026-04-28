#!/usr/bin/env node

import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";

const rootDir = process.cwd();
const goCommand = resolveGoCommand();

function withWindowsComSpec(env = process.env) {
  if (process.platform !== "win32" || env.ComSpec) {
    return env;
  }
  return {
    ...env,
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  };
}

const processes = [
  {
    name: "backend",
    command: goCommand,
    args: ["run", "-mod=vendor", "./cmd/lynx-server"],
    cwd: path.join(rootDir, "backend"),
    requiredFile: path.join(rootDir, "backend", "go.mod"),
    shell: false,
  },
  {
    name: "frontend",
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["--prefix", "frontend", "run", "dev"],
    cwd: rootDir,
    requiredFile: path.join(rootDir, "frontend", "package.json"),
    shell: process.platform === "win32",
  },
];

function resolveGoCommand() {
  const windowsGo = "C:\\Program Files\\Go\\bin\\go.exe";
  if (process.platform === "win32" && existsSync(windowsGo)) {
    return windowsGo;
  }
  return "go";
}

for (const processConfig of processes) {
  if (!existsSync(processConfig.requiredFile)) {
    console.error(`[start-local-console-dev] missing ${processConfig.requiredFile}`);
    process.exit(1);
  }
}

const children = processes.map((processConfig) => {
  const child = spawn(processConfig.command, processConfig.args, {
    cwd: processConfig.cwd,
    stdio: "inherit",
    shell: processConfig.shell,
    env: withWindowsComSpec(),
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[start-local-console-dev] ${processConfig.name} exited with code ${code}`);
      process.exit(code);
    }
  });
  child.on("error", (error) => {
    console.error(`[start-local-console-dev] failed to start ${processConfig.name}: ${error.message}`);
    process.exit(1);
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
