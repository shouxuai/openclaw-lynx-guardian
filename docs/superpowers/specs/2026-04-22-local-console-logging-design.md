# Lynx 本地日志控制台设计

## Scope

本设计仅适用于：

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`

本轮目标是把本地日志控制台的数据方案先固化下来，并产出一版接近可执行的 SQLite 初始化脚本，作为后续本地 backend 与日志页面实现的基线。

本轮不做：

- 不修改 OpenClaw 核心代码：`D:\all-works\openclaw`
- 不直接实现本地 Web 控制台前后端
- 不宣称插件运行时行为已经因本次设计文档而变化
- 不把网关认证日志强行并入当前插件 hook 路径

## 本轮确认结论

### 1. 架构方向

采用三层结构：

- 插件层：继续负责 hook 拦截、风险判断、事件采集、向本地 backend 上报
- 本地 backend：负责 SQLite、migration、查询聚合、分页筛选、统计接口
- 前端页面：只消费本地 backend API，不直接读 SQLite

### 2. 数据库位置

数据库文件暂定：

- `%USERPROFILE%\.openclaw\lynx\data\lynx.db`

同目录保留：

- `%USERPROFILE%\.openclaw\lynx\data\lynx.db-wal`
- `%USERPROFILE%\.openclaw\lynx\data\lynx.db-shm`
- `%USERPROFILE%\.openclaw\lynx\data\console.log`
- `%USERPROFILE%\.openclaw\lynx\data\console.pid`

### 3. v1 表架构

本轮确认从旧的 `5 + 1` 收敛为 `6 + 2`：

业务表：

- `sessions`
- `audit_events`
- `tool_calls`
- `approvals`
- `lynx_checks`
- `token_usage`

基础设施表：

- `ingest_cursors`
- `schema_migrations`

### 4. 几个已经拍板的字段级决策

- `audit_events` 是统一总时间线主表
- `decision` 不再保留为一个含糊字段，拆成：
  - `policy_decision`
  - `enforcement_action`
- `audit_events.created_at` 拆成：
  - `occurred_at`
  - `ingested_at`
- `audit_events.metadata_json` 更名为 `payload_json`
- `approvals.approval_token` 不作为普通日志字段入库
- `request_fingerprint_hash` 可以保留，用于判重与链路关联
- `token_usage` 单独成表，不塞进 `audit_events`

### 5. Token 与网关认证日志的边界

- Token 统计：本轮纳入正式设计，后续由 `llm_output` hook 产生事实流，落到 `token_usage`
- 网关认证日志：本轮不纳入 v1 主 schema 的业务能力，后续如果要做，建议走 sidecar/日志追尾采集，并复用 `ingest_cursors`

## 当前插件已具备的事件来源

当前插件已接入：

- `gateway_start`
- `before_dispatch`
- `message_received`
- `before_agent_start`
- `agent_end`
- `before_message_write`
- `tool_result_persist`
- `message_sending`
- `before_tool_call`
- `after_tool_call`
- `session_start`
- `session_end`

这意味着当前 schema 已经能覆盖：

- 会话生命周期
- 输入侧风险事件
- Agent 启动前风险事件
- 输出拦截与结果持久化拦截
- 工具调用前后事件
- 审批/放行链路
- `/lynx-check` 记录
- 启动审计与技能完整性检查

另外，OpenClaw 运行时已支持 `llm_output`，只是当前插件尚未接入，因此 `token_usage` 的设计可以先落表，后续再接事件源。

## 设计原则

### 1. 主时间线与专题表并存

- `audit_events` 负责“所有重要事件都能查到”
- `tool_calls`、`approvals`、`lynx_checks`、`token_usage` 负责各自专题页与聚合统计

### 2. 弱关联优先，不用强外键卡死写入顺序

v1 先使用文本主键做软关联，例如：

- `session_key`
- `run_id`
- `tool_call_id`
- `approval_id`
- `request_id`

原因是插件 hook 天生存在前后分步写入、延迟补全、未来 sidecar 补数等情况，过早加严格外键会让 ingestion 顺序变脆。

### 3. 结构化字段 + JSON 明细并存

- 列表页、筛选页、统计页依赖结构化字段
- 详情抽屉、原始证据、未来扩展依赖 `payload_json`

### 4. 审计判断与执行动作分离

`policy_decision` 表示策略层的判断结论。

`enforcement_action` 表示系统最终采取的动作，当前建议稳定收敛为：

- `allow`
- `warn`
- `block`
- `redact`
- `require_approval`
- `log_only`

拆分的好处：

- 同一种策略判断可以映射到不同动作，避免前端把“判断”和“执行结果”混为一谈
- 仪表盘统计动作分布时可以直接按 `enforcement_action` 聚合
- 后续如果出现“策略判断建议 block，但本次因为兼容模式只 warn”，数据层也能真实表达

## 表总览

| 表名 | 角色 | 主要来源 | 主要页面 |
| --- | --- | --- | --- |
| `sessions` | 会话维度主表 | `session_start` / `session_end` / 请求上下文 | 会话页、总览页 |
| `audit_events` | 统一审计时间线 | 各类 hook 事件 | 事件页、Dashboard |
| `tool_calls` | 工具调用专题表 | `before_tool_call` / `after_tool_call` | 工具调用页 |
| `approvals` | 审批与放行链路表 | 本地审批与工作流放行 | 审批页 |
| `lynx_checks` | `/lynx-check` 运行表 | 手动/定时检查链路 | Lynx Check 页 |
| `token_usage` | Token 用量专题表 | `llm_output` | Token 页、成本卡片 |
| `ingest_cursors` | sidecar/补数游标表 | 文件追尾、补采任务 | 不是用户页面 |
| `schema_migrations` | schema 版本记录 | migration 执行器 | 不是用户页面 |

## 各表详细设计

### 1. `sessions`

用途：

- 所有日志页面的会话维度入口
- 给事件、工具调用、审批、token 记录提供统一会话锚点

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `session_key TEXT NOT NULL UNIQUE`
- `channel_profile TEXT`
- `channel_id TEXT`
- `requester_id TEXT`
- `requester_ou_id TEXT`
- `account_id TEXT`
- `conversation_id TEXT`
- `thread_id TEXT`
- `is_group INTEGER NOT NULL DEFAULT 0`
- `first_seen_at INTEGER NOT NULL`
- `last_seen_at INTEGER NOT NULL`
- `ended_at INTEGER`
- `metadata_json TEXT`

前端主要用途：

- `session_key`：会话详情页主键、列表跳转主键
- `channel_profile` / `channel_id`：来源标签、渠道筛选
- `requester_id` / `requester_ou_id`：请求人筛选、审批上下文对齐
- `account_id` / `conversation_id` / `thread_id`：跨系统追踪
- `first_seen_at` / `last_seen_at` / `ended_at`：会话时长、最近活跃时间、是否结束
- `is_group`：群聊/单聊标签
- `metadata_json`：保底明细，不进入主列表列

### 2. `audit_events`

用途：

- 统一总时间线
- 支撑“全部日志”“风险事件”“输入/输出内容记录”“动作分布”“最近异常”这类核心页面

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `event_id TEXT NOT NULL UNIQUE`
- `session_key TEXT`
- `run_id TEXT`
- `tool_call_id TEXT`
- `approval_id TEXT`
- `request_id TEXT`
- `source_kind TEXT NOT NULL`
- `hook_name TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `category TEXT NOT NULL`
- `sub_category TEXT`
- `direction TEXT`
- `content_kind TEXT`
- `primary_module TEXT`
- `modules_json TEXT`
- `risk_level TEXT`
- `risk_score INTEGER`
- `policy_decision TEXT`
- `enforcement_action TEXT NOT NULL`
- `title TEXT NOT NULL`
- `summary TEXT`
- `recommendation TEXT`
- `content_excerpt TEXT`
- `content_hash TEXT`
- `occurred_at INTEGER NOT NULL`
- `ingested_at INTEGER NOT NULL`
- `payload_json TEXT`

