import { describe, expect, it } from "vitest";

import { RUNTIME_STORE_OWNERSHIP_INVENTORY } from "../src/runtime/runtime-store-ownership.js";

describe("runtime store ownership inventory", () => {
  it("records every Task 11 compatibility store and its active write owner", () => {
    const byFile = new Map(
      RUNTIME_STORE_OWNERSHIP_INVENTORY.map((entry) => [entry.file, entry]),
    );

    expect([...byFile.keys()].sort()).toEqual([
      "approval-grant-store.ts",
      "feishu-local-approval-grant-store.ts",
      "feishu-local-approval-replay-store.ts",
      "feishu-run-continuation-store.ts",
      "local-tool-approval-store.ts",
      "lynx-check-run-store.ts",
      "managed-lynx-check-authorization-store.ts",
      "pending-tool-approval-store.ts",
      "recent-active-delivery.ts",
      "run-approval-context-store.ts",
      "workflow-authorization-store.ts",
    ].sort());

    expect(byFile.get("lynx-check-run-store.ts")).toMatchObject({
      owner: "go-task-plane",
      activeLocalWrites: true,
      goWriteThrough: true,
      preserveForDeliveryBridge: true,
    });
    expect(byFile.get("approval-grant-store.ts")).toMatchObject({
      owner: "go-grant-plane",
      activeLocalWrites: true,
      goWriteThrough: true,
    });
    expect(byFile.get("workflow-authorization-store.ts")).toMatchObject({
      owner: "frozen-compatibility",
      activeLocalWrites: false,
      goWriteThrough: false,
    });
    expect(byFile.get("recent-active-delivery.ts")).toMatchObject({
      owner: "delivery-bridge",
      preserveForDeliveryBridge: true,
    });
  });
});
