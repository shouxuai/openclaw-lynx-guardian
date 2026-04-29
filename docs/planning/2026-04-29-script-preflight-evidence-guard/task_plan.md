# Script Preflight Evidence Guard 落地方案与计划

## 目标

在不依赖 Go managed executor 和运行时沙盒的前提下，先把 Lynx Guardian 的工具调用防护从“命令字符串识别”增强到“脚本入口识别 + 脚本内容静态预检 + 结构化证据裁决 + 可解释拒绝”。

这个方案不承诺 100% 运行时隔离。它的安全边界是：

- 插件在 OpenClaw `before_tool_call` 执行前拦截工具调用。
- 对能定位到的脚本、dispatcher 文件、脚本投放行为进行静态读取和扫描。
- 高置信危险链路直接拒绝；中等风险要求审批；低风险记录审计。
- LLM 只负责解释已拒绝的证据，不参与放行裁决。

## 当前代码落点

当前代码已经具备几条可复用的主干：

- `src/hooks/tool-hooks.ts`
  - `api.on("before_tool_call", ...)` 是真实工具调用前的插件拦截点。
  - 现在调用顺序是先走 `handleBeforeToolCallDecision(decisionBroker, event, ctx)`，再走本地 `guardToolCall()`，最后走 `checkExecBlacklist()` / `checkPathBlacklist()`。
  - 这意味着如果脚本 evidence 要进入 Go 裁决，必须在 `handleBeforeToolCallDecision()` 之前采集并注入 decision request；否则只能作为本地后置 guard/blacklist 的依据。

- `src/runtime/hook-decision-handlers.ts`
  - `handleBeforeToolCallDecision()` 当前把 `event.params` 原样作为 `toolArgs` 发给 Go。
  - 短期可把脚本预检 evidence 放进 `toolArgs.__lynxScriptPreflight`。
  - 中长期应扩展 `DecisionRequest`，增加正式的 `scriptEvidence` / `resourceEvidence` 字段。

- `shared/src/decision.ts` 与 `backend/internal/api/dto.go`
  - `DecisionRequest` 当前包含 `content/toolName/toolArgs/targetUri/chainSummary/taintSummary/providerSafety`。
  - `EvidenceSource` 当前没有 `script`，只有 `input/tool/output/chain/taint/provider/local_l4`。
  - 第一期建议复用 `tool` 或 `taint`，第三期再加 `script`。

- `backend/internal/decision/tool_request.go`
  - Go 已能从 `toolArgs` 里分类 `CommandFlags`、`PathKinds`、`SourceKinds`、`SinkKinds`。
  - 现有 flags 覆盖 `encoded_execution`、`download_execute`、`recursive_delete`、`permission_weakening`、`config_disable` 等。
  - 适合把脚本 findings 映射为新的 command flags 或 evidence items。

- `backend/internal/decision/rules_tool.go`
  - 已有 L4 规则：下载执行、敏感内容外发、凭证路径、插件自毁、递归删除、权限削弱等。
  - 第一期可新增脚本 evidence 规则，而不是重写裁决体系。

- `src/guard/concealed-intent.ts`
  - 已有 `detectOperationGradeConcealedExecution()`，能识别 `powershell -enc`、`certutil -decode`、base64 exec、`fromCharCode + eval`、压缩后执行等。
  - 应复用为脚本内容扫描的一部分，避免在 `safety-guard.ts` 里散落重复规则。

- `src/blacklist.ts`
  - `checkExecBlacklist()` 是现有 exec 黑名单入口。
  - 它适合继续负责命令级 hard deny，但脚本内容扫描不应硬塞到这里；建议新建独立模块，再把结果映射给 blacklist/guard/decision。

- `backend/internal/db/migrations/001_init.sql` 与 `002_control_plane.sql`
  - 已有 `audit_events`、`tool_calls`、`decisions`、`decision_evidence`、`chains`、`taint_labels`。
  - 第二期可先把脚本 evidence 写入现有 `metadata_json`、`payload_json`、`decision_evidence`。
  - 第三期再新增 `policy_rules`、`protected_resources`、`script_findings`、`script_taints` 等正式表。

## 需求清单

### 1. 用户自定义黑白名单词汇

需求：

- 用户可以维护黑名单词汇、短语、正则或规则项。
- 用户可以维护白名单词汇用于降低误报。
- 白名单权限不能过高，不能覆盖 L4 hard deny。

落地：

