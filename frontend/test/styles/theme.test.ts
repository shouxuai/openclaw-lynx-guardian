import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function readThemeCss(): Promise<string> {
  return readFile(resolve("src/styles/theme.css"), "utf8");
}

function extractCssRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*{([^}]*)}`));
  if (!match) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return match[1];
}

function extractCssRules(css: string, selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escapedSelector}\\s*{([^}]*)}`, "g"))].map((match) => match[1]);
}

describe("theme styles", () => {
  it("keeps the top bar title vertically centered inside the sticky header", async () => {
    const css = await readThemeCss();
    const titleRule = extractCssRule(css, ".topbar__title");
    const dividerRule = extractCssRule(css, ".topbar__divider");
    const eyebrowRule = extractCssRule(css, ".topbar__eyebrow");

    expect(titleRule).toMatch(/(?:^|\n)\s*height: 100%;/);
    expect(titleRule).toContain("margin: 0;");
    expect(titleRule).toContain("align-items: center;");
    expect(dividerRule).toContain("display: inline-flex;");
    expect(dividerRule).toContain("align-items: center;");
    expect(eyebrowRule).toContain("display: inline-flex;");
    expect(eyebrowRule).toContain("align-items: center;");
  });

  it("keeps filter inputs vertically centered inside their 40px border box", async () => {
    const css = await readThemeCss();

    expect(css).toMatch(/\.filter-field > input,\s*\.filter-field > select\s*{[\s\S]*height: 40px;[\s\S]*box-sizing: border-box;[\s\S]*line-height: 20px;/);
    expect(css).toMatch(/\.filter-field \.ant-input-affix-wrapper \.ant-input\s*{[\s\S]*height: auto;[\s\S]*min-height: 0;[\s\S]*line-height: 20px;/);
  });

  it("sizes filter fields by control type instead of first-column position", async () => {
    const css = await readThemeCss();
    const formRule = extractCssRule(css, ".audit-filter-form");
    const compactRule = extractCssRule(css, ".audit-filter-form--compact");
    const selectRule = extractCssRule(css, ".audit-filter-form > .filter-field:has(.ant-select)");

    expect(formRule).toContain("display: flex;");
    expect(formRule).toContain("flex-wrap: wrap;");
    expect(formRule).not.toContain("grid-template-columns");
    expect(compactRule).not.toContain("grid-template-columns");
    expect(extractCssRules(css, ".audit-filter-form").every((rule) => !rule.includes("grid-template-columns"))).toBe(true);
    expect(selectRule).toContain("flex: 1 1 160px;");
    expect(selectRule).toContain("min-width: 150px;");
    expect(selectRule).not.toContain("max-width");
    expect(css).toMatch(/\.audit-filter-form > \.filter-field:has\(\.ant-input-affix-wrapper\),\s*\.audit-filter-form > \.filter-field:has\(> input\)\s*{[\s\S]*flex: 1\.15 1 190px;[\s\S]*min-width: 180px;/);
    expect(css).toMatch(/\.audit-filter-form > \.filter-field--search\s*{[\s\S]*flex: 1\.25 1 220px;[\s\S]*min-width: 200px;/);
    expect(css).toMatch(/\.audit-filter-form > \.filter-field--date-range\s*{[\s\S]*flex: 1\.35 1 260px;[\s\S]*min-width: 240px;/);
  });

  it("keeps modal dialogs tall enough without a top accent rail", async () => {
    const css = await readThemeCss();
    const dialogRule = extractCssRule(css, ".modal-dialog");
    const headerRule = extractCssRule(css, ".modal-dialog__header");

    expect(dialogRule).toContain("min-height:");
    expect(headerRule).not.toContain("var(--success)");
    expect(css).not.toMatch(/\.modal-dialog__header::before\s*{/);
  });

  it("limits form layouts inside modal dialogs to at most two columns", async () => {
    const css = await readThemeCss();

    expect(css).toMatch(/\.modal-dialog \.audit-filter-form,\s*\.modal-dialog \.audit-filter-form--compact\s*{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.modal-dialog \.filter-field--search\s*{[\s\S]*grid-column: auto;/);
  });

  it("caps token trend bars so sparse charts do not become full-width columns", async () => {
    const css = await readThemeCss();
    const plotRule = extractCssRule(css, ".token-trend-plot");

    expect(plotRule).toContain("grid-template-columns:");
    expect(plotRule).toContain("repeat(");
    expect(plotRule).toContain("var(--token-trend-slot-count, 7)");
    expect(plotRule).toContain("minmax(0, 1fr)");
    expect(css).toMatch(/\.token-trend-body\s*{[\s\S]*grid-template-columns: 56px minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.token-trend-y-axis\s*{[\s\S]*justify-content: space-between;/);
    expect(css).toMatch(/\.token-trend-bar\s*{[\s\S]*width: min\(40px, 100%\);[\s\S]*max-width: 40px;/);
    expect(css).toMatch(/\.token-trend-gridline\s*{[\s\S]*border-top: 1px solid rgba\(100, 116, 139, 0\.16\);/);
  });
});
