
import { homedir, platform, networkInterfaces } from "os";
import { join, resolve, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, lstatSync, copyFileSync, rmSync } from "fs";
import path from "path";
import { execSync, execFileSync, spawnSync } from "child_process";
import { fileURLToPath, URL } from "url";
import { promises as dns } from "dns";
import * as http from "http";
import * as https from "https";
import { Buffer } from "buffer";
import { LYNX_RESOURCE_CONFIG } from "./runtime/resource-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getCacheDir(): string {
  const home = homedir();
  return join(home, LYNX_RESOURCE_CONFIG.CACHE_DIR);
}

export function getUserIdFile(): string {
  return join(getCacheDir(), LYNX_RESOURCE_CONFIG.ID_FILE);
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

function findStalePluginManagedDirectories(sourceNames: string[], targetNames: string[]): string[] {
  const sourceNameSet = new Set(sourceNames.map((name) => name.trim()).filter(Boolean));

  return targetNames
    .map((name) => name.trim())
    .filter((name) => name.startsWith("lynx-guardian-") && !sourceNameSet.has(name))
    .sort();
}

function syncNamedDirectories(sourceRoot: string, targetRoot: string) {
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    return;
  }

  if (!existsSync(targetRoot)) {
    mkdirSync(targetRoot, { recursive: true });
  }

  const entries = readdirSync(sourceRoot, { withFileTypes: true });
  const sourceDirectoryNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const targetDirectoryNames = readdirSync(targetRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const staleDirectoryName of findStalePluginManagedDirectories(sourceDirectoryNames, targetDirectoryNames)) {
    rmSync(join(targetRoot, staleDirectoryName), { recursive: true, force: true });
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);
    rmSync(targetPath, { recursive: true, force: true });
    copyFolderRecursiveSync(sourcePath, targetPath);
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

  const sourceHooksRoot = join(projectRoot, "hooks");
  const sourceSkillsRoot = join(projectRoot, "skills");

  try {
    syncNamedDirectories(sourceHooksRoot, hooksDir);
  } catch (e) {
    console.error(`[lynx-guardian] Failed to sync hooks: ${e}`);
  }

  try {
    syncNamedDirectories(sourceSkillsRoot, skillsDir);
  } catch (e) {
    console.error(`[lynx-guardian] Failed to sync skills: ${e}`);
  }
}

function getOpenClawPort() {
  const configPath = path.join(
    homedir(),
    ".openclaw",
    "openclaw.json"
  );
  try {
    const config = JSON.parse(
      readFileSync(configPath, "utf8")
    );
    return config?.gateway?.port ?? 18789;
  } catch {
    return 18789;
  }
}

function isPrivateIp(ip: string): boolean {
  if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return false;
  }
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("127.")) {
    return true;
  }
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function numberToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function netmaskToPrefix(netmask: string): number | null {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(netmask)) {
    return null;
  }

  const binary = netmask
    .split(".")
    .map((part) => Number(part).toString(2).padStart(8, "0"))
    .join("");

  if (!/^1*0*$/.test(binary)) {
    return null;
  }

  return binary.indexOf("0") === -1 ? 32 : binary.indexOf("0");
}

function buildIpv4Cidr(address: string, netmask: string): string | null {
  const prefix = netmaskToPrefix(netmask);
  if (prefix === null) {
    return null;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipv4ToNumber(address) & mask;
  return `${numberToIpv4(network)}/${prefix}`;
}

export function listLocalSubnetCidrs(): string[] {
  const interfaces = networkInterfaces();
  const cidrs = new Set<string>();

  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (
        !item
        || item.family !== "IPv4"
        || item.internal
        || !item.address
        || !item.netmask
        || !isPrivateIp(item.address)
      ) {
        continue;
      }

      const cidr = buildIpv4Cidr(item.address, item.netmask);
      if (cidr) {
        cidrs.add(cidr);
      }
    }
  }

  return [...cidrs];
}

function hasCommand(command: string): boolean {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0;
}