前端主要用途：

- `event_id`：事件详情页主键
- `session_key` / `run_id` / `tool_call_id` / `approval_id` / `request_id`：跨页跳转与链路串联
- `source_kind`：区分插件 hook、未来 sidecar、系统任务
- `hook_name`：技术定位维度
- `event_type`：事件主类型筛选，例如 `input_guard`、`output_guard`、`tool_guard`
- `category` / `sub_category`：业务视角标签，用于页面 tab 与细粒度筛选
- `direction`：标明是输入、输出还是内部系统事件
- `content_kind`：文本、工具结果、审批摘要、系统通知等内容类型
- `primary_module` / `modules_json`：模块标签与多模块命中标签
- `risk_level` / `risk_score`：风险等级徽标、风险排序、趋势统计
- `policy_decision`：展示策略判断语义
- `enforcement_action`：展示实际执行动作，是页面统计的关键字段
- `title` / `summary` / `recommendation`：列表卡片与详情抽屉的核心文案
- `content_excerpt`：输入/输出内容摘要，支撑日志页正文预览
- `content_hash`：敏感内容去重、原文不直存时的对照键
- `occurred_at`：事件真实发生时间
- `ingested_at`：事件写入本地库时间，用于排查延迟与补数
- `payload_json`：详情页“原始负载”区域

