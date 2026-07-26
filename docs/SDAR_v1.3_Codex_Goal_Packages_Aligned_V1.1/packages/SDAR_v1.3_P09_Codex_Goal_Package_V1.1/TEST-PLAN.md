# P09 Test Plan

## Baseline / Handoff

确认 P00/P01/P02/P03/P04/P05/P06/P07/P08 Commit 为祖先。

## Full Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## Rule DSL

- Valid Operand；
- Invalid Operand；
- Type Mismatch；
- Null；
- Unknown；
- all / any / not；
- Pattern Bound；
- Depth Bound；
- Collection Bound；
- Timeout；
- No eval；
- Injection。

## Evaluation

- Required True / False / Unknown；
- Forbidden True / False；
- Confirmation；
- Advisory；
- Active / Non-active；
- Tenant；
- Goal / Plan Version；
- Policy / Catalog / Readiness；
- Kill Switch；
- Stable Hash。

## Conflict Resolution

- Allow vs Deny；
- Advice vs Confirm；
- Global vs Tenant；
- Generic vs Specific；
- Same Priority；
- New Version；
- Compatible Patch；
- Conflicting Patch；
- Ambiguous；
- Stable Tie-break。

## Policy / Authorization

- Policy Allow；
- Deny；
- Confirm；
- Rule More Conservative；
- Rule More Permissive Rejection；
- Missing Auth；
- Stale Auth；
- Actor Spoofing；
- Cross Tenant。

## Plan Patch

- Low-risk Patch；
- Goal Change；
- Criterion Change；
- Scope Expansion；
- New Side Effect；
- Human Gate Delete；
- Invalid DAG；
- Validator Reject；
- Planning Confirmation；
- Goal Lock Fail；
- Double Handoff；
- Stale Before Commit。

## No Direct Execution

验证 P09 不：

- 创建 Skill Attempt；
- 启动 Workflow；
- 调用 Skill；
- 调用 MCP；
- 写 Outcome；
- 授予 Authorization；
- 切换 Active Pointer。

## Usage / Drift

- Usage Record；
- Outcome Link；
- False Positive；
- False Negative；
- Unsafe Allow；
- Missed Confirmation；
- Correction；
- Fallback；
- Drift Trigger；
- Duplicate Event；
- Redis Flush；
- PostgreSQL Restart；
- User Deletion。

## Security

- Forged P07 Result；
- Forged Rule Hash；
- Cross Tenant；
- Policy Bypass；
- Authorization Injection；
- Kill Switch Bypass；
- Regex / Pattern DoS；
- DSL Injection；
- Sensitive Operand Exposure；
- Prompt Injection。

## Performance

报告：

- Single Rule P50/P95；
- 10 / 100 / 1k Rule Set；
- Conflict Resolution；
- Policy / Authorization；
- Plan Patch；
- Formal Handoff；
- Cache Hit/Miss；
- Concurrent Evaluations。

性能优化不得删除 Policy、Authorization、Stale 或 Bounds。
