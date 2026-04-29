import { describe, expect, it } from "vitest";

import { RUNTIME_STORE_OWNERSHIP_INVENTORY } from "../src/runtime/runtime-store-ownership.js";

describe("runtime store ownership inventory", () => {
  it("records every Task 11 compatibility store and its active write owner", () => {
    const byFile = new Map(
      RUNTIME_STORE_OWNERSHIP_INVENTORY.map((entry) => [entry.file, entry]),
    );

    expect([...byFile.keys()].sort()).toEqual([
      "approval/approval-bridge.ts",
      "approval/approval-context.ts",
      "lynx-check-run-store.ts",
      "managed-lynx-check-authorization-store.ts",
      "recent-active-delivery.ts",
    ].sort());

    expect(byFile.get("lynx-check-run-store.ts")).toMatchObject({
      owner: "go-task-plane",
      activeLocalWrites: true,
      goWriteThrough: true,
      preserveForDeliveryBridge: true,
    });
    expect(byFile.get("approval/approval-bridge.ts")).toMatchObject({
      owner: "approval-bridge",
      activeLocalWrites: true,
      goWriteThrough: true,
      preserveForDeliveryBridge: true,
    });
    expect(byFile.get("approval/approval-context.ts")).toMatchObject({
      owner: "approval-bridge",
      activeLocalWrites: true,
      goWriteThrough: false,
      preserveForDeliveryBridge: true,
    });
    expect(byFile.get("recent-active-delivery.ts")).toMatchObject({
      owner: "delivery-bridge",
      preserveForDeliveryBridge: true,
    });
  });
});
