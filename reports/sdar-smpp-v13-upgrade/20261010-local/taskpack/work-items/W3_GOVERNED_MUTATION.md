# W3 · RequiredInput 与导航 Intervention 受管写入

## 目的

将已有请求构造器接入真实授权、持久发送和后续确认，完成原 Task 内的可控业务变化。

## 前置条件

W2 的精确视图与原任务唤醒入口已完成；合同 03/05 强制适用。

## 实际入口

RemoteTaskInputService、governed-control-authority、相应 PostgreSQL repository、McpRegistryService、SmppTaskBusinessClient；必要时薄 business-command 编排。

路径状态与来源见 [CODE_MAP](../CODE_MAP.md)。拟新增名称仅为建议，存在等价入口时优先复用。

## 实施子任务

### W3.1 · 复用真实授权与发送记录

**实现步骤：** 沿原确认/预授权获取可信 receipt；明确一次性权限消费的位置，持久化不可变内容与 dispatch claim。development 可无网络 Token，但无内部权威必须发送前拒绝。

**可验收输出：** AC-019，拒绝路径 wire counter 为零；本地意图早于网络发送。

### W3.2 · 接通原 Input 服务

**实现步骤：** 复用输入 link/attempt/上下文串行门；核对原 task inputRequests 与 Context request/subject/revision/deadline。按 strict wire 白名单发送；原 prompt cancel 与 Task cancel 分离。

**可验收输出：** AC-020–024，正常答复、过期/替换、丢回执以及禁止字段序列化测试。

### W3.3 · 接通运行中导航调整

**实现步骤：** 使用当前 available Intervention；冻结两个 revision、合法 payload 与 commandId。通过相同治理与发送路径，不另建导航 Task。原 Workflow 不原地改写，只更新远端业务计划事实。

**可验收输出：** AC-025–027，running 可调整，ack 不更新采用路线，applied 必须精确关联原命令。

### W3.4 · 实现幂等、竞争与不确定结果核对

**实现步骤：** 同 ID 同内容归并、异内容拒绝；lease 过期不自动取得重新派发权。取消在最终边界优先或记录已在途状态；未知响应先读原请求/业务对象，不发明新查询 RPC。

**可验收输出：** AC-028–030，多发送者、崩溃、同内容冲突和有限核对；保留 uncertain，不盲重发。

## 不可修改边界

不提供永真 mutationAuthority；不新增 respondedBy/expectedRequestRevision wire 字段；不扩大到独立锁定/发射；不自动放开现场开关。

## 验证

执行 [验收矩阵](../acceptance/CASE_MATRIX.md) 的 **AC-019–AC-030**；将每个 case 绑定到真实测试文件/名称和报告。局部测试后，按仓库规则运行本批正式里程碑完整 gate，命令依据 [COMMANDS](../acceptance/COMMANDS.md)。不为本工作包杜撰不存在的 npm script。

## 完成标准

AC-019–030 的隔离场景通过；两种写操作均从正式 Task/控制入口执行并等待业务证据；拒绝路径、单发送者与响应丢失都有持久证明。

## 失败与恢复

确认过期/撤销/版本冲突时重新读取和决策，不挪用旧授权；HTTP/进程故障进入 uncertain。缺少精确核对证明时不自动创建替代命令。

## 本批交付记录

复制 [阶段交接模板](../templates/STAGE_HANDOFF.md) 到该批报告目录；保留具体源码 SHA、代码差异、命令、exit code、测试环境与未执行项。更新总 ExecPlan 和追踪矩阵。本任务卡初始状态为 `NOT_STARTED`。
