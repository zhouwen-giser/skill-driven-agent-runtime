# P10 Gateway Orchestration Contract

## 1. Precheck

顺序：

```text
authentication
tenant
authorization
request schema
deadline
cancellation
feature flags
kill switch
base safety policy
```

失败时不调用 P07/P09/P08。

## 2. Retrieval

调用 P07：

```text
retrieve active artifacts
evaluate applicability
bind parameters
validate dependency
check capability/readiness/policy
```

Gateway 不能重算这些结果。

## 3. Intent Route

若存在 Active `intent_route`：

- 只能作为候选路由建议；
- 必须通过 P07 Applicability；
- 不能绕过 Policy；
- 不能直接指向 Skill/MCP；
- 最终只能选择 Rule、Template、Fallback、Confirm 或 Deny。

P10 不实现新的 Intent Classifier，除非 P07 已提供受控 Candidate Port。

## 4. Rule Stage

调用 P09。

可能结果：

```text
advice
require_confirmation
deny
fallback
plan_patch_candidate
no_match
```

`deny` 终止，不进入普通 Fallback 执行。

`plan_patch_candidate` 通过 P09→P08 正式 Handoff。

## 5. Template Stage

调用 P08。

可能结果：

```text
formal_handoff
requires_confirmation
fallback
deny
discarded_stale
failed
```

## 6. Cognitive Fallback

调用现有 v1.3 Cognitive Runtime。

必须：

- 保持原正式权威；
- 记录 Fallback 原因；
- 传播剩余 Deadline；
- 不携带失效 Artifact 作为执行权威；
- 可以携带非权威解释上下文，但不得改变 Formal Input Contract。

## 7. Route 选择

默认优先级：

```text
policy deny
policy confirmation
matched deny/confirm rule
eligible deterministic rule patch/advice
eligible plan template
cognitive fallback
```

实际优先级需按冻结 Policy 实现并版本化。

## 8. 组合

首版不允许在一次请求中任意组合多个 Template。

允许：

- Rule 建议 + Template；
- Rule Patch + P08 Formal Handoff；
- Rule Confirmation；
- Template Fallback。

多 Artifact 组合属于后续明确版本，不得隐式实现。

## 9. Formal Authority

Gateway 不能将自身 Decision 当作 Formal Goal / Plan。

只有 P08/P09 Adapter 或 Cognitive Runtime 通过现有正式权威提交后，结果才为 Formal Handoff。
