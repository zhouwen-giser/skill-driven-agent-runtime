# W0 · 合同、治理与现有基础收口

## 目的

确认当前代码与已部署合同真正差在哪里，保留现有 PR34 已完成部分，产出可执行源码映射与字段依据。

## 前置条件

无；必须先于所有实现工作。

## 实际入口

AGENTS.md、PLANS.md、实际需求/ADR、package.json、PR34 九个变更文件、McpRegistryService、Provider output schema、正式 Source/Capability successor、verify-resource-identity.mjs。

路径状态与来源见 [CODE_MAP](../CODE_MAP.md)。拟新增名称仅为建议，存在等价入口时优先复用。

## 实施子任务

### W0.1 · 建立非破坏性基线

**实现步骤：** 运行 scripts/audit_repo.py；读取 git status、HEAD、main/PR34 祖先关系；确认 PR 是否已合并或有后继提交。使用现有工作分支/隔离 worktree，不覆盖用户修改。

**可验收输出：** BASELINE_AUDIT.md 记录代码身份、上游 SHA、版本与隔离环境；所有未知项显式标 unknown。

### W0.2 · 核定实际代码和治理入口

**实现步骤：** 沿 Registry→Task/Skill→远端绑定→输入→事件→存储逐层定位；尤其检查 Input 发送前持久授权、事件双水位和业务读取执行身份。核对 accepted ADR 对恢复与门禁的修订。

**可验收输出：** CODE_OWNERSHIP_MAP.md 标出具体符号、调用者、事务和测试；未核对不得直接新建并行服务。

### W0.3 · 冻结兼容合同及时间路径

**实现步骤：** 从固定提交 schema/现有夹具建立 canonical catalog；在已有授权现场目标上才允许只读核对。逐路径列出身份、扩展、input/output、公开游标和 Provider 接收时间字段；冻结原始 hash。

**可验收输出：** CONTRACT_DIFF.json 和 TIME_FIELD_MAP.md；历史 UGV_PROFILE_SCHEMA_DRIFT 作为待复核问题，不预设仍存在。

### W0.4 · 最小修复与正式 successor

**实现步骤：** 仅修复已证实的 SDAR 合同映射/初始化问题。新注册用正式 Source/Provider/Capability 后继流程，先在隔离环境验证；旧任务 frozen snapshot 不改。复核 PR34 专项 CI，不把 Draft 自动改 Ready。

**可验收输出：** 源码/合同测试、初始门禁和未解决外部缺口；不执行现场写入或自动合并。

## 不可修改边界

不改 SMPP/schema；不关闭校验；不刷新现场 health/readiness 冒充准入；不运行会引发设备动作的 bootstrap/debug/qualify-control。

## 验证

执行 [验收矩阵](../acceptance/CASE_MATRIX.md) 的 **AC-001–AC-005**；将每个 case 绑定到真实测试文件/名称和报告。局部测试后，按仓库规则运行本批正式里程碑完整 gate，命令依据 [COMMANDS](../acceptance/COMMANDS.md)。不为本工作包杜撰不存在的 npm script。

## 完成标准

工作树身份与合同来源可追溯；AC-001–005 的本地部分通过；所有新增文件落位有实际依据；现场未检查项保持 NOT_RUN。

## 失败与恢复

GitHub/现场不可达时继续使用已记录固定提交做离线实现，标出未重核事实；缺 Provider 时间字段只阻塞相关完整证据，不用本地 now 填充。

## 本批交付记录

复制 [阶段交接模板](../templates/STAGE_HANDOFF.md) 到该批报告目录；保留具体源码 SHA、代码差异、命令、exit code、测试环境与未执行项。更新总 ExecPlan 和追踪矩阵。本任务卡初始状态为 `NOT_STARTED`。
