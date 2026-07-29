# P11 Test Plan

## Baseline / Handoff

确认 P00～P10 Commit 为祖先。

## Full Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## Case Runtime

- Active / Non-active / Stale；
- Tenant；
- Goal / Policy / Catalog / Readiness；
- Exact Similar Case；
- Near Case；
- OOD；
- Failure Boundary；
- Parameter Adaptation；
- Entity Class；
- Optional Step；
- Same Capability；
- Scope Expansion Rejection；
- Human Gate Delete Rejection；
- Side-effect Replay Rejection；
- Validator Pass / Reject；
- Confirmation；
- Goal Lock；
- Duplicate Handoff；
- Outcome Link；
- Drift。

## Model Profile

- Ready / Restricted / Degraded / Disabled / Unknown；
- Capability；
- Context；
- Structured Output；
- Residency；
- Classification；
- Rate / Capacity；
- Version Change；
- No Credential Exposure。

## Model Route

- Exact Route；
- Multiple Profiles；
- No Candidate；
- Policy Deny；
- Classification Deny；
- Residency Deny；
- Capability Gap；
- Schema Gap；
- Deadline；
- Budget；
- Stable Tie-break；
- Stale Profile；
- Kill Switch。

## Cascade

- Small Success；
- Small Schema Fail→Medium；
- Medium Validator Fail→Large；
- Large Fail→Fallback；
- Budget Exhausted；
- Token Limit；
- Invocation Limit；
- Deadline；
- Cancellation；
- Late Result；
- Provider Error；
- Rate Limit；
- Circuit Open；
- Output Injection；
- Low Confidence；
- Parallel Comparison（如实现）。

## Formal Authority

验证模型输出不：

- 创建 Goal；
- 创建 Plan；
- 创建 Attempt；
- 启动 Workflow；
- 调用 Skill / MCP；
- 写 Outcome；
- 授权高风险行为。

需要 Plan 时必须通过 P08。

## Usage / Cost / Outcome

- Route Record；
- Step Record；
- Tokens；
- Cost；
- Cache；
- Retry；
- Escalation；
- Selected Output；
- Cognitive Fallback；
- Formal Outcome；
- Correction；
- Drift；
- Duplicate Event；
- User Deletion。

## Security

- Cross Tenant；
- Forged P07 / P10 Result；
- Credential Exfiltration；
- Profile Secret；
- Prompt Injection；
- Output Injection；
- Data Classification Bypass；
- Residency Bypass；
- Budget Bypass；
- Deadline Bypass；
- Authorization Injection；
- Model Self-approval。

## Performance / Economics

报告：

- Case Match / Adapt / Handoff；
- Model Route P50/P95；
- Each Cascade Step；
- 1/10/100 Concurrent；
- Token / Cost；
- Circuit / Rate；
- Profile Refresh；
- Usage Feedback Lag。

性能优化不得删除 Policy、Readiness、Budget、Deadline、Schema 或 Formal Authority。
