
import { homedir } from "os";
import { join, resolve, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, lstatSync, copyFileSync } from "fs";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getCacheDir(): string {
  const home = homedir();
  return join(home, CONFIG.CACHE_DIR);
}

export function getUserIdFile(): string {
  return join(getCacheDir(), CONFIG.ID_FILE);
}

export function generateUserId(): string {
  // Format: LYNX00 (6 chars) + 8 digits (timestamp) + 4 digits (random)
  // Total length: 18 chars
  const prefix = "LYNX00";
  
  // 8 digits timestamp: YYYYMMDD
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const timestamp = `${year}${month}${day}`;

  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `${prefix}${timestamp}${random}`;
}

export function ensureUserRegistered(): string {
  const cacheDir = getCacheDir();
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  const idFile = getUserIdFile();
  if (existsSync(idFile)) {
    return readFileSync(idFile, "utf-8").trim();
  }

  const newId = generateUserId();
  writeFileSync(idFile, newId, "utf-8");
  return newId;
}

function resolveSessionsDir(): string {
  const home = homedir();
  const candidates = [
    join(home, ".openclaw/agents/main/sessions"),
    "/root/.openclaw/agents/main/sessions",
    "/home/clawdbot/.openclaw/agents/main/sessions",
  ];
  for (const dir of candidates) {
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) {
        return dir;
      }
    } catch {
      /* try next */
    }
  }
  return candidates[0]; // fallback
}

export function readRecentContext(_sessionKey?: string): string {
  try {
    const sessDir = resolveSessionsDir();
    if (!existsSync(sessDir)) return "(no session context available)";

    const files = readdirSync(sessDir)
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => ({ name: f, mtime: statSync(join(sessDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return "(no session context available)";

    const latest = join(sessDir, files[0].name);
    const raw = readFileSync(latest, "utf-8");
    const lines = raw.split("\n").slice(-50); // Get last 50 lines

    const userMessages: string[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const msg = entry.message ?? entry;
        if (msg.role === "user") {
          let text = "";
          if (typeof msg.content === "string") {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            text = msg.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join(" ");
          }
          
          if (text && text.trim()) userMessages.push(text.trim().slice(0, 500));
        }
      } catch {
        /* ignore invalid lines */
      }
    }

    return userMessages.join("\n");
  } catch (err) {
    return "(error reading context)";
  }
}

function copyFolderRecursiveSync(source: string, target: string) {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }

  if (lstatSync(source).isDirectory()) {
    const files = readdirSync(source);
    files.forEach((file) => {
      const curSource = join(source, file);
      const curTarget = join(target, file);
      if (lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, curTarget);
      } else {
        copyFileSync(curSource, curTarget);
      }
    });
  }
}

export function ensureResources() {
  const home = homedir();
  const openclawDir = join(home, ".openclaw");
  const hooksDir = join(openclawDir, "hooks");
  const skillsDir = join(openclawDir, "skills");

  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }

  // Assuming we are running from dist/index.js (bundled) or src/utils.ts (ts-node)
  // We need to find the project root where hooks/ and skills/ are located.
  let projectRoot = __dirname;
  
  // 1. Check if hooks/ exists in current directory (dist/hooks case)
  if (existsSync(join(projectRoot, "hooks"))) {
    // Found it in current directory (e.g. dist/)
  } else {
    // 2. Check parent directory (dev case: src/../hooks)
    projectRoot = resolve(__dirname, "..");
    if (!existsSync(join(projectRoot, "hooks"))) {
       // 3. Check one more level up just in case
       projectRoot = resolve(projectRoot, "..");
    }
  }

  const sourceHooksDir = join(projectRoot, "hooks", "lynx-guardian-sensitiveData");
  const sourceSkillsDir = join(projectRoot, "skills", "lynx-guardian-lesson");

  const targetHooksPath = join(hooksDir, "lynx-guardian-sensitiveData");
  const targetSkillsPath = join(skillsDir, "lynx-guardian-lesson");

  // Copy hooks if not exists
  if (existsSync(sourceHooksDir) && !existsSync(targetHooksPath)) {
    try {
      copyFolderRecursiveSync(sourceHooksDir, targetHooksPath);
    } catch (e) {
      console.error(`[lynx-guardian] Failed to copy hooks: ${e}`);
    }
  }

  // Copy skills if not exists
  if (existsSync(sourceSkillsDir) && !existsSync(targetSkillsPath)) {
    try {
      copyFolderRecursiveSync(sourceSkillsDir, targetSkillsPath);
    } catch (e) {
      console.error(`[lynx-guardian] Failed to copy skills: ${e}`);
    }
  }
}
