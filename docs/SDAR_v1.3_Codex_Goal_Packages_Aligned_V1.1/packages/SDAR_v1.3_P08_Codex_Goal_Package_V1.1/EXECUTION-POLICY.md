# P08 Execution Policy

## 模型

```text
GPT-5.6 Sol Medium
```

一个主执行 Agent。独立只读 Review 使用新会话。

## 正式权威

```text
Existing Goal Contract / Goal Version
> Template Definition

Existing Plan Validator
> P04 Static Validator

Existing Interactive Planning / Confirmation
> P08 Confidence

Existing UserGoalPlanController
> P08 Runtime

Existing Workflow / Attempt / Outcome
> Artifact Usage Projection
```

## Template 定位

Template 是：

```text
Plan Candidate Generator
```

Template 不是：

- Goal Authority；
- Planner Authority；
- Skill Selector Authority；
- Workflow Runtime；
- Outcome Authority。

## Skill 边界

Template Node 保留 Capability Requirement。

Runtime 可以调用现有 Skill Selection 读取候选可用性，但不得：

- 将历史 Skill ID 固化为权威；
- 绕过现有 Selection；
- 将 Provider / MCP Tool 写入 Artifact；
- 在 P08 启动 Skill Attempt。

## Adaptation

只允许：

- 已授权参数替换；
- Optional Node 删除；
- 同 Capability 兼容替换；
- 低风险排序调整；
- 已定义 Recovery Branch；
- 现有 Validator 可检查的边。

禁止：

- 改 Goal；
- 改 Required Criterion；
- 扩大 Scope；
- 增加副作用；
- 降低 Safety；
- 创建新 Capability；
- 静默删除 Human Gate；
- 静默修改 Authorization。

## Confirmation

出现以下任一情况：

- P07 require_confirmation；
- 关键参数候选；
- Required Criterion 解释变化；
- Scope / Target 歧义；
- 高风险行为；
- Human Gate；
- 新 Recovery；
- Policy Confirm；

必须进入现有 Interaction / Planning Session。

## 当前状态重检

P07 的结果是候选快照。正式 Handoff 前必须重新检查：

- Artifact Active；
- Artifact Hash；
- Active Pointer Version；
- Goal Version；
- Policy Hash；
- Catalog Hash；
- Provider Readiness；
- Kill Switch。

## Git

建议：

```text
feat(v1.3): instantiate active plan templates
feat(v1.3): hand template plans to formal planner
docs(v1.3): record P08 evidence
```

不 Merge，不 Tag。
