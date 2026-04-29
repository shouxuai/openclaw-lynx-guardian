# 07. Skill, Token, Frontend Observability Spec

## 目标

补齐 Skill 供应链保护、Token usage 展示语义、前端可解释日志。

## Skill 供应链

新增 hook：

- `before_install`

插件行为：

- 本地 L4 快速拒绝明显恶意安装。
- 调用 Go `/decision/install`。
- 上报 install event。

Go 行为：

- 扫描安装目标。
- 记录 `targetType`、`targetName`、`sourcePath`、`builtinScan`。
- 保存 Skill hash、baseline、findings。
- 维护 inventory。

前端新增：

- `frontend/src/api/skills.ts`
- `frontend/src/pages/SkillsPage.tsx`
- nav 增加 Skills / Supply Chain。

## Token usage

展示必须区分：

- `actual`
- `estimated`
- `unavailable`

规则：

- 成本统计只聚合 actual。
- estimated 只显示上下文压力和趋势。
- provider 没返回 usage 时，不虚构真实成本。

插件侧：

- `llm_output.usage` 有值就上报 actual。
- 无值时可以上报 unavailable。
- 估算逻辑单独标记，不混入 official totals。

## 前端可观测性

新增或增强页面：

- Decisions：展示 arbiter、score breakdown、matched rules。
- Chains：展示多轮链路、taint、grant。
- Grants：展示 allow-current-chain 状态。
- Skills：展示 Skill inventory 和 findings。
- Tokens：区分 actual / estimated / unavailable。

现有页面增强：

- Events 详情展示 `decisionId`、`winningArbiter`、`block:false` 解释。
- Tool Calls 展示 taint、data exfil signal、approval/grant。
- Approvals 展示 grant scope 和 revoked reason。
- Lynx Checks 展示 task 状态机和 evidence。

## 中文文案

所有前端新增文案必须可读中文。

已知需要修复：

- `frontend/src/app/nav-config.ts` 当前存在中文乱码。

