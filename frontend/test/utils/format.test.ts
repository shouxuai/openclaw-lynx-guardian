import { describe, expect, it } from "vitest";

import { formatCompactTokens, formatInteger } from "../../src/utils/format";

describe("formatCompactTokens", () => {
  it("keeps small token values exact", () => {
    expect(formatCompactTokens(0)).toBe("0");
    expect(formatCompactTokens(72)).toBe("72");
    expect(formatCompactTokens(999)).toBe("999");
  });

  it("rounds positive fractional values before compact formatting", () => {
    expect(formatCompactTokens(1.6)).toBe("2");
  });

  it("formats thousands and millions with compact units", () => {
    expect(formatCompactTokens(1_000)).toBe("1.0K");
    expect(formatCompactTokens(64_306)).toBe("64.3K");
    expect(formatCompactTokens(2_170_856)).toBe("2.2M");
  });

  it("promotes rounded million boundary values", () => {
    expect(formatCompactTokens(999_950)).toBe("1.0M");
    expect(formatCompactTokens(999_999)).toBe("1.0M");
  });

  it("rounds invalid or negative values into the token display domain", () => {
    expect(formatCompactTokens(Number.NaN)).toBe("0");
    expect(formatCompactTokens(-5)).toBe("0");
  });

  it("keeps exact integer formatting available for titles", () => {
    expect(formatInteger(2_170_856)).toBe("2,170,856");
  });
});
