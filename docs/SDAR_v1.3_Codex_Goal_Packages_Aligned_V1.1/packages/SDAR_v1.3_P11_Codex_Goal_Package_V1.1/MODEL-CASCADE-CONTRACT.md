# P11 Model Cascade Contract

## 1. Cascade Step

每一步定义：

```text
model profile selector
maximum attempts
deadline budget
cost budget
input bound
output schema
success condition
escalation condition
fallback condition
```

## 2. 推荐结构

```text
deterministic / cache / parser
→ small model
→ medium model
→ large model
→ existing cognitive fallback / confirmation
```

不要求所有请求经过所有层级。

## 3. Escalation

只允许因以下原因升级：

- Schema Invalid；
- Required Field Missing；
- Confidence Below Policy Threshold；
- Contradiction；
- Unsupported Capability；
- Validator Reject；
- Model Failure；
- Explicit High Complexity；
- Policy Requires Higher Tier。

禁止仅因“可能更好”无限升级。

## 4. Success

成功必须满足：

- Output Schema；
- Policy；
- Required Fields；
- No Critical Contradiction；
- Validator；
- Budget；
- Deadline；
- Current Profile / Policy Not Stale。

模型自报置信度不足以证明成功。

## 5. Attempts

必须限制：

- Max Steps；
- Max Invocations；
- Max Retry per Step；
- Max Tokens；
- Max Cost；
- Deadline。

## 6. Fallback

可能结果：

```text
selected_output
cognitive_fallback
require_confirmation
deny
budget_exhausted
timed_out
failed
```

## 7. Cancellation / Late Result

Deadline / Cancellation 后：

- 取消未提交调用；
- 丢弃迟到输出；
- 不继续下一级；
- 不提交 Formal Plan。

## 8. Parallelism

首版默认串行级联。

只有独立、成本有界且 Policy 允许时才可并行比较；必须有 Winner 规则和预算上限。

## 9. Tool Calling

Model Tool Calling 只能通过现有受控 Tool / Policy 层。

P11 不允许模型在 Route Runtime 中直接执行 Skill / MCP。
