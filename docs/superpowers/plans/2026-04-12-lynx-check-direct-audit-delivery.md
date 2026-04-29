# Lynx Check Direct Audit Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/lynx-check` 在手动和定时两条链路上都直接产出完整中文审计报告，去掉 orchestrator 调度依赖，把“`/lynx-check` 命令本身 + 审计报告生成 + 审计报告发送”整体提升为 Lynx Guardian 最高权限白名单动作，确保它们不会再触发 Lynx 插件自身的审批拦截、权限不足弹框或 `Approve with: /approve ... allow-once` 提示，并把报告同时发送到可解析的全部消息通道。

**Architecture:** 保留现有 `intent/result/report` 运行时存储与 `agent_end` 兜底框架，但把执行模型从“注入 orchestrator 技能入口”改为“插件先完成确定性审计数据预计算，再向模型注入按渠道区分的中文写作提示”。同时新增 managed `/lynx-check` 免审授权层：手动 `/lynx-check` 和定时 `/lynx-check` 都被识别为受信任内部工作流，跳过 Lynx 自身的一次性审批链；定时任务在创建或 reconcile 成功时就预注册持久化免审授权，而不是等到第一次执行时再弹授权框。发送链路升级为多目标 fanout：当前会话、近期活跃 WebChat、近期活跃 Feishu 都参与投递，去重后逐个发送，并把每次发送结果写回 run store 以供 `agent_end` 诚实兜底。

**Tech Stack:** TypeScript、OpenClaw plugin hooks、Vitest、PowerShell、Docker OpenClaw dev sync、Lynx run store

---

## File Structure

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
  当前 `/lynx-check` 主入口。负责 `message_received`、`before_agent_start`、`agent_end`、`before_tool_call`、`before_message_write`、`message_sending` 的协同改造。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\manual-lynx-check.ts`
  当前中文报告生成位置。需要从“简短摘要”升级为“完整中文审计报告数据装配器”。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\lynx-check-report-template.ts`
  新文件。只负责详细中文审计报告的章节模板、缺省文案和 Markdown 渲染。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-check-prompt.ts`
  新文件。负责手动/定时两套 prompt、WebChat/Feishu 两类文风提示、禁止路径回显与禁止 orchestrator 调度的约束文案。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-message-delivery.ts`
  现有单目标投递逻辑。需要升级为多目标 fanout 投递，并支持每个 provider 的消息整形。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\recent-active-delivery.ts`
  当前只记录一个 recent-active target。需要改成保留多个 channel target，并对旧单对象格式兼容读取。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-check-run-store.ts`
  现有 run store。需要增加 `deliveryAttempts`，让“全通道发送”的结果可追踪、可回放、可兜底。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\managed-lynx-check-authorization-store.ts`
  新文件。负责持久化 managed `/lynx-check` 的免审授权状态，让定时任务在创建时就完成授权引导，避免运行时再次出现 `Approve with` 或 allow-once 提示。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\plugin-runtime-helpers.ts`
  当前只对白名单读和少量 exec 做 managed `/lynx-check` 放行。需要扩展为读、exec、输出持久化、消息外发四类豁免判定。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\safety-guard.ts`
  需要让 managed `/lynx-check` 的报告生成与发送不再掉进自身拦截链。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\result-guard.ts`
  需要增加受信任上下文参数，允许完整审计报告写入 transcript / tool result 而不被替换。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\workflow-authorization-store.ts`
  现有工作流授权存储。需要评估是否复用其接口，或让它与新的 managed `/lynx-check` 持久化免审授权存储协同。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
  需要补充 managed `/lynx-check` 免审授权相关配置，避免实现只靠硬编码，后续不好验证和回归。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\manual-lynx-check.test.ts`
  详细中文报告模板的主测试文件。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`
  手动/定时 `/lynx-check` 入口、白名单、fanout 投递、兜底发送的主集成测试文件。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\scheduled-lynx-check.test.ts`
  定时任务配置与默认行为测试，后续扩展定时任务完整性断言。
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\managed-lynx-check-authorization.test.ts`
  新文件。专门验证免审授权创建、持久化、加载、撤销和“绝不弹框”的行为。

### Task 1: 把简略摘要升级为完整中文审计报告模板

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\lynx-check-report-template.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\manual-lynx-check.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\manual-lynx-check.test.ts`

- [ ] **Step 1: 先写失败测试，锁定“必须是完整中文审计报告”**

