import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { resolveBackendConfig } from "../src/config/env.js";

describe("resolveBackendConfig", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("supports a dedicated listen host that differs from the plugin client host", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lynx-console-env-"));
    cleanupDirs.push(dataDir);

    const tokenPath = join(dataDir, "console.token");
    writeFileSync(tokenPath, "test-token\n", "utf8");

    const config = resolveBackendConfig({
      LYNX_LOCAL_CONSOLE_HOST: "127.0.0.1",
      LYNX_LOCAL_CONSOLE_LISTEN_HOST: "0.0.0.0",
      LYNX_LOCAL_CONSOLE_PORT: "31789",
      LYNX_LOCAL_CONSOLE_DATA_DIR: dataDir,
      LYNX_LOCAL_CONSOLE_TOKEN_PATH: tokenPath,
    } as NodeJS.ProcessEnv);

    expect(config.host).toBe("127.0.0.1");
    expect(config.listenHost).toBe("0.0.0.0");
    expect(config.ingestToken).toBe("test-token");
  });
});
