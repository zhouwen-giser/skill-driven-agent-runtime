# P07 Test Plan

## Baseline / Handoff

确认 P00/P01/P02/P03/P04/P05/P06 Commit 为祖先。

## Full Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## Active Index

- Active；
- Candidate；
- Revalidating；
- Deprecated；
- Cross Tenant；
- Pointer Version；
- Cache Rebuild；
- Duplicate Invalidation；
- Kill Switch。

## Exact / Structured Retrieval

- Explicit Ref；
- Exact Pattern；
- Task Type；
- Domain Alias；
- Tenant；
- Risk；
- Environment；
- Device；
- Feature Flag。

## Semantic Retrieval

- Threshold；
- Version；
- Near Duplicate；
- Ambiguity；
- Cross Tenant；
- Memory Leakage；
- Projection Stale；
- No Match。

## Ranking

- Exact Priority；
- Lower Risk；
- Higher Validation；
- More Specific；
- Newer Version；
- Lower Cost；
- Stable Tie-break；
- Ambiguous Top Two。

## Applicability

- Required Satisfied / Missing；
- Forbidden Matched；
- Optional Missing；
- OOD；
- Unknown Constraint；
- Risk；
- Uncertainty。

## Parameter Binding

- User-confirmed；
- Request；
- World State；
- Runtime Context；
- User Preference；
- Small Model Candidate；
- Source Conflict；
- Required Missing；
- High-risk Default Rejection；
- Cross-user Preference Rejection。

## Dependency

- Catalog；
- Policy；
- Task Type；
- Schema；
- Compiler；
- Validator / Promotion；
- Stale Active Projection；
- Revalidation Signal。

## Capability / Readiness / Policy

- Internal Capability Available；
- Capability Gap；
- Skill Candidate Missing；
- Provider Ready / Restricted / Disabled / Unknown；
- Policy Allow / Deny / Confirm；
- Public Card Mismatch。

## Security

- Cross Tenant；
- Unauthorized Artifact Ref；
- Forged Binding；
- Actor Spoofing；
- Stale Policy；
- Kill Switch Bypass；
- Cache Poisoning；
- Embedding Injection；
- Prompt Injection。

## Performance

报告：

- Exact Retrieval P50/P95；
- Structured Retrieval；
- Semantic Retrieval；
- L0/L1/L2；
- Applicability；
- Parameter Binding；
- Capability / Readiness；
- Policy；
- Cache Hit/Miss；
- Redis Rebuild；
- 1k/10k/100k Active Index。

性能优化不得删除硬门禁。
