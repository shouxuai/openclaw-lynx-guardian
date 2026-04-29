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
    label: "总览",
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
    label: "审计",
    items: [
      {
        id: "events",
        label: "审计日志",
        path: ROUTE_PATHS.events,
        pageTitle: "审计控制台",
      },
      {
        id: "decisions",
        label: "决策观测",
        path: ROUTE_PATHS.decisions,
        pageTitle: "决策观测",
      },
      {
        id: "tool-calls",
        label: "工具调用",
        path: ROUTE_PATHS.toolCalls,
        pageTitle: "工具调用审计",
      },
    ],
  },
  {
    id: "governance",
    label: "治理",
    items: [
      {
        id: "approvals",
        label: "审批管理",
        path: ROUTE_PATHS.approvals,
        pageTitle: "审批管理",
      },
      {
        id: "chains",
        label: "多轮链路",
        path: ROUTE_PATHS.chains,
        pageTitle: "多轮链路",
      },
      {
        id: "grants",
        label: "授权 Grant",
        path: ROUTE_PATHS.grants,
        pageTitle: "授权 Grant",
      },
    ],
  },
  {
    id: "runtime",
    label: "运行",
    items: [
      {
        id: "lynx-checks",
        label: "检测",
        path: ROUTE_PATHS.lynxChecks,
        pageTitle: "检测",
      },
      {
        id: "sessions",
        label: "会话",
        path: ROUTE_PATHS.sessions,
        pageTitle: "会话",
      },
      {
        id: "skills",
        label: "Skill 供应链",
        path: ROUTE_PATHS.skills,
        pageTitle: "Skill 供应链",
      },
      {
        id: "tokens",
        label: "Token 统计",
        path: ROUTE_PATHS.tokens,
        pageTitle: "Token 统计报表",
      },
    ],
  },
];

export const PRIMARY_NAV_ITEMS: NavItem[] = PRIMARY_NAV_GROUPS.flatMap((group) => group.items);