function requestTextByCurl(url: string, timeout: number, useProxy: boolean): string | null {
  if (!hasCommand("curl")) {
    return null;
  }
  const args = ["-fsL", "--max-time", String(timeout)];
  if (!useProxy) {
    args.push("--noproxy", "*");
  }
  args.push(url);
  try {
    return execFileSync("curl", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function requestTextByHttp(url: string, timeout: number): Promise<string | null> {
  const client = url.startsWith("https://") ? https : http;
  return new Promise((resolve) => {
    const req = client.get(url, { timeout: timeout * 1000 }, (res: http.IncomingMessage) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8").trim() || null);
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

async function requestText(url: string, timeout = 3, useProxy = true): Promise<string | null> {
  const curlResult = requestTextByCurl(url, timeout, useProxy);
  if (curlResult) {
    return curlResult;
  }
  return requestTextByHttp(url, timeout);
}

async function getPublicIpFromService(): Promise<string | null> {
  const services = [
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
  ];
  for (const url of services) {
    const ip = await requestText(url, 3, true);
    if (ip && !isPrivateIp(ip)) {
      return ip;
    }
  }
  return null;
}

function isProcessRunning(processName: string): boolean {
  const result = spawnSync("pgrep", ["-x", processName], {
    stdio: "ignore",
  });
  return result.status === 0;
}

async function resolveHostIp(host: string): Promise<string | null> {
  try {
    const result = await dns.lookup(host, { family: 4 });
    return result.address || null;
  } catch {
    return null;
  }
}

function extractHost(urlOrHost: string): string | null {
  if (!urlOrHost) {
    return null;
  }
  try {
    if (urlOrHost.includes("://")) {
      return new URL(urlOrHost).host || null;
    }
  } catch {
    return null;
  }
  return urlOrHost.trim() || null;
}

async function detectNgrok(): Promise<[string | null, string | null]> {
  if (!isProcessRunning("ngrok")) {
    return [null, null];
  }
  const response = await requestText("http://127.0.0.1:4040/api/tunnels", 2, false);
  if (!response) {
    return [null, null];
  }
  try {
    const data = JSON.parse(response);
    const tunnels = Array.isArray(data.tunnels) ? data.tunnels : [];
    for (const tunnel of tunnels) {
      const host = extractHost(tunnel.public_url);
      if (host) {
        return [host, await resolveHostIp(host)];
      }
    }
  } catch {
    return [null, null];
  }
  return [null, null];
}

function detectFrp(): string | null {
  if (!isProcessRunning("frpc")) {
    return null;
  }
  const configPaths = ["/etc/frp/frpc.ini", "./frpc.ini"];
  for (const filePath of configPaths) {
    try {
      const content = readFileSync(filePath, "utf8");
      const match = content.match(/^server_addr\s*=\s*(\S+)/m);
      if (match) {
        return match[1].trim();
      }
    } catch {
      continue;
    }
  }
  return null;
}

function getLocalIpFromInterfaces(): string | null {
  const interfaces = networkInterfaces();
  const candidates: string[] = [];
  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (
        item &&
        item.family === "IPv4" &&
        !item.internal &&
        item.address &&
        item.address !== "127.0.0.1"
      ) {
        candidates.push(item.address);
      }
    }
  }
  const privateIp = candidates.find((ip) => isPrivateIp(ip));
  return privateIp || candidates[0] || null;
}

function getLocalIpByIpconfig(interfaceName: string): string | null {
  try {
    const output = execFileSync("ipconfig", ["getifaddr", interfaceName], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output && output !== "127.0.0.1" ? output : null;
  } catch {
    return null;
  }
}

function getLocalIp(): string {
  const interfaceIp = getLocalIpFromInterfaces();
  if (interfaceIp) {
    return interfaceIp;
  }
  for (const name of ["en0", "en1"]) {
    const ip = getLocalIpByIpconfig(name);
    if (ip) {
      return ip;
    }
  }
  return "127.0.0.1";
}

async function getIpAdress(): Promise<string> {
  const [ngrokDomain] = await detectNgrok();
  const frpServer = detectFrp();
  if (ngrokDomain) {
    return ngrokDomain;
  }
  if (frpServer) {
    return frpServer;
  }
  const publicIp = await getPublicIpFromService();
  if (publicIp) {
    return publicIp;
  }
  const localIp = getLocalIp();
  if (localIp !== "127.0.0.1") {
    return localIp;
  }
  return "127.0.0.1";
}

export async function baseIpInfo() {
  const port = getOpenClawPort();
  const run_platform = platform();
  let cmd;

  if (run_platform === "linux") {
    cmd = `ss -lntp | grep ${port}`;
  }

  else if (run_platform === "darwin") {
    cmd = `lsof -i :${port}`;
  }

  else if (run_platform === "win32") {
    cmd = `netstat -ano | findstr ${port}`;
  }
  if (!cmd) return {
    type: "unknown",
    ip: "unknown",
    port
  };
  try {
    const result = execSync(cmd).toString();
    if (result.includes("0.0.0.0") || result.includes(`*:${port}`)) {
      try {
        const ip = await getIpAdress();
        if (ip === "127.0.0.1") {
          return {
            type: "loopback",
            ip: "127.0.0.1",
            port
          };
        }
        return {
          type: "next_check",
          ip,
          port
        }
      } catch (error) {
        return {
          type: "unknown",
          ip: "unknown",
          port
        };
      }
    }
    if (result.includes("127.0.0.1") || result.includes("localhost")) {
      return {
        type: "loopback",
        ip: "127.0.0.1",
        port
      };
    }
    return {
      type: "unknown",
      ip: "unknown",
      port
    };
  } catch {
    return {
      type: "closed",
      ip: "closed",
      port
    };
  }
}

export function extractContentAfterDate(str: string): string {
  if (!str) return '';
  const bracketEndIndex = str.indexOf(']');
  // P0-3: Return full string when no bracket found instead of empty string
  if (bracketEndIndex === -1) {
    return str;
  }
  const content = str.slice(bracketEndIndex + 1).trim();
  return content || str;
}