```ts
import { describe, expect, it, vi } from "vitest";
import { buildManualLynxCheckReport } from "../src/discovery/manual-lynx-check.js";

it("renders the mandatory Chinese audit sections for manual /lynx-check", async () => {
  const report = await buildManualLynxCheckReport({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    userId: "TEST_ID",
    ipInfo: { ip: "127.0.0.1", port: 18789, type: "next_check" },
    discoveryConfig: { fullScan: false },
    discoveryRuntimePath: "openclaw.plugin.json",
  });

  expect(report).toContain("# 🛡️ OpenClaw 全方位安全审计报告");
  expect(report).toContain("## 一、执行摘要");
  expect(report).toContain("## 二、配置安全");
  expect(report).toContain("## 三、网关与执行面安全");
  expect(report).toContain("## 四、通道与消息投递安全");
  expect(report).toContain("## 五、Skills 与插件代码风险");
  expect(report).toContain("## 六、依赖与供应链风险");
  expect(report).toContain("## 七、文件权限与敏感路径");
  expect(report).toContain("## 八、优先级整改建议");
});

it("never tells the user to inspect report files or local paths", async () => {
  const report = await buildManualLynxCheckReport({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    userId: "TEST_ID",
    ipInfo: { ip: "127.0.0.1", port: 18789, type: "next_check" },
    discoveryConfig: { fullScan: false },
    discoveryRuntimePath: "openclaw.plugin.json",
  });

  expect(report).not.toMatch(/check-runs|report\.md|result\.json|查看文件|inspect local files/i);
});
```

- [ ] **Step 2: 运行测试，确认它先红**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/manual-lynx-check.test.ts`

Expected: `FAIL`，因为当前报告只有简短摘要结构，没有完整中文章节。

- [ ] **Step 3: 新增独立模板文件，固定章节与缺省文案**

```ts
// src/discovery/lynx-check-report-template.ts
export interface LynxAuditSection {
  title: string;
  summary: string;
  bullets: string[];
}

export interface DetailedLynxAuditReportInput {
  generatedAt: string;
  overallRating: "高危" | "中高危" | "中危" | "低危";
  executiveSummary: string[];
  sections: LynxAuditSection[];
  nextActions: string[];
}

export function renderDetailedLynxAuditReport(input: DetailedLynxAuditReportInput): string {
  return [
    "# 🛡️ OpenClaw 全方位安全审计报告",
    `生成时间：${input.generatedAt}`,
    `总体评级：${input.overallRating}`,
    "",
    "## 一、执行摘要",
    ...input.executiveSummary.map((line) => `- ${line}`),
    "",
    ...input.sections.flatMap((section, index) => [
      `## ${["二", "三", "四", "五", "六", "七"][index]}、${section.title}`,
      `结论：${section.summary}`,
      ...section.bullets.map((line) => `- ${line}`),
      "",
    ]),
    "## 八、优先级整改建议",
    ...input.nextActions.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n");
}
```

- [ ] **Step 4: 让 `manual-lynx-check.ts` 只负责采集数据，不再手写零散文案**

```ts
import { renderDetailedLynxAuditReport } from "./lynx-check-report-template.js";

return renderDetailedLynxAuditReport({
  generatedAt: new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }),
  overallRating,
  executiveSummary: [
    "本次审计由 Lynx Guardian 在插件侧完成确定性预计算后生成。",
    "报告默认直接面向最终用户阅读，不要求用户打开本地文件或工件路径。",
    "若某项数据源不可用，该章节必须明确标注“未能采集”而不是省略。",
  ],
  sections: [
    buildConfigSecuritySection(...),
    buildGatewaySecuritySection(...),
    buildChannelSecuritySection(...),
    buildSkillAndPluginSection(...),
    buildDependencySection(...),
    buildPermissionSection(...),
  ],
  nextActions: buildPrioritizedActions(...),
});
```

- [ ] **Step 5: 再跑一次报告模板测试**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/manual-lynx-check.test.ts`

Expected: `PASS`

- [ ] **Step 6: 提交这个模板基线**

```bash
git add src/discovery/lynx-check-report-template.ts src/discovery/manual-lynx-check.ts test/manual-lynx-check.test.ts
git commit -m "feat: render detailed chinese lynx audit report"
```

### Task 2: 把 `/lynx-check` 从 orchestrator 注入改成“直接学习报告”的双提示词体系

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-check-prompt.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: 先写失败测试，锁定四个关键约束**

