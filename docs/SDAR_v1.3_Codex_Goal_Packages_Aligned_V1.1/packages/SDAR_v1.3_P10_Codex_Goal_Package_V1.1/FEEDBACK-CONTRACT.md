# P10 Feedback Contract

## 1. 反馈链

```text
gateway request
→ gateway decision
→ selected artifact
→ formal goal / plan
→ attempt / workflow
→ outcome
→ correction / recovery
→ artifact usage / drift
```

## 2. 反馈类型

### Match

- candidates；
- selected；
- ambiguity；
- no match；
- latency。

### Applicability

- eligible；
- missing parameter；
- dependency mismatch；
- capability gap；
- readiness gap；
- policy result；
- OOD。

### Runtime

- rule decision；
- template instantiation；
- formal handoff；
- confirmation；
- fallback；
- denial；
- timeout；
- cancellation。

### Outcome

- success；
- failure；
- partial；
- correction；
- recovery；
- user rejection；
- plan patch；
- evidence completeness；
- artifact correctness。

### Performance

- stage latency；
- token；
- model calls；
- cache；
- queue；
- fallback overhead。

## 3. Attribution

反馈必须区分：

```text
fast path selected
fast path committed
fallback selected
fallback committed
formal outcome
```

禁止将 Fallback Outcome 归功于 Fast Artifact。

## 4. Drift

至少计算：

- Fast Path Match Rate；
- Eligible Rate；
- Commit Rate；
- Confirmation Rate；
- Fallback Rate；
- Deny Rate；
- Timeout Rate；
- Stale Rate；
- Correction Rate；
- Recovery Rate；
- Outcome Regression；
- Latency / Cost Drift；
- Environment Novelty；
- Artifact-specific failure。

## 5. Revalidation Signal

规则示例：

- Unsafe / Policy Violation → critical；
- Outcome / Correction Drift → urgent；
- Latency / Cost Drift → normal；
- New Environment → normal / urgent；
- High Fallback → normal；
- Stale Dependency → urgent。

具体阈值必须版本化、可审计，P10 不直接修改 Artifact Status。

## 6. Compiler Feedback

P10 发送结构化事实给：

- P03 Trace / Pattern；
- P05 Validation Dataset；
- P06 Revalidation；
- Future P11 Case / Model Route。

不直接重编译或生成新 Candidate。

## 7. 删除传播

反馈不得保存：

- Credential；
- 私有思维链；
- 非必要 PII；
- 跨 Tenant 数据。

用户 / Tenant 删除后，按现有策略删除明细并保留允许的匿名聚合。
