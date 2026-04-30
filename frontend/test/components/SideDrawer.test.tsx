import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SideDrawer } from "../../src/components/feedback/SideDrawer";

describe("SideDrawer", () => {
  afterEach(() => {
    document.body.style.overflow = "";
    document.body.innerHTML = "";
  });

  it("renders as a right-side dialog and locks background scrolling", () => {
    document.body.style.overflow = "auto";

    const { rerender } = render(
      <SideDrawer open title="问答详情" onClose={() => undefined}>
        <p>抽屉内容</p>
      </SideDrawer>,
    );

    expect(screen.getByRole("dialog", { name: "问答详情" })).toHaveClass("side-drawer");
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <SideDrawer open={false} title="问答详情" onClose={() => undefined}>
        <p>抽屉内容</p>
      </SideDrawer>,
    );

    expect(document.body.style.overflow).toBe("auto");
  });

  it("supports a wide drawer variant", () => {
    render(
      <SideDrawer open size="wide" title="问答详情" onClose={() => undefined}>
        <p>抽屉内容</p>
      </SideDrawer>,
    );

    expect(screen.getByRole("dialog", { name: "问答详情" })).toHaveClass("side-drawer--wide");
  });

  it("does not close when the backdrop is clicked unless explicitly enabled", () => {
    const onClose = vi.fn();
    const { container } = render(
      <SideDrawer open title="问答详情" onClose={onClose}>
        <p>抽屉内容</p>
      </SideDrawer>,
    );

    fireEvent.mouseDown(container.querySelector(".side-drawer-backdrop")!);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "问答详情" })).toBeInTheDocument();
  });
});
