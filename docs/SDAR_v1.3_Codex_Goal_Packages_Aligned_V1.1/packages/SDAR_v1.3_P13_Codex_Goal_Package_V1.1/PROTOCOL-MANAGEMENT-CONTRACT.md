# P13 Protocol / Management Contract

## OpenAPI

- Schema 与实现一致；
- Operation Inventory；
- Error；
- Pagination；
- ETag / Version；
- Idempotency；
- Auth；
- Redaction。

## Console

- Registry；
- Governance；
- Runtime Evidence；
- Case / Model；
- Cost / Drift；
- Accessibility；
- Security；
- No Fixture product path。

## A2A

- Agent Card；
- Public Capability Allowlist；
- Input-required；
- Confirmation；
- Formal Task State；
- SSE；
- MUST TCK；
- Backward Compatibility。

## SSE

- Event Source；
- Tenant/Auth；
- Resume；
- Dedup；
- Overflow；
- Slow Consumer；
- Redaction；
- No State Authority。

## Compatibility

Feature Flag Off：

```text
v1.2.3 behavior preserved
```

## 失败标准

- Breaking public API；
- A2A formal state drift；
- Console bypass；
- Sensitive exposure；
- OpenAPI mismatch；
- TCK failure。

任一未关闭：

```text
RELEASE_CANDIDATE_BLOCKED
```
