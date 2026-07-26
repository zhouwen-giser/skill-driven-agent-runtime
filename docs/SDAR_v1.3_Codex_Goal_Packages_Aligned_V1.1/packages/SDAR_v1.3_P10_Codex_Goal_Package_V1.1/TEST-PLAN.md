# P10 Test Plan

## Baseline / Handoff

确认 P00/P01/P02/P03/P04/P05/P06/P07/P08/P09 Commit 为祖先。

## Full Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## Precheck

- Auth Success / Failure；
- Tenant；
- Authorization；
- Invalid Request；
- Deadline；
- Cancellation；
- Feature Off；
- Kill Switch；
- Policy Deny / Confirm。

## Route

- No Match；
- Intent Route→Rule；
- Intent Route→Template；
- Rule Advice；
- Rule Deny；
- Rule Confirm；
- Rule Patch；
- Template Commit；
- Template Confirm；
- Template Fallback；
- Cognitive Fallback；
- Unsupported Combination。

## Deadline / Cancellation

- Timeout P07；
- Timeout P09；
- Timeout P08；
- Timeout Formal Handoff；
- Reserve Fallback；
- Cancellation Before / During / After Commit；
- Late Result；
- Background Commit Rejection。

## Stale

- Active Pointer Changed；
- Artifact Hash Changed；
- Goal Version Changed；
- Policy Changed；
- Catalog Changed；
- Readiness Changed；
- Kill Switch During Request。

## Idempotency / Concurrency

- Duplicate Request；
- Same Key Different Payload；
- Concurrent Rule / Template；
- Double Formal Handoff；
- Out-of-order Result；
- Retry After Timeout；
- Server Restart。

## Resilience / Chaos

- Redis Down；
- PostgreSQL Projection Down；
- P07 Down；
- P09 Down；
- P08 Down；
- Cognitive Runtime Down；
- Circuit Open / Half-open；
- Queue Full；
- Load Shedding；
- Feedback Worker Down；
- Outbox Retry。

## Feedback

- Fast Selected；
- Fast Committed；
- Fallback；
- Confirmation；
- Denial；
- Formal Outcome；
- Correction；
- Recovery；
- Rejection；
- Artifact Drift；
- Revalidation Signal；
- Duplicate Outcome；
- User Deletion；
- Cross Tenant。

## Protocol

- API Response Envelope；
- A2A Request；
- SSE Evidence；
- Console Evidence；
- Error Mapping；
- Cancellation；
- Retry / Idempotency。

## Security

- Cross Tenant；
- Forged Adapter Result；
- Actor Spoofing；
- Authorization Bypass；
- Policy Bypass；
- Kill Switch Bypass；
- Cache Poisoning；
- Deadline Abuse；
- Idempotency Collision；
- Prompt Injection；
- Sensitive Evidence Exposure；
- Fallback Bypass after Deny。

## Performance

报告：

- Gateway Added Latency P50/P95/P99；
- Precheck；
- P07；
- P09；
- P08；
- Fallback；
- Formal Handoff；
- 1/10/100/1k Concurrent Requests；
- Circuit / Load Shedding；
- Feedback Lag；
- Cache Hit/Miss；
- Error Rate；
- Deadline Miss。

性能优化不得删除 Auth、Policy、Stale、Deadline 或 Formal Authority。
