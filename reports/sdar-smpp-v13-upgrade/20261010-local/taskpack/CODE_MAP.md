# 代码定位与改动边界

来源为 [S02、S06–S10](SOURCES.md)。以下“已确认存在”指文件已读取或由实际 export/import 确认，并不代表已穷尽审查实现。“建议新增”必须先排除已有等价组件。

| 状态 | 路径 / 符号 | 本轮用途 |
|---|---|---|
| 已确认存在 | `packages/mcp-adapter/src/frozen-v1-mcp-client.ts` / `FrozenV1McpClient` | 原 Frozen MCP transport；方法协商、headers、元数据继续复用 |
| 已读取 | `packages/mcp-adapter/src/smpp-task-business-client.ts` / `SmppTaskBusinessClient` | 快照/内容读取、业务预检；加强身份、内容和调用上下文，不建立第二连接 |
| 已确认存在 | `packages/application/src/mcp-registry.ts` / `McpRegistryService` | 原 authority 校验；统一业务读取、订阅和写入入口 |
| 已读取 | `packages/application/src/business-events.ts` / `BusinessEventSubscriptionService` | 原 subscription、inbox、continuity 与双水位 |
| export 确认 | `packages/application/src/business-event-impact.ts` | 原业务事件影响处理；W0 核定新增投影接入位置 |
| 已读取 | `packages/application/src/remote-task-input.ts` / `RemoteTaskInputService` | 复用 process/prepareResponse/submitAnswer 与原等待输入链 |
| export 确认 | `packages/application/src/remote-task-polling.ts` | 原生命周期轮询，不能被 Context 同步替代 |
| export 确认 | `packages/application/src/remote-task-admission-recovery.ts` | 既有 uncertain admission 的只核对恢复 |
| export 确认 | `packages/application/src/remote-task-continuation.ts` | 原等待/恢复入口，禁止另建 workflow runtime |
| export 确认 | `packages/application/src/remote-task-cancellation.ts` | 原取消流程及同任务串行边界 |
| export 确认 | `packages/application/src/governed-control-authority.ts` | 确认、权限、dispatch authority 的主入口 |
| export 确认 | `packages/application/src/governed-control-ugv-authority.ts` | 原 UGV 控制约束，仅核对/复用，不扩大设备动作集 |
| import 确认 | `packages/application/src/ports.ts` | 核对输入、事件、远端任务与存储 ports；核心不得依赖外部 SDK 类型 |
| export 确认 | `packages/application/src/skill-execution-recording.ts`、`skill-evidence-matcher.ts` | Skill 结果引用和匹配 |
| export 确认 | `packages/application/src/result-processing-service.ts`、`outcome-judges.ts` | 业务结果分层判定 |
| export 确认 | `packages/application/src/task-service.ts`、`task-projection.ts` | 正式用户任务入口与现有对外投影 |
| 已确认存在 | `apps/server/src/runtime.ts` | 依赖注入与运行资源生命周期，不放业务规则 |
| export 确认 | `packages/persistence-postgres/src/remote-task-repository.ts` | 原任务绑定持久化 |
| export 确认 | `packages/persistence-postgres/src/remote-task-input-repository.ts` | 原 Input Link/Attempt，优先增量扩展 |
| export 确认 | `packages/persistence-postgres/src/governed-control-authority-repository.ts` | 原确认与发送事实记录；检查是否足够承载 Intervention |
| export 确认 | `packages/persistence-postgres/src/workflow-continuation-repository.ts` | 原 claim/continuation 持久机制 |
| 已确认存在 | `deploy/development/verify-resource-identity.mjs` | 现场只读资格验证入口；运行前检查当前脚本行为与参数 |
| 已确认存在 | `packages/mcp-adapter/test/smpp-task-business-client.contract.test.ts`、`frozen-v1-http.contract.test.ts` | 复用现有合同夹具和运输层测试 |
| 已确认存在 | `packages/application/test/mcp-registry.unit.test.ts` | Registry authority 正反例 |
| 建议新增 | `packages/application/src/remote-task-business.ts` | 只做同步编排；优先可直接落在现有事件影响模块 |
| 建议新增 | `packages/application/src/ugv-business-projection.ts` | 外部标准语义 → 内部只读 DTO；不再翻译设备原码 |
| 建议新增 | `packages/application/src/remote-task-business-command.ts` | 仅当原 Input/control 没有可复用编排入口时新增薄协调层 |
| 建议新增 | 对应 `*.unit.test.ts` / `*.contract.test.ts` / PostgreSQL 集成测试 | 名称按仓库实际 Vitest project 分类落位 |

## W0 必须产出的定位清单

每行记录“职责 → 真实文件/符号 → 当前调用者 → 修改点 → 所有者 → 对应测试”。对 domain 实体、GOWM storage adapter、迁移目录、schema owner、evidence 注册器、对外 Task/A2A route 和 active ADR，必须查看当前工作树，不猜文件名、迁移编号、路由 URL 或默认 schema。

## 三处必须实测而不能靠文档断言的风险

1. `watchContext` 的相同 Context revision 去重与对象/事件去重是否混用；加 AC-012 后决定修复范围。
2. 原 `RemoteTaskInputService.submitAnswer` 展示了发送后记录结果，但发送前权限消费和意图持久化可能在外层；必须沿调用链核对，不能只凭片段宣布缺陷，也不能默认外层已经保障。
3. 当前 Registry 业务读取是否完整核对原 execution/operation、旧 binding 与健康约束；读取历史事实和授权新变更不可混为一体，不能以恢复为由绕过权限。
