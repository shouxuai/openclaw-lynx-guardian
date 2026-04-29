# 01. Decision Contracts Spec

## 目标

统一插件与 Go 后端之间的裁决契约，让输入、工具、输出、安装扫描都返回可解释的结构化结果。

## 新增共享类型

建议在 `shared/src/decision.ts` 新增类型，并由插件和前端复用。

核心类型：

- `DecisionStage`
- `DecisionAction`
- `RiskLevel`
- `DecisionRequest`
- `DecisionResponse`
- `ArbiterResult`
- `EvidenceItem`
- `ScoreBreakdown`
- `ApprovalRequestDraft`
- `OutputRedaction`

## DecisionStage

```ts
export type DecisionStage =
  | "input"
  | "prompt_context"
  | "tool_call"
  | "tool_result"
  | "assistant_output"
  | "outbound_message"
  | "install";
```

## DecisionAction

```ts
export type DecisionAction =
  | "allow"
  | "log_only"
  | "warn"
  | "redact"
  | "require_approval"
  | "block"
  | "deny";
```

## RiskLevel

```ts
export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";
```

## DecisionResponse

```ts
export interface DecisionResponse {
  decisionId: string;
  stage: DecisionStage;
  block: boolean;
  action: DecisionAction;
  riskLevel: RiskLevel;
  score: number;
  winningArbiter: "semantic_intent" | "evidence_score" | "local_l4" | "grant" | "fallback";
  arbiters: ArbiterResult[];
  matchedModules: string[];
  requiresApproval: boolean;
  approvalRequest?: ApprovalRequestDraft;
  redactions?: OutputRedaction[];
  promptContext?: string;
  userMessage?: string;
  audit: {
    eventSeverity: "info" | "warn" | "error" | "critical";
    policyDecision: DecisionAction;
    enforcementAction: DecisionAction;
    color: "neutral" | "blue" | "yellow" | "orange" | "red";
  };
  degraded?: {
    backendTimeout?: boolean;
    usedCachedDecision?: boolean;
    reason?: string;
  };
}
```

## block:false 语义

`block:false` 只表示未拦截，不等于安全。

前端颜色和日志级别必须看：

- `riskLevel`
- `action`
- `audit.eventSeverity`
- `audit.enforcementAction`

示例：

| block | riskLevel | action | eventSeverity | 含义 |
| --- | --- | --- | --- | --- |
| false | L0 | allow | info | 普通放行 |
| false | L2 | warn | warn | 有风险提示但未拦截 |
| false | L3 | require_approval | warn | 等待审批，不是安全 |
| true | L4 | deny | critical | 硬拒绝 |

## 双判别器

Go 后端必须并行运行：

- `semantic_intent`：意图/语义/上下文判别。
- `evidence_score`：关键词、规则、taint、chain、内容安全信号赋分。

两个判别器不能互相依赖输出。

仲裁规则：

1. 取更高 `riskLevel`。
2. 同级时取更严格 `action`。
3. 本地 L4 永远最高。
4. active grant 只能降到 `allow` 或 `warn`，不能覆盖新 L4。

## 日志要求

每个 `DecisionResponse` 必须能解释：

- 命中了什么。
- 哪条线命中。
- 分数如何变化。
- 为什么没有拦截。
- 是否来自上游内容安全 `is_safe:false`。
- 是否使用 grant。
- 是否 backend degraded。

