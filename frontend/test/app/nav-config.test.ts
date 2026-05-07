import { describe, expect, it } from "vitest";

import {
  PRIMARY_NAV_GROUPS,
  PRIMARY_NAV_ITEMS,
} from "../../src/app/nav-config";

describe("PRIMARY_NAV_ITEMS", () => {
  it("groups navigation by control plane function", () => {
    expect(PRIMARY_NAV_GROUPS.map((group) => group.label)).toEqual([
      "工作台",
      "审计链路",
      "审批闭环",
      "治理",
      "运行资产",
    ]);
    expect(
      PRIMARY_NAV_GROUPS.map((group) => group.items.map((item) => item.label)),
    ).toEqual([
      ["概览", "问答记录"],
      ["审计日志", "工具调用", "多轮链路"],
      ["审批管理", "决策观测", "放行记录"],
      ["策略配置"],
      ["检测报告", "会话", "Token 统计", "Skill 供应链"],
    ]);
  });

  it("matches the control plane observability navigation order", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      "概览",
      "问答记录",
      "审计日志",
      "工具调用",
      "多轮链路",
      "审批管理",
      "决策观测",
      "放行记录",
      "策略配置",
      "检测报告",
      "会话",
      "Token 统计",
      "Skill 供应链",
    ]);
  });
});
