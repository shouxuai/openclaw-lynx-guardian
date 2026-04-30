import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE_FILES_WITH_FILTERS = [
  "ApprovalsPage.tsx",
  "DecisionsPage.tsx",
  "EventsPage.tsx",
  "LynxChecksPage.tsx",
  "QaRecordsPage.tsx",
  "SessionsPage.tsx",
  "SkillsPage.tsx",
  "ToolCallsPage.tsx",
];

function extractAuditFilterForms(source: string): string[] {
  const forms: string[] = [];
  const formStartRe = /<form\b[^>]*className="[^"]*\baudit-filter-form\b[^"]*"[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = formStartRe.exec(source)) !== null) {
    const start = match.index;
    const end = source.indexOf("</form>", formStartRe.lastIndex);
    if (end === -1) {
      throw new Error("Missing </form> for audit-filter-form");
    }
    forms.push(source.slice(start, end));
    formStartRe.lastIndex = end + "</form>".length;
  }

  return forms;
}

describe("filter field order", () => {
  it("keeps dropdown filters before text inputs in every list filter form", async () => {
    const violations: string[] = [];

    for (const fileName of PAGE_FILES_WITH_FILTERS) {
      const source = await readFile(resolve("src/pages", fileName), "utf8");
      const forms = extractAuditFilterForms(source);

      forms.forEach((form, index) => {
        const firstInputIndex = form.indexOf("<Input");
        const selectIndices = [...form.matchAll(/<Select\b/g)].map((match) => match.index ?? -1);
        if (firstInputIndex === -1 || selectIndices.length === 0) {
          return;
        }

        const lateSelectIndex = selectIndices.find((selectIndex) => selectIndex > firstInputIndex);
        if (lateSelectIndex !== undefined) {
          violations.push(`${fileName} form ${index + 1}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
