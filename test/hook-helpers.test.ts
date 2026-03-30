import { describe, expect, it } from "vitest";
import {
  appendDiscoveryReportToMessage,
  decorateAssistantMessage,
} from "../src/message-decoration.js";
import {
  isManualDiscoveryRequest,
} from "../src/discovery-hook-utils.js";
import {
  buildGuardContext,
  redactAgentOutput,
} from "../src/plugin-runtime-helpers.js";

describe("hook helper modules", () => {
  it("decorates the first and last assistant text blocks", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "internal" },
        { type: "text", text: "你好" },
        { type: "tool_result", tool: "x" },
        { type: "text", text: "世界" },
      ],
    };

    expect(decorateAssistantMessage(message)).toBe(message);
  });

  it("appends a discovery report to the last assistant text block", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "internal" },
        { type: "text", text: "检测已完成" },
      ],
    };

    expect(
      appendDiscoveryReportToMessage(
        message,
        "\n---\n📡 Lynx Guardian OpenClaw 服务检测报告\n---\n127.0.0.1:18789",
      ),
    ).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "internal" },
        {
          type: "text",
          text: "检测已完成\n---\n📡 Lynx Guardian OpenClaw 服务检测报告\n---\n127.0.0.1:18789",
        },
      ],
    });
  });

  it("replaces an existing discovery report instead of stacking a second one", () => {
    const message = {
      role: "assistant",
      content: "原始回复\n---\n📡 Lynx Guardian OpenClaw 服务检测报告\n---\n旧报告",
    };

    expect(
      appendDiscoveryReportToMessage(
        message,
        "\n---\n📡 Lynx Guardian OpenClaw 服务检测报告\n---\n新报告",
      ),
    ).toEqual({
      role: "assistant",
      content: "原始回复\n---\n📡 Lynx Guardian OpenClaw 服务检测报告\n---\n新报告",
    });
  });

  it("detects manual discovery requests", () => {
    expect(isManualDiscoveryRequest("/check")).toBe(true);
    expect(isManualDiscoveryRequest("帮我检测 openclaw 网关 ip 端口")).toBe(true);
    expect(isManualDiscoveryRequest("普通聊天")).toBe(false);
  });

  it("builds guard context from event and trusted config", () => {
    expect(
      buildGuardContext(
        {
          selfSafetyGuard: {
            ownerVerification: {
              trustedUserIds: ["owner-1"],
              trustedChannels: ["private-room"],
            },
          },
        },
        {
          sender: { id: "owner-1" },
          channel: "private-room",
        },
        {},
      ),
    ).toEqual({
      verifiedOwner: true,
      requesterId: "owner-1",
      channel: "private-room",
    });
  });

  it("redacts string and block outputs in place", () => {
    const event = {
      output: "secret",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "secret" }],
        },
      ],
    };

    redactAgentOutput(event, "redacted");

    expect(event.output).toBe("redacted");
    expect(event.messages[0].content[0].text).toBe("redacted");
  });
});
