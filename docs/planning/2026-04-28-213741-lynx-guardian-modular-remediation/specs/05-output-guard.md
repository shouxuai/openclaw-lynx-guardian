# 05. Output Guard Redesign Spec

## 目标

修正输出防护过度替换问题，同时保持密钥、PII、system prompt 原文、工具结果泄漏的强保护。

## 输出 sink 分类

| sink | hook | 能否等待 Go | 处理策略 |
| --- | --- | --- | --- |
| LLM 原始输出 | `llm_output` | 否，fire-and-forget | 观察、usage、预取输出决策 |
| agent 结束输出 | `agent_end` | 不作为主拦截 | 审计、/lynx-check 投递兜底 |
| assistant 持久化 | `before_message_write` | 否，sync-only | 本地 redaction + cached decision |
| 工具结果持久化 | `tool_result_persist` | 否，sync-only | 私钥/token/PII/system 原文本地保护 |
| 最终外发 | `message_sending` | 是 | 最终 kill switch 和通道格式化 |

## 行为矩阵

| 风险 | 默认动作 |
| --- | --- |
| L0/L1 | allow/log |
| L2 | warn，不改内容 |
| L3 可脱敏 | redact，局部替换 |
| L3 不可确认 | require_approval 或 warn，按 sink |
| L4 明确泄漏 | block/deny，必要时整段替换 |

## 不应整段替换的场景

- 普通业务建议。
- 文件名列表。
- metadata-only 配置摘要。
- 审批状态说明。
- `/lynx-check` 报告。
- 合法安全培训解释。

## 必须拦截或脱敏的场景

- PEM 私钥。
- API key / token。
- `.env` 明文。
- 身份证号、住址、银行卡等 PII。
- system prompt / developer instruction / 安全规则原文。
- 工具结果中携带敏感文件全文。

## Go 输出决策返回

`/decision/output` 返回：

- `sink`
- `riskLevel`
- `action`
- `redactions`
- `metadataOnly`
- `safeReplacement`
- `diagnostic`
- `trustedManagedReport`

## 插件侧改动

重点改：

- `src/guard/result-guard.ts`
- `src/guard/safety-guard.ts`
- `src/guard/system-prompt-guard.ts`
- `src/runtime/local-console-hook-handlers.ts`
- `index.ts` 中 `agent_end`、`before_message_write`、`tool_result_persist`、`message_sending` 分支

## 测试要求

- 正常中文业务输出不被替换。
- metadata-only `openclaw.json` 摘要不被 L4。
- PEM private key 被 block。
- 身份证输出被 redact。
- `message_sending` 对外发敏感内容能最终拦截。

