import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModalDialog } from "../../src/components/feedback/ModalDialog";

describe("ModalDialog", () => {
  afterEach(() => {
    document.body.style.overflow = "";
    document.body.innerHTML = "";
  });

  it("locks background scrolling while open and restores the previous body overflow", () => {
    document.body.style.overflow = "auto";

    const { rerender } = render(
      <ModalDialog open title="事件详情" onClose={() => undefined}>
        <p>弹框内容</p>
      </ModalDialog>,
    );

    expect(screen.getByRole("dialog", { name: "事件详情" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <ModalDialog open={false} title="事件详情" onClose={() => undefined}>
        <p>弹框内容</p>
      </ModalDialog>,
    );

    expect(document.body.style.overflow).toBe("auto");
  });
});
