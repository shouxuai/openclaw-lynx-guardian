# 00. Execution Boundaries Spec

## 目标

把 Lynx Guardian 整改拆成可独立推进的模块，避免一次性重写插件。每个模块必须能单独测试，并且不能破坏现有 L4 硬拒绝边界。

## 总体分层

| 层 | 责任 | 不再承担 |
| --- | --- | --- |
| 插件层 | OpenClaw hook 注册、上下文提取、本地 L4 快速拒绝、调用 Go、执行裁决、审批 bridge、最终投递 | 长期状态、完整赋分模型、复杂语义判别、任务控制面 |
| Go 后端 | 决策控制面、状态控制面、日志控制台、SQLite、审批 grant、chain、/lynx-check task、Skill inventory | 直接操作 OpenClaw hook、直接发送通道消息 |
| 前端 webview | 展示风险、证据、审批、任务、Skill、Token、链路状态 | 直接读取 SQLite、直接推断风险 |

## 模块拆分

1. 决策契约与日志语义。
2. 插件 DecisionBroker 与 hook 接入。
3. Go 控制面与数据库扩展。
4. 审批 grant 与多轮 chain。
5. 输出防护重构。
6. `/lynx-check` 任务控制面。
7. Skill 供应链与 Token usage。
8. 前端可观测性与演示数据。
9. 旧 runtime store 收束与代码减负。

## 必须保留的本地 L4 快速拒绝

插件本地必须保留以下快速拒绝，不等待 Go：

- 禁用 Lynx Guardian。
- 修改 `openclaw.json` 把插件设为 disabled。
- 删除、移动、篡改插件防护文件。
- 读取私钥、token、系统提示、开发者指令、安全规则原文。
- 敏感文件 + 外部网络发送。
- 键盘记录、静默上传、绕过检测、隐藏执行链。
- 审批绕过和规避确认。

## 迁移方式

采用三阶段兼容：

1. **双写**：插件继续执行旧逻辑，同时把 Go decision / evidence 写入日志。
2. **Go 主判定**：可等待 hook 以 Go decision 为主，本地 L4 仍优先。
3. **旧逻辑收束**：删除或冻结插件侧重复赋分、grant store、任务 store。

## 成功标准

- `index.ts` 只保留 setup 和 hook 编排。
- 复杂判断逻辑集中到 Go。
- Go 能解释为什么 `block:false` 但仍是 warn。
- 旧 runtime store 数量明显下降。
- 所有关键路径可通过本地测试和真实 OpenClaw runtime 验证。