```ts
import {
  buildManualLynxCheckPrompt,
  buildScheduledLynxCheckPrompt,
} from "../src/runtime/lynx-check-prompt.js";

it("builds a manual prompt that forbids file-path replies and orchestrator dispatch", () => {
  const prompt = buildManualLynxCheckPrompt({
    reportMarkdown: "# 🛡️ OpenClaw 全方位安全审计报告\n\n## 一、执行摘要\n- ok",
    channel: "webchat",
  });

  expect(prompt).toContain("请直接使用中文回复完整审计报告");
  expect(prompt).toContain("不要让用户查看文件路径");
  expect(prompt).toContain("不要调度 lynx-guardian-check-orchestrator");
  expect(prompt).not.toContain("原样输出到最终回复");
});

it("builds a scheduled prompt with stronger completeness guidance instead of blocked-status boilerplate", () => {
  const prompt = buildScheduledLynxCheckPrompt({
    reportMarkdown: "# 🛡️ OpenClaw 全方位安全审计报告\n\n## 一、执行摘要\n- ok",
    channel: "feishu",
  });

  expect(prompt).toContain("你正在执行定时 /lynx-check");
  expect(prompt).toContain("不得输出 BLOCKED、Approve with、allow-once、allow-always");
  expect(prompt).toContain("如果某章节证据不足，明确写出“未能采集”并保留章节");
  expect(prompt).toContain("优先保证报告完整性，而不是解释执行过程");
});
```

- [ ] **Step 2: 跑测试，确认目前没有这套 prompt builder**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/plugin.test.ts -t "builds a manual prompt|builds a scheduled prompt"`

Expected: `FAIL`

- [ ] **Step 3: 创建新 prompt builder，明确手动/定时和 WebChat/Feishu 的差异化提示**

```ts
// src/runtime/lynx-check-prompt.ts
export type LynxReportChannel = "webchat" | "feishu" | "generic";

export function buildManualLynxCheckPrompt(input: {
  reportMarkdown: string;
  channel: LynxReportChannel;
}): string {
  return [
    "[系统指令] 你正在处理手动触发的 /lynx-check。",
    "请直接使用中文回复完整审计报告，不要让用户查看文件路径，不要省略任何章节。",
    "你的任务是学习下面这份预计算审计结果，并用自然、专业、完整的中文把它表达出来。",
    "不要调度 lynx-guardian-check-orchestrator，不要提及技能调度、report.md、result.json。",
    input.channel === "webchat"
      ? "WebChat 输出适合连续 Markdown 阅读，保留标题、表格和分段。"
      : "Feishu 输出优先保证首屏结论清晰、风险等级明确、整改建议可快速转发。",
    "",
    input.reportMarkdown,
  ].join("\n");
}

export function buildScheduledLynxCheckPrompt(input: {
  reportMarkdown: string;
  channel: LynxReportChannel;
}): string {
  return [
    "[系统指令] 你正在执行定时 /lynx-check。",
    "本次任务必须直接产出完整中文审计报告，不得输出 BLOCKED、Approve with、allow-once、allow-always。",
    "如果有证据不足的章节，写明“未能采集”，但不得删除章节或退化成简讯。",
    "不要让用户查看文件路径，不要提及本地工件，不要调度 lynx-guardian-check-orchestrator。",
    input.channel === "feishu"
      ? "Feishu 版本先给出总体评级、最高优先级问题和立即整改动作，再完整展开全文。"
      : "WebChat 版本保持 Markdown 结构完整，适合直接滚动阅读。",
    "",
    input.reportMarkdown,
  ].join("\n");
}
```

- [ ] **Step 4: 在 `index.ts` 里移除 orchestrator prompt 注入，改为注入预计算报告 prompt**

```ts
if (isManualCompositeLynxCheckRequest(userInput)) {
  const source = resolveManagedLynxCheckSource(ctx);
  const reportMarkdown = await buildManualLynxCheckReport({
    log,
    userId,
    ipInfo,
    publicAccessResult,
    discoveryConfig: openClawDiscoveryConfig,
    discoveryRuntimePath: discoveryRuntime.path,
  });

  const channel = inferPreferredLynxReportChannel(ctx, routeHint);
  prependContext += source === "scheduled"
    ? buildScheduledLynxCheckPrompt({ reportMarkdown, channel })
    : buildManualLynxCheckPrompt({ reportMarkdown, channel });
}
```

- [ ] **Step 5: 把旧 orchestrator 断言改成“直出中文审计报告”断言**

```ts
expect((result as any).prependContext).toContain("请直接使用中文回复完整审计报告");
expect((result as any).prependContext).not.toContain("lynx-guardian-check-orchestrator");
expect((result as any).prependContext).not.toContain("Use the exact audit skill file");
```

- [ ] **Step 6: 重新跑 `/lynx-check` prompt 相关测试**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/plugin.test.ts -t "/lynx-check|prompt"`

Expected: `PASS`

- [ ] **Step 7: 提交 prompt 体系切换**

```bash
git add src/runtime/lynx-check-prompt.ts index.ts test/plugin.test.ts
git commit -m "refactor: replace lynx orchestrator prompt with direct audit prompt"
```

### Task 3: 建立 managed `/lynx-check` 免审授权层，彻底消灭审批弹框

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\managed-lynx-check-authorization-store.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\managed-lynx-check-authorization.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\scheduled-lynx-check.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\plugin-runtime-helpers.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: 先写失败测试，明确 `/lynx-check` 不允许再出现审批弹框或 allow-once 提示**

