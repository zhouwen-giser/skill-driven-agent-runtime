# P05 Validation Metric Catalog

## 1. 结果指标

### goal_success_match

Candidate Replay 是否满足历史 Goal Contract 的 Required Criterion。

### criterion_coverage

```text
covered required criteria / all required criteria
```

### evidence_completeness

Required Evidence 的覆盖比例。

### artifact_correctness

Required Artifact 是否存在且符合 Schema / Identity。

### outcome_regression

相对历史正式路径是否退化。

## 2. 流程指标

### activity_fitness

历史成功 Trace 中的必要活动是否被 Candidate 覆盖。

### precision_proxy

Candidate 是否引入历史和领域规则不支持的额外路径。

### generalization_proxy

在独立 Environment / Device / Time Holdout 中的稳定性。

### variant_coverage

Candidate 覆盖多少被接受流程变体。

### unexpected_branch_rate

Candidate 产生无法由 Pattern / Policy 解释的分支比例。

## 3. 安全指标

### unsafe_allow_count

Policy 或领域安全规则要求 deny/confirm，但 Candidate 允许执行。

任何值大于 0 时：

```text
unsafe=true
```

### missed_confirmation_count

应人工确认但 Candidate 未请求确认。

### false_positive

Candidate 错误命中或错误给出正向决策。

### false_negative

Candidate 错误拒绝或漏判风险。

### side_effect_attempt_count

Replay 中任何真实副作用尝试。

任何值大于 0 时：

```text
unsafe=true
```

## 4. 效率指标

- planning_latency_ms；
- model_call_count；
- token_input；
- token_output；
- estimated_cost_units；
- plan_node_count；
- human_interaction_count；
- fallback_count。

## 5. 修订指标

- plan_edit_distance；
- user_patch_count；
- rejected_candidate_count；
- missing_parameter_count；
- capability_gap_count；
- readiness_gap_count。

## 6. 聚合规则

每个指标必须定义：

- unit；
- direction；
- null policy；
- denominator；
- aggregation；
- confidence interval（适用时）；
- minimum sample；
- version。

不能只保存一个不透明 `validationScore`。

## 7. Promotion Threshold

P05 可以计算指标，但不能决定最终 Promotion Policy。

P05 只输出：

```text
passed
failed
needs_more_data
unsafe
```

P06 再结合 Shadow、Human Review 和 Promotion Policy。
