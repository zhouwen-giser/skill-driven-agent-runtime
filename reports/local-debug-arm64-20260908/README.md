# 本地 Runtime 与 ARM64 SMPP 联调记录

日期：2026-09-08。源码：`cb50da8ec8d160a673852be8bcdfc3bb094f5ce5`。

## 已启动

- 本地 Compose 项目：`sdar-development`，6 个容器运行；Runtime、Control API、两个 PostgreSQL 健康。
- Console：http://127.0.0.1:10998/console/
- Runtime 健康：`GET http://127.0.0.1:10998/api/v1/health` → 200。
- A2A：http://127.0.0.1:10999；官方 Agent Card → 200。
- Control API：http://127.0.0.1:10091；`/health/ready` → 200。
- 私有部署配置：`deploy/development/.env`（已忽略，不提交凭证）。沿用已有模型配置，没有更换模型。
- 启动命令：`node deploy/development/cli.mjs up`。保留持久卷和运行服务。

## 远端接入

引用任务：`01a079c2-ce84-7550-8bc0-40f803a15992`（梳理调试记录并检查未完成功能），已读取其部署记录并通过 SSH 核对。

- SSH：`smpp-arm64-dev`；既有部署目录 `/home/cwsz/smpp-validation/20260907-68b58793`。
- Frozen MCP：`http://192.168.1.7:29100/mcp`，协议 `2026-07-28`；健康检查 200。
- Telemetry Query：`http://192.168.1.7:28088`，健康检查 200。
- Grafana：`http://192.168.1.7:23000`。
- 远端服务保持原部署，未重启、未重新部署。
- 游戏仿真软件采用 live transport；本记录不构成物理设备验证。

该部署未包含 Registry/PMS。本地通过正式管理 API 创建 direct binding `smpp-arm64-dev-binding`，Control 操作 `6132b81f-4c16-42be-90d8-79452a4f9683` 成功，并独立注册 Runtime MCP server `smpp-arm64-dev`，发现 10 个工具。未伪造 Registry 来源。

本地使用普通在线 Task Type 路径（`SDAR_TASK_UNDERSTANDING_PROFILE=off` 关闭专用静态 profile）。人工注册只读 Skill `skill.arm64.vehicle-state` v1，仅允许 `vehicle_get_state`，禁止其余控制工具，要求计划确认。经配置治理激活 Task Type `arm64.vehicle-state-read` v1，来源 configured。注册脚本及摘要保存在已忽略目录 `.state/arm64-debug/`。

## 本次验证与未完成项

1. 官方 A2A SDK 发起 Task `64712aef-114c-44cf-ad89-91db367f06e4`，已召回配置 Task Type，但在模型调用阶段失败；未生成计划，未执行远端工具。错误 `MODEL_INVOCATION_FAILED` / `MODEL_TRANSPORT_UPSTREAM_ERROR`，约 30 秒。
2. 独立最小模型诊断复现 `UND_ERR_CONNECT_TIMEOUT`。容器 DNS 返回代理虚拟 IP `198.18.0.30`；随后三个不携带业务信息的最小请求返回 HTTP 200。现有证据支持连接间歇失败，尚未证明代理是根因，也未证明生产请求已恢复。
3. 自动审批拒绝重新发起 A2A 业务查询：它会将内部服务、车辆标识发送至配置的外部 DashScope 模型。未绕过拒绝，完整模型联调暂停，等待明确外发授权。
4. 独立直接向指定内网 SMPP 调用 **一次** `vehicle_get_state({resourceId:"vehicle:ugv1"})`，未调用外部模型。返回 `resultType=complete`、`isError=false`，MQTT/MCP 均连接、deviceAvailable=true。观测时间 `2026-09-08T02:12:51.448Z`；状态 revision `2b8c37ca38cfaadfac16dfcb018af3288891072505592c97c0a1e8c3579b21c3`。仅保存身份、连接、版本、时间摘要，未导出完整遥测或历史日志。
5. 初次镜像拉取出现网络超时；重拉原锁定 Redis 镜像成功，未修改镜像版本或 Docker 全局配置。

