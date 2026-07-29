# P10 Deadline / Fallback Contract

## 1. Deadline

每个请求具有绝对 `deadlineAt`。

阶段预算不能超过剩余时间。

建议结构：

```text
precheck
retrieval
rule
template
formal handoff
fallback reserve
```

具体比例配置化，不硬编码到领域合同。

## 2. Reserve

必须预留 Cognitive Fallback 或正式 Interaction 的最小时间。

不能把全部 Deadline 消耗在 Semantic Retrieval 或 Model Call。

## 3. Timeout

阶段超时：

- 取消该阶段；
- 记录 `timed_out`；
- 不使用迟到结果；
- 根据 Reason / Risk 进入 Fallback、Confirm 或 Failure。

## 4. Cancellation

用户 / 上游取消：

- 传播到 P07/P09/P08；
- 取消未提交工作；
- 不创建新 Formal Plan；
- 已正式提交后的处理由现有 Runtime 负责；
- 记录取消边界。

## 5. Late Result

Deadline / Cancellation 后到达的：

- Retrieval；
- Rule；
- Template；
- Handoff；

结果必须 `discarded_stale` 或 `discarded_late`。

禁止后台继续提交 Formal Plan。

## 6. Fallback 类型

### no_match

没有适用 Artifact。

### ambiguous

候选冲突或接近。

### degraded

子系统不可用 / Circuit Open。

### stale

Artifact / Goal / Policy / Catalog / Readiness 变化。

### timeout

Fast Path 预算耗尽。

### unsupported

P10 尚未支持的 Artifact 组合。

## 7. Deny 不等于 Fallback

Policy Deny、Authorization Deny、Critical Safety、Cross Tenant 必须直接 Deny。

禁止转 Cognitive Fallback 后继续尝试执行。

## 8. Confirmation 不等于 Fallback

确认需要进入正式 Interaction。

不能为了降低延迟跳过确认并使用 Cognitive Fallback 自动执行。