```ts
import {
  grantManagedLynxCheckAuthorization,
  hasManagedLynxCheckAuthorization,
} from "../src/runtime/managed-lynx-check-authorization-store.js";

it("treats managed /lynx-check as pre-authorized and never returns an approval prompt", async () => {
  setup(mockApi);
  const beforeAgentStart = handlers["before_agent_start"];

  grantManagedLynxCheckAuthorization({
    scope: "manual-and-scheduled",
    source: "scheduled-job-create",
  });

  const result = await beforeAgentStart(
    { prompt: "[2026-04-12 11:20:00] /lynx-check" },
    { sessionKey: "sess-preauthorized-lynx", subsystem: "plugins" },
  );

  expect(hasManagedLynxCheckAuthorization()).toBe(true);
  expect(JSON.stringify(result ?? {})).not.toContain("Approve with");
  expect(JSON.stringify(result ?? {})).not.toContain("allow-once");
  expect(JSON.stringify(result ?? {})).not.toContain("allow-always");
  expect(JSON.stringify(result ?? {})).not.toContain("The /lynx-check command requires approval to run.");
});

it("registers managed /lynx-check authorization when the scheduled job is created", async () => {
  await reconcileScheduledLynxCheck({
    config: { enabled: true, cron: "37 8 * * *", timezone: "Asia/Shanghai" },
    storePath,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    now: 1712880000000,
  });

  expect(hasManagedLynxCheckAuthorization()).toBe(true);
});
```

- [ ] **Step 2: 运行测试，确认当前缺少这个免审授权层**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/managed-lynx-check-authorization.test.ts test/plugin.test.ts -t "approval prompt|pre-authorized|scheduled job is created"`

Expected: `FAIL`

- [ ] **Step 3: 创建持久化授权存储，区分“普通 workflow auth”与“managed /lynx-check 免审授权”**

```ts
// src/runtime/managed-lynx-check-authorization-store.ts
export interface ManagedLynxCheckAuthorization {
  scope: "manual-and-scheduled";
  source: "scheduled-job-create" | "plugin-startup" | "manual-bootstrap";
  grantedAtMs: number;
  grantedByPlugin: true;
}

export function grantManagedLynxCheckAuthorization(input: {
  scope: "manual-and-scheduled";
  source: ManagedLynxCheckAuthorization["source"];
}): ManagedLynxCheckAuthorization {
  const record: ManagedLynxCheckAuthorization = {
    scope: input.scope,
    source: input.source,
    grantedAtMs: Date.now(),
    grantedByPlugin: true,
  };
  writeAuthorization(record);
  return record;
}

export function hasManagedLynxCheckAuthorization(): boolean {
  return readAuthorization()?.grantedByPlugin === true;
}
```

- [ ] **Step 4: 在 `scheduled-lynx-check.ts` 的 create/reconcile 成功路径里预注册免审授权**

```ts
if (resolvedConfig.enabled) {
  nextJobs.push(buildScheduledLynxCheckJob(resolvedConfig, now, existing));
  grantManagedLynxCheckAuthorization({
    scope: "manual-and-scheduled",
    source: "scheduled-job-create",
  });
}
```

- [ ] **Step 5: 在 `index.ts` 的 `/lynx-check` 入口短路所有一票审批文本**

```ts
const isManagedLynxCheck = isManualCompositeLynxCheckRequest(userInput);
const managedLynxCheckPreauthorized = isManagedLynxCheck && hasManagedLynxCheckAuthorization();

if (managedLynxCheckPreauthorized) {
  ctx.managedLynxCheckRun = true;
  ctx.managedLynxCheckPreauthorized = true;
}

// When true, skip savePendingOverrideFull/buildOverridePrompt branches entirely.
if (managedLynxCheckPreauthorized) {
  approvedAgentStartOverride = { trusted: true } as any;
}
```

- [ ] **Step 6: 给配置 schema 增加显式开关，避免实现语义不清**

```json
"managedLynxCheckAuthorization": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "enabled": { "type": "boolean", "default": true },
    "autoGrantOnScheduledJobCreate": { "type": "boolean", "default": true },
    "treatManualLynxCheckAsPreauthorized": { "type": "boolean", "default": true }
  }
}
```

- [ ] **Step 7: 重新跑免审授权相关测试**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/managed-lynx-check-authorization.test.ts test/plugin.test.ts test/scheduled-lynx-check.test.ts`

Expected: `PASS`

- [ ] **Step 8: 提交免审授权层**

```bash
git add src/runtime/managed-lynx-check-authorization-store.ts src/runtime/scheduled-lynx-check.ts src/runtime/plugin-runtime-helpers.ts index.ts openclaw.plugin.json test/managed-lynx-check-authorization.test.ts test/plugin.test.ts
git commit -m "feat: pre-authorize managed lynx-check without approval prompts"
```

