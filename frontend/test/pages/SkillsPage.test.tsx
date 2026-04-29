import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillsPage } from "../../src/pages/SkillsPage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SkillsPage trust state labels", () => {
  it("renders first_seen as a readable non-trusted state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [
        {
          skillId: "new-local-skill",
          name: "New Local Skill",
          source: "local",
          installPath: "C:/Users/example/.openclaw/skills/new-local-skill",
          manifestPath: "C:/Users/example/.openclaw/skills/new-local-skill/SKILL.md",
          hashAlgorithm: "sha256",
          baselineHash: "",
          currentHash: "ccc333",
          trustState: "first_seen",
          lastSeenAt: "2026-04-28T00:00:00Z",
          findings: [],
        },
      ],
    }), { status: 200 })));

    render(<SkillsPage />);

    expect(await screen.findByText("New Local Skill")).toBeInTheDocument();
    const trustBadge = screen.getByText("首次发现");
    expect(trustBadge).toHaveClass("status-badge--warning");
    expect(screen.queryByText("first_seen")).not.toBeInTheDocument();
  });
});