这张表已经能够承接用户关心的几类信息：

- 总事件
- 各种 L 风险等级
- 执行动作
- 输入与输出内容摘要

### 3. `tool_calls`

用途：

- 专门记录工具调用前后链路
- 避免所有工具字段都挤在 `audit_events` 里导致列表与统计过重

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `tool_call_id TEXT NOT NULL UNIQUE`
- `session_key TEXT`
- `run_id TEXT`
- `approval_id TEXT`
- `tool_name TEXT NOT NULL`
- `param_summary TEXT`
- `param_hash TEXT`
- `triggered_modules_json TEXT`
- `risk_level TEXT`
- `risk_score INTEGER`
- `policy_decision TEXT`
- `enforcement_action TEXT NOT NULL`
- `started_at INTEGER NOT NULL`
- `finished_at INTEGER`
- `duration_ms INTEGER`
- `result_status TEXT`
- `result_excerpt TEXT`
- `error_text TEXT`
- `metadata_json TEXT`

前端主要用途：

- `tool_call_id`：工具详情页主键
- `tool_name`：工具筛选、排行
- `param_summary`：列表预览，不直接把原始参数铺开
- `param_hash`：去重与隐私保护
- `approval_id`：是否进入审批链路
- `risk_level` / `risk_score`：危险工具调用高亮
- `policy_decision` / `enforcement_action`：区分“建议怎么做”和“实际怎么做”
- `started_at` / `finished_at` / `duration_ms`：耗时排序、超时分析
- `result_status`：成功、失败、阻断等状态筛选
- `result_excerpt` / `error_text`：结果摘要与失败原因
- `metadata_json`：原始参数结构、附加诊断信息

### 4. `approvals`

用途：

- 统一记录审批请求、审批结果、工作流放行
- 让审批页能独立呈现，而不是从事件表硬拼

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `approval_id TEXT NOT NULL UNIQUE`
- `pending_id TEXT`
- `session_key TEXT`
- `run_id TEXT`
- `transport TEXT`
- `channel_profile TEXT`
- `channel_id TEXT`
- `account_id TEXT`
- `conversation_id TEXT`
- `requester_ou_id TEXT`
- `approver_ou_ids_json TEXT`
- `resolved_approver_ou_id TEXT`
- `request_fingerprint_hash TEXT`
- `module TEXT NOT NULL`
- `risk_level TEXT NOT NULL`
- `tool_name TEXT`
- `scope_type TEXT NOT NULL`
- `requested_at INTEGER NOT NULL`
- `expires_at INTEGER NOT NULL`
- `resolved_at INTEGER`
- `resolution TEXT`
- `prompt_excerpt TEXT`
- `audit_summary_json TEXT`
- `metadata_json TEXT`

