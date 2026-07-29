# P11 Model Safety and Economics Contract

## 1. Data Classification

模型选择必须匹配：

- Public；
- Internal；
- Confidential；
- Restricted。

不兼容 Provider / Region 必须拒绝。

## 2. Prompt / Context

必须：

- 最小必要输入；
- PII / Credential Redaction；
- Bounded Context；
- Source Refs；
- Prompt Hash；
- Model / Version；
- No Private Chain-of-thought Persistence。

## 3. Output

必须：

- Schema；
- Size Bound；
- Safety Check；
- Policy Check；
- Injection / Exfiltration Check；
- Source / Confidence；
- Audit。

## 4. Budget

每次 Route 有：

```text
max cost
max input tokens
max output tokens
max invocations
deadline
```

超过：

```text
budget_exhausted / fallback / confirm
```

## 5. Cost Attribution

记录：

- Provider；
- Model；
- Step；
- Input / Output Token；
- Estimated Cost；
- Cache；
- Retry；
- Escalation；
- Final Selected Output；
- Formal Outcome Link。

## 6. Quality / Cost

不能使用单一不透明 Score。

至少分别记录：

- Schema Success；
- Validator Success；
- Correction；
- Outcome；
- Latency；
- Cost；
- Escalation；
- Fallback；
- Safety。

## 7. High Risk

高风险任务要求：

- Policy 允许；
- 适当模型能力；
- Structured Output；
- Validator；
- Confirmation；
- Formal Authority。

模型 Route 不能自动确认。

## 8. Provider Failure

Credential / Quota / Rate / Health Failure：

- 不泄露 Secret；
- 记录标准错误；
- Circuit；
- Route 下一合法候选；
- Budget / Deadline 检查；
- 无候选时 Fallback。
