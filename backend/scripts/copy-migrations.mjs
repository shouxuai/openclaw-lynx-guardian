#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync } from "fs";
import path from "path";

const backendRoot = process.cwd();
const sourceDir = path.join(backendRoot, "src", "db", "migrations");
const targetDir = path.join(backendRoot, "dist", "migrations");

if (!existsSync(sourceDir)) {
  console.log("[copy-migrations] source migrations directory missing, skipping");
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true });
console.log(`[copy-migrations] copied migrations to ${targetDir}`);
