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
    path: "/",
    pageTitle: "安全概览",
  },
  {
    id: "events",
    label: "审计日志",
    path: "/events",
    pageTitle: "审计控制台",
  },
  {
    id: "tool-calls",
    label: "工具调用",
    path: "/tool-calls",
    pageTitle: "工具调用审计",
  },
  {
    id: "approvals",
    label: "审批管理",
    path: "/approvals",
    pageTitle: "审批管理",
  },
  {
    id: "lynx-checks",
    label: "检查任务",
    path: "/lynx-checks",
    pageTitle: "检查任务",
  },
  {
    id: "tokens",
    label: "Token 统计",
    path: "/tokens",
    pageTitle: "Token 统计报表",
  },
];
