import { describe, expect, it } from "vitest";

import { PRIMARY_NAV_ITEMS } from "./nav-config";

describe("PRIMARY_NAV_ITEMS", () => {
  it("matches the approved Stitch reference navigation order", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      "概览",
      "审计日志",
      "工具调用",
      "审批管理",
      "检查任务",
      "Token 统计",
    ]);
  });
});
