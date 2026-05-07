import { ROUTE_PATHS } from "./route-paths";

export interface NavItem {
  id: string;
  label: string;
  path: string;
  pageTitle: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const PRIMARY_NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "工作台",
    items: [
      {
        id: "dashboard",
        label: "概览",
        path: ROUTE_PATHS.dashboard,
        pageTitle: "安全概览",
      },
      {
        id: "qa-records",
        label: "问答记录",
        path: ROUTE_PATHS.qaRecords,
        pageTitle: "问答记录",
      },
    ],
  },
  {
    id: "audit",
    label: "审计链路",
    items: [
      {
        id: "events",
        label: "审计日志",
        path: ROUTE_PATHS.events,
        pageTitle: "审计日志",
      },
      {
        id: "tool-calls",
        label: "工具调用",
        path: ROUTE_PATHS.toolCalls,
        pageTitle: "工具调用审计",
      },
      {
        id: "chains",
        label: "多轮链路",
        path: ROUTE_PATHS.chains,
        pageTitle: "多轮链路",
      },
    ],
  },
  {
    id: "approval-loop",
    label: "审批闭环",
    items: [
      {
        id: "approvals",
        label: "审批管理",
        path: ROUTE_PATHS.approvals,
        pageTitle: "审批管理",
      },
      {
        id: "decisions",
        label: "决策观测",
        path: ROUTE_PATHS.decisions,
        pageTitle: "决策观测",
      },
      {
        id: "grants",
        label: "放行记录",
        path: ROUTE_PATHS.grants,
        pageTitle: "放行记录",
      },
    ],
  },
  {
    id: "governance",
    label: "治理",
    items: [
      {
        id: "policies",
        label: "策略配置",
        path: ROUTE_PATHS.policies,
        pageTitle: "策略配置",
      },
    ],
  },
  {
    id: "runtime",
    label: "运行资产",
    items: [
      {
        id: "lynx-checks",
        label: "检测报告",
        path: ROUTE_PATHS.lynxChecks,
        pageTitle: "检测报告",
      },
      {
        id: "sessions",
        label: "会话",
        path: ROUTE_PATHS.sessions,
        pageTitle: "会话",
      },
      {
        id: "tokens",
        label: "Token 统计",
        path: ROUTE_PATHS.tokens,
        pageTitle: "Token 统计报表",
      },
      {
        id: "skills",
        label: "Skill 供应链",
        path: ROUTE_PATHS.skills,
        pageTitle: "Skill 供应链",
      },
    ],
  },
];

export const PRIMARY_NAV_ITEMS: NavItem[] = PRIMARY_NAV_GROUPS.flatMap(
  (group) => group.items,
);

export const SECONDARY_NAV_ITEMS: NavItem[] = [
  {
    id: "raw-events",
    label: "原始审计流水",
    path: ROUTE_PATHS.rawEvents,
    pageTitle: "原始审计流水",
  },
];

export const CONSOLE_ROUTE_ITEMS: NavItem[] = [
  ...PRIMARY_NAV_ITEMS,
  ...SECONDARY_NAV_ITEMS,
];
