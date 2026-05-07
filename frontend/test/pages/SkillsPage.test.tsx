import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillsPage } from "../../src/pages/SkillsPage";

function skillListResponse(items: unknown[], sourceBreakdown: unknown[] = []) {
  return {
    items,
    total: items.length,
    pageNum: 1,
    pageSize: 20,
    totalPages: items.length > 0 ? 1 : 0,
    sourceBreakdown,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SkillsPage trust state labels", () => {
  it("separates OpenClaw native skills from other supply-chain channels", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(skillListResponse(
      [
        {
          skillId: "openclaw-plugin-dev-workflow",
          name: "OpenClaw Plugin Dev Workflow",
          source: "openclaw-managed",
          installPath: "/home/node/.openclaw/skills/openclaw-plugin-dev-workflow",
          manifestPath: "/home/node/.openclaw/skills/openclaw-plugin-dev-workflow/SKILL.md",
          hashAlgorithm: "sha256",
          baselineHash: "",
          currentHash: "aaa111",
          trustState: "first_seen",
          lastSeenAt: "2026-05-07T00:00:00Z",
          metadata: {
            inventoryChannel: {
              kind: "native",
              sourceKind: "openclaw-managed",
              scanner: "openclaw-runtime",
            },
          },
          findings: [],
        },
        {
          skillId: "lynx-guardian-lesson",
          name: "Lynx Guardian Lesson",
          source: "openclaw-extension",
          installPath: "/app/dist/extensions/openclaw-lynx-guardian/skills/lynx-guardian-lesson",
          manifestPath: "/app/dist/extensions/openclaw-lynx-guardian/skills/lynx-guardian-lesson/SKILL.md",
          hashAlgorithm: "sha256",
          baselineHash: "",
          currentHash: "bbb222",
          trustState: "first_seen",
          lastSeenAt: "2026-05-07T00:00:00Z",
          metadata: {
            inventoryChannel: {
              kind: "other",
              sourceKind: "openclaw-extension",
              scanner: "file-system",
            },
          },
          findings: [],
        },
      ],
      [
        { sourceKind: "openclaw-managed", count: 3 },
        { sourceKind: "openclaw-extension", count: 15 },
      ],
    )), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillsPage />);

    expect(await screen.findByText("OpenClaw Plugin Dev Workflow")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/skills?pageNum=1&pageSize=20");
    expect(screen.getAllByText("OpenClaw 原生").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("其他渠道").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("原生托管").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("插件扩展").length).toBeGreaterThanOrEqual(1);
    const sourceBreakdown = screen.getByLabelText("Skill 来源分布");
    expect(within(sourceBreakdown).getByText("来源分布")).toBeInTheDocument();
    expect(within(sourceBreakdown).getByText("原生托管")).toBeInTheDocument();
    expect(within(sourceBreakdown).getByText("插件扩展")).toBeInTheDocument();
  });

  it("filters by source kind chips without losing pagination", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(skillListResponse(
        [
          {
            skillId: "openclaw-plugin-dev-workflow",
            name: "OpenClaw Plugin Dev Workflow",
            source: "openclaw-managed",
            installPath: "/home/node/.openclaw/skills/openclaw-plugin-dev-workflow",
            manifestPath: "/home/node/.openclaw/skills/openclaw-plugin-dev-workflow/SKILL.md",
            hashAlgorithm: "sha256",
            baselineHash: "",
            currentHash: "aaa111",
            trustState: "first_seen",
            lastSeenAt: "2026-05-07T00:00:00Z",
            findings: [],
          },
        ],
        [
          { sourceKind: "openclaw-bundled", count: 53 },
          { sourceKind: "openclaw-extension", count: 15 },
          { sourceKind: "openclaw-extra", count: 4 },
          { sourceKind: "openclaw-managed", count: 3 },
          { sourceKind: "local", count: 2 },
        ],
      )), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(skillListResponse(
        [
          {
            skillId: "plugin-extension-skill",
            name: "Plugin Extension Skill",
            source: "openclaw-extension",
            installPath: "/app/dist/extensions/plugin/skills/plugin-extension-skill",
            manifestPath: "/app/dist/extensions/plugin/skills/plugin-extension-skill/SKILL.md",
            hashAlgorithm: "sha256",
            baselineHash: "",
            currentHash: "bbb222",
            trustState: "first_seen",
            lastSeenAt: "2026-05-07T00:00:00Z",
            findings: [],
          },
        ],
        [
          { sourceKind: "openclaw-bundled", count: 53 },
          { sourceKind: "openclaw-extension", count: 15 },
          { sourceKind: "openclaw-extra", count: 4 },
          { sourceKind: "openclaw-managed", count: 3 },
          { sourceKind: "local", count: 2 },
        ],
      )), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillsPage />);

    await screen.findByText("OpenClaw Plugin Dev Workflow");
    fireEvent.click(screen.getByRole("button", { name: "筛选 插件扩展" }));

    await screen.findByText("Plugin Extension Skill");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/skills?sourceKind=openclaw-extension&pageNum=1&pageSize=20");
  });

  it("renders source channel as compact text instead of a wide badge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(skillListResponse(
      [
        {
          skillId: "native-source-row",
          name: "Native Source Row",
          source: "openclaw-bundled",
          installPath: "/app/skills/native-source-row",
          manifestPath: "/app/skills/native-source-row/SKILL.md",
          hashAlgorithm: "sha256",
          baselineHash: "",
          currentHash: "aaa111",
          trustState: "first_seen",
          lastSeenAt: "2026-05-07T00:00:00Z",
          findings: [],
        },
      ],
      [{ sourceKind: "openclaw-bundled", count: 1 }],
    )), { status: 200 })));

    render(<SkillsPage />);

    const skillName = await screen.findByText("Native Source Row");
    const row = skillName.closest("tr");
    expect(row).not.toBeNull();
    const sourceChannel = within(row as HTMLElement).getByText("OpenClaw 原生");
    expect(sourceChannel).toHaveClass("skills-source-cell__channel");
    expect(sourceChannel.closest(".status-badge")).toBeNull();
  });

  it("summarizes findings as compact risk hints and leaves details in the drawer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(skillListResponse(
      [
        {
          skillId: "changed-skill",
          name: "Changed Skill",
          source: "local",
          installPath: "C:/Users/example/.openclaw/skills/changed-skill",
          manifestPath: "C:/Users/example/.openclaw/skills/changed-skill/SKILL.md",
          hashAlgorithm: "sha256",
          baselineHash: "aaa111",
          currentHash: "bbb222",
          trustState: "hash_mismatch",
          lastSeenAt: "2026-05-07T00:00:00Z",
          findings: [
            {
              findingId: "finding-1",
              skillId: "changed-skill",
              severity: "critical",
              ruleId: "hash_mismatch",
              message: "Skill current hash does not match its baseline.",
              createdAt: "2026-05-07T00:00:00Z",
            },
          ],
        },
      ],
    )), { status: 200 })));

    render(<SkillsPage />);

    const skillName = await screen.findByText("Changed Skill");
    const row = skillName.closest("tr");
    expect(row).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "风险摘要" })).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("1 项风险")).toHaveClass("skills-finding-summary--danger");
    expect(within(row as HTMLElement).queryByText("hash_mismatch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 changed-skill Skill 详情" }));

    expect(await screen.findByRole("dialog", { name: "Skill 详情" })).toBeInTheDocument();
    expect(screen.getByText("Skill 概览")).toBeInTheDocument();
    expect(screen.getByText("供应链状态")).toBeInTheDocument();
    expect(screen.getByText("安装位置")).toBeInTheDocument();
    expect(screen.getByText("风险提示")).toBeInTheDocument();
    expect(screen.getByText(/当前哈希与基线不一致/)).toBeInTheDocument();
  });

  it("renders first_seen as a readable non-trusted state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(skillListResponse(
      [
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
    )), { status: 200 })));

    render(<SkillsPage />);

    expect(await screen.findByText("New Local Skill")).toBeInTheDocument();
    const trustBadge = screen.getByText("首次发现");
    expect(trustBadge).toHaveClass("status-badge--warning");
    expect(screen.queryByText("first_seen")).not.toBeInTheDocument();
  });

  it("uses filters and moves hashes/path into skill details", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...skillListResponse([
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
        ]),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...skillListResponse([
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
        ]),
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
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/skills?q=filtered&pageNum=1&pageSize=20");
  });
});
