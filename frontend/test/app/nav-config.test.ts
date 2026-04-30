import { describe, expect, it } from "vitest";

import { PRIMARY_NAV_GROUPS, PRIMARY_NAV_ITEMS } from "../../src/app/nav-config";

describe("PRIMARY_NAV_ITEMS", () => {
  it("groups navigation by control plane function", () => {
    expect(PRIMARY_NAV_GROUPS.map((group) => group.label)).toEqual([
      "总览",
      "审计",
      "治理",
      "高级诊断",
      "运行",
    ]);
    expect(PRIMARY_NAV_GROUPS.map((group) => group.items.map((item) => item.label))).toEqual([
      ["概览", "问答记录"],
      ["审计日志", "原始审计流水", "决策观测", "工具调用"],
      ["审批管理", "策略配置"],
      ["多轮链路", "链路授权"],
      ["检测报告", "会话", "Skill 供应链", "Token 统计"],
    ]);
  });

  it("matches the control plane observability navigation order", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      "概览",
      "问答记录",
      "审计日志",
      "原始审计流水",
      "决策观测",
      "工具调用",
      "审批管理",
      "策略配置",
      "多轮链路",
      "链路授权",
      "检测报告",
      "会话",
      "Skill 供应链",
      "Token 统计",
    ]);
  });
});
