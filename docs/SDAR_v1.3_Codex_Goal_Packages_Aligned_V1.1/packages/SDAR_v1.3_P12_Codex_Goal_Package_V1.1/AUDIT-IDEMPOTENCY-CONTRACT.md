# P12 Audit / Idempotency Contract

## Audit 字段

所有写操作记录：

```text
actor
roles
tenant
operation
target
before version
expected version
after version
reason
idempotency key
request id
result
timestamp
source ip / client（按策略）
```

## Audit 不可变

Audit 不得被 UI 编辑。

## Idempotency

同一：

```text
tenant
actor
operation
target
idempotency key
```

重复请求返回相同结果或明确冲突。

不同 Payload 复用同一 Key：

```text
409 conflict
```

## Expected Version

治理操作必须：

- expectedVersion；
- stale → 409 / 412；
- 不自动覆盖；
- Console 提示刷新。

## Reason

以下必须 Reason：

- Approve；
- Reject；
- Activate；
- Revalidate；
- Deprecate；
- Rollback；
- Kill Switch；
- Break-glass；
- Feature Flag 变更。

## Read Audit

敏感 Audit 查询本身也记录。

## A2A / Service Principal

自动化调用记录 Service Principal、Scope 和原始来源。
