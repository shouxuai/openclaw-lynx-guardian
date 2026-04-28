export type RuntimeStoreOwner =
  | "go-grant-plane"
  | "go-task-plane"
  | "approval-bridge"
  | "delivery-bridge"
  | "managed-boundary"
  | "frozen-compatibility";

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
    file: "approval-grant-store.ts",
    owner: "go-grant-plane",
    activeLocalWrites: true,
    goWriteThrough: true,
    preserveForDeliveryBridge: false,
    notes: "Compatibility cache for in-flight approval reuse; allow-current-chain grant writes are also sent to Go.",
  },
  {
    file: "local-tool-approval-store.ts",
    owner: "approval-bridge",
    activeLocalWrites: true,
    goWriteThrough: false,
    preserveForDeliveryBridge: true,
    notes: "Ephemeral local approval prompt/resolution bridge for native and channel approval flows.",
  },
  {
    file: "pending-tool-approval-store.ts",
    owner: "approval-bridge",
    activeLocalWrites: true,
    goWriteThrough: false,
    preserveForDeliveryBridge: true,
    notes: "Ephemeral pending promise bridge while OpenClaw waits for an approval resolution.",
  },
  {
    file: "workflow-authorization-store.ts",
    owner: "frozen-compatibility",
    activeLocalWrites: false,
    goWriteThrough: false,
    preserveForDeliveryBridge: false,
    notes: "Legacy free-text workflow authorization is no longer created from index.ts.",
  },
  {
    file: "run-approval-context-store.ts",
    owner: "approval-bridge",
    activeLocalWrites: true,
    goWriteThrough: false,
    preserveForDeliveryBridge: true,
    notes: "Short-lived context bridge from before_agent_start to before_tool_call.",
  },
  {
    file: "feishu-local-approval-grant-store.ts",
    owner: "approval-bridge",
    activeLocalWrites: true,
    goWriteThrough: false,
    preserveForDeliveryBridge: true,
    notes: "Feishu local-chat approval bridge retained until channel delivery parity is proven.",
  },
  {
    file: "feishu-local-approval-replay-store.ts",
    owner: "approval-bridge",
    activeLocalWrites: true,
    goWriteThrough: false,
    preserveForDeliveryBridge: true,
    notes: "One-shot replay bridge for Feishu approval replies.",
  },
  {
    file: "feishu-run-continuation-store.ts",
    owner: "approval-bridge",
    activeLocalWrites: true,
    goWriteThrough: false,
    preserveForDeliveryBridge: true,
    notes: "Short Feishu continuation window after a local approval grant.",
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
