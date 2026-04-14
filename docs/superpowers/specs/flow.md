把它拆成 3 张更小的图来画，这样更容易显示，也把“新版证据链赋分”单独画进去了。

**1. 总体新架构图**

```mermaid
flowchart TD
    U["用户输入 / 外部内容"]
    MR["message_received"]
    IN["输入归一化"]
    SX["输入信号提取"]
    ES["证据链赋分层"]
    IP["输入策略"]
    BAS["before_agent_start"]
    OBJ["可信任务主线"]
    MD["模型防御注入"]
    M["模型"]

    BTC["before_tool_call"]
    TN["工具事件归一化"]
    RC["资源分类"]
    AG["攻击图判断"]
    AT["Artifact Taint"]
    SG["Skill Guard"]
    TP["执行前策略主闸"]

    EX["执行工具"]
    SU["状态更新"]
    SS["Session Security State"]

    OUT["输出链路"]
    OP["输出策略"]
    SEND["发送 / 持久化"]

    U --> MR --> IN --> SX --> ES --> IP
    SS --> SX

    IP -->|deny / block / confirm| IH["输入阻断 / 待确认"]
    IP -->|warn / allow| BAS

    BAS --> OBJ
    BAS --> MD
    ES --> MD
    SS --> OBJ
    OBJ --> M
    MD --> M

    M --> BTC --> TN --> RC
    RC --> AG
    RC --> AT
    RC --> SG
    SS --> AG

    AG --> ES
    AT --> ES
    SG --> ES

    ES --> TP

    TP -->|deny| TD["直接拒绝"]
    TP -->|block| TB["阻断并补条件"]
    TP -->|confirm| TC["单次确认"]
    TP -->|workflow_auth| TW["工作流授权窗口"]
    TP -->|warn / allow| EX

    TC --> PO["Pending Override"]
    TW --> WA["Workflow Auth Store"]

    EX --> SU
    SU --> SS
    SU --> AT

    EX --> OUT --> OP
    ES --> OP
    OP -->|allow| SEND
    OP -->|sanitize / replace / block| OB["脱敏 / 替换 / 阻断"]
```

**2. 新版证据链赋分图**

```mermaid
flowchart LR
    I1["输入证据"]
    I2["工具证据"]
    I3["输出证据"]
    I4["会话攻击图"]
    I5["Artifact Taint"]
    I6["Skill 证据"]

    N["证据标准化"]

    D1["harm"]
    D2["rev"]
    D3["auth"]
    D4["pattern"]
    D5["clarity"]
    D6["chain"]
    D7["taint"]

    A["证据链聚合"]
    R1["风险姿态"]
    R2["解释结果"]
    P["Policy Engine"]

    I1 --> N
    I2 --> N
    I3 --> N
    I4 --> N
    I5 --> N
    I6 --> N

    N --> D1
    N --> D2
    N --> D3
    N --> D4
    N --> D5
    N --> D6
    N --> D7

    D1 --> A
    D2 --> A
    D3 --> A
    D4 --> A
    D5 --> A
    D6 --> A
    D7 --> A

    A --> R1
    A --> R2

    R1 --> P
    R2 --> P
```

这张图里可以这样理解：

- 旧 5 维保留：`harm / rev / auth / pattern / clarity`
- 新增 2 维：`chain / taint`
- 聚合后不是直接替代裁决，而是给 `Policy Engine` 提供：
  - `风险姿态`
  - `解释结果`

也就是：

- 赋分层负责“把证据热度算清楚”
- `Policy Engine` 负责“最后拍板”

**3. 状态持续检测与回收图**

```mermaid
flowchart TD
    S["Session Security State / Artifact Taint"]

    S --> R1["1. sessionKey 变更 -> 隔离"]
    S --> R2["2. 长时间无活动 -> 过期"]
    S --> R3["3. 任务主线切换 -> trusted objective 重置"]
    S --> R4["4. agent_end / 工作流结束 -> workflow_auth 回收"]
    S --> R5["5. 连续 4 到 5 个安全无关 turn -> 风险衰减"]
    S --> R6["6. artifact 删除 / 重写 / 超时 -> 清 taint"]

    R2 --> T1["输入诱导窗口 15m"]
    R2 --> T2["攻击链窗口 10m"]
    R2 --> T3["普通会话安全态 30m"]
```

如果这次能正常显示，我下一步就继续给你画两张更细的图：

1. `模型侧提示词注入防护子流程图`
2. `confirm / workflow_auth / block / deny` 的决策树图
