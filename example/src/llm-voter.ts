/**
 * LLM voter — calls a lightweight model to check if user explicitly requested/confirmed
 * the flagged operation. Single job: "Did the user ask for this?"
 *
 * LLM config is read from OpenClaw's own model provider config (api.config.models.providers).
 * No separate API key needed — uses whatever the user already configured.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type Vote = { voter: number; confirmed: boolean; reason: string };
export type VoteResult = { confirmed: boolean; reason: string; votes?: Vote[] };

// ── LLM Config (resolved at init from OpenClaw config) ─────────────

let llmUrl = "";
let llmApiKey = "";
let llmModel = "";
let llmApi: string = "anthropic-messages";
let llmHeaders: Record<string, string> = {};
let llmReady = false;

const LLM_TIMEOUT_MS = 5000;
const LLM_MAX_TOKENS = 200;

// Preferred models for guardian voting (cheap + fast)
const PREFERRED_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-3-5-haiku",
  "claude-3-haiku",
  "gpt-4o-mini",
  "gemini-2.0-flash",
];

/**
 * Initialize LLM config from OpenClaw's provider config.
 * Called once at plugin setup.
 */
export function initLlm(config: Record<string, unknown>): void {
  const providers = (config as Record<string, any>)?.models?.providers;
  if (!providers || typeof providers !== "object") {
    console.error("[guardian] No model providers found in config");
    return;
  }

  // Strategy: find a provider with a cheap/fast model
  for (const preferred of PREFERRED_MODELS) {
    for (const [, provider] of Object.entries(providers) as [string, any][]) {
      if (!provider.baseUrl || !provider.apiKey) continue;
      const models = provider.models ?? [];
      const found = models.find(
        (m: any) => m.id === preferred || m.id?.includes(preferred) || m.name?.includes(preferred),
      );
      if (found) {
        llmUrl = provider.baseUrl.replace(/\/$/, "");
        llmApiKey = provider.apiKey;
        llmModel = found.id;
        llmApi = found.api ?? provider.api ?? "anthropic-messages";
        llmHeaders = { ...provider.headers, ...found.headers };
        llmReady = true;
        console.log(`[guardian] LLM ready: ${llmModel} via ${llmUrl}`);
        return;
      }
    }
  }

  // Fallback: use the first provider with any model
  for (const [, provider] of Object.entries(providers) as [string, any][]) {
    if (!provider.baseUrl || !provider.apiKey) continue;
    const models = provider.models ?? [];
    if (models.length > 0) {
      llmUrl = provider.baseUrl.replace(/\/$/, "");
      llmApiKey = provider.apiKey;
      llmModel = models[0].id;
      llmApi = models[0].api ?? provider.api ?? "anthropic-messages";
      llmHeaders = { ...provider.headers, ...models[0].headers };
      llmReady = true;
      console.log(`[guardian] LLM fallback: ${llmModel} via ${llmUrl}`);
      return;
    }
  }

  console.error("[guardian] No usable LLM provider found");
}

// ── System Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a security confirmation checker for an AI agent.

Your ONLY job is to determine: Did the user explicitly request or confirm this operation?

You will receive:
1. A tool call that was flagged as potentially dangerous
2. Recent conversation messages for context

Rules:
- If the user clearly asked for this operation (e.g., "delete that folder", "remove the old files", "restart the service"), answer YES.
- If the user confirmed after being asked (e.g., "yes", "do it", "confirmed", "go ahead"), answer YES.
- If there is no clear user intent or confirmation for this specific operation, answer NO.
- When in doubt, answer NO.
- Do NOT evaluate whether the operation is dangerous — that's already been determined. You are ONLY checking user intent.

Examples:

User said: "帮我删掉 /data/old-backup 这个文件夹"
Tool: exec, Command: rm -rf /data/old-backup
→ {"confirmed": true, "reason": "User explicitly asked to delete /data/old-backup"}

User said: "看看磁盘空间"
Tool: exec, Command: rm -rf /var/log/old
→ {"confirmed": false, "reason": "User asked about disk space, not file deletion"}

User said: "好的，执行吧"
Tool: exec, Command: sudo systemctl restart nginx
→ {"confirmed": true, "reason": "User said go ahead, confirming the operation"}

User said: "我要重启服务器"
Tool: exec, Command: reboot
→ {"confirmed": true, "reason": "User explicitly requested server reboot"}

User said: "检查一下 nginx 状态"
Tool: exec, Command: systemctl stop nginx
→ {"confirmed": false, "reason": "User asked to check status, not stop the service"}

User said: "yes"
Tool: exec, Command: rm -rf /home/user/project
→ {"confirmed": true, "reason": "User confirmed with yes"}

User said: (no recent messages)
Tool: exec, Command: rm -rf /tmp/cache
→ {"confirmed": false, "reason": "No user messages found to confirm this operation"}

User said: "echo 'rm -rf /' 这个命令很危险"
Tool: exec, Command: rm -rf /
→ {"confirmed": false, "reason": "User was discussing the command as dangerous, not requesting execution"}

