# EP-SDAR-SMPP-V13-BUSINESS-CLOSURE

状态：`PLANNED`。规格版本：1.0.0。编制日期：2026-10-10。目标仓库：`zhouwen-giser/skill-driven-agent-runtime`。本文件是新升级计划，不把历史 PR 的 CI 结果作为本计划实施完成证据。

## 1. Purpose / Outcome

用户可通过正式 SDAR Task/Skill 入口读取完整任务业务状态，在原任务内回答有效的非发射观察请求、调整导航计划，并看到已受理/已应用/业务结果及证据质量的差异。实际轨迹与完整确认链能够从既有输出途径检索。重启后仍能找到同一远端任务并核对未决命令，不重复派发。

本轮只升级 SDAR 消费方。沿用 development/live；Provider ID 为 isr.vehicle.ugv.ugv，resource 为 vehicle:ugv，GOWM device 为 ugv:ugv。发射持续禁用，不新增独立锁定或接管 Provider 内部动作。

## 2. Requirements Covered

范围为 [追踪矩阵](../acceptance/TRACEABILITY.md) 的 UPG-V13-R01–R19，映射 [AC-001–AC-050](../acceptance/CASE_MATRIX.md)。W0 将这些局部编号挂接到仓库正式需求与 accepted ADR；发生冲突时记录决策，不静默修改基线。

覆盖 W0 合同治理、W1 精确绑定、W2 同步与投影、W3 受管写入、W4 结果与证据、W5 恢复与交付。排除 PMS-api/pms-web、设备端、SDK、第二运行时/数据库、未部署新 AutoLock 与全面重构。

## 3. Context and Orientation

已观测 main 为 f94d0b98d140dd22514029ccdc34978209426940；PR34 head 为 52f54a11a40380f7c73bd9da277d640e49bdfbf7，读取时 Open/Draft，专项 workflow success。其适配器、Registry 读取和请求预检已存在，但并不证明正式业务写入与现场闭环。

兼容 SMPP 提交 0a4a7c36865d4c9920a4e65857c0903e9ef12533；Frozen MCP 2026-07-28、TaskBusiness 1.0-rc2、BusinessEvents 1.0。仓库部署记录不是本次现场重探测。版本与来源详见 [BASELINE.lock.json](../BASELINE.lock.json)、[SOURCES](../SOURCES.md)。

现有 `RemoteTaskInputService`、`BusinessEventSubscriptionService`、RemoteTaskBinding、governed-control、PG repositories 必须优先复用，入口与拟新增模块见 [CODE_MAP](../CODE_MAP.md)。

## 4. Architecture and Interfaces

正式调用链：Task/Skill/Capability → 原 RemoteTaskBinding → McpRegistryService → FrozenV1McpClient/SmppTaskBusinessClient → SMPP。反馈链：原业务事件 inbox + Task polling → 完整 Context/精确 Artifact → 业务投影 → Skill/Agent 输入与结果。

读取只产生事实与候选；控制走真实授权、持久命令意图、最终发送边界、Runtime ack、精确业务确认。完整轨迹通过原 artifact 存储引用，模型只读摘要。Provider 接收时间作为源时间，设备时间和 SDAR 时间保留。

设计依据：[身份存储](../contracts/01_IDENTITY_AND_STORAGE.md)、[事件投影](../contracts/02_EVENTS_AND_PROJECTION.md)、[写入恢复](../contracts/03_MUTATION_AND_RECOVERY.md)、[结果证据](../contracts/04_RESULTS_TIME_AND_EVIDENCE.md)、[公开 wire](../contracts/05_FROZEN_WIRE_BOUNDARY.md)。内部示意名称不强制新增等价模块，亦不修改外部协议。

## 5. Progress

- [x] 2026-10-10 形成详细任务规格、固定来源、25 个子任务与 50 个验收场景；这不是实现完成。
- [ ] M1 / 批次一：W0 与现有 PR34 基础收口，固定实际合同及源码入口。
- [ ] M2 / 批次二：W1/W2 持久关联、同步投影与 Skill 消费。
- [ ] M3 / 批次三：W3 两类受管写入、竞争和结果核对。
- [ ] M4 / 批次四：W4/W5 完整证据、恢复迁移、隔离 E2E 与本地门禁。
- [ ] 独立 SITE：已有授权的现场只读核对；无授权时保持 NOT_RUN。
- [ ] 独立 SITE-WRITE：另行授权范围内的非武器业务验收；无授权时保持 NOT_RUN。

执行者为每个完成项添加真实时间、实现 SHA、命令与证据；不能只勾选而无材料。

## 6. Discoveries and Surprises