结论：本地服务已启动，远端发现与只读 MCP 调用已验证。完整 A2A 理解、Skill 选择、DSL 确认、执行及 Artifact 流尚未验证通过；不宣称发布验收或完整端到端成功。未运行控制操作。本次仅配置与启动调试环境，没有修改运行时代码，也没有重复全仓库门禁。

授权后下一步：重新提交只读 Task；检查实际 DSL 仅包含一次状态读取后，通过标准确认继续；核对工具调用次数、Artifact 先于终态及持久结果。

## 复查（2026-09-08 06:56 UTC）

本次重新读取引用任务，并复查现有部署：本地 Runtime、A2A Agent Card、Control API 与远端 SMPP/Query 就绪接口全部 HTTP 200，6 个本地开发容器仍在运行。使用当前仓库 FrozenV1McpClient 执行 tools/list，返回 10 个工具，包含 vehicle_get_state。本次未重复创建 Task、调用外部模型或执行游戏控制。当前工作区另有未提交 GOWM 修改；现有容器不代表这些修改已部署或验证。完整 A2A 模型链仍受上节记录的外发授权问题阻断。

## 复查（2026-09-08 08:09 UTC）

本地 6 个调试容器仍在运行。Runtime、A2A Agent Card、Control API、ARM64 SMPP 就绪检查均为 HTTP 200。当前仓库 FrozenV1McpClient 的 tools/list 实际返回 10 个工具，包含 vehicle_get_state。复用现有运行环境，未重建镜像或将未提交的 GOWM 修改部署进去。未重复调用外部模型；完整 A2A 业务链仍待先前外发审批问题解决。本次仅复查服务健康与 MCP 目录，不将历史只读执行结果记作本次执行证据。

## 当前请求复查（2026-09-08T09:12:51.907222+00:00）

已读取用户指定的关联任务。Runtime、A2A Agent Card、Control API、ARM64 SMPP 与 Query 就绪接口本次均返回 200；通过当前仓库 FrozenV1McpClient 实际 tools/list 返回 10 个工具，包含 vehicle_get_state。复用现有调试环境，未部署未提交的 GOWM 修改。未调用外部模型或控制工具；此前记录的外部 DashScope 业务数据发送审批拒绝仍须用户明确授权后才能继续完整 A2A 链路。

## 用户外发授权后的尝试（2026-09-08）

用户明确允许本次只读查询的内部服务和车辆标识发送至原 DashScope。Task 89b441f4-d029-4e95-a995-2f8e5a2b983c 和 ea04ed1f-30e3-4d12-9603-3a4a25d9c6c4 均在 task_understanding 约 30 秒失败（MODEL_TRANSPORT_UPSTREAM_ERROR）；未生成 DSL/执行工具。实际容器无凭证健康连通为 401；最小结构化请求为 200、2462ms。Provider 为 300000ms，但理解阶段另有 30000ms 限制，仍不足以断言完整请求失败的根因。直接重发完整审计载荷的诊断被自动审批拒绝：其还包含内部能力、Task Type 和运行上下文，超出用户明确授权的字段范围。未发送该诊断载荷、未绕过、未调整业务超时。原“缺服务/车辆外发授权”已解除；完整额外上下文诊断仍待批准。

## 补充授权后的完整请求诊断（2026-09-08）

用户明确允许诊断发送该 Task 的能力描述、Task Type 定义和运行上下文。随后从实际 Runtime 容器将 ea04ed1f-30e3-4d12-9603-3a4a25d9c6c4 已审计的相同 task_understanding 请求发送至原 DashScope；诊断在 65001ms 返回 TimeoutError，未收到完整响应。不更改模型/业务超时、不执行工具、不篡改失败 Task。最小请求 2462ms/200 与完整请求超时的差异已确认，根因仍未证明；当前已无待处理的外发授权问题。暂停重复外部请求，后续需诊断模型生成与传输的具体耗时。
