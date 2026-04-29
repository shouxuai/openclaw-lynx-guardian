import { describe, expect, it } from "vitest";
import { loadDiscoveryRuntimeConfig } from "../src/discovery/discovery-runtime-config.js";

describe("loadDiscoveryRuntimeConfig", () => {
  it("returns defaults when inline config is missing", () => {
    const result = loadDiscoveryRuntimeConfig(undefined);

    expect(result).toEqual({
      enabled: true,
      runOnStartup: false,
      fullScan: false,
      localOnly: false,
    });
  });

  it("merges inline openclawDiscovery config with defaults", () => {
    const result = loadDiscoveryRuntimeConfig({
      fullScan: true,
      localOnly: true,
      targets: ["127.0.0.1:18789"],
      candidatePorts: [18789, 8080],
      timeoutMs: 5000,
    });

    expect(result).toEqual({
      enabled: true,
      runOnStartup: false,
      fullScan: true,
      localOnly: true,
      targets: ["127.0.0.1:18789"],
      candidatePorts: [18789, 8080],
      timeoutMs: 5000,
    });
  });
});
