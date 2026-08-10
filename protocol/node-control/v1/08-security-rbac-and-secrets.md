# 08. 安全、RBAC 与 Secret

## 身份

- 外部 Node Control API：部署侧 Bearer/OIDC 兼容；
- 组织控制平面：独立 Service Principal；
- Runtime 内部 API：独立 Service Credential，优先 mTLS；
- Actor、Tenant 和 Role 从可信身份解析，不接受请求体伪造。

## Secret

领域和 API 只出现：

```text
credentialRef
secretStatus
lastValidatedAt
```

禁止出现明文 Token、Password、Private Key、完整 Connection String 或 Secret 文件路径。

## Fail Closed

- 不合法 Scope；
- 未知角色；
- If-Match 缺失；
- Idempotency Key 冲突；
- 高风险 Capability 缺少确认策略；
- 非 Loopback 但未配置认证；
- Runtime Contract Version 不兼容。

## v1.4.1 Evidence Operations

- Metadata read：`node_admin`、`node_operator`、`node_viewer`、`security_admin`；
- Replay、DLQ retry、coverage reconcile：仅 `node_admin`、`security_admin`；
- `organization_service`：所有 Evidence Operations read/write 均拒绝；
- Actor/role 来自认证后的部署凭据，JSON body 不能提供；
- 响应排除 canonical Evidence payload、credential、Secret 解析值和 private reasoning；
- 不存在任意 SQL 或 ClickHouse proxy endpoint。