初始事实：已有 Input service 和双水位事件 inbox，可减少重复基础设施。现有 client 中同 Context revision 输出去重需要与事件/对象去重分开验证。Input 发送前的意图/授权事务必须沿完整调用链审查，不能凭一个方法片段判定缺失。实际 Provider 接收时间字段路径尚需 W0 确定。

发现表格式：日期｜源码/合同位置｜事实或冲突｜影响需求｜处理与证据。新增事实不得改写原失败历史。

## 7. Decision Log

| ID | 初始决定 | 后续更改要求 |
|---|---|---|
| D01 | 接续现有适配，不另建 MCP 客户端/任务状态机 | 更改须说明无法复用的证据及 ADR |
| D02 | 兼容已部署 0a4a7c3，不追随未部署新功能 | 新兼容版本需独立合同差异与授权 |
| D03 | sourceTime=Provider 接收时间，缺失不回填 now | 保留用户约定；字段来源必须核定 |
| D04 | 已准入状态恢复≠重新执行整个工作流 | 现有 accepted ADR/基线优先，禁止扩大自动重试 |
| D05 | 两阶段事件事务：admit 和 project | 不为图简单而合并水位语义 |
| D06 | ack≠applied≠业务/物理成功 | 每层使用真实证据 |
| D07 | 工作树本地实现和隔离验证可推进；现场、push/merge/deploy 独立授权 | 无授权项 NOT_RUN，其他工作继续 |
| D08 | GOWM 正式持久适配必须保持，禁止直写上游私有表 | 权限/schema 缺口明确阻塞，不绕过 |

重大领域/存储/上位协议变更另写 ADR，不在本表一句话带过。

## 8. Implementation Steps

按 [W0](../work-items/W0_CONTRACT_AND_GOVERNANCE.md) → [W1](../work-items/W1_BUSINESS_BINDING.md) → [W2](../work-items/W2_SYNC_AND_SKILL_PROJECTION.md) → [W3](../work-items/W3_GOVERNED_MUTATION.md) → [W4](../work-items/W4_RESULT_TRAJECTORY_EVIDENCE.md) → [W5](../work-items/W5_RECOVERY_AND_DELIVERY.md) 执行。

W0–W2 可在代码理解后准备并行独立测试，但共享存储、authority 和运行接线应串行集成。每批形成可运行增量并写交接；不把全部后续实现塞入 PR34。缺外部权限只阻塞相关现场项，不阻塞可本地完成的验证。

## 9. Validation

[COMMANDS](../acceptance/COMMANDS.md) 列出源仓库存在的命令。每次改动最小相关测试，每个正式里程碑按仓库当前要求运行完整 gate；任何减少门禁的安排必须来自已接受的仓库规则，而不是本包擅自授权。完整 gate 绑定同一源码身份，保留原失败、耗时、环境与清理记录。

全部 case 初始 NOT_RUN。正式入口隔离 E2E 必须覆盖两条业务路径；PG/GOWM/真实现场各自分开标注。核心断言为：不串 Task/Execution，不伪造完整性，不重复变更，原 authority 不漂移，正式 Skill 使用了业务事实。

## 10. Idempotence and Recovery

本地脚本只审计工作树、包结构与 hash，不连接现场。迁移增量且保留旧记录。事件重复只允许重复读取/幂等投影；控制命令通过持久 claim 防止重复发送。不确定发送后必须恢复原命令核对，不能换 ID 重发。

取消与控制在最终发送边界形成清晰先后；已经发送的请求无法由本地事务撤回。Lease 失效不是重新发送许可。回滚遇 pending/uncertain 命令时停止旧版写接管，先核对或保持受管只读，详见 [运维手册](../operations/DEPLOYMENT_AND_ROLLBACK.md)。

## 11. Artifacts and Evidence

仓库报告建议根路径 `reports/sdar-smpp-v13-upgrade/<run-id>/`，保留 baseline、contract diff、source time field map、代码定位、各批 validation、完整轨迹样例、确认链、迁移回滚、失败记录和最终 closeout。路径是建议新增，不表示现有文件。

复制 [templates](../templates/STAGE_HANDOFF.md) 中对应模板；报告不得包含密钥、凭据或私密思维。更新 PROJECT_STATUS.md、CHANGELOG.md、docs/17_TRACEABILITY_MATRIX.md 及实际相关文档。

## 12. Outcomes and Retrospective

本任务包阶段：规格完成；产品代码实现、该升级的测试与现场结果尚未执行。

最终分别填写代码、合同、受管读取、受管写入、隔离 E2E、选定 GOWM、现场只读、现场业务、发布/部署状态。局部开发完成可以独立收口，但现场未经验证必须直说。总结已实现能力、仍缺的上游事实、对历史任务的影响与回滚条件，不把缺失必需能力写成“后续优化”。