- 第二期在 Go 后端增加策略存储和 API。
- 内部模型不要直接叫“词汇”，应建为 `policy_rules`：
  - `rule_id`
  - `kind`: `blacklist` / `allowlist`
  - `scope`: `input` / `tool` / `script` / `output`
  - `pattern_type`: `literal` / `regex`
  - `pattern`
  - `risk_delta`
  - `enabled`
  - `created_by`
  - `updated_at`
- allowlist 只能降低 `L1-L2` 或减少审批噪声；遇到 hard deny 模块仍拒绝：
  - `plugin_integrity`
  - `config_integrity`
  - `credential_access`
  - `exfiltration`
  - `destructive_mutation`
  - `concealed_execution` 高置信链路

### 2. 用户自定义受保护目录

需求：

- 用户可以添加完整文件夹路径。
- 用户可以通过页面选择文件夹。
- 用户可配置目录权限。
- 当前不引入 `no_execute`，执行风险统一交给脚本预检。

权限模型：

- UI 预设：
  - `deny_all`: 不允许访问。
  - `read_only`: 只允许 read/list/search。
  - `no_modify`: 允许读，但禁止 create/write/rename/chmod/delete。
  - `no_delete`: 禁止 delete，其他按策略继续判断。
- 内部 operation bits：
  - `read`
  - `list`
  - `search`
  - `create`
  - `write`
  - `rename`
  - `chmod`
  - `delete`

落地：

- 第二期新增 `protected_resources` 表与 UI。
- 插件在 `before_tool_call` 中把 tool 参数映射为操作族：
  - `read/open/view/cat/type/Get-Content` -> read
  - `ls/dir/Get-ChildItem/find/rg` -> list/search
  - `write/edit/apply_patch/Set-Content/Out-File/tee` -> write/create
  - `mv/ren/Move-Item/Rename-Item` -> rename
  - `chmod/icacls/Set-Acl` -> chmod
  - `rm/del/Remove-Item/rmdir` -> delete
- 命中受保护目录时构造 `resourceEvidence`，送入本地 guard 或 Go decision。

### 3. 恶意脚本静态预检

需求：

- 不只看 `exec.command` 原始字符串。
- 能识别“直接执行脚本”、“间接执行脚本”、“脚本投放/修改”、“延迟执行”。
- 读取脚本内容后做恶意链路扫描。

第一期覆盖：

- 立即执行入口：
  - `python file.py`
  - `node file.js`
  - `bash file.sh`
  - `sh file.sh`
  - `pwsh -File file.ps1`
  - `powershell -File file.ps1`
  - `cmd /c file.bat`
  - `node -e`
  - `python -c`
  - `powershell -enc`
- 间接执行入口：
  - `npm run <script>`
  - `pnpm run <script>`
  - `yarn run <script>`
  - `bun run <script>`
  - `npx <bin>`
  - `make <target>`
  - `just <target>`
  - `task <target>`
  - `uv run ...`
  - `python -m module`
- 投放入口：
  - `write/edit/apply_patch` 修改 `.sh/.ps1/.bat/.cmd/.py/.js/.ts/.mjs/.cjs`
  - 修改 `package.json scripts`
  - 修改 `Makefile`
  - 修改 `Justfile`
  - 修改 `Taskfile.yml`
  - 修改 `pyproject.toml`
- 延迟执行入口：
  - cron
  - schtasks
  - systemd
  - launchctl
  - git hooks
  - npm lifecycle scripts
  - CI 配置

安全读取约束：

- 只读取能解析到本地路径的脚本。
- 优先限制在 `workdir` / workspace / 用户允许根内。
- 限制大小，建议第一期 512KB。
- 跳过或拒绝设备文件、FIFO、异常 symlink。
- 记录 `path`、`realpath`、`sha256`、`size`、`mtime`。
- 读取失败时不伪装成安全；按风险级别降级为审批或记录。

扫描规则族：

- `script.download_execute`
- `script.encoded_execution`
- `script.dynamic_eval`
- `script.credential_access`
- `script.external_exfiltration`
- `script.persistence`
- `script.destructive_mutation`
- `script.permission_weakening`
- `script.defense_evasion`
- `script.plugin_or_config_tamper`

### 4. 结构化证据与 LLM 解释

需求：

- 拒绝要有理有据。
- 可以让 LLM 告诉用户脚本大概在做什么。
- LLM 不能决定是否放行。

落地：

- scanner 输出 `ScriptPreflightEvidence`：
  - `entrypointKind`
  - `scriptPath`
  - `realPath`
  - `sha256`
  - `language`
  - `findings[]`
  - `riskLevel`
  - `recommendedAction`
