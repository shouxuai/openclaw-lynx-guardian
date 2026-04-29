import { describe, expect, it, vi } from "vitest";
import {
  clearRequesterProvenanceStore,
  rememberRequesterProvenance,
  readRequesterProvenance,
} from "../src/runtime/requester-provenance-store.js";

describe("requester provenance store", () => {
  it("prefers the freshest record for the same session", () => {
    clearRequesterProvenanceStore();
    const baseTime = Date.now();
    rememberRequesterProvenance({
      sessionKey: "sess-group-1",
      channelId: "feishu",
      requesterId: "ou_old",
      requesterOuId: "ou_old",
      accountId: "default",
      conversationId: "chat-1",
      isGroup: true,
      timestamp: baseTime,
    });
    rememberRequesterProvenance({
      sessionKey: "sess-group-1",
      channelId: "feishu",
      requesterId: "ou_owner",
      requesterOuId: "ou_owner",
      accountId: "default",
      conversationId: "chat-1",
      isGroup: true,
      timestamp: baseTime + 1,
    });

    expect(
      readRequesterProvenance({ sessionKey: "sess-group-1", channelId: "feishu" }),
    ).toMatchObject({
      requesterOuId: "ou_owner",
      timestamp: baseTime + 1,
    });
  });

  it("returns undefined after the record TTL passes", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-15T00:00:00Z"));
      rememberRequesterProvenance({
        sessionKey: "sess-expired",
        channelId: "feishu",
        requesterId: "ou_expired",
        requesterOuId: "ou_expired",
        accountId: "default",
        conversationId: "chat-expired",
        isGroup: true,
        timestamp: Date.now(),
      });
      vi.setSystemTime(new Date("2026-04-15T00:20:00Z"));

      expect(
        readRequesterProvenance({ sessionKey: "sess-expired", channelId: "feishu" }),
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
