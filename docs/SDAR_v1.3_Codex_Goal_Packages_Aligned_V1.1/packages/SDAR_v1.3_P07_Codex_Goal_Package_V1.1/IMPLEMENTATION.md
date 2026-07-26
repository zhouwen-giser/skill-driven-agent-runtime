# P07 Implementation Plan

## G13：Artifact Index、Semantic Retrieval 与候选排序

### 1. Handoff Validator

校验 P06：

- Active Query Port；
- Active Pointer Version；
- Revalidating / Deprecated Exclusion；
- Cache Invalidation；
- Feature Flag；
- Kill Switch。

### 2. Index Projection

建立 Level-0 Active Index：

- PostgreSQL 权威；
- Redis / pgvector / FTS 投影；
- Active-only；
- Tenant Scope；
- Artifact Version；
- Pointer Version；
- Catalog / Policy Hash。

### 3. Exact Retrieval

实现：

- Explicit Artifact Ref；
- Exact Pattern；
- Task Type；
- Domain Alias；
- Structured Identifier。

### 4. Structured Retrieval

实现 Tenant、Domain、Task Type、Artifact Type、Risk、Environment、Device 和 Feature Flag 过滤。

### 5. Semantic Retrieval

复用现有 Embedding 基础设施：

- Projection；
- Version；
- Threshold；
- Query Hash；
- Tenant Isolation；
- No Memory Authority；
- Progressive Loading。

### 6. Progressive Loading

实现 L0→L1→L2，记录每级 Load / Filter Reason。

### 7. Ranking

实现可解释 Score，但总分只排序。

### 8. Ambiguity

候选接近、条件矛盾或多 Active 冲突时返回 Fallback / Confirm。

### 9. Cache

- Active Pointer Event；
- Revalidation Event；
- Policy / Catalog Change；
- Kill Switch；
- Redis Flush Rebuild；
- Duplicate Event Idempotency。

## G14：Applicability、参数绑定与依赖有效性

### 10. Applicability Evaluator

执行 Required / Optional / Forbidden Condition。

### 11. Parameter Binder

按固定优先级绑定，并保存 Source / Trust / Confidence。

### 12. Dependency Validator

检查 Catalog、Policy、Task Type、Schema、Compiler、Validator / Promotion Version。

失配发送 Revalidation Trigger，但 P07 不修改 Status。

### 13. Capability / Skill

用 Internal Runtime Capability Query，获得当前 Skill Candidate。

### 14. Readiness

执行当前 Provider Readiness / Availability。

### 15. Policy

执行 Safety Policy：

```text
allow
deny
require_confirmation
```

### 16. OOD / Uncertainty

计算：

- Environment Novelty；
- Device Novelty；
- Unknown Constraint；
- Missing Parameter；
- Ambiguous Candidate；
- Confidence；
- Risk。

### 17. Candidate Decision

输出：

```text
eligible
requires_adaptation
fallback
require_confirmation
deny
```

### 18. Match / Applicability Audit

保存：

- Candidate；
- Score；
- Filters；
- Conditions；
- Bindings；
- Dependency；
- Capability；
- Readiness；
- Policy；
- Reason Code；
- Snapshot Hash。

### 19. Performance

目标参考：

```text
Exact Retrieval P95 < 10ms
Active Index Retrieval P95 < 50ms
Applicability P95 < 30ms
```

目标必须在真实规模基准中验证，不得为达标省略硬门禁。

### 20. Tests / Evidence

完成 Unit、Contract、Integration、E2E、Security、Cache、Performance 和 Read-only Review。
