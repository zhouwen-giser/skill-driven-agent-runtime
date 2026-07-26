# Codex Goal Prompt：执行 SDAR v1.3 P10

你正在执行 SDAR v1.3 十四个正式任务包中的 P10。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P10
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

将 P07 Artifact Retrieval / Applicability、P09 Decision Rule Runtime、P08 Plan Template Runtime 和现有 v1.2.3 Cognitive Runtime 集成为一个有界、可解释、Fail-closed、可降级的 Fast Gateway，并建立完整反馈闭环。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00～P09 Handoff；
3. P06 Active / Revalidating / Kill Switch；
4. P07 Retrieval / Applicability / Binding / Policy；
5. P08 Template Runtime / Formal Handoff；
6. P09 Rule Runtime / Conflict / Policy；
7. v1.2.3 Request Entry、Interactive Goal、Interactive Planning、Cognitive Runtime；
8. v1.2.2 Goal、Plan、Workflow、Outcome、Recovery；
9. 当前 API / A2A / SSE / Console / Telemetry / Feature Flag / Rate Limit / Auth；
10. 当前 Idempotency、Deadline、Cancellation、Circuit Breaker 和 Error Envelope。

## 强制执行顺序

```text
Baseline
→ Handoff Validation
→ Gateway Contract
→ Request Context Freeze
→ Auth / Tenant / Deadline
→ Active / Kill Switch Snapshot
→ P07 Retrieval / Applicability
→ P09 Rule Runtime
→ P08 Template Runtime
→ Cognitive Fallback
→ Confirmation / Deny
→ Formal Handoff Correlation
→ Deadline / Cancellation / Circuit Breaker
→ Decision Evidence
→ Feedback Collection
→ Drift / Revalidation
→ API / A2A / Console
→ Performance / SLO
→ Tests
→ Evidence
→ Read-only Review
→ Commit / Push / Draft PR
```

## 必须实现

- FastGateway Port；
- GatewayRequestContext；
- GatewayDeadline；
- GatewayDecision；
- GatewayResult；
- Deterministic orchestration order；
- P07 / P09 / P08 adapters；
- Intent Route handling；
- Deny / Confirm / Fallback；
- Cognitive Runtime fallback；
- Deadline budget allocation；
- Timeout；
- Cancellation；
- Stale snapshot guard；
- Kill switch；
- Feature flag；
- Circuit breaker；
- Bulkhead；
- Load shedding；
- Idempotency；
- Duplicate request protection；
- Gateway decision audit；
- Reason code catalog；
- Formal Handoff correlation；
- Artifact usage correlation；
- Outcome / Correction / Recovery / Fallback feedback；
- Drift signal；
- Revalidation signal；
- Runtime metrics；
- OpenAPI / A2A / SSE / Console evidence；
- P11 Handoff。

## 禁止实现

- P07 Retrieval / Ranking 重实现；
- P07 Applicability / Binding 重实现；
- P09 Rule DSL / Conflict 重实现；
- P08 Template Instantiation / Validator / Handoff 重实现；
- 第二套 Policy Engine；
- 第二套 Planner；
- 直接创建 Skill Attempt；
- 直接启动 Workflow；
- 直接调用 Skill / MCP；
- 自动批准 / 激活 Artifact；
- 自动修改 Artifact；
- Case Runtime；
- Model Cascade；
- 超时后继续后台提交正式 Plan；
- 快路径失败后吞掉错误并伪装成功。

## 核心编排顺序

```text
1. Auth / Tenant / Deadline / Kill Switch
2. P07 Active Artifact Retrieval + Applicability
3. P09 Rule Runtime
4. P08 Plan Template Runtime
5. Existing v1.3 Cognitive Fallback
```

Policy Deny、Authorization 缺失、Kill Switch 和 Critical Safety 不能进入普通 Fallback 后继续执行。

## 完成后

交付 P11 Handoff。P11 可扩展 Case Template 和 Model Route，但不得改变 P10 的正式权威顺序、Fallback 语义、Deadline 或 Policy 边界。
