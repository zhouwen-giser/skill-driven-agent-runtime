# P03 Test Plan

## 1. Baseline

```bash
git fetch origin --prune
git rev-parse origin/main
git status --short --branch
```

确认 P00/P01/P02 Commit 为祖先。

## 2. Full Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## 3. G05 Unit

- Stable Trace Hash；
- Stable Event Order；
- Parallel Group；
- Branch；
- Missing Source；
- Completeness；
- PII；
- Credential；
- Large Tool Result；
- Private Reasoning；
- Fingerprint；
- Tenant Isolation。

## 4. G05 Contract / Integration

- Episode→Trace；
- Planning Correction→Trace；
- Workflow/Outcome/Recovery→Trace；
- Duplicate Job；
- Worker Crash；
- Redis Flush；
- PostgreSQL Restart；
- User Deletion；
- Migration fresh / rollback / reapply。

## 5. G06 Unit

使用人工 Golden Trace Set：

- 单一路径；
- 两个 Variant；
- Optional Step；
- Parallel；
- Loop；
- Failure；
- Recovery；
- Human Intervention；
- Contradiction；
- Environment Split。

验证：

- Variant；
- Direct-Follows；
- Precedence；
- Mandatory；
- Optional；
- Parallel Candidate；
- Recovery；
- Quality。

## 6. G06 Integration

- Database Cohort；
- Repeat Mining；
- Algorithm Version；
- Candidate Persistence；
- Rebuild；
- Large Cohort Bounds；
- Dead Letter；
- Cancellation / stale job。

## 7. No Product Side Effect

验证 Mining 不会：

- 创建 Goal；
- 创建 Plan；
- 创建 Attempt；
- 调用 MCP；
- 改 Outcome；
- 激活 Artifact；
- 发 A2A 正式状态。

## 8. Optional Research Comparison

如使用 PM4Py：

- 与 TypeScript Variant 数量比较；
- Mandatory/Optional 差异；
- 并行差异；
- 结果只保存报告；
- 不成为 Gate 唯一来源。

## 9. Performance

至少报告：

- Trace Build P50/P95；
- 1k/10k Trace Cohort Mining；
- Memory；
- DB Query；
- Worker Throughput；
- Queue Lag。

P03 不需要满足 Fast Gateway 在线延迟，但必须有有界资源策略。
