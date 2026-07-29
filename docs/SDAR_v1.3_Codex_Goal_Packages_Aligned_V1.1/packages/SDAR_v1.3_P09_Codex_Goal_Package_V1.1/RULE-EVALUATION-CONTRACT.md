# P09 Rule Evaluation Contract

## 1. 输入重检

评估前检查：

- Rule Active；
- Rule Hash；
- Active Pointer；
- Tenant；
- Goal / Plan Version；
- Policy Hash；
- Catalog Hash；
- Readiness；
- Kill Switch；
- Dependency Snapshot。

## 2. 评估顺序

```text
kill switch
status / tenant
authorization
safety policy
forbidden conditions
required conditions
confirmation conditions
advisory conditions
action materialization
```

## 3. Unknown

Unknown 产生于：

- 缺字段；
- Stale Snapshot；
- Untrusted Source；
- Provider Readiness Unknown；
- World State 不完整；
- 类型不匹配；
- Operator 不支持。

默认：

```text
no_match / fallback / require_confirmation
```

不得自动视为 True。

## 4. Determinism

相同：

```text
rule hash
runtime snapshot hash
evaluator version
```

必须产生相同 `resultHash`。

## 5. Action Materialization

### advise

生成非权威建议。

### require_confirmation

进入 Existing Interaction / Planning Session。

### deny

返回正式 Policy / Rule Deny Reason，不修改正式 Goal。

### fallback

返回 v1.2.3 Cognitive Runtime。

### suggest_parameter

只允许低风险候选，仍需 P07/P08 参数权威流程。

### propose_plan_patch

生成 `RulePlanPatchCandidate`，必须进入 P08 Existing Validator / Planning Handoff。

## 6. Stale

评估完成前再次检查 Rule / Goal / Plan / Policy / Catalog / Readiness。

变化时：

```text
discarded_stale
```

## 7. 错误隔离

Rule Evaluation Failure：

- 不阻断正式请求；
- 记录失败；
- 返回 fallback；
- 不产生部分 Action；
- 不修改 Rule Status；
- 可触发 Drift / Revalidation。
