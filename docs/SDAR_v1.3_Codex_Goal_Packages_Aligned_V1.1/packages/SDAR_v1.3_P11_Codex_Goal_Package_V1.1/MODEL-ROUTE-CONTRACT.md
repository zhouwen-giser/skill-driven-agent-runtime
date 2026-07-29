# P11 Model Route Contract

## 1. 输入

Route 决策至少考虑：

- Operation Type；
- Task Type；
- Risk；
- Data Classification；
- Required Capability；
- Output Schema；
- Deadline；
- Budget；
- Provider Readiness；
- Capacity；
- Policy；
- Tenant；
- Region / Residency。

## 2. Route Artifact

`model_route` 可以定义：

- Matching Conditions；
- Required Model Capability；
- Preferred Quality Tier；
- Maximum Cost Tier；
- Latency Tier；
- Cascade Steps；
- Escalation Conditions；
- Fallback；
- Validation Requirements；
- Human Confirmation Boundary。

不得定义：

- Credential；
- Secret；
- 任意 Endpoint Token；
- 绕过 Provider Registry 的 Model；
- 无界重试。

## 3. Hard Gates

```text
tenant / authorization
data classification / residency
provider readiness
model capability
output schema
deadline
budget
rate / capacity
policy
kill switch
```

任一失败不能由历史成功率覆盖。

## 4. Selection

排序只用于可用候选之间：

```text
required capability fit
policy compatibility
readiness
deadline fit
expected quality
cost
recent reliability
stable profile id
```

## 5. Determinism

相同：

```text
artifact hash
route context hash
profile snapshot hash
policy hash
router version
```

必须产生相同 Decision Hash。

## 6. Stale

每个 Cascade Step 前检查：

- Route Artifact；
- Profile；
- Policy；
- Deadline；
- Budget；
- Cancellation；
- Circuit。

变化时丢弃或重新路由，不继续旧 Step。
