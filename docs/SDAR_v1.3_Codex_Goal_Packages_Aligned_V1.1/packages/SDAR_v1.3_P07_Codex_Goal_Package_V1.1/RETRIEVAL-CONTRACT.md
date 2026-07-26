# P07 Retrieval Contract

## 1. Active-only

在线索引只允许：

```text
status=active
active_pointer=current
dependency_state=not_known_invalid
tenant_scope=authorized
```

以下状态永不进入：

```text
discovered
candidate
validating
awaiting_approval
revalidating
deprecated
archived
rejected
```

## 2. Progressive Loading

### Level 0

```text
artifact ref
type
task type
domain
tenant
risk
status
exact patterns
structured hints
embedding
active pointer version
```

### Level 1

```text
applicability
required capability
required parameters
dependency snapshot
validation summary
```

### Level 2

```text
full definition
lineage
promotion summary
known limitations
counterexample summary
```

只在上一级通过筛选后加载下一级。

## 3. Exact Retrieval

- Exact Pattern；
- Explicit Artifact Ref；
- Task Type；
- Structured Identifier；
- Domain Alias。

Exact Match 不等于 Applicable。

## 4. Structured Retrieval

过滤：

- Tenant；
- Domain；
- Task Type；
- Artifact Type；
- Risk；
- Environment Class；
- Device Class；
- Feature Flag。

## 5. Semantic Retrieval

- 使用 Artifact Projection；
- Embedding Version 固定；
- Threshold 可配置；
- 记录 Query Hash；
- 不读取 Memory 作为 Artifact Authority；
- 不跨 Tenant；
- 结果必须继续走 Applicability。

## 6. Ranking

排序优先级：

```text
exact applicability
lower risk
higher validation confidence
more specific condition
newer verified version
lower expected cost
```

## 7. Ambiguity

前两名差距低于配置阈值时：

```text
fallback / require_confirmation
```

禁止随机选取。

## 8. Tie-break

最终 Tie-break 必须稳定，例如：

```text
artifact key
artifact version
artifact id
```

Tie-break 只解决显示顺序，不解决业务歧义。
