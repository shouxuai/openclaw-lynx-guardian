import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";

import {
  clearManagedLynxCheckAuthorization,
  grantManagedLynxCheckAuthorization,
  hasManagedLynxCheckAuthorization,
  readManagedLynxCheckAuthorization,
} from "../src/runtime/managed-lynx-check-authorization-store.js";

describe("managed lynx-check authorization", () => {
  const stubHome = join(process.cwd(), "test-temp", "managed-lynx-check-authorization-home");

  beforeEach(() => {
    vi.stubEnv("HOME", stubHome);
    vi.stubEnv("USERPROFILE", stubHome);
    clearManagedLynxCheckAuthorization();
  });

  it("persists a plugin-granted authorization record", () => {
    grantManagedLynxCheckAuthorization({
      scope: "manual-and-scheduled",
      source: "scheduled-job-create",
    });

    expect(hasManagedLynxCheckAuthorization()).toBe(true);
    expect(readManagedLynxCheckAuthorization()).toEqual(
      expect.objectContaining({
        scope: "manual-and-scheduled",
        source: "scheduled-job-create",
        grantedByPlugin: true,
      }),
    );
  });
});
