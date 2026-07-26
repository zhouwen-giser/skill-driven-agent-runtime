# P12 Test Plan

## Baseline / Handoff

确认 P00～P11 Commit 为祖先。

## Full Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## Management API

- List / Detail；
- Version / Diff / Lineage；
- Validation / Shadow；
- Promotion / Approval / Activation；
- Revalidation / Deprecation / Rollback / Kill Switch；
- Runtime / Case / Model / Cost / Drift；
- Pagination；
- Filter；
- Sort；
- ETag / Version；
- Idempotency；
- Status Code；
- Error Envelope。

## RBAC / Tenant

测试每个角色：

- View；
- Validation Request；
- Shadow Request；
- Approve；
- Activate；
- Revalidate；
- Rollback；
- Kill Switch；
- Audit。

测试 Cross Tenant、Global Scope、Service Principal、Actor Spoofing。

## Console E2E

- Registry；
- Filters；
- Detail；
- Diff；
- Lineage；
- Validation；
- Shadow；
- Promotion；
- Approve / Reject；
- Activate；
- Revalidate；
- Deprecate；
- Rollback；
- Kill Switch；
- Runtime Timeline；
- Case / Model / Cost；
- Drift；
- Audit；
- Loading / Empty / Error / Permission；
- Stale Version；
- Retry。

## Accessibility

- Keyboard；
- Focus；
- Labels；
- Screen Reader；
- Contrast；
- Table；
- Dialog；
- Error Announcement；
- No Color-only State。

## A2A

- Agent Card；
- Public Capability；
- Artifact-enhanced planning description；
- Input-required；
- Confirmation；
- Formal Task State；
- SSE；
- Redaction；
- Internal Data Absence；
- Existing MUST TCK。

## SSE

- Governance Event；
- Runtime Event；
- Feedback Event；
- Tenant Filter；
- Authorization；
- Redaction；
- Last-Event-ID；
- Resume；
- Duplicate；
- Overflow；
- Slow Client；
- Reconnect；
- Redis Restart；
- Outbox Replay。

## Security

- IDOR；
- Cross Tenant；
- XSS；
- Injection；
- CSRF（适用）；
- Actor Spoofing；
- Role Escalation；
- Stale Version；
- Idempotency Collision；
- Secret Exposure；
- Prompt / Lineage Exposure；
- Export Abuse；
- SSE Subscription Abuse。

## Performance

报告：

- Artifact List / Detail P50/P95；
- Runtime Query；
- Audit Query；
- Console Initial Load；
- SSE Throughput；
- 1k / 10k / 100k Artifacts；
- Pagination；
- Diff / Lineage；
- Concurrent Operators；
- Slow Client；
- A2A Evidence Overhead。

性能优化不得移除权限、Redaction、Version 或 Audit。
