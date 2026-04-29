import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deliverLynxFeishuApprovalPromptDirectly,
  resetDirectFeishuApprovalDeliveryForTests,
} from "../src/delivery/message-delivery.js";

describe("lynx feishu direct delivery", () => {
  const runtimeHome = join(process.cwd(), "test-temp", "lynx-feishu-direct-delivery");
  const hostConfigPath = join(runtimeHome, ".openclaw", "openclaw.json");
  const approvalText = "/lynx-approve 000001 allow-once";

  function writeHostFeishuConfig(config: Record<string, unknown>): void {
    mkdirSync(dirname(hostConfigPath), { recursive: true });
    writeFileSync(
      hostConfigPath,
      JSON.stringify({
        channels: {
          feishu: config,
        },
      }, null, 2),
      "utf8",
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubEnv("HOME", runtimeHome);
    vi.stubEnv("USERPROFILE", runtimeHome);
    rmSync(runtimeHome, { recursive: true, force: true });
    resetDirectFeishuApprovalDeliveryForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetDirectFeishuApprovalDeliveryForTests();
    rmSync(runtimeHome, { recursive: true, force: true });
  });

  it("delivers DM approval prompts via Feishu open_id targets", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          tenant_access_token: "tenant-token",
          expire: 7200,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            message_id: "om_msg_1",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as any);

    writeHostFeishuConfig({
      enabled: true,
      appId: "cli_test_app",
      appSecret: "test_secret",
      domain: "feishu",
    });

    const result = await deliverLynxFeishuApprovalPromptDirectly({
      conversationId: "dm:ou_abc123",
      content: approvalText,
    });

    expect(result).toMatchObject({
      delivered: true,
      transport: "feishu-openapi-direct",
      receiveIdType: "open_id",
      receiveId: "ou_abc123",
      messageId: "om_msg_1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain("/auth/v3/tenant_access_token/internal");
    expect(String(fetchMock.mock.calls[1]?.[0] ?? "")).toContain("/im/v1/messages?receive_id_type=open_id");

    const authBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(authBody).toEqual({
      app_id: "cli_test_app",
      app_secret: "test_secret",
    });

    const sendBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}"));
    expect(sendBody.receive_id).toBe("ou_abc123");
    expect(sendBody.msg_type).toBe("text");
    expect(JSON.parse(sendBody.content)).toEqual({
      text: approvalText,
    });
  });

  it("fails closed when host feishu config is unavailable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as any);

    const result = await deliverLynxFeishuApprovalPromptDirectly({
      conversationId: "dm:ou_abc123",
      content: approvalText,
    });

    expect(result).toMatchObject({
      delivered: false,
      transport: "none",
      reason: "missing_config",
      configReason: "file_not_found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for malformed dm/user targets instead of falling back to chat_id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as any);
    writeHostFeishuConfig({
      enabled: true,
      appId: "cli_test_app",
      appSecret: "test_secret",
      domain: "feishu",
    });

    const dmMalformed = await deliverLynxFeishuApprovalPromptDirectly({
      conversationId: "dm:chat_123",
      content: approvalText,
    });
    const userMalformed = await deliverLynxFeishuApprovalPromptDirectly({
      conversationId: "user:not_an_open_id",
      content: approvalText,
    });

    expect(dmMalformed).toMatchObject({
      delivered: false,
      transport: "none",
      reason: "malformed_target",
    });
    expect(userMalformed).toMatchObject({
      delivered: false,
      transport: "none",
      reason: "malformed_target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses token only for matching config identity and re-authenticates when config changes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          tenant_access_token: "token-a",
          expire: 7200,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: { message_id: "om_msg_1" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: { message_id: "om_msg_2" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          tenant_access_token: "token-b",
          expire: 7200,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: { message_id: "om_msg_3" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as any);

    writeHostFeishuConfig({
      enabled: true,
      appId: "cli_test_app_a",
      appSecret: "secret_a",
      openBaseUrl: "https://open.feishu.cn",
    });
    const first = await deliverLynxFeishuApprovalPromptDirectly({
      conversationId: "dm:ou_abc123",
      content: approvalText,
    });
    const secondSameConfig = await deliverLynxFeishuApprovalPromptDirectly({
      conversationId: "dm:ou_abc123",
      content: approvalText,
    });

    writeHostFeishuConfig({
      enabled: true,
      appId: "cli_test_app_b",
      appSecret: "secret_b",
      openBaseUrl: "https://open.larksuite.com",
    });
    const thirdChangedConfig = await deliverLynxFeishuApprovalPromptDirectly({
      conversationId: "dm:ou_abc123",
      content: approvalText,
    });

    expect(first.delivered).toBe(true);
    expect(secondSameConfig.delivered).toBe(true);
    expect(thirdChangedConfig.delivered).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal");
    expect(String(fetchMock.mock.calls[1]?.[0] ?? "")).toContain("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id");
    expect(String(fetchMock.mock.calls[2]?.[0] ?? "")).toContain("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id");
    expect(String(fetchMock.mock.calls[3]?.[0] ?? "")).toContain("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal");
    expect(String(fetchMock.mock.calls[4]?.[0] ?? "")).toContain("https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=open_id");

    const firstSendHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    const secondSendHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>;
    const thirdSendHeaders = fetchMock.mock.calls[4]?.[1]?.headers as Record<string, string>;
    expect(String(firstSendHeaders.authorization)).toContain("token-a");
    expect(String(secondSendHeaders.authorization)).toContain("token-a");
    expect(String(thirdSendHeaders.authorization)).toContain("token-b");
  });
});
