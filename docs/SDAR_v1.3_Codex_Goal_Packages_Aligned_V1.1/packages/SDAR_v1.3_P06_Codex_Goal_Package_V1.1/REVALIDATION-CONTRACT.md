# P06 Revalidation Contract

## 触发

Capability Catalog、Skill、Policy、Task Type、Schema、Compiler、Validator、Provider Profile、Performance/Correction/Fallback Drift、New Counterexample、Safety Incident、Long Inactivity、Operator Request。

## normal / urgent / critical

normal：计划性 Revalidation；urgent：立即从 Fast Index 排除；critical：Kill Switch、失效/回滚 Active Pointer、Cache Invalidation、安全事件、人工介入。

## Revalidating

允许 Replay、Shadow、人工查看、新 Candidate Revision；禁止 Fast Path、自动确认、新 Runtime Binding、自动激活、复用旧 Approval。

## 重新激活

必须 new validation + new shadow + new promotion package + new approval + new activation。

## Deprecation / Rollback

Deprecated 不进入在线索引，保留 Lineage/Audit。Rollback 只能选择仍有效、已批准、依赖有效的历史版本；否则禁用 Compiled Path 并回退 Cognitive Runtime。
