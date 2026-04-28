import { ROUTE_PATHS } from "./route-paths";

export interface NavItem {
  id: string;
  label: string;
  path: string;
  pageTitle: string;
}

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "概览",
    path: ROUTE_PATHS.dashboard,
    pageTitle: "安全概览",
  },
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
  {
    id: "lynx-checks",
    label: "检查任务",
    path: ROUTE_PATHS.lynxChecks,
    pageTitle: "检查任务",
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
];
