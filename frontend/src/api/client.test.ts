import { describe, expect, it } from "vitest";

import { buildQueryString } from "./client";

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
});
