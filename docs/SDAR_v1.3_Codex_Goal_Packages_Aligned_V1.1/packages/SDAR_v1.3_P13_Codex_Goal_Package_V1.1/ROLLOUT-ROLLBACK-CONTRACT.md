# P13 Rollout / Rollback Contract

## Feature Flag 层级

至少：

```text
compiler enabled
artifact registry enabled
shadow enabled
promotion enabled
retrieval enabled
rule enabled
template enabled
gateway enabled
case enabled
model route enabled
tenant allowlist
artifact allowlist
```

## Rollout 阶段

建议：

```text
0. disabled
1. compiler / replay only
2. shadow only
3. internal tenant
4. allowlisted low-risk artifact
5. limited canary
6. broader tenant rollout
```

实际阶段由执行时风险与证据冻结。

## Canary

监控：

- Error；
- Deadline；
- Fallback；
- Confirmation；
- Correction；
- Outcome Regression；
- Policy Deny；
- Unsafe；
- Latency；
- Cost；
- Queue；
- Drift。

## Stop Condition

任一关键条件：

- Security；
- Cross-tenant；
- Unsafe；
- Duplicate Side Effect；
- Outcome Regression；
- Deadline Spike；
- Active Pointer Corruption；
- Recovery Failure；

立即停止或回滚。

## Rollback

顺序：

```text
disable fast path
invalidate cache
switch approved artifact
disable artifact type
disable model route
rollback application
forward-fix migration
restore cognitive fallback
```

数据库 Migration 是否回滚必须根据数据兼容性，不得机械降级损坏数据。

## 发布授权

P13 只能生成计划和 Release Candidate。

Merge、Tag、Release、Production Deploy 需要用户另行明确授权。
