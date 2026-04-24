import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

function readTrimmedFile(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }

  return readFileSync(filePath, "utf8").trim();
}

export function readLocalConsoleToken(tokenPath: string): string {
  return readTrimmedFile(tokenPath);
}

export function ensureLocalConsoleToken(tokenPath: string): string {
  const existingToken = readLocalConsoleToken(tokenPath);
  if (existingToken) {
    return existingToken;
  }

  mkdirSync(dirname(tokenPath), { recursive: true });
  const nextToken = randomBytes(24).toString("hex");
  writeFileSync(tokenPath, `${nextToken}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return nextToken;
}

export function createLocalConsoleTokenProvider(tokenPath: string): () => string {
  return () => readLocalConsoleToken(tokenPath);
}
