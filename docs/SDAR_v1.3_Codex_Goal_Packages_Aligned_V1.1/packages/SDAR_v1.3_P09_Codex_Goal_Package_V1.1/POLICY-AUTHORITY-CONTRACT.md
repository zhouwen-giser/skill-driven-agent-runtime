# P09 Policy Authority Contract

## 1. 现有 Policy 是最终权威

P09 不创建第二 Policy Engine。

必须通过现有 Policy Guard / Authorization Port 查询：

```text
allow
deny
require_confirmation
```

## 2. Rule 与 Policy

Rule 可以比 Policy 更保守，但不能更宽松。

允许：

```text
policy allow + rule deny
policy allow + rule confirm
```

禁止：

```text
policy deny + rule allow
policy confirm + rule auto-allow
```

## 3. Authorization

Authorization 必须来自可信身份与正式授权事实。

禁止使用：

- 请求体 actorId；
- Rule 自带角色；
- 历史审批；
- 模型推断；
- 用户偏好；

作为当前授权。

## 4. Goal Contract

Rule 不得：

- 修改 Objective；
- 修改 Required Criterion；
- 扩大 Target Scope；
- 删除 Constraint；
- 改写 Authorization；
- 降低 Evidence / Artifact Requirement。

## 5. Plan Patch

Rule 只能产生 Candidate Patch，并交给：

- Existing Plan Validator；
- Existing Planning Session；
- Goal Version Lock；
- User Confirmation / Policy Confirmation；
- Existing UserGoalPlan Authority。

## 6. 高风险

高风险 Rule Action 必须：

- Policy 允许；
- Authorization 有效；
- Current Readiness；
- Explicit Confirmation；
- Formal Handoff；
- Audit。

P09 本身不能执行。