### Task 4: 把“生成并发送审计报告”提升为 managed `/lynx-check` 最高权限白名单

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\plugin-runtime-helpers.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\safety-guard.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\result-guard.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: 先写失败测试，覆盖读、exec、持久化、外发四类白名单**

```ts
it("does not ask for confirmation when managed /lynx-check writes or sends the final audit report", async () => {
  setup(mockApi);
  const beforeAgentStart = handlers["before_agent_start"];
  const beforeMessageWrite = handlers["before_message_write"];
  const messageSending = handlers["message_sending"];

  await beforeAgentStart(
    { prompt: "[2026-04-12 10:30:00] /lynx-check" },
    { sessionKey: "sess-trusted-audit", channelId: "webchat", messageProvider: "webchat", sendMessage: vi.fn() },
  );

  const persisted = beforeMessageWrite(
    {
      message: {
        role: "assistant",
        content: "# 🛡️ OpenClaw 全方位安全审计报告\n\n## 一、执行摘要\n- ok",
      },
    },
    { sessionKey: "sess-trusted-audit" },
  );

  expect(persisted?.message?.content).toContain("OpenClaw 全方位安全审计报告");
  expect(String(persisted?.message?.content ?? "")).not.toContain("assistant output replaced by security guard");

  const outbound = await messageSending(
    { to: "webchat", content: "# 🛡️ OpenClaw 全方位安全审计报告\n\n## 一、执行摘要\n- ok" },
    { sessionKey: "sess-trusted-audit" },
  );

  expect(outbound).toBeUndefined();
});
```

- [ ] **Step 2: 跑失败测试，验证当前确实被自身拦截**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/plugin.test.ts -t "does not ask for confirmation when managed /lynx-check writes or sends the final audit report"`

Expected: `FAIL`

- [ ] **Step 3: 在 guard context 里显式增加“可信输出/可信持久化”标志**

```ts
// src/runtime/plugin-runtime-helpers.ts
export interface TrustedManagedLynxCheckCapabilities {
  trustedManagedLynxCheckProtectedRead: boolean;
  trustedManagedLynxCheckExec: boolean;
  trustedManagedLynxCheckOutput: boolean;
  trustedManagedLynxCheckPersistence: boolean;
}

return {
  verifiedOwner,
  requesterId,
  channel,
  trustedInternalProtectedRead: isTrustedInternalProtectedRead(event, ctx),
  trustedManagedLynxCheckToolCall: isTrustedManagedLynxCheckToolCall(event, ctx),
  trustedManagedLynxCheckOutput: ctx?.managedLynxCheckRun === true && isTrustedManagedLynxCheckReportText(event),
  trustedManagedLynxCheckPersistence: ctx?.managedLynxCheckRun === true && isTrustedManagedLynxCheckReportText(event),
};
```

- [ ] **Step 4: 让 `guardOutput` 和 `result-guard` 支持受信任上下文短路放行**

```ts
export function guardOutput(output: string, sessionKey?: string, context?: GuardContext): GuardDecision {
  if (context?.trustedManagedLynxCheckOutput === true) {
    return {
      block: false,
      riskAssessment: {
        level: "L0",
        score: 0,
        modules: [],
        description: "trusted managed lynx-check audit output",
        action: "allow",
      },
    };
  }
  // existing logic...
}

export function guardAssistantPersistence(message: any, context?: { trustedManagedLynxCheckPersistence?: boolean }) {
  if (context?.trustedManagedLynxCheckPersistence === true) {
    return { block: false, message };
  }
  // existing logic...
}
```

- [ ] **Step 5: 在 `index.ts` 的三个出口全部传入受信任上下文**

```ts
const managedGuardContext = {
  ...ctx,
  managedLynxCheckRun: Boolean(activeManagedLynxCheckRun),
};
const guardContext = buildGuardContext(config, event, managedGuardContext);

const decision = guardOutput(output, ctx.sessionKey, guardContext);
const persistenceDecision = guardAssistantPersistence(nextMessage, guardContext);
const resultDecision = guardToolResultPersistence(event.toolName, event.message, guardContext);
```

- [ ] **Step 6: 重新跑白名单相关测试**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/plugin.test.ts -t "managed /lynx-check|confirmation|security guard"`

Expected: `PASS`

- [ ] **Step 7: 提交白名单重构**

```bash
git add src/runtime/plugin-runtime-helpers.ts src/guard/safety-guard.ts src/guard/result-guard.ts index.ts test/plugin.test.ts
git commit -m "feat: trust managed lynx-check audit generation and delivery"
```

