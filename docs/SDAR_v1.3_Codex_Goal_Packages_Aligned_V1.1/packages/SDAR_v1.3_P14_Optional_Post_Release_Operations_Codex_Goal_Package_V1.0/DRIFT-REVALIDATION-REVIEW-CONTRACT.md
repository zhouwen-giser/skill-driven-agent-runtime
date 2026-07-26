# P14 Drift / Revalidation Review Contract

## Artifact Drift

- Match Rate；
- Eligible Rate；
- Confirmation；
- Fallback；
- Correction；
- Recovery；
- Outcome Regression；
- Environment Novelty；
- Dependency Change；
- Policy Change。

## Rule Drift

- FP / FN；
- Unsafe Allow；
- Missed Confirmation；
- Conflict；
- Rule No-match；
- Patch Rejection。

## Template / Case Drift

- Validator Rejection；
- Adaptation；
- Missing Parameter；
- OOD；
- Human Gate；
- Outcome Regression。

## Model Route Drift

- Schema Failure；
- Escalation；
- Timeout；
- Budget；
- Cost；
- Provider Failure；
- Correction；
- Outcome Regression。

## Review 决策

P14 只能建议：

```text
continue
collect more data
request revalidation
disable fast path
open next-version candidate
```

不得直接修改 Artifact Status。
