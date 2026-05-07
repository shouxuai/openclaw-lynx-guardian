import { describe, expect, it } from "vitest";

import { getGoBuildTargets } from "../scripts/build-local-console-lib.mjs";

describe("Go backend build matrix", () => {
  it("includes every release platform target", () => {
    expect(getGoBuildTargets()).toEqual([
      { platform: "linux", arch: "x64" },
      { platform: "win32", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
    ]);
  });
});
