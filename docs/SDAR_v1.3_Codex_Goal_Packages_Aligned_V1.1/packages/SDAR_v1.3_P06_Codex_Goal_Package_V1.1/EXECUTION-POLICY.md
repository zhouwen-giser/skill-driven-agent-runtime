# P06 Execution Policy

## 模型

GPT-5.6 Sol Medium；一个主执行 Agent；只读 Review 使用独立新会话。

## Shadow 权威

Formal Request/Plan/Outcome 始终高于 Shadow。Shadow 只观察和比较，不影响正式任务。

## 审批权威

```text
Authenticated Human Operator > Promotion Service > Worker > Model
```

模型、Worker、指标和规则均不能创建批准事实。

## Approval 与 Activation

两者必须独立。Approval 绑定 Artifact、Validation、Shadow、Counterexample、Risk、Dependency 和 Policy 的精确 Hash。任一变化使旧 Approval 失效。

## Promotion Policy

版本化、可审计、Tenant/Domain 可配置、Fail Closed，不使用单一 Score；Unsafe 硬拒绝；样本不足 needs_more_data。

## Activation

校验 Approval/Evidence/Dependency/Status/ExpectedVersion，CAS Active Pointer、写 Status/Audit/Outbox，同一事务。

## Revalidating

不进入 Fast Index；可 Replay/Shadow/人工查看；不能新建 Runtime Binding、自动确认或自动恢复 Active。

## Git

建议至少 G11、G12、Evidence 三个可审查提交；Push Draft PR；不 Merge、不 Tag。
