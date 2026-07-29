# MASTER GOAL：SDAR v1.3 P10

## Goal ID

```text
SDAR-V1.3-P10
```

## 原子 Goal

```text
G17：Fast Gateway 与在线闭环编排
G18：Artifact Feedback、Drift 与再编译触发
```

## 目标

建立：

```text
Incoming Request
        |
        v
Fast Gateway
        |
        +→ P07 Retrieval / Applicability
        |
        +→ P09 Decision Rule
        |
        +→ P08 Plan Template / Formal Handoff
        |
        +→ v1.3 Cognitive Fallback
        |
        v
Formal Goal / Plan / Outcome Authority
        |
        v
Usage / Outcome / Correction / Drift Feedback
```

## 输入权威

- Authenticated Request；
- Tenant / Authorization；
- Deadline / Cancellation；
- P06 Active / Kill Switch；
- P07 Candidate Decision；
- P09 Rule Decision；
- P08 Template / Formal Handoff；
- Existing Cognitive Runtime；
- Formal Goal / Plan / Attempt / Workflow / Outcome；
- Artifact Usage；
- Current Policy / Catalog / Readiness。

## 输出权威

P10 输出：

```text
GatewayDecision
GatewayResult
GatewayDecisionRecord
GatewayFeedbackEnvelope
GatewayDriftSignal
```

P10 不成为 Goal、Plan、Workflow 或 Outcome 权威。

## 权威边界

```text
Authorization / Safety Policy
> Gateway Route

P07 / P09 / P08 Domain Ports
> Gateway Orchestration

Existing Formal Planner / UserGoalPlanController
> Gateway Decision

Existing Workflow / Outcome
> Gateway Feedback Projection

P06 Active Pointer / Kill Switch
> Gateway Cache

Deadline / Cancellation
> Background Continuation
```

## 完成合同

- 统一请求入口只编排，不重实现子系统；
- Auth / Tenant / Policy / Kill Switch 先执行；
- 只有 Active Artifact 可进入 Fast Path；
- Rule / Template 均通过现有正式权威；
- Cognitive Fallback 保持可用；
- Deny 不被普通 Fallback 绕过；
- Confirm 进入正式 Interaction；
- Deadline / Cancellation 全链路传播；
- 超时后不得继续提交正式 Plan；
- Circuit Breaker / Bulkhead 隔离；
- 决策可解释、可审计；
- 正式 Outcome 与 Artifact Usage 可关联；
- Drift / Revalidation 信号完整；
- 不实现 Case / Model Route Runtime；
- P11 Handoff 完整。
