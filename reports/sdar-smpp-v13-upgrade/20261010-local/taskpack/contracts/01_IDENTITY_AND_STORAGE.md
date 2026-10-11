# 合同 01：身份、业务关联与存储

本文件中的字段/方法为 **SDAR 内部建议**，不修改 SMPP 公开 wire schema。已存在类型应增量复用；参考 [代码定位](../CODE_MAP.md)、[S02/S07/S10](../SOURCES.md)。

## 1. 权威链

`AgentTask → capabilityAttempt / nodeRun → RemoteTaskBinding → frozen authority → SMPP Task → Execution → object refs`。

应用入口只接收本地 `bindingId`、明确的操作及已确认输入；从存储加载 endpoint、Provider、resource、合同及凭据版本。不能信任模型传入的 endpoint、actor、remoteTaskId、Provider binding 或 executionId 作为授权来源。

初次发现 Execution：优先采用已有正式 admission/result/execution-link；若当前合同只在 task-scoped Context 中提供 Execution，则允许在该精确 Task 的原冻结 authority 下，验证完整身份与 operation 后，通过 CAS 建立第一次关联并记录依据。该操作不是“把设备最新任务认领为当前任务”。同一绑定后续出现不同 Execution，默认冲突；只有上位合同明确允许且有迁移事实才可改变。

## 2. 内部业务关联记录

| 字段组 | 建议语义 | 不变量 |
|---|---|---|
| 本地归属 | taskId、capabilityAttemptId、nodeRunId、bindingId | 取自已持久真实实体；不为填表伪造 ID |
| 远端身份 | remoteTaskId、remoteExecutionId、providerId、resourceId、operationName | 与原 task authority 和正式 Context 一致 |
| 权威引用 | authoritySnapshotRef/hash、protocolContractRef、credentialRevision | 引用原记录，避免复制另一份可变 authority |
| 业务版本 | contextRevision、effectivePlanRevision、projectionRevision | 三者区分，版本不会跨执行复用 |
| 对象引用 | kind、id、revision、resolution、contentDigest/ref | 引用有值不等于内容可用；版本不可覆盖 |
| 同步质量 | currentStateComplete、historyContinuous、requiredObjectsResolved | 分别判断，不合并为 complete 一个布尔值 |
| 时间 | sourceTime、sourceTimeBasis、deviceReportedAt、sdarReceivedAt、projectedAt | Provider 接收时间为源，其他时间保持独立 |
| 同步位置 | streamId、snapshotWatermark、appliedEventPosition | 不代替全流的已持久 admitted cursor |

`bindingId` 为索引起点；相同远端 tuple 重复输入必须是等值幂等，不同 tuple 不可静默覆盖。对象主键逻辑至少含绑定/Execution 和 `{kind,id,revision}`。如果原存储中存在更严格 owner/device/service 作用域，必须继承，不新建宽松 global key。

## 3. 最小持久化方案

优先复用原 RemoteTaskBinding 的扩展读取记录、事件 inbox 与 Input/control journal。当前快照可为一份 SDAR 自有 JSONB read model；精确大对象内容只保留内容地址和摘要，使用已有 artifact/evidence 存储，禁止重复塞入每条 Task event。

只有已有结构无法满足原子性/查询/不可变版本要求时，才新增薄投影表或命令记录，必须有 ADR 说明为何不能复用。这里不强制表名或迁移编号。不能把所有原始遥测复制进新 PostgreSQL 表，也不能只存摘要却宣称完整轨迹保留。

对 GOWM：复用当前正式 storage adapter、device/service scope 与 owner 迁移机制。不能直接 ALTER/UPDATE SMPP 的 `ugv_smpp` 私有数据，不可让 SDAR 角色借超级权限修复上游 schema。若 GOWM 合同无可用写位置，隔离开发可继续，选定 GOWM 路径必须记阻塞而非切回本地隐藏差异。

## 4. 事务和读模型

完整远端读取在事务外完成；事务内重新核对本地 binding/version/terminal 标志，使用 CAS 提交投影。网络读取期间出现取消/版本更新时，保留事实可作为历史，但不可更新成活动视图或唤醒新动作。

对象版本/hash 冲突拒绝；高版本引用内容未解析时记录 unresolved。上一个完整版本可用于历史展示，必须带 observedRevision/stale 标识。只要本次任务决策所需对象不完整，结果判定器不得使用该视图得出成功。

## 5. 兼容与扩展

旧绑定无 TaskBusiness 时维持原生命周期；业务视图状态为 unsupported/absent，而非伪空完整 Context。不能把增加业务投影变成所有普通 MCP 工具的强制依赖。

所有迁移需要 forward/rollback 说明、旧记录读取、并发冲突和真实 PostgreSQL 测试；只有局部单元夹具不能证明 GOWM 角色和实际约束已通过。