前端主要用途：

- `approval_id`：审批详情主键
- `pending_id`：对接运行时 pending 记录
- `transport` / `channel_profile` / `channel_id`：审批是从哪里发出的
- `requester_ou_id` / `approver_ou_ids_json` / `resolved_approver_ou_id`：审批身份链路
- `request_fingerprint_hash`：判重与同类请求聚合，不暴露真实 token
- `module` / `risk_level` / `tool_name`：审批原因、风险来源、对应工具
- `scope_type`：区分单工具、工作流、时间窗
- `requested_at` / `expires_at` / `resolved_at`：审批时效与 SLA
- `resolution`：批准、拒绝、过期、取消等状态
- `prompt_excerpt`：页面上显示给审批人的简要请求文案
- `audit_summary_json`：审批关联的事件摘要
- `metadata_json`：额外调试信息

### 5. `lynx_checks`

用途：

- 记录手动与定时 `/lynx-check`
- 记录投递与报告生成结果

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `request_id TEXT NOT NULL UNIQUE`
- `source TEXT NOT NULL`
- `trigger TEXT NOT NULL`
- `preferred_target_kind TEXT NOT NULL`
- `session_key TEXT`
- `target_key TEXT`
- `channel_id TEXT`
- `message_provider TEXT`
- `status TEXT NOT NULL`
- `send_attempted INTEGER NOT NULL DEFAULT 0`
- `send_succeeded INTEGER NOT NULL DEFAULT 0`
- `transport TEXT`
- `report_path TEXT`
- `error_message TEXT`
- `delivery_attempts_json TEXT`
- `created_at INTEGER NOT NULL`
- `completed_at INTEGER`

前端主要用途：

- `request_id`：检查详情主键
- `source` / `trigger`：区分手动触发、定时触发、谁触发的
- `preferred_target_kind` / `target_key`：目标投递对象信息
- `status`：运行状态筛选
- `send_attempted` / `send_succeeded`：投递结果徽标
- `transport` / `channel_id` / `message_provider`：消息投递通道
- `report_path`：跳转打开报告
- `error_message`：失败原因
- `delivery_attempts_json`：多次投递的轨迹
- `created_at` / `completed_at`：运行时长

### 6. `token_usage`

用途：

- 记录模型调用 Token 消耗
- 服务成本卡片、模型排行、会话级用量查询

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `usage_event_id TEXT NOT NULL UNIQUE`
- `session_key TEXT`
- `run_id TEXT`
- `agent_id TEXT`
- `provider TEXT NOT NULL`
- `model TEXT NOT NULL`
- `input_tokens INTEGER NOT NULL DEFAULT 0`
- `output_tokens INTEGER NOT NULL DEFAULT 0`
- `cache_read_tokens INTEGER NOT NULL DEFAULT 0`
- `cache_write_tokens INTEGER NOT NULL DEFAULT 0`
- `total_tokens INTEGER NOT NULL DEFAULT 0`
- `assistant_text_count INTEGER NOT NULL DEFAULT 0`
- `is_estimated INTEGER NOT NULL DEFAULT 0`
- `occurred_at INTEGER NOT NULL`
- `ingested_at INTEGER NOT NULL`
- `payload_json TEXT`

前端主要用途：

- `usage_event_id`：单条 token 记录主键
- `session_key` / `run_id` / `agent_id`：会话、运行、Agent 维度聚合
- `provider` / `model`：模型成本排行、模型筛选
- `input_tokens` / `output_tokens`：入参/出参成本拆分
- `cache_read_tokens` / `cache_write_tokens`：缓存命中收益与缓存写入成本
- `total_tokens`：趋势图、Top N
- `assistant_text_count`：辅助判断一次调用输出体量
- `is_estimated`：提醒前端这条是不是估算值
- `occurred_at` / `ingested_at`：用量时间轴与补数排查
- `payload_json`：保留原始 usage 结构

说明：

