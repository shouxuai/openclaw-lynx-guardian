import { appendLocalConsoleWebviewFootnote } from "../runtime/local-console-webview-note.js";

export interface DetailedAuditSection {
  title: string;
  summary: string;
  bullets: string[];
}

export interface DetailedLynxAuditReportInput {
  generatedAt: string;
  overallRating: "高危" | "中高危" | "中危" | "低危";
  executiveSummary: string[];
  sections: [
    DetailedAuditSection,
    DetailedAuditSection,
    DetailedAuditSection,
    DetailedAuditSection,
    DetailedAuditSection,
    DetailedAuditSection,
  ];
  nextActions: string[];
}

const SECTION_LABELS = [
  "二、配置安全",
  "三、网关与执行面安全",
  "四、通道与消息投递安全",
  "五、Skills 与插件代码风险",
  "六、依赖与供应链风险",
  "七、文件权限与敏感路径",
] as const;

export function renderDetailedLynxAuditReport(input: DetailedLynxAuditReportInput): string {
  return appendLocalConsoleWebviewFootnote([
    "# 🛡️ OpenClaw 全方位安全审计报告",
    `生成时间：${input.generatedAt}`,
    `总体评级：${input.overallRating}`,
    "",
    "## 一、执行摘要",
    ...input.executiveSummary.map((line) => `- ${line}`),
    "",
    ...input.sections.flatMap((section, index) => [
      `## ${SECTION_LABELS[index]}`,
      `结论：${section.summary}`,
      ...section.bullets.map((line) => `- ${line}`),
      "",
    ]),
    "## 八、优先级整改建议",
    ...input.nextActions.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n"));
}
