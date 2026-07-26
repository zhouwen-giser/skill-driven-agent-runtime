# P08 Usage / Feedback Contract

## 1. Artifact Usage

记录：

- Artifact Ref / Hash / Version；
- Goal / Plan Ref；
- Instantiation Ref；
- Adaptation Refs；
- Formal Handoff Ref；
- Runtime Snapshot Hash；
- Created At。

## 2. Formal Outcome Correlation

P08 只建立关联，不复制 Outcome：

```text
artifact usage
→ formal plan
→ skill attempts
→ workflow
→ outcome
→ correction / recovery
```

## 3. 反馈事件

可写入：

```text
artifact.template_instantiated
artifact.template_handoff_submitted
artifact.template_handoff_rejected
artifact.template_usage_linked
artifact.template_outcome_observed
```

这些事件不是正式任务状态事件。

## 4. 反馈边界

P08 不：

- 修改 ValidationResult；
- 修改 Promotion；
- 修改 Active Pointer；
- 自动 Revalidate；
- 自动 Deprecate。

它只发送结构化 Usage / Outcome Evidence，供 P03 / P06 后续处理。

## 5. 删除传播

用户 / Tenant 删除传播时：

- Usage Link 按现有删除策略处理；
- 不保留 PII；
- 保留允许保留的聚合指标；
- 不跨用户形成 Preference。