- finding 字段：
  - `ruleId`
  - `module`
  - `severity`
  - `line`
  - `snippet`
  - `behavior`
  - `confidence`
- 裁决先发生。
- 如果 block/deny，再把 evidence 包交给解释层。
- 解释层只生成 `userMessage` 或 block reason。
- LLM 输入只包含必要片段和 findings，不塞完整脚本。
- LLM 失败时使用模板兜底。

示例解释：

```text
已拒绝执行 scripts/setup.ps1。
静态预检发现该脚本包含 下载远程内容 -> 解码/拼接 -> Invoke-Expression 执行 的链路，并在后续读取 .env/token 类文件后发起外部 HTTP 请求。
命中规则：script.download_execute、script.encoded_execution、script.credential_access、script.external_exfiltration。
这是高危执行与数据外发组合，因此 Lynx Guardian 已阻止本次工具调用。
```

## 架构方案

### 新增 TS 模块

建议新增：

- `src/script-preflight/types.ts`
  - 定义 `ScriptPreflightEvidence`、`ScriptFinding`、`ScriptEntrypoint`。
- `src/script-preflight/entrypoint-resolver.ts`
  - 从 toolName + params 解析脚本入口。
- `src/script-preflight/safe-script-reader.ts`
  - 安全读取脚本内容，计算 hash/size/mtime。
- `src/script-preflight/script-scanner.ts`
  - 对脚本内容进行静态规则扫描。
- `src/script-preflight/dispatcher-parser.ts`
  - 解析 `package.json scripts`、`Makefile`、`Justfile` 等常见 dispatcher。
- `src/script-preflight/evidence-adapter.ts`
  - 将 findings 映射到本地 guard、Go decision、local-console metadata。
- `src/script-preflight/explanation.ts`
  - 生成模板解释；后续接 LLM 解释。

### 插入点

第一期推荐顺序：

1. `before_tool_call` 入口处先运行 `collectScriptPreflightEvidence(event, ctx)`。
2. 将 evidence 注入：
   - `eventForDecision.params.__lynxScriptPreflight`
   - `recordBeforeToolCall.metadataJson.scriptPreflight`
3. 调用 `handleBeforeToolCallDecision(decisionBroker, eventForDecision, ctx)`。
4. 如果 Go block/approval，直接返回。
5. 本地 `guardToolCall()` 使用原始 params + `guardContext.scriptPreflight` 二次兜底。
6. `checkExecBlacklist()` 继续处理命令级黑名单。

注意：

- 不建议直接修改真实 tool params，避免影响用户命令执行。
- `__lynxScriptPreflight` 只进入裁决请求，不进入最终工具执行。

### Go 裁决扩展

第一期最小改法：

- 在 `tool_request.go` 的 `toolArgsFlatText()` 中，`__lynxScriptPreflight` 会被扁平化。
- 新增 helper 从 `req.ToolArgs["__lynxScriptPreflight"]` 读取结构化 findings。
- 在 `rules_tool.go` 增加脚本 evidence rules：
  - high confidence `download_execute + dynamic_eval` -> L4 deny
  - `credential_access + external_exfiltration` -> L4 deny
  - `persistence + silent_mode` -> L3/L4
  - `destructive_mutation` -> L4 deny

第三期正式改法：

- 扩展 `DecisionRequest`：
  - `scriptEvidence?: ScriptPreflightEvidence[]`
  - `resourceEvidence?: ResourcePolicyEvidence[]`
- 扩展 `EvidenceSource`：
  - `script`
  - `resource_policy`
- Go DTO、OpenAPI、repo、frontend 同步更新。

## 阶段计划

### 第一期：脚本预检增强 + 拒绝解释

目标：

- 在不改 DB 大结构的前提下，先让工具调用前能读脚本、扫脚本、形成 evidence，并参与拒绝/审批。

任务：

1. 新建 `src/script-preflight/*` 模块。
2. 实现入口识别：
   - direct interpreter
   - inline payload
   - package runner
   - build/task runner
   - write/edit/apply_patch 脚本投放
3. 实现安全读取：
   - 路径解析
   - 大小限制
   - hash/mtime/size
   - 读取失败分类
4. 实现内容扫描规则：
   - 复用 `detectOperationGradeConcealedExecution()`
   - 增加 download-exec、credential-exfil、persistence、destructive mutation 等规则
