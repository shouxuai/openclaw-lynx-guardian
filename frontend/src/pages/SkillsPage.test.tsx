import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillsPage } from "./SkillsPage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SkillsPage", () => {
  it("renders skill inventory with hash mismatch details behind the row action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [
        {
          skillId: "payment-export",
          name: "Payment Export",
          source: "local",
          installPath: "C:/Users/example/.openclaw/skills/payment-export",
          manifestPath: "C:/Users/example/.openclaw/skills/payment-export/SKILL.md",
          hashAlgorithm: "sha256",
          baselineHash: "aaa111",
          currentHash: "bbb222",
          trustState: "hash_mismatch",
          lastSeenAt: "2026-04-28T00:00:00Z",
          findings: [
            {
              findingId: "payment-export:hash_mismatch",
              skillId: "payment-export",
              severity: "critical",
              ruleId: "hash_mismatch",
              message: "Skill current hash does not match its baseline.",
              evidence: {
                baselineHash: "aaa111",
                currentHash: "bbb222",
              },
              createdAt: "2026-04-28T00:00:00Z",
            },
          ],
        },
      ],
    }), { status: 200 })));

    render(<SkillsPage />);

    expect(await screen.findByText("Payment Export")).toBeInTheDocument();
    expect(screen.getAllByText("哈希不一致").length).toBeGreaterThan(0);
    expect(screen.queryByText("Baseline Hash")).not.toBeInTheDocument();
    expect(screen.queryByText("Current Hash")).not.toBeInTheDocument();
    expect(screen.queryByText("aaa111")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 payment-export Skill 详情" }));

    expect(screen.getByRole("dialog", { name: "Skill 详情" })).toBeInTheDocument();
    expect(screen.getByText("aaa111")).toBeInTheDocument();
    expect(screen.getByText("bbb222")).toBeInTheDocument();
  });
});
