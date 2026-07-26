# P07 Execution Policy

## 模型

```text
GPT-5.6 Sol Medium
```

一个主执行 Agent。独立只读 Review 使用新会话。

## 检索权威

```text
PostgreSQL Active Artifact / Active Pointer
> Redis Cache
> Embedding Index
> Memory Projection
```

Memory、Embedding 和 Cache 只用于检索投影，不能证明 Artifact 仍为 Active。

## 检索顺序

```text
Exact Pattern
→ Structured Hint
→ Semantic Retrieval
→ Optional Small-model Classification Candidate
```

Exact 命中只缩小候选，不授予执行资格。

## Ranking 与 Hard Gate

Ranking 只排序。

Hard Gate 包括：

- Status；
- Tenant / Authorization；
- Required / Forbidden Condition；
- Required Parameter；
- Dependency；
- Capability；
- Skill；
- Readiness；
- Policy；
- OOD；
- Critical Uncertainty。

任何硬门禁失败都不能由高分覆盖。

## 参数优先级

```text
User-confirmed Goal Contract
> Explicit Request Field
> Trusted World State
> Runtime Context
> Scoped Low-risk Preference
> Small-model Candidate
```

以下不得模型默认：

- Goal；
- Target；
- Scope；
- Completion Criterion；
- Authorization；
- Safety Constraint；
- High-risk Parameter。

## Readiness

Historical Success、Replay、Shadow、Promotion 不能证明当前 Provider Ready。

必须使用当前 Readiness / Availability。

## 模型边界

模型可以产生：

- Intent / Task Type Candidate；
- 低风险参数候选；
- 语义解释。

模型结果必须：

- Schema；
- Source；
- Confidence；
- Audit；
- no-op；
- 不成为 Authoritative Binding；
- 不覆盖 Policy。

## Cache

Cache Key 必须包含：

- Artifact Version；
- Active Pointer Version；
- Tenant；
- Catalog Hash；
- Policy Hash；
- Schema Version。

Cache 失效或 Redis 丢失时从 PostgreSQL 重建。

## Git

建议至少：

```text
feat(v1.3): retrieve active runtime artifacts
feat(v1.3): evaluate artifact applicability
docs(v1.3): record P07 evidence
```

不 Merge，不 Tag。
