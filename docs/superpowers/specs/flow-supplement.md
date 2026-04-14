下面继续补两张细图。

**1. 模型侧提示词注入防护子流程图**

```mermaid
flowchart TD
    U["用户输入 / 网页 / 文件 / 工具结果"]
    N["内容归一化"]
    T["来源判定"]
    E["内容封装"]

    O["可信任务主线<br/>Trusted Objective"]
    H["历史安全状态<br/>Session Security State"]

    S1["注入信号提取<br/>direct / indirect / role / probe"]
    S2["证据链赋分<br/>harm rev auth pattern clarity chain taint"]
    P["模型防御姿态判定<br/>normal / aware / strict / quarantine"]

    I1["普通上下文"]
    I2["安全预警注入"]
    I3["严格护栏注入"]
    I4["隔离态注入"]

    M["模型"]

    U --> N --> T --> E
    E --> S1 --> S2 --> P
    H --> S2
    O --> P

    P -->|normal| I1
    P -->|aware| I2
    P -->|strict| I3
    P -->|quarantine| I4

    O --> M
    I1 --> M
    I2 --> M
    I3 --> M
    I4 --> M
```

这张图对应的语义是：

- 先把外部内容分清楚“谁有指令权，谁只是数据”。
- 再提取注入信号，接入新版证据链赋分。
- 最后不是直接让模型判断能不能执行，而是先决定给模型戴多厚的护栏：
  - `normal`
  - `aware`
  - `strict`
  - `quarantine`

也就是：

- 模型防线负责“不被带偏”
- 不负责“最后拍板”

---

**2. `before_tool_call` 裁决树图**

```mermaid
flowchart TD
    A["before_tool_call"]
    B["工具事件归一化"]
    C["资源分类"]
    D["攻击图判断"]
    E["Artifact Taint 判断"]
    F["Skill Guard 判断"]
    G["证据链赋分"]
    H["Policy Engine"]

    A --> B --> C
    C --> D
    C --> E
    C --> F
    D --> G
    E --> G
    F --> G
    G --> H

    H --> I{"是否硬红线?"}
    I -->|是| D1["deny<br/>直接拒绝"]
    I -->|否| J{"是否越界或条件不足?"}
    J -->|是| D2["block<br/>阻断并要求补条件"]
    J -->|否| K{"是否单步高风险?"}
    K -->|是| D3["confirm<br/>单次确认"]
    K -->|否| L{"是否连续工作流?"}
    L -->|是| D4["workflow_auth<br/>开启短时范围授权窗口"]
    L -->|否| M{"是否弱风险?"}
    M -->|是| D5["warn<br/>放行但抬高警惕"]
    M -->|否| D6["allow<br/>正常放行"]
```

这张图里几种语义可以再对应得更直白一点：

- `deny`
  - 红线
  - 用户确认也不放
- `block`
  - 现在不行
  - 需要补条件、缩范围、看清内容后再来
- `confirm`
  - 这一步可以做
  - 但必须你明确批准这一次
- `workflow_auth`
  - 不是批一次
  - 是给一个短时、限范围的连续施工窗口
- `warn`
  - 先放
  - 但后续护栏拉高
- `allow`
  - 正常通过

---

**3. 新版证据链赋分在这两张图里的位置**
你刚才特别提醒“别漏掉新版证据链赋分”，这里再明确一下它在两张图里的职责：

在模型侧图里：

- 它决定模型护栏厚度
- 也就是 `normal / aware / strict / quarantine`

在工具侧图里：

- 它不直接决定最终放行
- 而是给 `Policy Engine` 提供风险热度、攻击链推进程度、taint 污染程度

所以新版赋分层不是旧时代那种“一个总分裁决天下”，而是：

- 模型侧：决定护栏姿态
- 工具侧：决定灰区升级路径
- 输出侧：决定泄漏严重度和替换等级

如果你认可这两张细图，下一步我就把它们整理成正式设计文档结构，并开始进入“新工作树 + 分模块实施计划”。
