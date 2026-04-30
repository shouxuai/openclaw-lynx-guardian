import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PoliciesPage } from "../../src/pages/PoliciesPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubPolicyOverview(fetchMock?: ReturnType<typeof vi.fn>) {
  const mock = fetchMock ?? vi.fn();
  mock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      if (String(_url).includes("/protected-resources")) {
        return Response.json({
          resourceId: body.resourceId ?? "resource-created",
          version: 10,
          path: body.path,
          preset: body.preset,
          enabled: body.enabled,
          createdBy: body.actorId,
          createdAtMs: 1710000000000,
          updatedAtMs: 1710000000000,
        });
      }

      return Response.json({
        ruleId: body.ruleId ?? `rule-${body.kind}`,
        version: 11,
        kind: body.kind,
        scope: body.scope,
        patternType: body.patternType,
        pattern: body.pattern,
        riskDelta: body.riskDelta,
        enabled: body.enabled,
        createdBy: body.actorId,
        createdAtMs: 1710000000000,
        updatedAtMs: 1710000000000,
      });
    }

    return Response.json({
      currentVersion: 9,
      protectedResources: [
        {
          resourceId: "resource-1",
          version: 9,
          path: "C:\\Users\\alice\\Secrets",
          preset: "read_only",
          enabled: true,
          createdBy: "alice",
          createdAtMs: 1710000000000,
          updatedAtMs: 1710000000000,
        },
      ],
      rules: [
        {
          ruleId: "rule-black",
          version: 8,
          kind: "blacklist",
          scope: "script",
          patternType: "literal",
          pattern: "Invoke-Expression",
          riskDelta: 70,
          enabled: true,
          createdBy: "alice",
          createdAtMs: 1710000000000,
          updatedAtMs: 1710000000000,
        },
        {
          ruleId: "rule-allow",
          version: 9,
          kind: "allowlist",
          scope: "tool",
          patternType: "literal",
          pattern: "npm test",
          riskDelta: -15,
          enabled: true,
          createdBy: "alice",
          createdAtMs: 1710000000000,
          updatedAtMs: 1710000000000,
        },
      ],
    });
  });

  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
}

describe("PoliciesPage", () => {
  it("renders directory protection, blacklist, and allowlist as separate modules", async () => {
    stubPolicyOverview();

    const { container } = render(<PoliciesPage />);

    expect(await screen.findByRole("heading", { name: "目录防护" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "黑名单" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "白名单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加目录防护" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加黑名单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加白名单" })).toBeInTheDocument();
    expect(screen.queryByText("黑白名单规则")).not.toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\alice\\Secrets")).toBeInTheDocument();
    expect(screen.getByText("Invoke-Expression")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /执行/ })).not.toBeInTheDocument();

    const metricLabels = [...container.querySelectorAll(".policy-metrics .metric-card__label")].map((element) => element.textContent);
    expect(metricLabels).toEqual(["目录防护", "黑名单", "白名单", "总数"]);
    expect(container.querySelector(".policy-metrics .summary-card")).toBeNull();
  });

  it("opens independent modal add dialogs and sends the matching policy payloads", async () => {
    const fetchMock = stubPolicyOverview();

    render(<PoliciesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "添加目录防护" }));
    const resourceDialog = await screen.findByRole("dialog", { name: "添加目录防护" });
    expect(resourceDialog.querySelector(".modal-dialog__close")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("目录路径"), {
      target: { value: "D:\\Project\\Protected" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存目录防护" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/protected-resources"), expect.objectContaining({ method: "POST" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "添加黑名单" }));
    expect(await screen.findByRole("dialog", { name: "添加黑名单" })).toHaveClass("modal-dialog");
    fireEvent.change(screen.getByLabelText("黑名单匹配内容"), {
      target: { value: "curl http://evil.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存黑名单" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/policy-rules"),
        expect.objectContaining({
          body: expect.stringContaining('"kind":"blacklist"'),
          method: "POST",
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/policy-rules"),
        expect.objectContaining({
          body: expect.stringContaining('"riskDelta":70'),
          method: "POST",
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "添加白名单" }));
    expect(await screen.findByRole("dialog", { name: "添加白名单" })).toHaveClass("modal-dialog");
    fireEvent.change(screen.getByLabelText("白名单匹配内容"), {
      target: { value: "npm test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存白名单" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/policy-rules"),
        expect.objectContaining({
          body: expect.stringContaining('"kind":"allowlist"'),
          method: "POST",
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/policy-rules"),
        expect.objectContaining({
          body: expect.stringContaining('"riskDelta":-15'),
          method: "POST",
        }),
      );
    });
  });

  it("opens edit modal dialogs with existing values and preserves policy ids in the upsert payload", async () => {
    const fetchMock = stubPolicyOverview();

    render(<PoliciesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "修改目录防护 C:\\Users\\alice\\Secrets" }));
    expect(await screen.findByRole("dialog", { name: "修改目录防护" })).toHaveClass("modal-dialog");
    fireEvent.change(screen.getByLabelText("目录路径"), {
      target: { value: "C:\\Users\\alice\\Secrets2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存目录防护" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/protected-resources"),
        expect.objectContaining({
          body: expect.stringContaining('"resourceId":"resource-1"'),
          method: "POST",
        }),
      );
    });

    fireEvent.click(await screen.findByRole("button", { name: "修改黑名单 Invoke-Expression" }));
    expect(await screen.findByRole("dialog", { name: "修改黑名单" })).toHaveClass("modal-dialog");
    fireEvent.change(screen.getByLabelText("黑名单匹配内容"), {
      target: { value: "Invoke-Expression downloaded payload" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存黑名单" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/policy-rules"),
        expect.objectContaining({
          body: expect.stringContaining('"ruleId":"rule-black"'),
          method: "POST",
        }),
      );
    });
  });
});
