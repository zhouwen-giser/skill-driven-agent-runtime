# P11 Execution Policy

## 模型

```text
GPT-5.6 Sol Medium
```

一个主执行 Agent。独立只读 Review 使用新会话。

## Adapter 原则

P11 只能通过 P10 Adapter Registry 增加：

```text
case_template adapter
model_route adapter
```

不得在 P10 Gateway Core 中嵌入类型专用算法。

## Case 权威

```text
Confirmed Goal / Current Constraints
> Historical Case

Current Policy / Readiness
> Historical Success

Existing Plan Validator
> Case Similarity

Formal Planner
> Case Adaptation Confidence
```

## Model Route 权威

```text
Policy / Data Classification
> Route Artifact

Deadline / Budget
> Model Quality Preference

Current Provider Readiness / Capacity
> Historical Model Reliability

Output Schema / Validator
> Model Confidence / Self-report

Formal Outcome
> Model Evaluation
```

## 模型 Route 边界

Artifact 可以保存：

- model capability class；
- quality tier；
- latency tier；
- cost tier；
- context requirement；
- fallback order；
- validation requirement。

Artifact 不得保存：

- API Key；
- Credential；
- Secret；
- 原始 Endpoint Token；
- 未授权 Provider；
- 动态代码。

## 级联

允许：

```text
deterministic / small
→ medium
→ large
→ cognitive fallback
```

每一步必须有：

- Entry Condition；
- Budget；
- Deadline；
- Output Schema；
- Escalation Reason；
- Maximum Attempts；
- Circuit / Rate Limit。

## 自评边界

模型自报置信度只作为 Candidate Signal。

不能：

- 直接通过验证；
- 覆盖 Policy；
- 证明 Outcome；
- 授权高风险行为；
- 跳过人工确认。

## Git

建议至少：

```text
feat(v1.3): adapt active case templates
feat(v1.3): route and cascade model invocations
docs(v1.3): record P11 evidence
```

不 Merge，不 Tag。
