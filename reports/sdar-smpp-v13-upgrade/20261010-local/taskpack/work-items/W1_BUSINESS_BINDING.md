# W1 · 持久任务业务关联与对象读取

## 目的

任何业务对象都能追溯到原正式 Task/Execution/authority；读取和重启不会认领错误任务。

## 前置条件

W0 完成；合同 01 与 05 作为实现约束。

## 实际入口

RemoteTaskBinding、McpRegistryService.readRemoteTaskBusiness*、remote-task-repository、原 GOWM storage 适配器、建议薄业务 read model。

路径状态与来源见 [CODE_MAP](../CODE_MAP.md)。拟新增名称仅为建议，存在等价入口时优先复用。

## 实施子任务

### W1.1 · 定义最小内部 DTO

**实现步骤：** 采用合同 01 的身份/版本/对象/完整性组；核心使用自有类型，不直接暴露 Smpp/Zod/SDK 类型。入口以 bindingId 定位 authority；标注未知与 unsupported。

**可验收输出：** 内部类型与 schema/normalizer 单元测试；每个字段的外部或本地出处明晰。

### W1.2 · 补齐原绑定到 Execution 的证明

**实现步骤：** 优先复用正式 admission/execution-link；必要时原 task-scoped Context 首次 CAS 绑定。读取任何 Artifact 前核对 task/execution/provider/resource/operation 与精确 ref。

**可验收输出：** 跨身份正反例，首次绑定竞争测试，重复相同绑定幂等。

### W1.3 · 实现读模型和内容引用持久化

**实现步骤：** 优先扩展原存储；网络读取在事务外、CAS 在事务内；对象未解析不能标完整。完整内容通过已有 artifact 存储引用，元数据及摘要保持不可变。

**可验收输出：** 增量迁移（确需时）、真实 PG 测试、旧绑定兼容与摘要冲突拒绝。

### W1.4 · 接入原 Task 读取生命周期

**实现步骤：** 在远端 admission 已持久后安排只读 hydration；启动恢复从原 binding 加载，不触发新的 tools/call。无 TaskBusiness Provider 仍沿用旧生命周期。

**可验收输出：** 可从正式服务读取持久业务视图；重启 Task/Execution/派发数量不变。

## 不可修改边界

不复制整份 mutable authority；不对陌生 taskId 开放读取；不直接写 SMPP 表；不把无业务扩展当所有任务必败。

## 验证

执行 [验收矩阵](../acceptance/CASE_MATRIX.md) 的 **AC-006–AC-010**；将每个 case 绑定到真实测试文件/名称和报告。局部测试后，按仓库规则运行本批正式里程碑完整 gate，命令依据 [COMMANDS](../acceptance/COMMANDS.md)。不为本工作包杜撰不存在的 npm script。

## 完成标准

AC-006–010 通过；旧任务可读、新任务精确关联；有真实持久化证明而非仅内存 Map。

## 失败与恢复

Execution 缺乏证明时只读状态为未绑定/待核对，不将设备最新状态塞入当前任务；GOWM 正式角色/迁移缺口不得通过新建数据库绕过。

## 本批交付记录

复制 [阶段交接模板](../templates/STAGE_HANDOFF.md) 到该批报告目录；保留具体源码 SHA、代码差异、命令、exit code、测试环境与未执行项。更新总 ExecPlan 和追踪矩阵。本任务卡初始状态为 `NOT_STARTED`。
