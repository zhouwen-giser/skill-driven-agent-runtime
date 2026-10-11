# SDAR → SMPP UGV v1.3 受管业务闭环适配任务包

**版本：1.0.0 · 编制日期：2026-10-10 · 交付性质：详细实施规格，不是实现完成报告。**

## 目标

沿用现有 Registry、RemoteTaskBinding、LangGraph、事件 inbox 和控制授权，使正式 Skill 能消费完整 Context/Artifact/轨迹/确认链，提交受管的非发射观察答复或导航调整，并依据后续事实确认结果。重启只恢复读取、投影、已准入 continuation 和精确核对；绝不据此重放整个任务。

## 从哪里开始

将本包放在 SDAR 工作树内的 `taskpacks/sdar-smpp-v13/`，或作为 Codex 可读取的独立目录。不要用包内文件覆盖根目录已有 `AGENTS.md`、`PLANS.md`、`CODEX_GOAL_PROMPT.md` 或状态文件。

将 [CODEX_GOAL_PROMPT.md](CODEX_GOAL_PROMPT.md) 全文交给 Codex。它要求先执行 W0，再依次完成本地可执行批次；现场未授权不阻止本地开发收口。要按批次执行，使用 [prompts](prompts/BATCH_01.md) 中对应入口。

## 目录导航

| 入口 | 用途 |
|---|---|
| [总执行计划](execplans/EP-SDAR-SMPP-V13-BUSINESS-CLOSURE.md) | 十二章节 ExecPlan，进度、决策、验证与恢复依据 |
| [W0 合同与治理](work-items/W0_CONTRACT_AND_GOVERNANCE.md) | 固定版本、实际代码映射、精确合同差异与准入 |
| [W1 业务关联](work-items/W1_BUSINESS_BINDING.md) | 精确任务/执行绑定、对象引用与存储 |
| [W2 同步与投影](work-items/W2_SYNC_AND_SKILL_PROJECTION.md) | 复用事件 inbox，接入 Skill/Agent |
| [W3 受管写入](work-items/W3_GOVERNED_MUTATION.md) | 复用 Input/control，发送前持久化、回执与实际确认 |
| [W4 结果与证据](work-items/W4_RESULT_TRAJECTORY_EVIDENCE.md) | 完整轨迹、Provider 时间语义、确认链、结果判定 |
| [W5 恢复与交付](work-items/W5_RECOVERY_AND_DELIVERY.md) | 崩溃/竞争/迁移/隔离 E2E/现场条件化验收 |
| [约束与接口](contracts/01_IDENTITY_AND_STORAGE.md) | 领域模型、事件事务、控制命令、结果和 wire 五份详细设计 |
| [50 个验收场景](acceptance/CASE_MATRIX.md) | Given/When/Then、禁止行为及证据要求 |
| [验证命令](acceptance/COMMANDS.md) | 基于真实 package.json 的命令与隔离限制 |
| [需求追踪](acceptance/TRACEABILITY.md) | 本包需求 → 工作包 → 测试 → 证据 |
| [现场与回滚手册](operations/DEPLOYMENT_AND_ROLLBACK.md) | 另行授权后的操作门槛、停止条件、数据保留 |
| [固定基线](BASELINE.lock.json) / [来源](SOURCES.md) | 可机器读取的 SHA/身份/协议与来源边界 |
| [代码定位表](CODE_MAP.md) | 已确认路径、符号、拟新增文件与执行时核对项 |

## 四批交付

1. **批次一 W0**：收口现有 PR34 基础并核对治理合同。不能把已实现适配器重新设计一遍。
2. **批次二 W1–W2**：持久关联、业务快照同步及 Skill 真正消费。
3. **批次三 W3**：真实控制授权和持久发送边界，接通 Input 与导航 Intervention。
4. **批次四 W4–W5**：轨迹、证据、结果判定、迁移恢复、隔离 E2E 及条件化现场验收。

每个工作包包含可执行子任务、具体修改入口、不可修改边界、测试编号和完成标准。一个批次形成一个可审查增量；不得把所有后续功能塞回 PR34。

## 不可扩大的范围

不改 SMPP 或设备端；不接管 Provider 内部 AutoLock；不接入未部署的顺序 AutoLock；不发射、不新增独立锁定；不做 PMS-api/pms-web、SDK、第二套运行时、独立业务数据库或全面重构。默认仍是 development/live，保留用户显式 NO。用户要的是运行能力接通，不是增加一组永远关闭而无法验收的接口。

## 源时间约定

**Provider 提供的接收时间为本轮 canonical sourceTime。** 原始设备时间、SDAR 接收时间、投影提交时间各自保存。字段路径必须在 W0 依据冻结公开合同核定；来源不存在时显式缺失，禁止用 SDAR 当前时间伪造。

## 授权与完成状态

当前交付只创建文档包，没有修改仓库、提交 PR、部署服务器或执行设备任务。本地实现、隔离测试、现场读取、现场写入和部署是独立权限/验证范围。现场目标和操作未获明确授权时，记录 `NOT_RUN`，继续完成其余本地工作；不能将本包或历史联调许可视作无限期设备控制许可。

正式结果至少分开报告：`CODE_IMPLEMENTED`、`CONTRACT_VERIFIED`、`GOVERNED_READ_VERIFIED`、`GOVERNED_WRITE_VERIFIED`、`ISOLATED_E2E_VERIFIED`、`SITE_READ_VERIFIED`、`SITE_BUSINESS_VERIFIED`。各项均附实际环境和证据，不只给一个“完成”。
