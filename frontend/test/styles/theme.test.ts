import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function readThemeCss(): Promise<string> {
  return readFile(resolve("src/styles/theme.css"), "utf8");
}

describe("theme styles", () => {
  it("keeps filter inputs vertically centered inside their 40px border box", async () => {
    const css = await readThemeCss();

    expect(css).toMatch(/\.filter-field > input,\s*\.filter-field > select\s*{[\s\S]*height: 40px;[\s\S]*box-sizing: border-box;[\s\S]*line-height: 20px;/);
    expect(css).toMatch(/\.filter-field \.ant-input-affix-wrapper \.ant-input\s*{[\s\S]*height: auto;[\s\S]*min-height: 0;[\s\S]*line-height: 20px;/);
  });

  it("caps token trend bars so sparse charts do not become full-width columns", async () => {
    const css = await readThemeCss();

    expect(css).toMatch(/\.token-trend-plot\s*{[\s\S]*grid-template-columns: repeat\(var\(--token-trend-slot-count, 7\), minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.token-trend-body\s*{[\s\S]*grid-template-columns: 56px minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.token-trend-y-axis\s*{[\s\S]*justify-content: space-between;/);
    expect(css).toMatch(/\.token-trend-bar\s*{[\s\S]*width: min\(40px, 100%\);[\s\S]*max-width: 40px;/);
    expect(css).toMatch(/\.token-trend-gridline\s*{[\s\S]*border-top: 1px solid rgba\(100, 116, 139, 0\.16\);/);
  });
});
