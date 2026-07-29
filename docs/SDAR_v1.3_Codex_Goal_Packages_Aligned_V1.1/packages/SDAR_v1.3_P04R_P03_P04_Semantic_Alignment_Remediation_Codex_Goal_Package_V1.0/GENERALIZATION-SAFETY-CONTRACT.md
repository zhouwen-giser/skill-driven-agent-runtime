# Generalization Safety V1.2

反过拟合必须是代码门禁：

- 单设备/单环境不全局化；
- 单用户偏好不转为租户/全局硬约束；
- 临时授权不转为 Invariant/Default；
- 单次成功且无失败边界不生成通用 Candidate；
- Failure/Recovery Boundary 不丢失。

FusedPattern 必须携带 Scope Evidence：

```text
tenantCount
userCount
deviceClassCount
environmentClassCount
successCount
failureCount
hasTemporaryAuthorization
hasFailureBoundary
```

LLM 不能覆盖 Activity Identity、Support、Ordering、Contradiction、Scope Evidence、Failure Boundary 或 Authorization。
