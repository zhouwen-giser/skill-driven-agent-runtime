# P08 Test Plan

## Baseline / Handoff

确认 P00/P01/P02/P03/P04/P05/P06/P07 Commit 为祖先。

## Full Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## Input / Recheck

- Active；
- Non-active；
- Wrong Artifact Type；
- Stale Hash；
- Stale Pointer；
- Goal Version Changed；
- Policy Changed；
- Catalog Changed；
- Readiness Changed；
- Kill Switch；
- Cross Tenant。

## Parameter Materialization

- Authoritative Binding；
- Trusted Binding；
- Candidate Binding；
- Missing Required；
- Type Conversion；
- Sensitive；
- Conflict；
- High-risk Default Rejection；
- Schema Error。

## Node / DAG

- Linear；
- Parallel；
- Conditional；
- Optional；
- Recovery；
- Human Gate；
- Cycle；
- Orphan；
- Duplicate Node；
- Criterion Missing；
- Evidence Missing；
- Artifact Missing。

## Adaptation

- Allowed Parameter；
- Optional Delete；
- Same Capability；
- Safe Order；
- Unsafe Order；
- Scope Expansion；
- Goal Change；
- Criterion Change；
- Human Gate Delete；
- New Side Effect；
- Model Candidate；
- Confirmation Required。

## Validator / Planning Session

- Validator Pass；
- Validator Reject；
- Planning Session Created；
- Confirmation Accepted；
- Confirmation Rejected；
- Patch；
- Cancel；
- Timeout；
- Duplicate Confirmation。

## Formal Handoff

- Valid Commit；
- Goal Lock Fail；
- Double Handoff；
- Same Idempotency；
- Different Candidate；
- Outbox Failure；
- Transaction Rollback；
- Stale Before Commit；
- Artifact Deactivated Before Commit；
- Policy Changed Before Commit。

## No Direct Execution

验证 P08 不：

- 创建 Skill Attempt；
- 启动 Workflow；
- 调用 Skill；
- 调用 MCP；
- 写 Outcome；
- 触发 Recovery。

## Usage / Outcome

- Usage Record；
- Formal Plan Link；
- Outcome Link；
- Correction Link；
- Duplicate Event；
- Redis Flush；
- PostgreSQL Restart；
- User Deletion。

## Security

- Cross Tenant；
- Forged P07 Result；
- Forged Binding；
- Actor Spoofing；
- Goal Scope Escalation；
- Authorization Injection；
- Kill Switch Bypass；
- Prompt Injection；
- Sensitive Lineage Exposure。

## Performance

报告：

- Instantiation P50/P95；
- Parameter Materialization；
- DAG Materialization；
- Validator Adapter；
- Planning Session Handoff；
- Formal Commit Transaction；
- 100 / 1k Node Template Bounds；
- Concurrent Handoff；
- Cache / DB I/O。

性能优化不得跳过 Recheck、Validator 或 CAS。
