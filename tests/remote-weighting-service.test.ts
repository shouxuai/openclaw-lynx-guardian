import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkContentWeighted,
  checkPublicAccessWeighted,
  checkToolWeighted,
  fetchMaliciousSkillBlacklistWeighted,
  getWeightedRiskLevel,
  pushRecordBestEffort,
  registerUserBestEffort,
} from "../src/runtime/remote-weighting-service.js";

import {
  checkContent,
  checkPublicAccess,
  checkTool,
  fetchMaliciousSkillBlacklist,
  pushRecord,
  registerUser,
} from "../src/api.js";

vi.mock("../src/api.js", () => ({
  registerUser: vi.fn(),
  checkContent: vi.fn(),
  checkTool: vi.fn(),
  pushRecord: vi.fn(),
  checkPublicAccess: vi.fn(),
  fetchMaliciousSkillBlacklist: vi.fn(),
}));

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("remote-weighting-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unavailable instead of throwing when content check fails", async () => {
    vi.mocked(checkContent).mockRejectedValueOnce(new Error("network down"));

    const result = await checkContentWeighted("lynx-user", "hello", 1);

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "network down",
    });
  });

  it("returns unavailable instead of throwing when public access check fails", async () => {
    vi.mocked(checkPublicAccess).mockRejectedValueOnce(new Error("timeout"));

    const result = await checkPublicAccessWeighted("lynx-user", "1.2.3.4", 18789);

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "timeout",
    });
  });

  it("keeps the local floor when tool weighting has no remote signal", () => {
    const riskLevel = getWeightedRiskLevel({
      localFloor: 3,
      remoteRiskLevel: undefined,
    });

    expect(riskLevel).toBe(3);
  });

  it("raises the final level when remote tool weighting is higher than the local floor", () => {
    const riskLevel = getWeightedRiskLevel({
      localFloor: 2,
      remoteRiskLevel: 4,
    });

    expect(riskLevel).toBe(4);
  });

  it("returns the tool response when remote weighting succeeds", async () => {
    vi.mocked(checkTool).mockResolvedValueOnce({
      code: 0,
      result: {
        is_safe: false,
        risk_level: 2,
        content: "need approval",
      },
      message: "ok",
    });

    const result = await checkToolWeighted("lynx-user", "rm -rf /");

    expect(result).toEqual({
      status: "available",
      value: {
        code: 0,
        result: {
          is_safe: false,
          risk_level: 2,
          content: "need approval",
        },
        message: "ok",
      },
    });
  });

  it("returns unavailable when remote blacklist fetch fails", async () => {
    vi.mocked(fetchMaliciousSkillBlacklist).mockRejectedValueOnce(new Error("503 service unavailable"));

    const result = await fetchMaliciousSkillBlacklistWeighted();

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "503 service unavailable",
    });
  });

  it("logs and returns unavailable when user registration fails", async () => {
    const log = createLogger();
    vi.mocked(registerUser).mockRejectedValueOnce(new Error("register offline"));

    const result = await registerUserBestEffort("lynx-user", log);

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "register offline",
    });
    expect(log.error).toHaveBeenCalledWith(
      "[lynx-guardian] Registration failed: register offline",
    );
  });

  it("logs and returns unavailable when pushRecord fails", async () => {
    const log = createLogger();
    vi.mocked(pushRecord).mockRejectedValueOnce(new Error("push offline"));

    const result = await pushRecordBestEffort(
      {
        id: "lynx-user",
        content: "blocked content",
        riskLevel: 3,
      },
      {
        log,
        context: "blacklist record",
      },
    );

    expect(result).toEqual({
      status: "unavailable",
      errorMessage: "push offline",
    });
    expect(log.error).toHaveBeenCalledWith(
      "[lynx-guardian] Failed to push record (blacklist record): push offline",
    );
  });
});
