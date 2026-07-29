# P08 Formal Handoff Authority Contract

## 1. 复用现有权威

P08 必须调用现有：

- Plan Validator；
- Interactive Planning Session；
- Plan Confirmation；
- Goal Version Lock；
- UserGoalPlanController；
- Transaction / Outbox；
- A2A / Console Evidence。

不得复制状态机或规则。

## 2. Handoff 顺序

```text
Materialized Plan Candidate
→ Existing Plan Validator
→ Existing Planning Session
→ User / Policy Confirmation（如需要）
→ Goal Version / Plan Version CAS
→ Existing UserGoalPlan Creation
→ Existing Planner / Workflow Handoff
```

## 3. 自动确认边界

P08 本身不能决定自动确认。

是否可以无新增用户确认，必须由：

- Confirmed Goal Contract；
- Existing Policy；
- Existing Planning Session；
- Risk Rule；
- P10 Gateway Policy（未来）；

共同决定。

P08 只提供“是否存在新增确认需求”的事实。

## 4. Goal Version Lock

正式提交时必须校验：

- Goal ID；
- Goal Version；
- Plan Candidate Hash；
- Artifact Hash；
- Runtime Snapshot Hash；
- Idempotency Key。

Goal Version 变化时：

```text
discarded_stale / fallback
```

## 5. Idempotency

重复提交同一：

```text
goal version
artifact hash
plan candidate hash
idempotency key
```

只能产生一个正式 Handoff 结果。

## 6. Failure

以下不得部分提交：

- Validator Fail；
- Confirmation Missing；
- Goal Lock Fail；
- Artifact Stale；
- Policy Changed；
- Readiness Changed；
- Outbox Fail；
- Transaction Fail。

## 7. 正式执行

P08 不调用 Skill / MCP。

正式 Plan 被现有 UserGoalPlanController 接受后，后续执行仍由现有 Workflow / Attempt / Outcome 权威负责。
