export interface NavItem {
  id: string;
  label: string;
  path: string;
  description: string;
}

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "总览",
    path: "/",
    description: "查看整体风险态势与最新记录。",
  },
  {
    id: "events",
    label: "事件",
    path: "/events",
    description: "查看统一审计时间线。",
  },
  {
    id: "tool-calls",
    label: "工具调用",
    path: "/tool-calls",
    description: "追踪执行过程与调用风险。",
  },
  {
    id: "approvals",
    label: "审批",
    path: "/approvals",
    description: "查看人工复核与授权状态。",
  },
  {
    id: "lynx-checks",
    label: "巡检",
    path: "/lynx-checks",
    description: "查看巡检运行与投递状态。",
  },
  {
    id: "sessions",
    label: "会话",
    path: "/sessions",
    description: "查看会话健康与历史概况。",
  },
  {
    id: "tokens",
    label: "令牌",
    path: "/tokens",
    description: "查看用量、趋势与效率。",
  },
];