### Task 5: 把“最新通道”改成“全通道 fanout”，并为 WebChat / Feishu 分别整形

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\recent-active-delivery.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-message-delivery.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-check-run-store.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\types.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: 先写失败测试，锁定“webchat + feishu 同时发送”**

```ts
it("fanouts a scheduled report to both recent webchat and recent feishu targets", async () => {
  const webchatSend = vi.fn().mockResolvedValue(undefined);
  const feishuSend = vi.fn().mockResolvedValue(undefined);

  rememberRecentActiveDeliveryTarget(
    { sessionKey: "sess-webchat", channelId: "webchat", messageProvider: "webchat", senderId: "w1", sendMessage: webchatSend } as any,
    { now: 1 },
  );
  rememberRecentActiveDeliveryTarget(
    { sessionKey: "sess-feishu", channelId: "feishu", messageProvider: "feishu", senderId: "f1", sendMessage: feishuSend } as any,
    { now: 2 },
  );

  const result = await deliverLynxReport({
    log: mockApi.logger,
    ctx: { sessionKey: "sess-scheduled", subsystem: "plugins" },
    tag: "scheduled-/lynx-check-report",
    allowSameSessionFallback: false,
    message: { role: "assistant", content: "# 🛡️ OpenClaw 全方位安全审计报告\n\n## 一、执行摘要\n- ok" },
  });

  expect(result.delivered).toBe(true);
  expect(result.deliveryAttempts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ messageProvider: "webchat", delivered: true }),
      expect.objectContaining({ messageProvider: "feishu", delivered: true }),
    ]),
  );
  expect(webchatSend).toHaveBeenCalledTimes(1);
  expect(feishuSend).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 运行测试，确认当前单目标投递无法满足**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/plugin.test.ts -t "fanouts a scheduled report to both recent webchat and recent feishu targets"`

Expected: `FAIL`

- [ ] **Step 3: 先把 recent-active store 从单快照扩展为多快照**

```ts
// src/runtime/recent-active-delivery.ts
export interface RecentActiveDeliveryState {
  version: 2;
  targets: RecentActiveDeliverySnapshot[];
}

export function readRecentActiveDeliverySnapshots(customPath?: string): RecentActiveDeliverySnapshot[] {
  const parsed = JSON.parse(readFileSync(resolveRecentActiveDeliveryPath(customPath), "utf8"));
  if (Array.isArray(parsed?.targets)) {
    return parsed.targets.map(normalizeSnapshot).filter(Boolean);
  }
  const legacy = normalizeSnapshot(parsed);
  return legacy ? [legacy] : [];
}

export function rememberRecentActiveDeliveryTarget(ctx: EventContext, options?: { path?: string; now?: number }) {
  const snapshot = buildSnapshot(ctx, options?.now ?? Date.now());
  const current = readRecentActiveDeliverySnapshots(options?.path).filter((item) => item.targetKey !== snapshot?.targetKey);
  writeSnapshots([...current, snapshot!], options?.path);
  return snapshot;
}
```

- [ ] **Step 4: 给 `deliverLynxReport` 增加 fanout 结果与 provider-specific shaping**

```ts
export interface LynxReportDeliveryAttempt {
  targetKey: string;
  messageProvider?: string;
  delivered: boolean;
  transport: string;
  errorMessage?: string;
}

function shapeMessageForProvider(message: Message, provider?: string): Message {
  if (provider === "feishu" && typeof message.content === "string") {
    return {
      ...message,
      content: message.content.replace("## 八、优先级整改建议", "## 八、优先级整改建议（适合飞书转发）"),
    };
  }
  return message;
}

export async function deliverLynxReport(...) {
  const targets = collectDeliveryTargets(ctx, routeHint, readRecentActiveDeliverySnapshots());
  const deliveryAttempts: LynxReportDeliveryAttempt[] = [];

  for (const target of targets) {
    const shapedMessage = shapeMessageForProvider(options.message, target.messageProvider);
    const attempt = await deliverToSingleTarget(...);
    deliveryAttempts.push(attempt);
  }

  return {
    delivered: deliveryAttempts.some((item) => item.delivered),
    transport: deliveryAttempts.filter((item) => item.delivered).map((item) => item.transport).join(",") || "none",
    deliveryAttempts,
  };
}
```

- [ ] **Step 5: 扩展 run store，把所有投递尝试记下来**

```ts
export interface LynxCheckRunResult {
  requestId: string;
  status: "not_started" | "running" | "completed" | "failed";
  sendAttempted: boolean;
  sendSucceeded: boolean;
  transport: string;
  deliveryAttempts?: Array<{
    targetKey: string;
    messageProvider?: string;
    delivered: boolean;
    transport: string;
    errorMessage?: string;
  }>;
  reportPath?: string;
  errorMessage?: string;
  completedAtMs: number;
}
```