Respond with EXACTLY one JSON object:
{"confirmed": true/false, "reason": "brief explanation"}`;

// ── Context Reader ─────────────────────────────────────────────────

function resolveSessionsDir(): string {
  // Try common paths
  const candidates = [
    join(process.env.HOME ?? "/root", ".openclaw/agents/main/sessions"),
    "/root/.openclaw/agents/main/sessions",
    "/home/clawdbot/.openclaw/agents/main/sessions",
  ];
  for (const dir of candidates) {
    try {
      readdirSync(dir);
      return dir;
    } catch {
      /* try next */
    }
  }
  return candidates[0]; // fallback
}

export function readRecentContext(_sessionKey?: string): string {
  try {
    const sessDir = resolveSessionsDir();
    const files = readdirSync(sessDir)
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => ({ name: f, mtime: statSync(join(sessDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return "(no session context available)";

    const latest = join(sessDir, files[0].name);
    const raw = readFileSync(latest, "utf-8");
    const lines = raw.split("\n").slice(-50).join("\n");

    const userMessages: string[] = [];
    for (const line of lines.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const msg = entry.message ?? entry;
        if (msg.role === "user") {
          const text =
            typeof msg.content === "string"
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content
                    .filter((b: any) => b.type === "text")
                    .map((b: any) => b.text)
                    .join(" ")
                : "";
          if (text.trim()) userMessages.push(text.trim().slice(0, 500));
        }
      } catch {
        /* skip malformed lines */
      }
    }

    return userMessages.slice(-3).join("\n---\n") || "(no user messages found)";
  } catch {
    return "(failed to read session context)";
  }
}

// ── LLM Call (supports anthropic-messages and openai-completions) ──

async function callLLM(userPrompt: string): Promise<{ confirmed: boolean; reason: string }> {
  if (!llmReady) throw new Error("LLM not initialized");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    let resp: Response;

    if (llmApi === "anthropic-messages") {
      const endpoint = llmUrl.endsWith("/messages") ? llmUrl : `${llmUrl}/v1/messages`;
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": llmApiKey,
          "anthropic-version": "2023-06-01",
          ...llmHeaders,
        },
        body: JSON.stringify({
          model: llmModel,
          max_tokens: LLM_MAX_TOKENS,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: controller.signal,
      });
    } else {
      // OpenAI-compatible (openai-completions, ollama, etc.)
      const endpoint = llmUrl.endsWith("/chat/completions")
        ? llmUrl
        : `${llmUrl}/v1/chat/completions`;
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${llmApiKey}`,
          ...llmHeaders,
        },
        body: JSON.stringify({
          model: llmModel,
          max_tokens: LLM_MAX_TOKENS,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
    }

    if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
    const data = (await resp.json()) as any;

    // Extract text from either Anthropic or OpenAI response format
    const text = data.content?.[0]?.text ?? data.choices?.[0]?.message?.content ?? "";

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error("No JSON in LLM response");
    const parsed = JSON.parse(jsonMatch[0]);
    return { confirmed: !!parsed.confirmed, reason: parsed.reason ?? "" };
  } finally {
    clearTimeout(timer);
  }
}

// ── Prompt Builder ─────────────────────────────────────────────────

function buildPrompt(toolName: string, params: Record<string, any>, context: string): string {
  const detail =
    toolName === "exec"
      ? `Command: ${params.command ?? "(empty)"}`
      : `File path: ${params.file_path ?? params.path ?? "(empty)"}`;
  return `Flagged tool call:\n- Tool: ${toolName}\n- ${detail}\n\nRecent user messages:\n${context}`;
}

// ── Public API ─────────────────────────────────────────────────────

export async function singleVote(
  toolName: string,
  params: Record<string, any>,
  sessionKey?: string,
): Promise<VoteResult> {
  const context = readRecentContext(sessionKey);
  const prompt = buildPrompt(toolName, params, context);
  try {
    return await callLLM(prompt);
  } catch (e: any) {
    return { confirmed: false, reason: `LLM unavailable: ${e.message}` };
  }
}

export async function multiVote(
  toolName: string,
  params: Record<string, any>,
  sessionKey?: string,
  count = 3,
  threshold = 3,
): Promise<VoteResult & { votes: Vote[] }> {
  const context = readRecentContext(sessionKey);
  const prompt = buildPrompt(toolName, params, context);

  const promises = Array.from({ length: count }, (_, i) =>
    callLLM(prompt)
      .then((r): Vote => ({ voter: i + 1, confirmed: r.confirmed, reason: r.reason }))
      .catch(
        (e: any): Vote => ({ voter: i + 1, confirmed: false, reason: `LLM error: ${e.message}` }),
      ),
  );

  const votes = await Promise.all(promises);
  const yesCount = votes.filter((v) => v.confirmed).length;
  const confirmed = yesCount >= threshold;
  const reason = confirmed
    ? `${yesCount}/${count} voters confirmed user intent`
    : `Only ${yesCount}/${count} confirmed (need ${threshold})`;

  return { confirmed, reason, votes };
}
