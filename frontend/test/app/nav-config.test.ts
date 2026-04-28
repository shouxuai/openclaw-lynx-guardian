import { describe, expect, it } from "vitest";

import { PRIMARY_NAV_ITEMS } from "../../src/app/nav-config";

describe("PRIMARY_NAV_ITEMS", () => {
  it("matches the control plane observability navigation order", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      "概览",
      "审计日志",
      "决策观测",
      "工具调用",
      "审批管理",
      "多轮链路",
      "授权 Grant",
      "检查任务",
      "Skill 供应链",
      "Token 统计",
    ]);
  });
});
