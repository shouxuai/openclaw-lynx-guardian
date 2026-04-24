import type { FilterChip } from "../components/filters/FilterBar";

export const filterPresets: Record<string, FilterChip[]> = {
  events: [
    { label: "范围", value: "近 24 小时" },
    { label: "风险", value: "L2-L4" },
    { label: "触发点", value: "消息 / 工具" },
    { label: "动作", value: "放行 + 告警 + 阻断" },
  ],
  toolCalls: [
    { label: "范围", value: "今天" },
    { label: "工具", value: "高频 6 个工具" },
    { label: "状态", value: "成功 + 暂停" },
  ],
  approvals: [
    { label: "结果", value: "待处理 + 已批准" },
    { label: "模块", value: "M2 / M3" },
    { label: "申请人", value: "所有者范围" },
  ],
  lynxChecks: [
    { label: "触发方式", value: "手动 + 定时" },
    { label: "渠道", value: "飞书 / 网页会话" },
    { label: "状态", value: "运行中 + 已完成" },
  ],
  sessions: [
    { label: "渠道", value: "飞书 + 网页会话" },
    { label: "模式", value: "群聊 + 直达" },
    { label: "窗口", value: "活跃会话" },
  ],
  tokens: [
    { label: "时间窗", value: "最近 3 小时" },
    { label: "提供方", value: "本地网关 + 外部模型" },
    { label: "估算", value: "仅真实记录" },
  ],
};
