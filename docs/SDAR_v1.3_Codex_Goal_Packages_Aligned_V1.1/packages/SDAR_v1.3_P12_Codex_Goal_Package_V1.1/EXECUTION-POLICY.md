# P12 Execution Policy

## 模型

```text
GPT-5.6 Sol Medium
```

一个主执行 Agent。独立只读 Review 使用新会话。

## 管理面原则

Management / Console / A2A 只允许：

- 查询；
- 调用正式 Command Port；
- 显示 Evidence；
- 发起授权操作；
- 记录 Audit。

禁止：

- 直接 SQL；
- 绕过状态机；
- 在 Controller 中复制业务规则；
- 在 UI 中决定 Promotion；
- 在 A2A Adapter 中改变 Runtime Authority。

## 身份

可信身份必须来自：

- Authentication Middleware；
- Operator Session；
- A2A Auth Context；
- Service Principal。

禁止使用：

- Body actorId；
- Query operatorId；
- 前端传入 Role；
- 模型推断身份。

## 命令

所有治理命令必须：

- RBAC；
- Tenant；
- Expected Version；
- Idempotency；
- Reason；
- Audit；
- Domain Validation；
- Transaction / CAS。

## 暴露边界

Public / Operator / Internal 分层：

### Public

- Allowlisted Capability；
- Safe Runtime Evidence；
- Input-required；
- Formal Status。

### Operator

- Artifact Detail；
- Validation / Shadow / Promotion；
- Runtime / Drift；
- 审批与运维操作。

### Internal

- Credential；
- Secret；
- Raw Provider Config；
- Private Experience；
- Internal Skill Detail；
- Full Model Prompt；
- Private Reasoning。

## A2A

A2A Adapter 不拥有：

- Goal；
- Plan；
- Artifact；
- Approval；
- Outcome。

它只投影现有正式权威。

## Git

建议至少：

```text
feat(v1.3): expose artifact management operations
feat(v1.3): integrate artifact console and a2a evidence
docs(v1.3): record P12 evidence
```

不 Merge，不 Tag。
