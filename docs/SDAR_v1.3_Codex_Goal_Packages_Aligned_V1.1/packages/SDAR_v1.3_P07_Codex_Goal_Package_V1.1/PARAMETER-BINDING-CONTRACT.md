# P07 Parameter Binding Contract

## 1. 来源优先级

```text
User-confirmed Goal Contract
> Explicit Request Field
> Trusted World State
> Runtime Context
> Scoped Low-risk User Preference
> Small-model Candidate
```

低优先级不能覆盖高优先级。

## 2. Source 与 Trust

每个 Binding 保存：

- value；
- source；
- trust；
- confidence；
- source ref；
- extracted at；
- schema version。

## 3. 不可默认参数

以下必须来自 Authoritative / Trusted Source 或显式确认：

- Goal；
- Target；
- Scope；
- Completion Criterion；
- Safety Constraint；
- Authorization；
- High-risk Threshold；
- Physical Device；
- Restricted Area；
- Side-effect Permission。

## 4. Small-model Candidate

只允许：

- 低风险文本归一；
- Alias；
- Location / Entity Candidate；
- Enum Mapping；
- 非授权型参数。

必须：

- Schema；
- Audit；
- no-op；
- Confidence；
- 不自动提交；
- 不覆盖 Explicit Value。

## 5. 冲突

不同 Source 冲突时：

```text
authoritative wins
trusted conflict → require_confirmation
candidate conflict → reject candidate
```

## 6. Missing Parameter

Required 参数缺失：

- 不允许 `eligible`；
- 低风险可 `requires_adaptation`；
- 高风险 `require_confirmation` 或 `fallback`。

## 7. 用户偏好

只允许已接受、低风险、作用域匹配的 Preference。

禁止：

- 跨用户；
- 跨 Tenant；
- 安全授权；
- Goal / Criterion；
- 全局自动升级。
