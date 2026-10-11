# W2 · 业务事件同步、投影与 Skill 实际消费

## 目的

业务反馈持续进入正式 Skill/Agent，而不是停留在 client 返回值或日志。

## 前置条件

W1 已有持久读取；合同 02 和 04 的时间/质量定义从本阶段开始落实。

## 实际入口

BusinessEventSubscriptionService、BusinessEventRuntimeRepository、business-event-impact、原 polling/continuation、建议 ugv-business-projection、Skill/result judge 调用点。

路径状态与来源见 [CODE_MAP](../CODE_MAP.md)。拟新增名称仅为建议，存在等价入口时优先复用。

## 实施子任务

### W2.1 · 复用 inbox 触发精确快照刷新

**实现步骤：** 接入原事件消费服务；按 Task scope 或正式 resource relatedTasks 路由。收齐分页/分块并验证；按事件去重与对象 revision 更新，修复实测的同 Context revision 误丢问题。

**可验收输出：** AC-011/012/014，事件→Registry→Context→对象的真实调用链。

### W2.2 · 完成双水位原子性和追平

**实现步骤：** 确认 inbox+admitted 与 projection+processed 两个事务；不得用某任务 snapshot watermark 推进共享流游标。重放保留历史记录，旧对象不回滚当前快照。

**可验收输出：** AC-013；五类崩溃点与失败孔洞测试；并发 CAS 证据。

### W2.3 · 接入 continuity/背压/关停

**实现步骤：** 沿原有 AbortSignal 和有界重试；stream reset 重建当前状态并保留历史缺口。只读刷新可合并，审计事件不能丢。保持 Task polling 兜底；不每条遥测调用模型。

**可验收输出：** AC-015/016，内存/并发上限和停止订阅测试。

### W2.4 · 正式 Skill 与任务视图集成

**实现步骤：** 摘要中带运行状态、精确对象、允许输入/Intervention、来源时间和质量。接到真实 Skill input/判断器/等待原因与对外 Task Artifact；原始业务文本当非可信数据。

**可验收输出：** AC-017/018，通过正式入口捕获模型/Skill 输入并断言事实改变导致结果改变。

## 不可修改边界

不建第二个 event bus/cursor store/workflow runtime；不强制新增顶层 Task 状态；不做独立 UI；投影不能直接发送控制。

## 验证

执行 [验收矩阵](../acceptance/CASE_MATRIX.md) 的 **AC-011–AC-018**；将每个 case 绑定到真实测试文件/名称和报告。局部测试后，按仓库规则运行本批正式里程碑完整 gate，命令依据 [COMMANDS](../acceptance/COMMANDS.md)。不为本工作包杜撰不存在的 npm script。

## 完成标准

AC-011–018 通过；重启/断流不漏已持久事件；正式 Skill 输入和 outcome 有证据引用；不是只改 adapter。

## 失败与恢复

只读暂时失败保持旧版本为 stale/history，不能伪 current；流缺口不可补造 Action 或样本；永久合同错误停止该能力的自动消费并保留原因。

## 本批交付记录

复制 [阶段交接模板](../templates/STAGE_HANDOFF.md) 到该批报告目录；保留具体源码 SHA、代码差异、命令、exit code、测试环境与未执行项。更新总 ExecPlan 和追踪矩阵。本任务卡初始状态为 `NOT_STARTED`。
