# P12 Console Contract

## Registry

展示：

- Artifact Key / Type；
- Version；
- Status；
- Tenant / Domain / Task Type；
- Risk；
- Validation / Shadow；
- Active Pointer；
- Drift；
- Last Updated。

## Detail

分区：

```text
Overview
Definition
Applicability
Dependencies
Lineage
Validation
Shadow
Promotion
Approvals
Activations
Runtime Usage
Outcomes
Drift
Audit
```

## Version Diff

必须支持：

- Definition Diff；
- Applicability Diff；
- Dependency Diff；
- Validation Diff；
- Risk / Known Limitations；
- Source Lineage。

## Promotion Review

展示：

- Artifact Diff；
- Replay / Holdout；
- Shadow；
- Counterexample；
- Risk；
- Dependency；
- Rollback；
- Expected Benefit；
- Known Unknowns。

Approve / Reject 要求 Reason。

## Activation

独立操作：

- 重新显示 Evidence Hash；
- Expected Version；
- 当前 Active；
- Policy / Dependency；
- Rollback；
- Confirmation Dialog。

## Runtime Evidence

展示：

- Gateway Route；
- Match；
- Rule；
- Template；
- Case；
- Model Route；
- Formal Handoff；
- Fallback；
- Confirmation；
- Denial；
- Outcome；
- Correction；
- Cost / Latency；
- Reason Codes。

## Revalidation / Drift

展示：

- Trigger；
- Severity；
- Metric Drift；
- Counterexample；
- Revalidating；
- Fast Index Exclusion；
- Recommended Operation（非自动决定）。

## Error / Empty / Loading

所有页面必须有：

- Loading；
- Empty；
- Partial；
- Permission Denied；
- Stale；
- Retry；
- Dependency Unavailable。

## Accessibility

至少：

- Keyboard；
- Focus；
- Labels；
- Contrast；
- Table semantics；
- Screen reader；
- No color-only state；
- Confirm dialogs；
- Error announcement。

## Security

Console 不在 Local Storage 保存 Secret 或完整敏感数据。

## No Fixture Claim

真实管理页面必须连接正式 API。Fixture 只能用于测试 / Story，不得作为产品路径。