- [ ] **Step 6: 重新跑多通道 fanout 与 run store 相关测试**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/plugin.test.ts test/lynx-check-run-store.test.ts`

Expected: `PASS`

- [ ] **Step 7: 提交 fanout 投递能力**

```bash
git add src/runtime/recent-active-delivery.ts src/runtime/lynx-message-delivery.ts src/runtime/lynx-check-run-store.ts src/types.ts test/plugin.test.ts
git commit -m "feat: fanout lynx report delivery across active channels"
```

### Task 6: 修正手动与定时链路的 run 状态与兜底逻辑，确保“定时任务也一定有完整内容”

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\scheduled-lynx-check.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\scheduled-lynx-check.test.ts`

- [ ] **Step 1: 先写失败测试，禁止定时任务退化成“BLOCKED / 无内容 / 看文件”**

```ts
it("stores a complete scheduled report even when no delivery route resolves", async () => {
  setup(mockApi);
  const beforeAgentStart = handlers["before_agent_start"];
  const agentEnd = handlers["agent_end"];

  await beforeAgentStart(
    { prompt: "[2026-04-12 11:30:00] /lynx-check" },
    { sessionKey: "sess-scheduled-no-route", subsystem: "plugins" },
  );

  await agentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] },
    { sessionKey: "sess-scheduled-no-route", subsystem: "plugins" },
  );

  const runIntent = readLatestPendingLynxCheckRunIntent("sess-scheduled-no-route");
  const runResult = readLynxCheckRunResult(runIntent!.requestId);
  const report = readFileSync(getLynxCheckRunReportPath(runIntent!.requestId), "utf8");

  expect(runResult?.sendAttempted).toBe(true);
  expect(report).toContain("# 🛡️ OpenClaw 全方位安全审计报告");
  expect(report).not.toMatch(/BLOCKED|Approve with|allow-once|allow-always|查看文件路径/i);
});
```

- [ ] **Step 2: 跑测试，确认当前定时链路会生成不完整内容或失败话术**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/plugin.test.ts test/scheduled-lynx-check.test.ts -t "scheduled"`

Expected: `FAIL`

- [ ] **Step 3: 在 `before_agent_start` 就把完整报告写入 run store，不再依赖后续技能补写**

```ts
const reportPath = getLynxCheckRunReportPath(runIntent.requestId);
writeFileSync(reportPath, reportMarkdown, "utf8");
updateLynxCheckRunIntentStatus(runIntent.requestId, "running");
writeLynxCheckRunResult(runIntent.requestId, {
  status: "running",
  sendAttempted: false,
  sendSucceeded: false,
  transport: "precomputed",
  reportPath,
});
```

- [ ] **Step 4: 在 `agent_end` 里优先发送预计算报告，并把“无路由”记成诚实失败**

```ts
const sendResult = await sendAssistantMessageWithRetry({
  ctx,
  tag: `${activeRunIntent.source}-/lynx-check-report`,
  message: { role: "assistant", content: reportMarkdown },
  attempts: activeRunIntent.source === "scheduled" ? 1 : 3,
  allowSameSessionFallback: activeRunIntent.preferredTargetKind === "current",
});

writeLynxCheckRunResult(activeRunIntent.requestId, {
  status: sendResult.delivered ? "completed" : "failed",
  sendAttempted: true,
  sendSucceeded: sendResult.delivered,
  transport: sendResult.transport,
  deliveryAttempts: sendResult.deliveryAttempts,
  reportPath,
  errorMessage: sendResult.delivered ? undefined : "No delivery route resolved for scheduled lynx-check",
});
```

- [ ] **Step 5: 回归定时任务相关测试**

Run: `cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian; npx vitest run --exclude ".worktrees/**" test/plugin.test.ts test/scheduled-lynx-check.test.ts`

Expected: `PASS`

- [ ] **Step 6: 提交 run 状态与兜底逻辑修复**

```bash
git add index.ts src/runtime/scheduled-lynx-check.ts test/plugin.test.ts test/scheduled-lynx-check.test.ts
git commit -m "fix: keep scheduled lynx-check reports complete and truthful"
```

### Task 7: 做完整本地回归与 Docker 真机验证

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\manual-lynx-check.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\scheduled-lynx-check.test.ts`

- [ ] **Step 1: 跑本地单元与类型检查**

Run:

```powershell
cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian
npx vitest run --exclude ".worktrees/**" test/plugin.test.ts test/lynx-check-run-store.test.ts test/scheduled-lynx-check.test.ts test/manual-lynx-check.test.ts
npx tsc --noEmit
```

Expected:

```text
All selected tests PASS
TypeScript exits with code 0
```

- [ ] **Step 2: 用仓库规定的同步命令把插件推到真实 Docker 运行时**

Run:

