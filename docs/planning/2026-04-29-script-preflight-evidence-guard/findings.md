# Findings

## 当前代码事实

- `src/hooks/tool-hooks.ts` 是 `before_tool_call` 主入口。当前顺序是先调用 Go control-plane 的 `handleBeforeToolCallDecision()`，再走本地 `guardToolCall()`，再走 `checkExecBlacklist()` / `checkPathBlacklist()`。
- `src/runtime/hook-decision-handlers.ts` 的 `handleBeforeToolCallDecision()` 当前把 `event.params` 作为 `toolArgs` 传给 Go，没有脚本 evidence 字段。
- `shared/src/decision.ts` 与 `backend/internal/api/dto.go` 的 `DecisionRequest` 当前没有 `scriptEvidence` / `resourceEvidence`。
- `backend/internal/decision/tool_request.go` 已有 tool 语义分类器，能识别 `CommandFlags`、`PathKinds`、`SourceKinds`、`SinkKinds`。
- `backend/internal/decision/rules_tool.go` 已有工具侧 evidence 规则，包括下载执行、敏感内容外发、凭证路径、插件配置篡改、递归删除、权限削弱、编码执行等。
- `src/guard/concealed-intent.ts` 已有执行级混淆检测，可复用到脚本内容扫描。
- `src/blacklist.ts` 的 `checkExecBlacklist()` 是现有 exec 黑名单入口，但脚本内容扫描应作为独立模块产出 evidence，不建议把所有逻辑塞进去。
- `backend/internal/db/migrations/001_init.sql` 已有 `audit_events`、`tool_calls`。
- `backend/internal/db/migrations/002_control_plane.sql` 已有 `decisions`、`decision_evidence`、`chains`、`taint_labels`，适合承接第二期/第三期的证据和 taint 设计。

## 设计结论

- `exec.command` 是立即执行边界，但不是完整脚本风险边界。
- 完整脚本风险需要同时覆盖：
  - 立即执行
  - 间接执行
  - 脚本投放/修改
  - 延迟执行
- 第一期不需要 Go managed executor，也不应该承诺运行时隔离。
- LLM 解释可以做，但必须在确定性裁决之后，只解释 evidence，不参与放行。
- `no_execute` 暂不进入目录权限模型。执行风险由脚本预检和恶意链路检测统一处理。

## 短期可行插入点

- 在 `src/hooks/tool-hooks.ts` 中，在 `handleBeforeToolCallDecision()` 前构造带 `__lynxScriptPreflight` 的 decision-only event。
- 在 `recordBeforeToolCall()` 的 `metadataJson` 里记录脚本预检摘要。
- 在 `guardContext` 中携带脚本预检结果，供本地 `guardToolCall()` 兜底。
- 在 Go `rules_tool.go` 中读取 `req.ToolArgs["__lynxScriptPreflight"]`，新增脚本 evidence rule。

## 长期应正规化的点

- `DecisionRequest` 扩展 `scriptEvidence` 和 `resourceEvidence`。
- `EvidenceSource` 增加 `script` 和 `resource_policy`。
- DB 增加 `policy_rules`、`protected_resources`、`policy_versions`、`script_findings`、`script_taints`。
- 前端增加策略配置页和 evidence 详情页。

