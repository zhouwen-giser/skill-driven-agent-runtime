# P09 Rule Conflict Resolution Contract

## 1. 冲突类型

- allow / deny；
- advise / deny；
- advise / confirm；
- 多个不兼容 Patch；
- 多个参数建议；
- Tenant / Domain Rule 冲突；
- Global / Specific Rule 冲突；
- 新旧版本冲突。

## 2. 权威顺序

```text
Safety Policy
> Authorization
> Deny Rule
> Require Confirmation Rule
> More Specific Scope
> Higher Explicit Priority
> Newer Active Version
> Stable Rule ID
```

## 3. Specificity

至少考虑：

- Tenant；
- Domain；
- Task Type；
- Environment；
- Device Class；
- Risk；
- Goal Pattern；
- Condition Count；
- Parameter Coverage。

更具体不代表更安全，仍受 Policy / Deny 覆盖。

## 4. Compatible Combination

只有以下都满足时才允许合并：

- Action 类型兼容；
- 参数不冲突；
- Patch 不重叠或顺序明确；
- 不扩大 Goal / Scope；
- 不降低 Safety；
- Existing Validator 可验证；
- 组合后仍满足 Bounds。

## 5. Ambiguous

无法确定唯一结果时：

```text
ambiguous_fallback
```

高风险场景：

```text
require_confirmation
```

禁止随机选 Rule。

## 6. 冲突证据

保存：

- Evaluation Refs；
- Selected / Suppressed Rule；
- Priority；
- Specificity；
- Policy Severity；
- Reason Codes；
- Resolver Version；
- Result Hash。
