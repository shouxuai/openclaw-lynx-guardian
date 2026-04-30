import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PoliciesPage } from "../../src/pages/PoliciesPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PoliciesPage", () => {
  it("renders protected resources and user rules", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init) {
        return Response.json({
          currentVersion: 4,
          protectedResources: [
            {
              resourceId: "resource-1",
              version: 4,
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
              ruleId: "rule-1",
              version: 4,
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
          ],
        });
      }
      return Response.json({});
    }) as unknown as typeof fetch);

    render(<PoliciesPage />);

    expect(await screen.findByText("受保护目录")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\alice\\Secrets")).toBeInTheDocument();
    expect(screen.getByText("Invoke-Expression")).toBeInTheDocument();
    expect(screen.getByText("策略版本 4")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /执行/ })).not.toBeInTheDocument();
  });

  it("creates a read_only protected resource", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({
          resourceId: "resource-created",
          version: 5,
          path: "D:\\Project\\Protected",
          preset: "read_only",
          enabled: true,
          createdBy: "local-user",
          createdAtMs: 1710000000000,
          updatedAtMs: 1710000000000,
        });
      }
      return Response.json({ currentVersion: 4, protectedResources: [], rules: [] });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<PoliciesPage />);
    fireEvent.change(await screen.findByLabelText("目录路径"), {
      target: { value: "D:\\Project\\Protected" },
    });
    fireEvent.change(screen.getByLabelText("权限预设"), {
      target: { value: "read_only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加目录" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/protected-resources"), expect.objectContaining({ method: "POST" }));
    });
  });
});
