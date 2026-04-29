import { afterEach, describe, expect, it, vi } from "vitest";

import { buildQueryString } from "../../src/api/client";
import { listLynxChecks } from "../../src/api/lynx-checks";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildQueryString", () => {
  it("encodes arrays and skips empty values", () => {
    expect(buildQueryString({
      limit: 20,
      riskLevel: ["L3", "L4"],
      empty: undefined,
      nullable: null,
      enabled: true,
    })).toBe("?limit=20&riskLevel=L3&riskLevel=L4&enabled=true");
  });

  it("does not mistake /lynx-checks for an already-prefixed /lynx API path", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] })));
    vi.stubGlobal("fetch", fetchMock);

    await listLynxChecks();

    expect(fetchMock).toHaveBeenCalledWith("/lynx/lynx-checks", undefined);
  });
});
