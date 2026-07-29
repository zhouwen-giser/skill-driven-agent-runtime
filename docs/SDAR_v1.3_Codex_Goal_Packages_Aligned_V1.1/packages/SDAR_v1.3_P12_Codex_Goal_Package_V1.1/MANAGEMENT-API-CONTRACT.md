# P12 Management API Contract

## Query API

至少提供：

```text
GET /artifacts
GET /artifacts/{id}
GET /artifacts/{id}/versions
GET /artifacts/{id}/diff
GET /artifacts/{id}/lineage
GET /artifacts/{id}/validation
GET /artifacts/{id}/shadow
GET /artifacts/{id}/promotion
GET /artifacts/{id}/approvals
GET /artifacts/{id}/activations
GET /artifacts/{id}/usage
GET /artifacts/{id}/outcomes
GET /artifacts/{id}/drift
GET /artifacts/{id}/audit
GET /runtime/decisions
GET /runtime/decisions/{id}
GET /runtime/model-usage
GET /runtime/case-usage
```

实际路径须服从现有 API 约定。

## Command API

至少覆盖：

```text
submit for validation
request shadow
build promotion package
approve / reject
activate
request revalidation
deprecate
rollback
kill switch enable / disable
feature flag update（若现有权限模型允许）
```

## Command 字段

必须包括：

- idempotency key；
- expected version；
- reason；
- target id；
- tenant context；
- optional comment。

身份不得从 Body 读取。

## 状态码

应统一映射：

```text
400 schema / invalid transition
401 unauthenticated
403 unauthorized / tenant denied
404 not found
409 version conflict / idempotency conflict / transition conflict
412 precondition / stale evidence
422 domain validation
429 rate limit
503 dependency unavailable
```

## Pagination / Filter

至少支持：

- cursor；
- limit；
- status；
- type；
- tenant；
- task type；
- risk；
- date；
- active；
- drift severity。

## Query Projection

Query API 不得直接拼装业务规则，应使用正式 Query Service。

## Write Projection

Command API 只能调用正式 Application Command / Governance Port。

## Sensitive Data

默认不返回：

- Credential；
- Raw Provider Config；
- Internal Skill Secret；
- Raw Prompt；
- Private Experience；
- Private Reasoning；
- Full User PII。

## ETag / Version

详情和命令应支持：

- version；
- ETag 或等价版本字段；
- expectedVersion；
- stale error。
