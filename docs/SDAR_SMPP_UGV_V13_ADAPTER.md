# SDAR ↔ 已部署 SMPP UGV Provider v1.3 兼容适配

## 适配基线与边界

- 本次以 **已部署** SMPP Git revision `0a4a7c36865d4c9920a4e65857c0903e9ef12533` 为准，而非尚未部署的顺序多目标 AutoLock 版本。
- MCP Frozen V1 protocol `2026-07-28`；TaskBusiness `1.0-rc2`；BusinessEvents `1.0`。
- Provider `isr.vehicle.ugv.ugv`；资源 `vehicle:ugv`；GOWM device `ugv:ugv`。
- 本站 `AUTH_MODE=development`，无需 Token；`executionMode=live` 默认；无 simulation-id。
- 禁止设备发射：`UGV_FIRE_ENABLED=false`；本轮不改 SMPP、设备端、现场部署和运行配置。

## 已增加的 SDAR 组件

1. `FrozenV1McpClient` 扩展 SMPP TaskBusiness / Task Execution 方法集合，保留调用方已有 `clientCapabilities.extensions`，按 SMPP 方法规则发 `MCP-Name`。
2. `SmppTaskBusinessClient` 使用现有 Frozen MCP Transport：
   - `getContext`：逐页读取 Context、Object/Descriptor，按 snapshot revision 与 BusinessEvents cursor fail closed；
   - `getArtifact/readArtifactContent`：任务归属、指定 revision、内容 offset/size 与 SHA-256 校验；
   - `listenFrom/watchContext`：复用 `FrozenBusinessEventsClient` 的公开 cursor，从事件触发刷新完整 Context，而非新建第二套状态机；
   - `parseSmppUgvBusinessSemantics`：解析 `ugv.business-semantics/1`，`native` 原码不丢失，`unknown` 不推断为 normal/ready；
   - `respondToRequiredInput`：校验 task/execution/requestKey/requestRevision/subject/deadline/Tool Input Schema，按标准 `tasks/update` 提交；
   - `applyNavigationAdjustment`：校验 Intervention 版本与当前 effectivePlanRevision、inputSchema、commandId，按 SMPP 指令提交。
3. `McpRegistryService.readRemoteTaskBusinessContext/readRemoteTaskBusinessArtifact/readRemoteTaskBusinessArtifactContent`：
   - **必须提供**原 Remote Task 上冻结的 Authority Snapshot、credential revision、protocol contract；
   - 按原 `#assertRemoteTaskReadAuthority` 检验 Server、Tool、Source/Provider/Binding、冻结 Catalog 和当前健康资格；
   - 使用原已登记 MCP endpoint 和 SDAR stored secret/Execution headers；不允许绕过 Registry 从未知 Task ID 读取业务对象；
   - 底层适配通过 `apps/server/src/runtime.ts` 注入已有 `McpRegistryService`。

## 对 SDAR Agent 的实际可用性分级

| 能力                                        | 当前接入状态               | 证明边界                                                         |
| ------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| Frozen MCP 基础任务/只读 Tool               | 复用既有能力               | 历史直接 MCP 互通，不代表治理通过                                |
| Registry-governed Context/Artifact read     | 已连接到服务端 Registry    | 仍需验证实际受管任务读取成功                                     |
| BusinessEvents Cursor / Context hydration   | Adapter 实现，复用现有 SSE | 需要实际 Task 事件流验收                                         |
| RequiredInput 无凭据请求                    | Adapter 能构造并本地预检   | **默认禁用写入**；只有提供真实 SDAR `mutationAuthority` 才能提交 |
| Navigation Intervention                     | Adapter 能构造并本地预检   | **默认禁用写入**；不能把 Runtime receipt 当设备执行成功          |
| SDAR Registry → Skill → Agent 自动消费/决策 | 尚未完成现场联调验收       | 不得标记 END_TO_END_READY                                        |
| 新版顺序 AutoLock                           | 非本站 0a4a7c3 已部署能力  | 不因本次兼容代码而改变现场                                       |

调用方不能传入伪造的 `respondedBy`，也不能自行将 `mutationAuthority` 写成永真函数。应复用现有 SDAR Task/Capability/Control 授权与持久命令账本，在受控阶段绑定真实 Execution 后开启。接收 Command ACK 仅表示受理；仍须继续读取 Context / Intervention / Device 事实来确认 applied。

## 只读治理诊断

2026-10-03 报告里的 `UGV_PROFILE_SCHEMA_DRIFT` 是当时镜像上的只读验证失败，不等价于当前代码仍然失败。SDAR main 已有 read/output 合同调整；必须对已登记 Source/Provider/Capability 和 **当前部署** SMPP 进行只读合同差异对比。发生漂移时：

1. 导出 Provider Binding 与冻结 Catalog 的无密钥 checksum、schema 及精确差异路径；
2. 依 Source/Provider/Capability successor 流程修复；
3. 不绕过 schema、禁止凭空更新 health/readiness；
4. 再执行原 `deploy/development/verify-resource-identity.mjs`（仅验证、不触发 Tool 控制）。

## 测试命令

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec vitest run \
  packages/mcp-adapter/test/smpp-task-business-client.contract.test.ts \
  packages/mcp-adapter/test/frozen-v1-http.contract.test.ts \
  packages/application/test/mcp-registry.unit.test.ts
```

CI 工作流：`.github/workflows/smpp-v13-adapter.yml`（使用完整 SHA 固定 Action）。

完成以上源代码/合同验证，**不等于现场任务写入或 SDAR 端到端验收**。本分支不启动车辆、不发送 `vehicle_navigate`、`vehicle_area_recon`、锁定/发射请求，不修改运行镜像。

## 下一阶段受管业务闭环的明确门槛

- 在 SDAR Task/Execution 上持久保存和复核 SMPP TaskBusiness 引用，应用业务投影到 Skill/Agent 的当前任务视图。
- 建立真实 `mutationAuthority`：检查冻结的 `providerBindingId` / capabilityAttempt / Task + Execution，依 SDAR 控制授权与持久化发送边界执行；禁止直接提供永真回调。
- 从既有 Task 获取 Context + RequiredInput 后，经同一 SDAR 治理路径提交 `tasks/update`；Intervention 保持 commandId 幂等，并等待 `applied`。
- 先以受控夹具确认，再根据用户现场授权进行真实业务验收；发射始终禁用。