- `token_usage` 不替代 `audit_events`
- 它更适合高频统计、模型维度排行、会话成本分析

### 7. `ingest_cursors`

用途：

- 给未来 sidecar/日志追尾/补采任务保存游标
- 先作为基础设施表落下，避免后续扩展时又重做 schema

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `source_name TEXT NOT NULL`
- `source_key TEXT NOT NULL`
- `cursor_type TEXT NOT NULL`
- `cursor_value TEXT`
- `cursor_meta_json TEXT`
- `updated_at INTEGER NOT NULL`
- `UNIQUE(source_name, source_key)`

前端主要用途：

- 无直接页面用途
- 主要是让未来 `gateway_auth_logs`、文件 tailing、补采器有稳定续读点

### 8. `schema_migrations`

用途：

- 记录 schema 版本

建议字段：

- `version TEXT PRIMARY KEY`
- `applied_at INTEGER NOT NULL`

## 页面支持判断

如果目标是做“插件本地日志页面”，当前这套表已经足够支撑 v1：

- Dashboard：`audit_events` + `tool_calls` + `approvals` + `lynx_checks` + `token_usage`
- 全量日志页：`audit_events`
- 工具调用页：`tool_calls`
- 审批页：`approvals`
- Lynx Check 页：`lynx_checks`
- 会话页：`sessions`
- Token 页：`token_usage`

当前还不直接支持的，是“网关认证日志独立页面”这一类 sidecar 来源页面，因为它不是现有插件 hook 的自然产物。

## 为什么当前表已经能支撑日志页面

对“日志页面”来说，核心不是把所有细节都塞到一张表，而是同时满足这四件事：

- 能按时间线看全貌
- 能按专题深入
- 能按风险与动作筛选
- 能把输入/输出/工具/审批串起来

当前 schema 已经具备这四个条件：

- `audit_events` 管总线
- `tool_calls`、`approvals`、`lynx_checks`、`token_usage` 管专题
- `session_key` / `run_id` / `tool_call_id` / `approval_id` / `request_id` 管关联
- `risk_level` / `policy_decision` / `enforcement_action` / `content_excerpt` 管页面展示与统计

## `001_init.sql` 设计要求

本轮 SQL 文件按“接近可执行”收口，原则如下：

- 使用 SQLite 语法
- 使用 `CREATE TABLE IF NOT EXISTS`
- 使用 `CREATE INDEX IF NOT EXISTS`
- 仅对稳定字段加轻量约束
- 不在 v1 加严格外键
- 末尾写入 `schema_migrations`

对应 SQL 文件：

- `docs/superpowers/specs/2026-04-22-local-console-logging-001_init.sql`

## 暂不纳入 v1 的内容

- `gateway_auth_logs` 业务表
- 纯运行时 TTL 缓存表
- 前端专用物化统计表

原因：

- 现有插件 hook 还不直接产出网关认证事件
- TTL 缓存更像运行态实现细节，不是审计主数据
- 统计类表可以在真实查询瓶颈出现后再补

## 后续实现顺序

建议按以下顺序推进：

1. 先以 `001_init.sql` 为准落本地 migration 基线
2. 再补本地 backend 的 DAO / repository
3. 再定义插件到本地 backend 的 ingestion 契约
4. 再接入 `llm_output` 并写入 `token_usage`
5. 最后再根据日志页面原型做查询 API 与 UI

## 结论摘要

这版设计已经把最关键的结构问题定住了：

- 有统一总时间线：`audit_events`
- 有总事件、风险等级、执行动作、输入/输出摘要
- 有工具、审批、检查、Token 四个专题表
- 预留了未来 sidecar 的 `ingest_cursors`
- 把 Token 纳入 v1，把网关认证日志延后到 sidecar 扩展

相关后续规格：

- `docs/superpowers/specs/2026-04-22-local-console-ingest-contract-design.md`
- `docs/superpowers/specs/2026-04-22-local-console-query-api-dto-design.md`

下一步可以直接围绕这份 spec 和 `001_init.sql` 进入 backend 迁移与 ingestion 设计。
