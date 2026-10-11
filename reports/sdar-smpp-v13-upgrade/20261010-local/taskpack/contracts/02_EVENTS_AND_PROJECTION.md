# 合同 02：事件同步、双水位和 Skill 投影

## 1. 复用关系

原 `BusinessEventSubscriptionService` 和 `BusinessEventRuntimeRepository` 已提供持久 subscription/inbox/continuity，见 [S08](../SOURCES.md)。正式路径优先是：现有订阅 → 原 inbox → 现有影响处理 → 新增薄业务投影。`SmppTaskBusinessClient.watchContext` 可保留为底层能力/测试入口，不再为每个 Task 新建一条常驻 SSE 和另一份 cursor store。

订阅的连接身份应沿用现有正式 Runtime/Registry 注入机制，并验证 endpoint、Provider、device/resource、executionMode、credential revision 与授权范围。不能只按 ProviderId 相同就让不同 authority 共用写权限。是否需要复用键扩展，在 W0 根据原模型决定；不要在本包提前重设计整个订阅服务。

## 2. 快照初始化与追平

1. 原 binding 已有权威身份；在事务外从原 Registry 读取完整 task-scoped Context。
2. 收齐所有页和 descriptor 分块，校验 Context revision、公开 watermark、对象归属、连续 offset、长度、hash、JSON/schema。
3. 对决策所需 Artifact，读取指定 revision 的完整内容。超过原资源上限时显式 incomplete，不解除限额无限读取。
4. 事务内 CAS 提交该快照和 snapshotWatermark。此 watermark 只代表该 Task 快照覆盖状态的位置，不可以推进整个共享订阅的 admitted cursor。
5. 将 inbox 中相关且需要处理的变化投影/归档。初始快照可能比积压事件更新：旧事件仍需保留审计处理记录，不能让其旧引用覆盖新对象。
6. 若需从 snapshot.resumeFrom 开始流，保证此位置在原正式订阅恢复机制中可表示；不能让一个新 Task 的 watermark 使其他任务事件跳过。已有共享流从自己的 durable cursor 恢复即可。

## 3. 两个事务，不是一个“收到就完成”事务

**事务 A：接收准入。** 验证帧与当前 stream authority，幂等持久 inbox，并推进仅覆盖已可靠准入事件的 admitted cursor。网络失败后从该游标继续，已持久未处理事件仍在 inbox。

**事务 B：投影消费。** 对某条/某批已持久事件读取需要的 Context 后，在本地事务中提交投影/引用解析/业务处理记录，标记 inbox processed，并按原模型推进已连续处理的水位。不能越过失败事件的孔洞而谎报连续完成。若原仓库以 per-event checkpoint 表达，保留它，不强制新增全局计数。

崩溃点测试必须覆盖 A 前、A 后、网络读取后、B 前、B 后。幂等投影可以重复执行，设备变更绝不能因为投影重试被直接触发。写入只能产生候选并走独立受管命令链。

## 4. 去重、版本和时间各司其职

事件唯一性：使用现有 envelope 的 eventId 与公开 stream/sequence 及 hash；同身份不同内容是冲突。对象唯一性：绑定/Execution + kind/id/revision。Context revision：仅用于快照元数据前进。sourceTime：用于业务新鲜度和轨迹解释，不用于替代公开恢复游标。

允许多个不同事件共享 Context revision。允许快照更新合并，但 inbox 中不同事件/对象的处理与历史证据不能因此消失。禁止“本次 revision 等于上次，所以所有后续事件全部丢弃”。

## 5. continuity、重试和负载

stream reset/cursor expired：记录断流原因与缺口范围，重建完整当前快照，保留 historyContinuous=false，使用正式新的游标。不要杜撰缺口中的 Action、轨迹样本或控制回执。

只读瞬时失败使用现有有界退避、AbortSignal 和关停机制；格式/身份/hash 冲突不能无穷重试。现有 polling 仍负责 Task 生命周期，SSE 失效不等于 Task 已取消。刷新合并不丢审计，控制事件优先于普通进度；不对每条遥测调用 LLM。

## 6. Agent/Skill 视图

投影输出包含 `executionSummary`、`artifactRefs`、`interactionRequests`、`allowedInterventions`、`quality`、`evidenceRefs`；名称为内部建议。模型得到经过校验的摘要、限制与精确引用，不是无边界原始 JSON、秘密或可执行指令。

必须接到正式 Skill 输入/结果判断/原任务等待，而不只是 UI 或日志。来自 Provider 的字符串均视为非可信业务数据。提供给模型的“允许选项”只是候选范围；实际执行仍核对原 capability、权限、版本、确认与有效期。

## 7. 任务终态

Task terminal 与 Context finalized 是两个事实。Task 已终态时停止产生新控制候选；可在有界窗口只读补齐终态证据。只出现 Context finalized 而 Task 未终态时继续原状态核对，不强行改 Task status。迟到证据可附加历史，不能复活任何任务。
