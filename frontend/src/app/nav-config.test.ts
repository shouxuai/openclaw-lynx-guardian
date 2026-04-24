import { describe, expect, it } from "vitest";

import { PRIMARY_NAV_ITEMS } from "./nav-config";

describe("PRIMARY_NAV_ITEMS", () => {
  it("matches the approved static-page navigation order", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      "总览",
      "事件",
      "工具调用",
      "审批",
      "巡检",
      "会话",
      "令牌",
    ]);
  });
});