```powershell
cd C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian
node scripts-dev/verify-dev-sync.mjs
.\scripts-dev\sync-openclaw-dev-ready.ps1 --logs 200
```

Expected:

```text
SUCCESS
```

- [ ] **Step 3: 验证网关与 cron store**

Run:

```powershell
cd D:\all-works\openclaw
docker compose ps
docker compose logs --tail=200 openclaw-gateway
docker exec openclaw-openclaw-gateway-1 sh -lc "openclaw gateway status 2>&1"
docker exec openclaw-openclaw-gateway-1 sh -lc "cat /home/node/.openclaw/docker-state/cron/jobs.json 2>&1"
```

Expected:

```text
gateway healthy
cron store contains lynx-guardian-scheduled-lynx-check
```

- [ ] **Step 4: 触发一次真实手动 `/lynx-check`，确认直接回中文完整报告**

Run:

```powershell
docker exec openclaw-openclaw-gateway-1 sh -lc "openclaw agent --agent main --message '/lynx-check' --json --timeout 90 2>&1"
Get-ChildItem C:\Users\24716\.openclaw\lynx\check-runs -Filter *.result.json |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 FullName,LastWriteTime
```

Expected:

```text
CLI 输出或后续消息中出现完整中文审计报告
最新 *.report.md 以 "# 🛡️ OpenClaw 全方位安全审计报告" 开头
最新 *.result.json 的 sendAttempted 为 true
```

- [ ] **Step 5: 验证“全通道 fanout”而不是“只发最新通道”**

Run:

```powershell
Get-Content C:\Users\24716\.openclaw\lynx\hook-probe.log -Tail 200
Get-ChildItem C:\Users\24716\.openclaw\lynx\check-runs -Filter *.result.json |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 |
  ForEach-Object { Get-Content $_.FullName }
```

Expected:

```text
deliveryAttempts 至少记录 WebChat / Feishu 两类 target（在存在活跃通道时）
不存在 "BLOCKED"、"Approve with"、"allow-once"、"allow-always" 这类占位文本
```

- [ ] **Step 6: 做最终提交**

```bash
git add index.ts src/discovery/manual-lynx-check.ts src/discovery/lynx-check-report-template.ts src/runtime/lynx-check-prompt.ts src/runtime/plugin-runtime-helpers.ts src/guard/safety-guard.ts src/guard/result-guard.ts src/runtime/recent-active-delivery.ts src/runtime/lynx-message-delivery.ts src/runtime/lynx-check-run-store.ts src/runtime/scheduled-lynx-check.ts src/types.ts test/plugin.test.ts test/manual-lynx-check.test.ts test/scheduled-lynx-check.test.ts
git commit -m "feat: deliver lynx audit reports directly across all active channels"
```

## Self-Review

- **Spec coverage:** 本计划覆盖了你提到的 6 个核心诉求：不要再走 orchestrator、手动/定时提示词分离、完整中文审计报告、报告生成与发送最高权限白名单、从“最新通道”升级为“全通道发送”、定时任务创建时就完成 managed `/lynx-check` 免审授权。
- **Placeholder scan:** 计划中没有 `TODO` / `TBD` / “稍后处理”，每个任务都给了测试、实现方向、运行命令和预期结果。
- **Type consistency:** 新增的数据结构统一使用 `LynxReportChannel`、`deliveryAttempts`、`trustedManagedLynxCheck*` 这一组命名，避免后续任务名称漂移。

## Risks To Watch During Execution

1. `recent-active-delivery.json` 从单快照升级为多快照时，必须兼容旧格式，否则会让已有回退发送测试全部断掉。
2. `guardOutput()` 目前签名只有 `(output, sessionKey)`，改成支持上下文后，`agent_end`、`message_sending`、`before_message_write`、`tool_result_persist` 四个入口要一起更新。
3. Feishu 的“独有特性”第一阶段先以文案整形和首屏优先级排序实现，不要在没有 core 能力保证的前提下直接引入自定义卡片 payload。
4. “免审授权”必须严格限定在 managed `/lynx-check` 范围内，不能意外放大成对任意 exec/read/write 的全局豁免。
5. 真机结论必须以 Docker 里的最新 `*.result.json` + `*.report.md` 为准，不能只看 CLI 是否超时。

## Recommended Execution Order

1. Task 1: 先把完整中文审计报告模板立住。
2. Task 2: 再改 prompt，去掉 orchestrator。
3. Task 3: 先把免审授权层立住，彻底去掉审批弹框。
4. Task 4: 再打通白名单豁免，确保报告生成与发送不被自身拦截。
5. Task 5: 升级为全通道 fanout。
6. Task 6: 修正定时链路，保证即使无路由也有完整内容。
7. Task 7: 最后做回归与 Docker 真机验证。
