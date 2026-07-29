# P11 Usage / Feedback Contract

## Case Usage

记录：

- Case Artifact；
- Match；
- Adaptation；
- Plan Candidate；
- Formal Handoff；
- Validator；
- Confirmation；
- Outcome；
- Correction；
- Failure Boundary；
- Drift。

## Model Usage

记录：

- Route Artifact；
- Profile Snapshot；
- Cascade Steps；
- Model Invocation；
- Tokens；
- Cost；
- Latency；
- Schema / Validator；
- Selected Output；
- Fallback；
- Formal Outcome；
- Correction；
- Safety。

## Attribution

必须区分：

```text
case selected
case plan committed
case fallback
model selected
model output accepted
model escalated
model fallback
formal outcome
```

不能把 Cognitive Fallback Outcome 归功于 Case / Model Route。

## Drift

### Case

- Adaptation Rejection；
- Validator Rejection；
- Confirmation Rate；
- Outcome Regression；
- Failure Boundary Hit；
- OOD；
- Correction。

### Model Route

- Schema Failure；
- Escalation Rate；
- Budget Exhaustion；
- Timeout；
- Provider Failure；
- Correction；
- Outcome Regression；
- Cost / Latency Drift；
- Model Version Change。

## Revalidation

P11 只发送 normal / urgent / critical Trigger，不直接改 Artifact Status。

## 删除传播

按 Tenant / User / Provider Retention 处理，禁止保留 Credential、PII 或完整敏感 Prompt。
