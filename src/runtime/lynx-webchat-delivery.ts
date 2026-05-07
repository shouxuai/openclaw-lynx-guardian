import { dirname, join } from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import type { Message } from "../types.js";
import { normalizeString } from "./plugin-runtime-helpers.js";

type CallGatewayFromCli = (
  method: string,
  opts: {
    url?: string;
    token?: string;
    timeout?: string;
    expectFinal?: boolean;
    json?: boolean;
  },
  params?: unknown,
  extra?: {
    expectFinal?: boolean;
    progress?: boolean;
  },
) => Promise<unknown>;

let injectedGatewayCallerForTests: CallGatewayFromCli | null = null;

function extractTextFromMessageContent(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => (block && typeof block === "object" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function extractInjectableWebchatText(message: Message): string {
  return extractTextFromMessageContent(message.content).trim();
}

export function setLynxWebchatGatewayCallerForTests(
  caller: CallGatewayFromCli | null,
): void {
  injectedGatewayCallerForTests = caller;
}

async function loadCallGatewayFromCli(): Promise<CallGatewayFromCli> {
  if (typeof injectedGatewayCallerForTests === "function") {
    return injectedGatewayCallerForTests;
  }

  const runtimeRequire = createRequire(join(process.cwd(), "package.json"));
  const pluginSdkEntry = runtimeRequire.resolve("openclaw/plugin-sdk");
  const browserSupportUrl = pathToFileURL(join(dirname(pluginSdkEntry), "browser-support.js")).href;
  const browserSupport = await import(browserSupportUrl);
  const browserSupportCallGatewayFromCli = (browserSupport as any).callGatewayFromCli as
    | CallGatewayFromCli
    | undefined;
  if (typeof browserSupportCallGatewayFromCli === "function") {
    return browserSupportCallGatewayFromCli;
  }

  throw new Error("openclaw/plugin-sdk callGatewayFromCli is unavailable in this runtime");
}

export async function injectLynxWebchatReportViaGateway(options: {
  sessionKey?: string;
  message: Message;
  timeoutMs?: number;
}): Promise<void> {
  const sessionKey = normalizeString(options.sessionKey);
  if (!sessionKey) {
    throw new Error("Missing sessionKey for webchat gateway injection");
  }

  const text = extractInjectableWebchatText(options.message);
  if (!text) {
    throw new Error("Webchat gateway injection requires non-empty text content");
  }

  const callGatewayFromCli = await loadCallGatewayFromCli();

  await callGatewayFromCli(
    "chat.inject",
    {
      json: true,
      timeout: String(Math.max(1_000, options.timeoutMs ?? 10_000)),
    },
    {
      sessionKey,
      message: text,
    },
    {
      progress: false,
    },
  );
}
