export type RuntimeStoreOwner =
  | "go-task-plane"
  | "approval-bridge"
  | "delivery-bridge"
  | "managed-boundary";

export interface RuntimeStoreOwnershipEntry {
  file: string;
  owner: RuntimeStoreOwner;
  activeLocalWrites: boolean;
  goWriteThrough: boolean;
  preserveForDeliveryBridge: boolean;
  notes: string;
}

export const RUNTIME_STORE_OWNERSHIP_INVENTORY: RuntimeStoreOwnershipEntry[] = [
  {
    file: "approval/approval-bridge.ts",
    owner: "approval-bridge",
    activeLocalWrites: true,
    goWriteThrough: true,
    preserveForDeliveryBridge: true,
    notes: "Consolidated approval bridge for local approval promises, Feishu replay windows, compatibility grants, and Go grant write-through.",
  },
  {
    file: "approval/approval-context.ts",
    owner: "approval-bridge",
    activeLocalWrites: true,
    goWriteThrough: false,
    preserveForDeliveryBridge: true,
    notes: "Short-lived context bridge from before_agent_start to before_tool_call plus requester provenance exports.",
  },
  {
    file: "lynx-check-run-store.ts",
    owner: "go-task-plane",
    activeLocalWrites: true,
    goWriteThrough: true,
    preserveForDeliveryBridge: true,
    notes: "Local intent/result artifacts remain compatibility evidence while task state is written through to Go.",
  },
  {
    file: "managed-lynx-check-authorization-store.ts",
    owner: "managed-boundary",
    activeLocalWrites: true,
    goWriteThrough: false,
    preserveForDeliveryBridge: true,
    notes: "Local managed-run boundary authorization is separate from Go task ownership.",
  },
  {
    file: "recent-active-delivery.ts",
    owner: "delivery-bridge",
    activeLocalWrites: true,
    goWriteThrough: false,
    preserveForDeliveryBridge: true,
    notes: "Channel route recovery remains plugin-owned until Feishu/webchat parity is proven by runtime logs.",
  },
];
