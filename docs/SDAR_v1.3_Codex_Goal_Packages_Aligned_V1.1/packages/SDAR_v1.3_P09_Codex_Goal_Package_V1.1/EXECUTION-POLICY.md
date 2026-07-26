# P09 Execution Policy

## 模型

```text
GPT-5.6 Sol Medium
```

一个主执行 Agent。独立只读 Review 使用新会话。

## 确定性优先

生产 Rule Runtime 必须是确定性解释器。

LLM 不允许：

- 在请求时生成新 Rule；
- 修改 Rule；
- 决定 Operator；
- 解释 Unknown 为 True；
- 覆盖 Policy；
- 创建 Approval；
- 直接输出正式 Plan。

LLM 只可在离线 Compiler 或解释层产生非权威说明。

## 三值逻辑

条件评估使用：

```text
true
false
unknown
```

禁止：

```text
unknown → true
```

Unknown 的处理必须由 Rule Definition 明确：

- fallback；
- require_confirmation；
- no_match。

## 权威顺序

```text
Kill Switch
→ Status / Tenant / Authorization
→ Safety Policy
→ Forbidden Condition
→ Required Condition
→ Current Capability / Readiness
→ Rule Conflict Resolution
→ Rule Action
→ Existing Formal Authority
```

## Rule Action 边界

允许：

- advice；
- require_confirmation；
- deny；
- fallback；
- low-risk parameter suggestion；
- bounded plan patch candidate；
- invoke P08 formal handoff port。

禁止：

- Skill / MCP；
- Goal mutation；
- Criterion mutation；
- Authorization grant；
- Active Pointer；
- Formal Outcome；
- direct Workflow command。

## Conflict

冲突消解不得仅用一个总分。

优先使用：

1. Policy Severity；
2. Rule Scope；
3. Specificity；
4. Explicit Priority；
5. Version；
6. Stable Rule ID。

Deny / Confirm 规则不能被 Allow 高分覆盖。

## 当前状态重检

评估前和正式 Handoff 前重新检查：

- Rule Active；
- Rule Hash；
- Active Pointer；
- Goal / Plan Version；
- Policy；
- Catalog；
- Readiness；
- Kill Switch。

## Git

建议至少：

```text
feat(v1.3): evaluate active decision rules
feat(v1.3): hand rule decisions to formal authority
docs(v1.3): record P09 evidence
```

不 Merge，不 Tag。
