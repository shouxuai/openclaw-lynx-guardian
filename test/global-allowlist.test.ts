import { describe, it, expect } from "vitest";
import {
  GLOBAL_INPUT_ALLOWLIST_RULES,
  matchGlobalInputAllowlistRule,
} from "../src/guard/global-allowlist.js";

describe("global input allowlist", () => {
  it("exposes manual input allowlist rules from a dedicated module", () => {
    expect(GLOBAL_INPUT_ALLOWLIST_RULES.length).toBeGreaterThan(0);
    expect(GLOBAL_INPUT_ALLOWLIST_RULES.some((rule) => rule.id === "official_lynx_guardian_update")).toBe(true);
  });

  it("matches the official Lynx Guardian update request", () => {
    const rule = matchGlobalInputAllowlistRule(
      "请帮我将 Lynx Guardian 插件更新到最新版本并重启openclaw。插件地址：https://github.com/shouxuai/openclaw-lynx-guardian",
    );

    expect(rule?.id).toBe("official_lynx_guardian_update");
  });

  it("does not match the official repo URL without update or install intent", () => {
    const rule = matchGlobalInputAllowlistRule(
      "请帮我重启openclaw。插件地址：https://github.com/shouxuai/openclaw-lynx-guardian",
    );

    expect(rule).toBeNull();
  });

  it("does not match non-official repository URLs", () => {
    const rule = matchGlobalInputAllowlistRule(
      "请帮我将 Lynx Guardian 插件更新到最新版本并重启openclaw。插件地址：https://github.com/example/openclaw-lynx-guardian",
    );

    expect(rule).toBeNull();
  });
});
