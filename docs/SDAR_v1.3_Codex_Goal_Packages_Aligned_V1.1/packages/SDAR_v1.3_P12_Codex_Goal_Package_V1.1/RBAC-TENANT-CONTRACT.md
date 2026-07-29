# P12 RBAC / Tenant Contract

## 角色示例

实际名称服从仓库现有约定。

```text
viewer
operator
reviewer
approver
administrator
security_operator
```

## 权限矩阵

### viewer

- 查看允许的 Artifact / Runtime Evidence。

### operator

- 请求 Validation / Shadow / Revalidation；
- 不能 Approve / Activate。

### reviewer

- 查看完整 Validation / Shadow / Counterexample；
- 可以提交 Review；
- 不能自动 Activate。

### approver

- Approve / Reject；
- 是否可以 Activate 由职责分离策略决定。

### administrator

- Activate / Deprecate / Rollback / Feature Flag；
- 仍不能绕过 Evidence / Policy。

### security_operator

- Critical Kill Switch；
- Security Incident；
- Emergency Disable；
- 必须 Audit。

## 职责分离

推荐：

```text
approver != activation operator
```

如现有组织允许同一人执行，两动作仍必须独立、分别审计。

## Tenant

所有 Query / Command 必须：

- Tenant Scope；
- Artifact Tenant / Global Scope；
- Cross-tenant Deny；
- Global Artifact 只按 Policy 可见；
- Audit 记录 Tenant。

## Actor

可信 Actor 只来自 Auth Context。

## Service Principal

自动化 Service Principal 可以：

- 读取；
- 请求 Validation / Shadow；
- 发送 Revalidation Trigger。

不能：

- Human Approval；
- 高风险 Activation；
- 关闭 Critical Kill Switch。

## Break-glass

如实现：

- 强认证；
- Reason；
- 时限；
- 双人或后审；
- 全量 Audit；
- 不跳过核心安全校验。