5. 在 `tool-hooks.ts` 的 `handleBeforeToolCallDecision()` 前注入 evidence。
6. Go `rules_tool.go` 增加脚本 evidence 规则。
7. block reason 使用模板解释。
8. local-console `beforeToolCall.metadataJson` 记录 script preflight evidence。

验收：

- `exec.command = "python bad.py"`，`bad.py` 中含 `requests.post(... open('.env'))`，拒绝并解释。
- `exec.command = "npm run build"`，`package.json scripts.build` 指向危险脚本，拒绝或审批。
- `write` 写入危险 `.ps1`，不执行也记录/拒绝高危投放。
- `write` 写普通脚本不误拦。
- `node -e "eval(Buffer.from(...))"` 继续由现有 concealed execution 路径拒绝。

### 第二期：策略产品化 + taint 关联 + UI

目标：

- 把用户黑白名单、受保护目录、脚本 findings、脚本 taint 做成可维护能力。

任务：

1. Go 后端新增策略表：
   - `policy_rules`
   - `protected_resources`
   - `policy_versions`
   - `script_findings`
   - `script_taints`
2. 新增策略 API：
   - 查询/新增/修改/禁用黑白名单
   - 查询/新增/修改/禁用受保护目录
   - 查询脚本 findings 和 taint
3. 前端新增配置页：
   - 黑白名单管理
   - 受保护目录管理
   - 权限预设：`deny_all/read_only/no_modify/no_delete`
4. 实现 `script_taints`：
   - 写入/修改危险脚本时记录 taint。
   - 后续 `exec` 命中相同 `realpath` 或 `sha256` 时继承风险。
5. 审计增强：
   - tool_calls metadata 展示 script preflight 摘要。
   - decisions / decision_evidence 展示脚本规则命中。
6. LLM 解释层接入：
   - 只解释 evidence。
   - 失败走模板。

验收：

- 用户添加受保护目录后，读/写/删按权限预设裁决。
- 白名单不能放行 L4。
- 写入危险脚本后，后续间接执行能关联 taint。
- UI 能看到脚本 finding、规则命中、解释文本。

### 第三期：Go 统一裁决 + 策略版本化 + 托管执行研究

目标：

- 让 Go 成为策略权威，TS 插件主要负责 hook、采集、桥接、解释展示。

任务：

1. 扩展共享 DTO：
   - `DecisionRequest.scriptEvidence`
   - `DecisionRequest.resourceEvidence`
   - `EvidenceSource = "script" | "resource_policy"`
2. Go evidence scorer 原生处理脚本 evidence。
3. 策略版本化：
   - 每次策略修改生成 `policyVersion`。
   - decisions/audit_events/tool_calls 带版本号。
4. 决策链可回放：
   - tool 参数摘要
   - 脚本 hash
   - findings
   - 命中规则
   - 最终裁决
   - LLM 解释摘要
5. 降级策略：
   - Go 不可用时，L4 本地 fast path 仍 fail-closed。
   - 普通风险可 requireApproval 或 warn。
6. Go managed executor / OS sandbox 只作为研究项：
   - 只有确认 OpenClaw core 能强制路由普通 exec，或接入真实 OS/container sandbox 后再推进。
   - 不作为第一、二期交付前提。

验收：

- Go 决策记录完整保存脚本 evidence。
- 策略版本可回放。
- TS 与 Go 对同一脚本风险输出一致。
- 后端不可用时仍能拦截本地 L4。

## 非目标

- 第一期不做 Go managed executor。
- 第一期不做完整 shell 解释器。
- 第一期不递归无限解析 import/source/include。
- 不把 `no_execute` 加入目录权限模型。
- 不让 LLM 决定是否放行。
- 不把完整恶意脚本直接塞给 LLM。

## 风险与约束

- 静态扫描无法证明脚本运行时一定不会做危险行为。
- 动态下载二阶段 payload 只能通过 pattern/taint/审批策略降低风险。
- package/build/task runner 的解析必须有深度和大小上限。
- 需要避免把 evidence 注入真实 tool params 后影响执行。
- 中文文案和已有文件中存在 mojibake，后续改文案时要小步 UTF-8 检查。

## 推荐执行顺序

1. 写测试夹具：恶意 Python/PowerShell/Node/Package script。
2. 实现 `src/script-preflight/types.ts`。
3. 实现入口解析。
4. 实现安全读取。
5. 实现脚本扫描。
6. 接入 `before_tool_call`，先只记录 metadata，不拦截。
7. 接入 Go decision 最小 evidence 规则。
8. 打开高危 block。
9. 增加模板解释。
10. 再考虑 LLM 解释。

