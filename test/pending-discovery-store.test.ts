import { mkdtempSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingDiscoveryRequest,
  readPendingDiscoveryRequest,
  shouldAttachPendingDiscoveryReport,
  writePendingDiscoveryRequest,
} from "../src/discovery/pending-discovery-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("pending discovery store", () => {
  it("writes and reads a pending discovery request", () => {
    const dir = mkdtempSync(join(tmpdir(), "lynx-discovery-"));
    tempDirs.push(dir);
    const filePath = join(dir, "pending.json");

    writePendingDiscoveryRequest(filePath, {
      sessionKey: "sess-1",
      userInput: "/lynx-check",
    });

    expect(readPendingDiscoveryRequest(filePath)).toEqual({
      sessionKey: "sess-1",
      userInput: "/lynx-check",
    });
  });

  it("does not attach lynx-check reports through legacy pending discovery", () => {
    const dir = mkdtempSync(join(tmpdir(), "lynx-discovery-"));
    tempDirs.push(dir);
    const filePath = join(dir, "pending.json");

    writePendingDiscoveryRequest(filePath, {
      sessionKey: "sess-1",
      userInput: "/lynx-check",
    });

    expect(shouldAttachPendingDiscoveryReport(filePath, "sess-1")).toBe(false);
    expect(shouldAttachPendingDiscoveryReport(filePath, "sess-2")).toBe(false);
  });

  it("clears a pending discovery request", () => {
    const dir = mkdtempSync(join(tmpdir(), "lynx-discovery-"));
    tempDirs.push(dir);
    const filePath = join(dir, "pending.json");

    writePendingDiscoveryRequest(filePath, {
      sessionKey: "sess-1",
      userInput: "/lynx-check",
    });
    clearPendingDiscoveryRequest(filePath);

    expect(readPendingDiscoveryRequest(filePath)).toBeNull();
  });
});
