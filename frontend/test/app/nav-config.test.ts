import { describe, expect, it } from "vitest";

import { PRIMARY_NAV_GROUPS, PRIMARY_NAV_ITEMS } from "../../src/app/nav-config";

describe("PRIMARY_NAV_ITEMS", () => {
  it("groups navigation by control plane function", () => {
    expect(PRIMARY_NAV_GROUPS.map((group) => group.label)).toEqual([
      "总览",
      "审计",
      "治理",
      "运行",
    ]);
    expect(PRIMARY_NAV_GROUPS.map((group) => group.items.map((item) => item.label))).toEqual([
      ["概览"],
      ["审计日志", "决策观测", "工具调用"],
      ["审批管理", "多轮链路", "授权 Grant"],
      ["检查任务", "会话", "Skill 供应链", "Token 统计"],
    ]);
  });

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
      "会话",
      "Skill 供应链",
      "Token 统计",
    ]);
  });
});
