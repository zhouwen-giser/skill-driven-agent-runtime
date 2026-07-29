# P06 Shadow Safety Contract

## 正式路径唯一权威

Shadow 不改变 Request、Goal、Plan、Attempt、Workflow、Outcome、Recovery 和正式通知。

## 零副作用

禁止 Skill.execute、MCP tools/call、Provider Task、外部写 API、设备控制、正式业务写、Active Pointer、Approval、Goal Terminal。

任何副作用尝试：abort、critical incident、unsafeAttempt=true、urgent revalidation。

## Stale Check

在 enqueue、start、candidate load、comparison、persist 检查 Artifact/Goal/Plan/Policy/Catalog Version；变化则 discarded_stale，不用于 Promotion。

## Backpressure

独立低优先级队列、并发/长度上限、采样、TTL、Stale Drop、Degraded Pause，不抢占正式 Worker。

## Comparison

只比较 Decision/Plan/Criterion/Evidence/Risk/Cost/Latency/Correction/后验 Outcome。未执行的物理结果必须为 Unknown。
