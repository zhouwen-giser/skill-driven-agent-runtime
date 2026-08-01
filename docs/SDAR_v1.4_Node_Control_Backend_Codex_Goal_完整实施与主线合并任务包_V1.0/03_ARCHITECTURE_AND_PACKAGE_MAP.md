# 03. 架构与包映射

## 目标进程

```text
apps/node-control-api
apps/node-control-worker
apps/server                    # 现有 Runtime，按冻结端口适配
```

Node Control Backend 必须可独立启动和停止。

## 建议新增包

```text
packages/node-control-domain
packages/node-control-application
packages/node-control-persistence-postgres
packages/runtime-control-client
packages/smpp-registry-adapter
packages/telemetry-export-adapter
```

实际路径必须在 P00 基于最新 main 校准，不能为了匹配文档重复现有包。

## 依赖方向

```text
API / Worker
→ Application
→ Domain + Ports
→ PostgreSQL / Runtime / SMPP / Telemetry Adapters
```

禁止：

- Domain 依赖 Express、pg、SDK；
- Node Control API 直接写 Runtime 业务表；
- Runtime 直接写 Node Control DB；
- Console 代码进入本 Goal；
- Node Control 引入第二 Workflow Engine；
- Adapter SDK 类型穿透 Domain。

## 独立性门禁

- 停止 Node Control Backend，Runtime 已有 Task 继续；
- 停止 Runtime，Node Control 能显示 Observed unavailable，不篡改 Desired；
- Control DB 故障不清空 Runtime LKG；
- Redis 丢失不丢正式配置或 Capability。
