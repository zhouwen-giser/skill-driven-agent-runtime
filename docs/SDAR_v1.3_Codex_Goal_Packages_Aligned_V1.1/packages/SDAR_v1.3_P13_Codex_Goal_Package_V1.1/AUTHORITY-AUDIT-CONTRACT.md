# P13 Authority Audit Contract

## 必须证明唯一的权威

### Goal

Confirmed Goal Contract / Formal Goal Authority。

### Plan

Existing UserGoalPlan / UserGoalPlanController。

### Skill / Attempt

Existing Skill Goal / Attempt Authority。

### Workflow

Existing LangGraph / Formal Workflow Runtime。

### Outcome / Recovery

Existing Outcome / Recovery / Terminal Authority。

### Artifact Definition

P02 PostgreSQL Artifact Repository。

### Artifact Active

P06 Approval / Activation / Active Pointer。

### Runtime Retrieval

P07 只读 Active Projection。

### Rule / Template / Case / Model

P08～P11 只生成候选 / 调用正式 Handoff，不拥有 Formal Goal/Plan/Outcome。

### Gateway

P10 只编排。

### Management / A2A / Console

P12 只投影与调用正式 Command。

## Duplicate Authority Scan

至少搜索：

- duplicate plan writer；
- duplicate goal terminal writer；
- direct SQL artifact activation；
- cache-only active state；
- UI direct state mutation；
- A2A task state mutation；
- rule direct execution；
- template direct attempt；
- model direct formal plan；
- worker approval；
- body actor identity；
- Redis-only job authority。

## 结果

每个 Authority 输出：

```text
owner
write ports
read projections
database tables
events
tests
forbidden writers
status
```

任何未解释的第二 Writer：

```text
RELEASE_CANDIDATE_BLOCKED
```
