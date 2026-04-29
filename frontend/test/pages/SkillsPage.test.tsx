import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillsPage } from "../../src/pages/SkillsPage";

afterEach(() => {
  cleanup();
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

  it("uses filters and moves hashes/path into skill details", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          {
            skillId: "skill-1",
            name: "Skill One",
            source: "local",
            installPath: "C:/Users/example/.openclaw/skills/skill-1",
            manifestPath: "C:/Users/example/.openclaw/skills/skill-1/SKILL.md",
            hashAlgorithm: "sha256",
            baselineHash: "aaa111",
            currentHash: "bbb222",
            trustState: "hash_mismatch",
            lastSeenAt: "2026-04-28T00:00:00Z",
            findings: [{ findingId: "finding-1", skillId: "skill-1", severity: "high", ruleId: "hash.changed", message: "changed", createdAt: "2026-04-28T00:00:00Z" }],
          },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          {
            skillId: "skill-filtered",
            name: "Filtered Skill",
            source: "builtin",
            installPath: "C:/Users/example/.openclaw/skills/skill-filtered",
            manifestPath: "C:/Users/example/.openclaw/skills/skill-filtered/SKILL.md",
            hashAlgorithm: "sha256",
            baselineHash: "ccc333",
            currentHash: "ccc333",
            trustState: "trusted",
            lastSeenAt: "2026-04-28T00:00:00Z",
            findings: [],
          },
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillsPage />);

    await screen.findByText("Skill One");
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.getByLabelText("信任状态")).toBeInTheDocument();
    expect(screen.queryByText("Baseline Hash")).not.toBeInTheDocument();
    expect(screen.queryByText("Current Hash")).not.toBeInTheDocument();
    expect(screen.queryByText("安装路径")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 skill-1 Skill 详情" }));
    expect(await screen.findByRole("dialog", { name: "Skill 详情" })).toBeInTheDocument();
    expect(screen.getByText("aaa111")).toBeInTheDocument();
    expect(screen.getByText("C:/Users/example/.openclaw/skills/skill-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "filtered" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("Filtered Skill");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/skills?q=filtered");
  });
});
