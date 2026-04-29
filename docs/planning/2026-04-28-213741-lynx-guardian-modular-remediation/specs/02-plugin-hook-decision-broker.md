# 02. Plugin Hook And DecisionBroker Spec

## 目标

插件只做 hook 接入和裁决执行。早期 hook 发起预判，硬拦截 hook 等待结果，sync-only hook 使用缓存。

## 新增文件建议

- `src/runtime/decision-client.ts`
- `src/runtime/decision-broker.ts`
- `src/runtime/decision-context.ts`
- `src/runtime/local-l4-fast-path.ts`
- `src/runtime/hook-decision-handlers.ts`
- `test/decision-broker.test.ts`
- `test/local-l4-fast-path.test.ts`

## Hook 安排

| hook | 角色 | 等待 Go |
| --- | --- | --- |
| `message_received` | 观测和输入预取 | 不阻塞 |
| `before_dispatch` | 输入主拦截 | 等待 |
| `before_agent_start` | 兼容兜底 | 等待 |
| `before_prompt_build` | 插入 Go 返回的短 promptContext | 等待或读缓存 |
| `llm_input` | 精确 prompt 审计和多轮补全 | fire-and-forget |
| `before_tool_call` | 工具主拦截 | 等待 |
| `after_tool_call` | 工具结果审计和 chain/taint 更新 | 等待但不阻断 |
| `tool_result_persist` | 工具结果持久化保护 | sync-only，不等待 |
| `before_message_write` | assistant/tool transcript 保护 | sync-only，不等待 |
| `llm_output` | usage 和输出预取 | fire-and-forget |
| `message_sending` | 最终外发保护 | 等待 |
| `before_install` | Skill/plugin 安装前扫描 | 等待 |
| `subagent_*` | 子 agent chain/投递/收束 | 根据 hook 类型处理 |

## DecisionBroker 行为

`DecisionBroker` 只负责请求、缓存、等待、超时，不做安全判断。

核心方法：

- `prefetchInputDecision(context)`
- `waitInputDecision(context, timeoutMs)`
- `waitToolDecision(context, timeoutMs)`
- `prefetchOutputDecision(context)`
- `waitOutboundDecision(context, timeoutMs)`
- `getCachedDecision(key)`
- `recordLocalL4Decision(context, result)`

## 超时策略

| 阶段 | 推荐超时 | 降级 |
| --- | --- | --- |
| 输入 | 300-800ms | 本地 L4 deny；高风险 require_approval；普通 allow + degraded warn |
| 工具 | 500-1500ms | 危险工具 block/approval；普通工具 warn/allow |
| 输出外发 | 300-800ms | 明确敏感本地 redact/block；普通 warn |
| 安装 | 1000-3000ms | unknown source require_approval；恶意命中 deny |

## sync-only 限制

`before_message_write` 和 `tool_result_persist`：

- 不允许返回 Promise。
- 不新发 Go 请求。
- 不等待 pending promise。
- 只读已完成缓存和本地 L4/redaction 规则。

## 插件减负路径

第一阶段保留旧 `guardInput/guardToolCall/guardOutput` 作兼容。

第二阶段：

- 可等待 hook 以 Go decision 为主。
- 旧 guard 只作为 fallback 或本地 L4。

第三阶段：

- 删除重复赋分逻辑。
- 保留 `src/guard` 中必须本地执行的 L4、PII/secret redaction、sync-only 快规则。

