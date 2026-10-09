# SDAR ↔ SMPP v1.3 联调（2026-10-03）

结论：只读 MCP 互通，治理业务链仍阻塞。本次没有修改代码或现场配置、重启容器、新建车辆任务、执行设备控制，也没有重复导航/侦察/锁定/发射功能验收。发射禁用要求保持不变。

## 运行身份与只读验证

SMPP 交接提交 0a4a7c36865d4c9920a4e65857c0903e9ef12533；SDAR 实际镜像 sdar-sz-gowm:union-29fdcfe193d6。Provider isr.vehicle.ugv.ugv、resource vehicle:ugv、GOWM device ugv:ugv。

SDAR 实际挂载配置为 development/live，无 simulation ID，资源 vehicle:ugv；未设置 live 省略头开关，源码默认 emit，显式 live 与新版 SMPP 兼容。

在 SDAR 容器内直接使用已部署 FrozenV1McpClient，通过宿主机网关 172.17.0.1:19100/mcp，分别以省略模式头及显式 live 请求 server/discover、tools/list、vehicle_get_state、vehicle_get_payload_status、vehicle_get_targets，10 次全部通过。没有 Authorization 或 simulation-id，JSON-RPC ID 1–10 及方法对应见 site-readonly.json。三个查询的 structuredContent 均保留 ugv.business-semantics/1 和 native 原码。此证据覆盖客户端传输层，不覆盖 Registry/Skill 调用路径。未从 unknown 推断健康或目标发现。

## 具体阻塞

1. 正式只读 deploy/development/verify-resource-identity.mjs 退出 1：provider-binding / UGV_PROFILE_SCHEMA_DRIFT，deviceCalls=0。公开卡资源检查已通过，但导航或终态读合同不满足治理解析器要求。失败发生于无动作资格解析，不能通过绕过 Schema 或伪造 readiness 修复。当前证据尚不能区分是哪一个合同谓词，也不能将失败直接归因于新 businessSemantics 字段。下一步需导出已登记合同与 v1.3 当前工具合同的脱敏差异，按正式 Source/Provider/Capability successor 流程适配。
2. packages/mcp-adapter/src/frozen-v1-mcp-client.ts 的方法联合及扩展声明仅覆盖 Tasks 等既有入口，无 TaskBusiness Context/artifacts/interventions/apply 支持，且请求构造覆盖客户端 capabilities。通用 tasks/update 可不带凭据提交，但不能因此宣称 RequiredInput 业务闭环已实现；未具备 request/revision/subject/deadline 的完整业务对象核对。
3. Intervention 的 execution/plan/intervention revision/commandId 守卫未在 SDAR 客户端实现，不向现场发送调整命令来尝试。
4. businessSemantics 在原始 structuredContent 中得到保留；未发现 SDAR 专用语义投影及 Context/Event 一致性消费实现。不能宣称专用界面、推理消费或全链语义验收通过。

## 本地验证

命令：pnpm exec vitest run packages/application/test/mcp-registry.unit.test.ts packages/mcp-adapter/test/frozen-v1-task-lifecycle.contract.test.ts packages/mcp-adapter/test/business-events-client.contract.test.ts。

3 文件、99 项通过。覆盖已有 live 头、Task Input 生命周期与 BusinessEvents 客户端回归，不代替缺失的 TaskBusiness 能力。本次只读诊断无实现变更，未运行全仓 gate。

证据：site-readonly.json、governance-readonly.log、client-regressions.log、summary.json；readonly-probe.mjs 保存现场容器执行的只读脚本（需 node --input-type=module 从 stdin 执行）。完整业务链验收保持未通过。
