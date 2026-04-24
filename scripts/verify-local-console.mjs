#!/usr/bin/env node

const candidateBaseUrls = process.env.LYNX_LOCAL_CONSOLE_VERIFY_BASE_URL
  ? [process.env.LYNX_LOCAL_CONSOLE_VERIFY_BASE_URL]
  : [
      "http://127.0.0.1:31789",
      "http://127.0.0.1:18789",
    ];

async function checkJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}`);
  }
  return response.json();
}

async function checkWebview(baseUrl) {
  const response = await fetch(`${baseUrl}/webview`);
  if (!response.ok) {
    throw new Error(`/webview returned ${response.status}`);
  }

  const html = await response.text();
  if (!html.includes("<!doctype html")) {
    throw new Error("/webview did not return the frontend HTML shell");
  }
}

let lastError = null;

for (const baseUrl of candidateBaseUrls) {
  try {
    const health = await checkJson(baseUrl, "/lynx/health");
    const capabilities = await checkJson(baseUrl, "/lynx/meta/capabilities");
    await checkWebview(baseUrl);
    console.log("[verify-local-console] baseUrl", baseUrl);
    console.log("[verify-local-console] health", JSON.stringify(health));
    console.log("[verify-local-console] capabilities", JSON.stringify(capabilities));
    process.exit(0);
  } catch (error) {
    lastError = error;
  }
}

console.error(
  `[verify-local-console] ${lastError instanceof Error ? lastError.message : String(lastError)}`,
);
process.exit(1);
