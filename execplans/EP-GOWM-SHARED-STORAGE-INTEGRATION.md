# SDAR 接入 GOWM 共享存储

## 当前实施方案：有限收尾与开发交付（2026-09-08 再次收敛）

本节替代上一版顶部排期。目的：结束持续扩展审计，交付可审查的当前实现和明确限制。原任务包、历史失败及延期要求保留；本方案完成不等于原 Goal 全部完成，不声明 SOURCE_READY / INTEGRATION_DEV_READY。当前工作树尚未提交，当前源码尚无完整开发回归通过结论。

### 当前事实与剩余清单

| 分类 | 当前事实 | 本轮处理 |
| --- | --- | --- |
| 已有分项证据 | 正常双设备 Server/Skill/DSL/LangGraph 原生持久化、Remote 恢复与延迟 canonical | 保留已有记录，最终只选代表链确认当前源码 |
| 已有分项证据 | Skill 子执行 d07acdc5、Business Event 147d9fdf、Remote binding 取消 0b57b0fe 均 PASS | 从待开发清单移除；不等同正式 Usage/Remote 子调用所有组合通过 |
| 已有分项证据 | Evidence infrastructure v2、quality source、retention 身份已有定向回归；几何和事务已有回归 | 不重新逐表审计，不重复构造相同几何/事务用例 |
| R1：在途修改 | Artifact execution 设备归属、start/complete/feedback 范围已有代码，尚无可核实的完整本批验证结论；最近全仓 format/lint 失败已作定向修复 | 先找回已有运行结果；确无结果才运行一次相关行为回归；集中处理遗留错误 |
| R2：恢复边界 | binding 取消不等于父 Task 取消；进程丢失、不重复派发及过期回调的正常入口证明仍不齐 | 复用现有场景，最多新增父 Task 取消、持久恢复两类代表场景；不做组合笛卡尔积 |
| R3：最终交付 | 同源码开发检查、最终报告、git 审查、提交/push/Draft PR、本任务资源清理未完成 | 集中一次收口；报告区分实现、验证、阻塞、延期 |
| U1：上游阻塞 | 临时 Skill 终态触发器遗漏 experience.device_id，导致整个 Task 终态回滚 | 原生终态不可用；保留复现，等待合同所有者修复，不在 SDAR 绕过事务 |
| U2：上游阻塞 | Provider 辅助关联全局 server/handle 唯一键不支持两设备同 handle | 保留复现和影响，不反复尝试、不改 GOWM DDL |

证据目录：`reports/sdar-gowm-shared-storage-integration-v0.1/`。代表文件：`execution-gowm-runtime-ce11aff1-9f1d-47a6-abc5-7fbd44199a06.json`、`gowm-skill-child-d07acdc5-e576-4232-bf5e-71f04609ab02.json`、`gowm-events-147d9fdf-37bf-46e2-a8b1-99ac9574f0b9.json`、`execution-gowm-runtime-0b57b0fe-4626-4d3b-8fd3-6115e152b034.json`。这些是历史分项证据，不是当前源码整体通过证明。U1/U2 见 `docs/gowm-shared-storage/UPSTREAM_STORAGE_GAP.md`。

### 执行顺序与完成条件

1. **R1 收尾现有改动。** 只检查已修改入口，核实 Artifact 未返回结果的运行；补齐必要行为回归。集中处理 format/lint 已知问题，不启动全库新审计。产出：现有改动有明确结果，未证明之处明确列出。
2. **R2 关闭关键恢复疑点。** 先读取现有断言，已有证据直接引用；仅缺少的父取消和恢复身份差异补测。统一核对所属设备、父子状态和工具调用次数。发现实际缺陷才修复。产出：两类边界分别得到通过、失败或明确阻塞结论；阻塞不得写成通过。
3. **R3 冻结与交付。** 固定源码后运行下述一次开发检查，集中整理 FINAL_REPORT、acceptance-results 及既有追踪矩阵，排除秘密和旧调试产物，再提交、push、创建 Draft PR。保留 INCOMPLETE 及 U1/U2，清理本任务拥有的资源并记录结果。任何当前回归失败必须出现在交付说明中，不宣称开发验证完成。

### 最少但必要的验证

- 开发中：每个实际缺陷一条最小行为回归；数据库写入、归属和事务问题使用现有隔离 PostgreSQL。修改相邻边界才扩大到所属套件。
- 最后一次：修改文件格式检查、lint、typecheck、`pnpm test`（已包括 unit/contract，不再分别重复全跑）、build、architecture/protocol/migrations 检查，以及现有 GOWM 合同检查、PG driver 和一个正常 runtime 代表链。已有脚本包含的步骤不另跑一遍；若声明完整里程碑验收，则仍须满足仓库要求的 integration/e2e/smoke，不能将 unit/contract 冒充全门禁。
- 复用现有锁定依赖、数据库、Redis 与 Model/MCP 桩；依赖或环境未变化，不重装、不重建。真实 DashScope/SMPP 联调在本地确定性错误收敛后，只用于尚需验证的服务互操作，不替代 SQL/状态机诊断。
- 已通过的检查只有受到后续修改影响才重跑。文档和状态更新仅做文档差异检查，不跑业务测试。
- 历史 PASS 保留为历史；不要求为每个小改动创建 progress JSON，不扩建证据平台。最终结论引用实际命令结果。

### 本轮明确不做（原要求继续开放）

全量 worker/retention/共享定义逐表证明、共享服务协调和配置绑定新装配、Artifact 全生命周期及正式 Usage/Remote 子调用全组合；演化完整验证与发布、Console 完整编辑器、发布级 18 AC、独立 frozen install、真实模型泛化评估。以上不得包装成已完成或无风险；直接影响当前正常闭环的已证实缺陷仍须处理。

### 停止扩展与汇报规则

- 工作清单锁定 R1–R3、U1–U2。新发现只有造成当前正常链失败、跨设备处理、重复执行或历史破坏，才进入本轮修复；其余集中记入延期，不立刻开工。
- 同一夹具连续失败两次，停止重复执行，先区分夹具、实现和上游合同原因。已证明上游问题不再重现，合同版本改变后才复测。
- 每个工作项报告“解决了什么、还缺什么、下一步”，不用测试数量代替进度。单项超过约 30 分钟仍未收敛时先汇报原因和剩余路径，避免无声扩展；时间阈值不替代正确性判断。
- 不增加第二轮全面审计，不以不断发现外围未证明项阻止 Draft PR。当前可交付物是明确限制的开发增量，不是全部需求验收。

### Progress / 本次调整结果

- [x] 2026-09-08 只读核对工作树、已有计划、代表报告与上游缺口；更新收敛方案。本次不运行业务测试或联调。
- [ ] R1：在途 Artifact 与静态检查收尾。
- [ ] R2：必要的父取消/持久恢复代表差异。
- [ ] R3：当前源码开发检查、集中报告、资源清理及 Draft PR。
- [ ] U1/U2：上游合同修复；不由本轮 SDAR 修改完成。

## Purpose / Outcome

仅修改 SDAR，使正常 Server 的 Task、Admission、Plan、Workflow、Node Run、目标、Invocation、Remote Binding 直接持久化到 GOWM 固定 `ugv_sdar`。两设备共用 Schema，以真实 device_id 归属。完整目标以 `docs/SDAR_GOWM_Shared_Storage_Integration_v0.1_Codex_Goal/` 的 MASTER、FULL_CN、acceptance 和 test-scenarios 为准，不缩减为连接串或测试 Writer。

## Requirements Covered

任务包 D00–D13、全部 required acceptance 与 P0–P7。保留唯一 LangGraph、Task revision/command authority、原确认/取消/恢复、非设备工作和共享 Goal/Skill。禁止导出同步副本、ugv_smpp DML、DDL 自修复、旧库 fallback。真实 SMPP 互操作可选；协议桩与真 PostgreSQL 正常 Server 链必需。

## Context and Orientation

SDAR 起点 main/origin/main 均为 cb50da8ec8d160a673852be8bcdfc3bb094f5ce5。工作分支 `codex/sdar-gowm-shared-storage-integration-v0.1`。已有未跟踪 `reports/local-debug-arm64-20260908/` 是前一任务产物，保留且不自动纳入本次交付。GOWM 合同来源锁定到 `contracts/gowm-shared-storage/current/source.json`；引用任务后续 actor 改造不阻塞本任务。

## Architecture and Interfaces

- Domain 拥有不可变 DeviceTaskContext 与设备处理范围，不引入 SDK 类型。
- PostgreSQL Adapter 拥有 GOWM 目录解析、固定连接 search_path、只读结构验证、目标事务和 canonical 查询/补齐。
- Application 在接纳前解析设备，在所有后台恢复中沿真实 Task/Binding/Subscription 恢复上下文；不用可变进程全局设备。
- Server 选择单一业务 Pool；共享模式禁止运行原生迁移。Node Control 管理 Pool 保持独立。
- Task 与派生数据由同一个事务 client 写入；网络调用不进入持锁事务。

## Progress（历史 P0–P7；当前状态见顶部收敛方案）

- [x] 2026-09-08 找到并解压任务包，读取 MASTER/FULL_CN 和引用任务。
- [x] 2026-09-08 fetch SDAR 并确认起点，创建单仓功能分支。
- [ ] P0 完成合同摄取、全部 SQL/worker/retention 盘点及差异核验。
- [x] 2026-09-08 P1 初步配置/固定 Pool/只读验证器接入正常 main/runtime；设备目录 reader 与范围检查实现，14 项定向测试通过。
- [x] 2026-09-08 P1 目录装配及实际安装库只读合同检查（列/键/触发器/函数体/视图），固定 search_path 恢复已真实验证。
- [ ] P1 生产受限角色权限检查与正常 Server 启动验证。
- [x] 2026-09-08 P2 首批：TaskService 接纳前目录解析、AgentTask 不可变 ownership、Task Repository scoped SELECT/INSERT、初始 Admission 设备/服务键和 admission UUID、澄清请求设备范围身份。
- [x] 2026-09-08 P2 Plan/Attempt 父记录顺序、executionTaskId 传递、计划定稿保护、实例/事件父级归属和相关读范围已实现；真实 PostgreSQL 生产 Repository 子集通过。
- [ ] P2 全部旁路 Task/Plan writer、初始 Admission 真实竞争/回滚和正常执行链验证。
- [x] 2026-09-08 P3 首批：显式 Schema 目标映射、Skill 输入/Plan 目标同事务、精确 TASK/PLAN_NODE owner、幂等冲突和 CRS 诊断；双设备真库回归通过。
- [ ] P3 已验证接纳输入与既有 UGV 语义映射、动态参数解析、真实 Remote Binding 的 DISPATCHED 目标及全部组合验证。
- [x] 2026-09-08 P4 首批：Invocation 归属、完整 Remote 身份、真实 Binding DISPATCHED 同事务与延迟 canonical；受限 consumer/独立 peer 真库子集通过。
- [ ] P4 完整 Remote 身份和延迟 canonical 的全部场景、冻结 Schema 来源及正常协议链。
- [x] 2026-09-08 P5 首批：Admission journal/观察/CAS fallback/recovery list 与进程丢失恢复按 Task/Plan 归属过滤；双设备状态及重复恢复真库通过。
- [x] 2026-09-08 P5 第二批：取消/补参/生命周期投影、Task Input 回答和 attempt 队列范围；GOWM source 枚举兼容及跨父身份拒绝，15 组真库场景通过。
- [x] 2026-09-08 P5 第三批：continuation 快照/生命周期/inbox/claim/finish/defer/attempt 范围、完整父身份检查和 canonical 幂等；16 组真库子集通过。
- [x] 2026-09-08 P5 第四批：reconciliation 与辅助 Provider execution link 的范围过滤/直接写入父身份验证；17 组真库子集通过。
- [ ] P4/P5 合同缺口：辅助 Provider execution link 仍为全局 server/handle 唯一键，双设备相同 handle 不能同时保存辅助关联（已真库复现，INCOMPLETE）。
- [x] 2026-09-08 P5 等待超时清理：根 Task 范围限定、原事务输入/事件联动、回调完整归属及显式非设备隔离；18 组真库子集通过。
- [ ] P5 所有后台 scope、事件、来源和保留。
- [ ] P6 真 PostgreSQL 双设备正常 Server + Frozen MCP 桩。
- [ ] P7 全部指定回归、报告、单仓提交和 Draft PR。

## Discoveries and Surprises

上游原生安装基线与 SDAR 起点相同。设备 Task 归属不可更新；initial admission 已改内部 UUID 主键/partial key；Remote 和订阅有设备与非设备独立唯一键。原 runtime 总是创建普通 Pool，main 总是 applyMigrations=true，因此必须先改装配。原多数 Repository 使用未限定表名，可用每连接启动参数指定固定 namespace；迁移检测中的 public.schema_migration 必须留在 standalone 路径。

2026-09-08 补查：WorkflowPlanner 当前先 saveAttempt 后 savePlan；GOWM device plan_attempt 的父计划 FK 要求调整真实创建顺序。现已在 saveAttempt 的同一事务先建立 definition_json=NULL 的未定稿 Plan，再保存真实尝试；savePlan 只能定稿未执行根记录。保持逐次失败尝试的持久证据，事务不包模型/网络。

2026-09-08 真库验证：本 Goal 独占 PostgreSQL 18.6 容器已正式安装 GOWM 001–078 及全部共享域，pgvector 0.8.6 为隔离环境前置。首次基础镜像缺 vector（引导未运行），补齐后上游引导与安装通过。首次消费校验发现 408 个 catalog 文本差异；原因是 pg_get_constraintdef 等输出受 search_path 影响，改为与上游同一事务内 pg_catalog,public 后通过。未放宽任何键或 SQL 断言。

2026-09-08 目标链补查：GOWM 078 的 PLAN_NODE owner 使用 nodes[].id，当前 SDAR DSL 使用 nodeId。共享数据库保存同值 id 别名，所有 Plan/治理 hash 读取边界去除已验证的双字段别名，保留仅 id 的旧治理记录。初版解码误拒绝旧记录导致 2 个既有回归失败，已修正且保持原断言。Input Resolution/runtime_event 本身无 device_id 列，应沿 task_id 校验归属；初次写入不存在列失败，已按固定合同修正，未加 DDL。重复测试曾因不同 SMPP 服务复用静态 server 身份被目录约束拒绝；隔离 fixture 改为每次唯一 server。

## Decision Log

2026-09-08：采用任务包的单仓并行边界；不等待 SMPP、不改 GOWM、不切换已经运行的用户实例。合同摄取只作为参考与验证输入，不复制安装器为第二迁移所有者。自动 SQL 命中清单仅为盘点线索，不等于行为已实现或已通过。

2026-09-08：空间映射采用正式 Schema 注解 x-sdar-targets，严格校验映射元数据，保留输入原文并记录来源 Schema hash。只解释映射指定字段，不扫描任意坐标；动态 Workflow 引用在实际参数解析前不生成几何。缺 CRS 通过原 runtime_event 保存 task.target_diagnostic，不改变任务状态机。准确 owner/角色/参数路径的同值重放复用已有 target，不同值显式冲突；新 Plan 独立保存新目标，事务失败连同 supersede 回滚。此增量不宣称既有 UGV、接纳旁路或 DISPATCHED 链已覆盖。

## Implementation Steps

历史排期为 P0–P7；现由顶部三阶段收敛方案替代，不再逐入口无限扩展。配置/上下文先以小型行为测试验证；持久化修改用正式 GOWM 合同的隔离库验证。任何上游不兼容写最小复现，不 ALTER 或伪造父记录。变更依据测试反馈同步本计划。

## Validation

遵循任务包开发验证：pnpm typecheck、lint、test、build、verify:architecture、verify:protocol、verify:migrations，修改文件 format。新增 gowm-storage check/verify、unit/postgres/runtime、smoke --help。真库要求显式 GOWM_BUSINESS_TEST_DATABASE_URL 与 GOWM_BUSINESS_SMOKE_ENABLE=true；缺环境 NOT_RUN，不能算通过。不默认启动 Docker 或完整 release/HA/实车门禁。首批 14 单测、类型检查、修改文件 lint、架构与许可证检查、87 文件离线哈希检查通过；数据库 verify 缺环境返回 NOT_RUN/2。详细本次与初始失败记录见 progress-20260908.json。不引用历史门禁证明本次修改。

2026-09-08 P3 首批当前证据：GOWM 单测 34 项；目标/治理/DSL 相关 39 项（有重叠，不相加）；严格 typecheck、修改源码/用例 lint、919 个源文件架构检查及 diff check 通过。真 PostgreSQL run `sdar-pg-3e3d56c4-c474-40e2-aaba-d5e179f5419f` 的七组生产 Repository 行为通过，原生 Input/Plan/supersede 回滚不遗留几何。见 progress-20260908-targets.json；下一步前先核对实际列和键，避免把所有派生表都假设为有 device_id。未重装依赖或上游库，未执行不相关全仓门禁。

## Idempotence and Recovery

结构只读验证无修复副作用。设备为空集合不允许设备工作。失败任务保持原 authority；canonical 缺父行不重发 MCP。测试不得访问用户业务库；保留必要历史，关闭本次拥有的测试连接/进程。交付不 merge/tag/release/deploy。

## Artifacts and Evidence

任务包原文保留于 docs；紧凑上游合同位于 contracts/gowm-shared-storage/current；本次结果位于 reports/sdar-gowm-shared-storage-integration-v0.1。schema-consumption-matrix 的 PENDING 必须逐项经实际源码与测试核验后变更。

## Outcomes and Retrospective

实施中，完整 Goal 未完成。仅在全部 required 行为和真实正常路径证据齐全后声明 INTEGRATION_DEV_READY。SOURCE_READY 不用于掩盖必需实现缺失或失败。

## 2026-09-08 MCP 与恢复增量

Discoveries：受限 consumer 对 ugv_smpp.provider_task 只有 SELECT。FOR KEY SHARE 实际需要 UPDATE 权限，初版真库失败后移除该锁；保留纯读父表，在 ugv_sdar canonical UPDATE 中重新核对完整父身份，未扩大角色权限。固定合同使用触发器校验 canonical，不虚构不存在的物理 FK。此前 fixture 的 mcp_declared 缺少声明语义触发约束，已修正 fixture，保留失败原因。

Decisions：MCP writer 从持久 Task/frozen binding 推导 device，调用前拒绝错误 server/resource；非设备通道也不能调用任何目录绑定的设备 server。Remote 查询必须明确 device/service 身份，通知凭 durable binding 匹配；同一订阅中无法区分的重复 handle 显式拒绝。canonical 是独立元数据，不改变 Runtime 状态/version，不重新提交 MCP。Admission CAS 的失败回查也必须过滤，启动恢复只处理本 Server 设备范围。未引入新引擎、生命周期或表结构。

Validation：本次 125 项相关 unit、typecheck、定向 lint、926 文件架构检查通过；真库 run `sdar-pg-d894ab8a-0bcd-462c-804c-bc99d33cea32` 的 13 组 Repository 场景通过。证据 `reports/sdar-gowm-shared-storage-integration-v0.1/progress-20260908-mcp-recovery.json` 保存命令、历史失败与当前运行身份。12 组 Admission 中间运行也独立保留。当前不要求或宣称逐里程碑全门禁。

Outcomes / next：P4/P5 部分实现，本 Goal 未完成。下一步处理 cancellation/input/continuation/reconciliation/订阅/事件及 retention 的全部范围；冻结实际 Invocation 输入 Schema/mapping 以抵抗目录变化；补齐接纳输入/既有 UGV 映射，然后执行正常 Server + LangGraph + Frozen MCP 桩的双设备完整场景与最终指定回归、清理和单仓 Draft PR。正常用户运行环境不切换。

## 2026-09-08 取消、输入与来源兼容增量

Discoveries：固定 GOWM 合同的 task_input_request_source_check 仅允许 goal_deliberation / skill_input_resolution / goal_evaluation / workflow，正式旧 Remote input writer 写 remote_task 在真库被拒绝。这是合同边界，不是模型或机器性能问题。fixture 的 processed 时间、awaiting_input next_poll_at、一 Task 一个 waiting 请求亦受原生约束保护；均修正 fixture，不放宽断言或约束。

Decisions：共享 Remote input 存储为 workflow，依据同事务的真实 remote_task_input_link 与匹配 Task 的 Binding 显式还原 Domain source。普通 workflow 无该关系不转换；独立 createRequest 不允许无 link 的 remote_task。TaskInput find/pending/answer/findResponseForAttempt 使用统一适配投影，避免后续 attempt 被误路由。取消/输入 attempt 必须匹配已锁定父记录；即使 allowlist 有两设备，回答事务也拒绝混用 Task/Request/Attempt 身份。仅 PostgreSQL 表示适配，无新状态或影子表。

Validation：67 项相关 unit 通过；真库 run `sdar-pg-0a79a630-3525-406d-81e5-c28d2ac53927` 的 15 组 Repository 场景通过，包含正式 answerAndCreateAttempt、排队 attempt 来源、跨设备领取/写入拒绝、跨父审计注入回滚及回执重复不重复推进。证据 `progress-20260908-input-cancellation.json` 保存命令和全部本轮失败原因。输入 fixture 从已经持久化的请求/link 开始，未冒称 continuation activation 或网络 tasks/update/cancel 通过。

Outcomes：P5 继续开放。剩余 continuation/reconciliation/订阅/事件/retention 全范围，实际 Invocation Schema 冻结、既有输入映射及正常 Server + LangGraph + 协议桩全链仍是后续必做。未合并、未部署，不声明完整 Goal 完成。

2026-09-08 本轮最终静态检查：typecheck、涉及文件 lint（最后身份检查后二次定向复查）、928 文件架构检查均通过；结果已附入 input-cancellation 增量证据。只更新文档后运行 git diff --check，不重复无关测试。

## 2026-09-08 Continuation 范围增量

Discoveries：相同 continuation 快照读回时 JSON key 顺序改变，原 JSON.stringify 比较产生真实幂等冲突。改用既有 canonicalHash 比较内容，不修改历史快照/持久 hash；回归同时证明不同 input 或 claim token 仍拒绝。fixture 固定 claim token 与历史记录唯一键冲突，改为按 event/run 唯一，保留原生约束和所有历史行。

Decisions：snapshot 拥有的 Task、Plan、Instance、Control 必须匹配；wait Binding 必须来自同 Task/Instance/node-run。attempt 必须匹配真实 snapshot wait。只沿持久父级校验范围，正常 Server 显式传递 scope，不使用可变全局设备。非终态恢复和执行预算语义不被这次持久边界修改。

Validation：20 项相关 unit、typecheck、定向 lint、930 文件架构检查通过；真库 run `sdar-pg-5ccc6343-6e43-478e-9b4b-2582af98032d` 16 组通过。当前证据 `reports/sdar-gowm-shared-storage-integration-v0.1/progress-20260908-continuation.json`。fixture 使用可识别的 1.0 快照与原生合成事件，仅证明 Repository 保存、查询和 worker 边界；没有执行 checkpoint，不证明 2.0 正常 Server/LangGraph 恢复。

Outcomes：P5 未关闭。reconciliation/订阅/业务事件/retention 仍需完整范围；实际 Invocation Schema 冻结、输入映射和正常 Server 双设备协议桩、全部要求回归、最终资源清理与单仓 Draft PR 继续开放。

## 2026-09-08 Reconciliation 与辅助 Link 增量

Discoveries：固定 GOWM `remote_task_provider_execution_link` 没有 device/service 维度，`remote_task_provider_executio_runtime_server_id_remote_task_key` 全局唯一 `(runtime_server_id,remote_task_id)`。真实测试已有两个设备同 opaque handle 的合法 Remote Binding；辅助 link 第二条被拒绝，第一条未改。该能力缺口单独记为 INCOMPLETE，不以 Repository 测试通过或环境 NOT_RUN 掩盖。not_found attempt fixture 缺 safe_error_code 的首次约束失败，已修正 fixture，未改约束。

Decisions：在现有合同内先完成所有直接入口范围和父级校验；非允许 intent 不分配 next attempt，冲突回查也过滤。辅助 link 的完整双设备能力仍须合同兼容解决，不能伪造 handle/server、建影子关联或改 GOWM DDL。该缺口不阻止继续修复其余后台范围和正常 Server 链，当前没有进入 blocked 状态。

Validation：34 项相关 unit、typecheck、定向 lint、931 文件架构检查通过。真库 run `sdar-pg-712bb588-087c-49c5-8243-5360efcaf329` 17 组 Repository 行为验证通过；报告明确 `acceptanceStatus=INCOMPLETE` 并引用 `auxiliary-link-contract-gap.json`。增量证据 `progress-20260908-consumer-sync.json`。辅助 link 冲突的成功复现不是双设备辅助 link 功能通过。

Outcomes：Goal 未完成，SOURCE_READY/INTEGRATION_DEV_READY 均不声明。剩余订阅/事件/retention、冻结 Schema、输入映射、正常 Server 2.0 执行和协议桩、最终回归/清理及单仓 Draft PR 继续推进；辅助全局唯一键作为明确合同缺口保留。

## 2026-09-08 等待超时清理增量

Discoveries：初步 DELETE/expire/purge 检索未发现产品级 Task/Workflow 主记录定时删除入口；不能据此视为所有 retention 完成。实际统一等待超时扫描此前会全局取消 Task，且显式投影丢失 device ownership。Artifact replay、experience compilation、fast gateway 的删除路径仍在待盘点清单。

Decisions：在原子 CTE 的 expired 根 Task 更新中应用 device/service 范围，派生 capability attempt/input/event 继续只消费该集合；返回完整原生 Task 行保留回调归属。空 allowlist 默认不清理设备，显式 includeNonDevice 仅处理无设备 Task。政策定义仍共享，不添加每设备第二策略表。

Validation：1 项直接相关 unit、真库 run `sdar-pg-0fbf52a9-2606-4c5e-8aec-40f182f97fb1` 共 18 组 Repository 场景通过，含双设备超时、错误服务、空 allowlist、非设备通道、输入/事件联动和重复通知。定向 lint 的冗余 optional-chain 已修正，未改变断言。证据 `progress-20260908-wait-timeout.json`。

Outcomes：仅此清理路径完成增量验证；P5 retention、订阅/事件等后台范围和正常 Server 全链仍开放。辅助 Provider link 全局唯一键合同缺口继续 INCOMPLETE；未修改任何 GOWM/SMPP 或运行部署。

本轮最终 typecheck 通过（包含非设备清理新增测试），已记录于 wait-timeout 增量报告。

## 2026-09-08 正常 Server 启动增量

Discoveries：首次启动因旧 Repository 空间 Skill fixture 缺正式 outcome 契约失败；迁移账本怀疑经真库只读检查排除，0125 标记和 GOWM 安装项均存在，未修改装配判断。

Decisions：使用同一 owned PG 中全新官方合同测试库，不修改旧不可变 fixture，不关闭正式校验。启动测试把未释放 consumer 连接作为失败。保留独立 Redis 供后续协议桩链路使用。

Validation：2026-09-08 正常 Server 启动增量：新建独立 sdar_gowm_runtime_test，使用固定 GOWM 官方 bootstrap/install 和受限 consumer。正常 startServerRuntime 的管理健康、Agent Card 均 200，关闭后连接为 0（run sdar-runtime-e6d3242e-3aeb-44ea-a3b7-a8ceede77d63）。旧 Repository 库中的不完整启用 Skill 导致的失败保留，不改历史 Skill。证据 progress-20260908-runtime-startup.json；仅启动/正常关闭验证，Task/LangGraph/MCP、异常构造清理和完整 Goal 仍开放。

Outcomes：继续推进正常 Task 双设备执行；不是完整里程碑关闭。早期失败资源关闭、全部后台范围、冻结 Schema、辅助 Link 合同缺口和最终单仓交付仍待完成。

## 2026-09-08 正常 A2A / LangGraph 双设备增量

Discoveries：正常 A2A 的 native external_task_projection 触发器拒绝缺设备归属写入；Repository 子集先前未覆盖此正常入口。模型桩的 Usage、输入路径和分层效果要求需与实际契约一致，均保留失败后修正 fixture，不降低 Runtime 校验。

Decisions：投影设备只从匹配 context 的原生 Task 推导；同语句 CTE 确认父级范围，保留旧单机逻辑和终态单调性。官方 SDK 测试调用也留在 adapter。

Validation：2026-09-08 正常 Server 双设备增量：正式 A2A 暴露并修复 external_task_projection 缺 device_id 的原生触发器失败，find/list/save 均应用持久 Task 范围。19 组 Repository、22 项相关协议、5 项 A2A store unit、typecheck/lint 和 936 文件架构检查通过。正常 Server run gowm-runtime-5422cc6b-aa3b-414a-b762-d7bfd7ada3ad 经配置 Task Type、正式 Skill 选择/输入、2.0 DSL 确认及 LangGraph 完成两个 Task，各一次本地 Frozen MCP 调用；Task/Plan/Instance/Node Event/Invocation/A2A 投影 device_id 一致，预算每次 MCP=1。证据 progress-20260908-normal-execution.json。仅 immediate-result 合成场景通过；规划交互结果采集 P0001、后台范围/配置和证据投影仍有缺口，Remote/targets 全链及最终交付未完成。

Outcomes / next：先处理实际暴露的 planning interaction 原生归属和后台扫描、稳定默认测试配置，再扩展 Remote waiting/canonical/recovery 与目标图形。不能用本次 immediate-result 成功关闭完整 Goal。GOWM/SMPP 未修改，未部署、提交、推送或合并。

## 2026-09-08 规划交互与正常 Remote 恢复增量

Discoveries：规划终态原生表含 device_id，旧 writer 未传导致 P0001；Task 完成先于 continuation worker 最终确认，立即读取会观测 terminal_event_claimed。测试局部 outcome 遮蔽模式参数由 typecheck 暴露，保留历史证据且不把未执行断言的运行当作 Remote 完整证明。

Decisions：同事务锁定受限原生 Task，再执行 correction/episode 幂等和写入；读范围沿 Task。仅测试配置经正式 API 设置原有 300 秒策略。保持精确 reentered/succeeded 断言，观察在途 worker 确认后判断。

Validation：2026-09-08 规划交互/正常远程恢复增量：planning correction 与 episode 从同事务受范围约束的 Task 推导 device_id，覆盖 task/user/tenant 查询与幂等边界；20 组 PostgreSQL 场景、3 项相关 unit 通过。正常 Server Remote run gowm-runtime-26cbf7c7-f1ec-43a2-9081-a761ab7c380f 完成双设备 Task，每设备一次 MCP 调用、2.0 terminal snapshot 和一次 succeeded continuation attempt，Binding completed/reentered；终态 episode 的设备和 outcome 引用已实际保存。证据 progress-20260908-planning-remote.json。canonical 仍缺桩父记录，其他远程组合、Schema/targets、后台及证据投影仍开放，完整 Goal 未完成。

Outcomes：优先补正常 canonical 父关联与目标来源冻结，随后完成其余后台消费者/retention、证据投影和全部要求；不修改上游、不部署，不声明整体完成。

本轮最终静态结果：typecheck、定向 lint 与 937 文件架构检查通过，已同步增量证据。

## 2026-09-08 调用 Schema 冻结增量

Discoveries：恢复目标读取当前目录会丢失原目标注解；既有 authority JSON 足以承载精确调用 Schema，无需改合同表。

Decisions：Domain 深冻结有界 JSON，派发先捕获，Repository 使用快照；旧记录不补写、不回退目录推断。

Validation：2026-09-08 冻结 Schema 增量：正式 MCP 派发将精确 operation/inputSchema 深拷贝到既有 authority snapshot，receipt/恢复沿用该快照；共享 DISPATCHED 目标不再查询可变 mcp_tool。缺快照或操作不匹配时显式拒绝新的共享 admission，旧行与 hash 不改写。41 项 unit、20 组真实 PostgreSQL 场景及正常双设备 Remote 链通过（sdar-pg-f899c0bf-1a98-40e5-941f-eb0ecacdf301；gowm-runtime-3772c61d-eaf1-4348-bbcd-c5fe273d244a），正常链每设备一次 MCP，快照持久化、continuation 成功且 cleanupErrors=[]。证据 progress-20260908-frozen-schema.json。仅增量已验证；正常 canonical/targets 组合、其余后台范围、辅助 link 合同缺口和最终交付仍开放。

Outcomes：本轮取得实现和当前行为证据，仍不关闭完整里程碑。下一步正常延迟 canonical 关联及目标图形业务链。

## 2026-09-08 正常 Server 延迟 canonical 增量

Discoveries：历史 active 测试类型与等向量桩挤出新类型，模型桩正确拒绝且无工具调用；这与 canonical 实现无关。

Decisions：仅在已验证的独立 runtime test 库，通过正式治理 API 退役此前本测试注册类型，保留历史和有限召回。协议桩显式启用 UUID；独立 peer 发布合成终态父行。

Validation：2026-09-08 正常延迟 canonical 增量：正常 Server 双设备 Remote Task 完成后，独立受限测试 peer 才发布合成 ugv_smpp 父行；现有后台自动补齐 canonical，未调用测试专用 reconcile，Binding version/Runtime revision 不变，MCP 总调用仍为 2。官方 gowm_business_v1.task_execution_lineage 回读设备及 MCP ID 正确，未伪造 Provider execution/Mission，missing_stage 仍 PROVIDER_PENDING。run gowm-runtime-d0036451-a307-4ac1-8088-36f8039ac18f，cleanupErrors=[]；22 项 Frozen HTTP/registry contract 通过。证据 progress-20260908-normal-canonical.json。完整 Goal 仍开放，targets、其他后台/恢复组合、辅助 link 合同缺口及最终交付未完成。

Outcomes：正常 canonical 成功及官方回读已有当前证据，未关闭整个里程碑。继续正常 targets 及其余读写/后台覆盖。

本增量最终静态检查：typecheck、定向 ESLint、938 文件架构检查通过。

## 2026-09-08 正常目标图形链增量

Discoveries：FULL_CN 与固定 validate_target_owner 均明确同步调用不创建 NODE_RUN 目标，不能把此合同边界误判为缺写并伪造 Binding。

Decisions：现有本地只读协议桩显式增加带 x-sdar-targets 的输入；同一个已知局部 Point 经正常 Skill 输入和 literal Plan 参数传递，按真实角色回读。

Validation：2026-09-08 正常目标链增量：本地 Model/Frozen MCP 协议桩通过正式 A2A、Skill 输入、确认 DSL、LangGraph 和共享 PostgreSQL，双设备远程场景保存 REQUESTED/PLANNED/DISPATCHED；同步场景按 FULL_CN 合同只保存 REQUESTED/PLANNED，Invocation 原参完整且无 Remote Binding。两条路径每设备调用 1 次，局部 Point (12,34) 的 native_crs=LOCAL:synthetic-grid、WGS84 为空，官方目标视图回读通过。remote gowm-runtime-3645ddb4-02b8-4332-8330-18c6bad3c9ac；sync gowm-runtime-1c02d1e8-3ae3-4a0a-b8ac-219fb92ca480；cleanupErrors=[]。22 项协议、typecheck/lint、938 文件架构检查通过。证据 progress-20260908-normal-targets.json。仅局部 Point 正常链已验证，几何/目标修订组合、后台范围、恢复组合与完整交付仍开放。

Outcomes：正常远程和同步表示边界获得当前证据，完整 P0–P7 与最终交付仍未完成。

## 2026-09-08 业务事件身份传递增量

Discoveries：持久订阅有设备/服务列但 mapper 丢弃，impact 端口只传 server/handle；新共享 Remote 仓储会拒绝该歧义查找。

Decisions：以持久订阅而非事件载荷作为设备通道权威，传递完整身份并检查返回值。旧 standalone undefined 仍可识别，显式 null 与设备通道分开。

Validation：2026-09-08 Business Event 身份读取/影响评估增量：订阅投影保留原生 device_id/smpp_service_key，Domain 区分未配置与显式非设备；Remote 查找传入持久订阅身份，跨 server/handle/device/service 结果在影响写入和恢复动作前拒绝。12 项 Application 事件测试与 1 项仓储投影 unit 通过；后者使用模拟 SQL 行，不能作为真库订阅集成证明。初次 5 项监听测试受沙箱 EPERM 阻止，同套在允许回环监听后通过。证据 progress-20260908-event-identity.json。订阅 writer、current/generation、连接与 worker 范围仍未完成；本增量不关闭业务事件完整要求。

Outcomes：读取至评估边界取得实现与 unit 证据，完整业务事件生命周期仍开放。下一步将显式身份贯穿订阅创建、current/generation 和全部 worker，而非默认选一台设备。

本增量最终静态验证：typecheck、定向 ESLint、938 文件架构、格式和 diff 检查通过。

## 执行方式收敛与订阅批次（2026-09-08）

用户指出执行时间过长。此前切分过细、重复整组验证和逐轮多文档更新造成低效。后续按模块收敛实现：缺陷只跑直接相关行为，模块稳定后统一静态检查，最终按任务包验收一次；不新增证据平台，不因文档/格式重跑业务测试，不以局部报告替代最终交付。保留设备隔离、事务与恢复必要验证，不删除任务包要求。

本批实现：共享订阅 writer 要求显式 device/service 或非设备通道；current/latest、list/find、continuity/admission、inbox claim/process/failure 使用持久订阅范围。同 Provider 按设备独立连接 key，正常 Server 从明确 allowlist 的有效目录绑定枚举通道，无默认设备。订阅各代和收到/处理游标仍分开。

验证：`pnpm exec tsx scripts/gowm-storage-postgres.mts`（既有隔离 test.env）PASS，run `sdar-pg-2b0e89cd-f758-4c5a-b7c6-163623a1e750`，21 场景组；新增订阅场景证明两设备同 Provider 同 generation 1 可共存、独立升代、游标隔离、越界写入及处理拒绝。`vitest --project unit` 的 business-events、business-event-impact、business-event-device-projection 共 13 项 PASS。初始 fixture 缺 sha256 前缀的真实约束失败保留；未修改约束。

边界：这是仓储和 Application 回归，尚无正常 Server 业务事件端到端证明；relation/assessment/incident 及连续性影响范围、其他后台和最终交付仍开放。后续先集中完成这些实现，不提前重复最终全链。

## 业务事件派生记录批次（2026-09-08）

已实现：relation/assessment 在同事务内先锁定并检查源 inbox 范围；assessment 列表按源订阅过滤。共享 incident 使用现有 JSON 内的 subscriptionId 记录精确来源，保存/读列表/查重/Task 关联均校验订阅范围；挂接 Task 要求设备与 SMPP 服务一致，原 incident 除 agentTaskId 外内容不可改写。事件与连续性 incident 的去重包含持久订阅身份，旧 standalone 路径保留原语义；连续性来源不匹配时拒绝。正常 incident Task 创建传递明确设备/非设备元数据。

验证：既有隔离 PG driver 的 21 组场景 PASS，run `sdar-pg-d71c8166-4a94-4735-af69-786b9d057e14`；事件场景扩展了 relation/assessment/incident 越界写读和跨设备 Task 关联拒绝。`vitest --project unit` 的 business-event-impact 与 business-event-device-projection 共 9 项 PASS，涵盖同 Provider 两设备 continuity 去重、重复处理与错误 stream 拒绝。仅本模块回归，没有重复正常模型/targets 全链。

未关闭：正常 Server 事件连接与连续性端到端、其他后台/retention 范围、完整任务包验收和单仓交付。该增量未修改 GOWM/SMPP、未引入新表或证据平台。

本批最终 typecheck、定向 ESLint 与 diff 检查通过。

### 2026-09-08 Evidence Task 归属与后台投影修复（模块回归，非最终验收）

- 共享 `PostgresEvidenceStore` 从受限 Task 推导原生 `device_id`，幂等前验证 Task/context；`hasRecord` 与 Runtime/Skill/MCP 证据源根扫描、直接读取限定设备/服务。正常 Server 传入同一 DeviceWorkScope。全局无 Task 证据、Experience 源及其余导出/清理范围仍待收敛，不能据此关闭全部后台消费者。
- 真 PostgreSQL driver `node --env-file=.state/gowm-storage/test.env --import tsx scripts/gowm-storage-postgres.mts`：run `sdar-pg-ccb66d81-98ee-4e1b-8f3b-a7a51c7be1e2`，22 组 Repository 场景通过；新增证据原生归属、幂等、错误 context、外设备与空范围拒绝。
- 单次正常 Server immediate 链 `node --env-file=.state/gowm-storage/runtime-test.env --import tsx scripts/gowm-runtime-execution.mts`：run `gowm-runtime-21f27707-d7da-40c5-82f1-ae7e0fae3ae9`，双设备自动落库 runtime.episode、工具总计 2 次、cleanupErrors=[]。该运行仍出现 MCP 证据 Schema 错误，故不代表完整证据链通过。
- 随后只加载已保存 Task 诊断：Admission arguments_hash 为裸 SHA-256，Evidence 要求 sha256: 前缀；在投影表示边界修复，不改原始 hash/记录，不放宽 Schema。相关 unit 4 项通过。Task `309ab54b-e13f-4788-9ca2-cb8c7195d74a` 经实际 CatalogValidatingEvidenceWriter + PostgreSQL 重投影成功（3 records、0 quality issues），未重新调用工具/模型。诊断中另一 Task 曾直接使用 Store 写入未过 Catalog gate 的测试记录；该调用不作为 Schema 成功证据，保留测试库历史，不宣称本轮全部历史 issue 已清除。
- 本轮初次 unit 命令误用了不存在的 vitest.unit.config.ts，启动失败；改为仓库 `--project unit` 后通过。初次 lint 指出测试模板可选 taskId，补显式断言后重查。保留失败记录，不将其抹去。
- 继续保持 Goal INCOMPLETE。只做相关模块回归，未重跑全量门禁；最终单仓交付、剩余目标/恢复组合及消费者范围仍开放。

本批最终静态检查：定向 eslint、`pnpm typecheck`、相关文件 Prettier 和 `git diff --check` 通过。


2026-09-08 Evidence 后续：Experience 的任务绑定分区扫描、实际来源 Task 读取及 existingEvidence 加入 DeviceWorkScope；retrieval/usage/feedback/replay 的有 Task 来源被拒绝时不退化为无 Task 全局记录。正常 Server 装配同一范围，终态 coverage 根扫描同步限制。共享 pattern/artifact/dataset/validation 等无单一 Task 的定义仍保留现有语义，其跨来源消费范围与导出/清理仍开放。

验证：Experience source unit 2 项通过；PG run `sdar-pg-0fd03299-2cf2-4da1-9fe3-a385f4cf34d2` 22 组通过，新增候选召回只含设备 A、直接读取 B/空范围拒绝、无必需分区标识拒绝、空范围 coverage 无候选。初次 PG 因测试遗漏 experience_task 必需 episodeId 失败，补合法输入并保留非法输入断言后通过，没有放宽 Domain 校验。未重跑正常工具链和全量门禁。


2026-09-08 Evidence 导出边界：pending 读取及 deadLetter 记录锁限定实际 Task 设备；acquireLease/markSent/acknowledge 在状态写入前验证整个 partition，避免局部可见记录推进共享 ACK 游标。共享模式 append 与分区检查采用相同事务 advisory lock，稳定检查/写入窗口，保留既有 fencing 语义。无 Task 的共享记录保留服务级语义。

验证：PG run `sdar-pg-16b4638e-bb67-4e0d-83aa-a526ff5c4a8f` 22 组通过，越界租约/发送/确认/死信均拒绝且 export_state/dead_letter 零写入；加分区锁后复用同 run，仅直接调用 verifyGowmEvidenceCases 再验证通过（没有重建目录或重跑正常工具链）。定向 eslint、typecheck、格式检查通过。清理/管理 recovery 操作、共享来源协调与全量验收仍开放，不能据此声明全部 Evidence 范围完成。


2026-09-08 Evidence retention：正常 Server 将 DeviceWorkScope 传入管理仓储，apply_retention 在共享模式中保留 task_id/episode_id/device_id 任一有归属的记录及其他 Evidence 引用的记录；仅无关联过期诊断仍按原有限流清理。保留既有事务、恢复任务与幂等结果，不添加归档服务、不更改 GOWM 触发器。

定向验证：复用 PG run `sdar-pg-16b4638e-bb67-4e0d-83aa-a526ff5c4a8f` 的双设备父记录，直接运行 `verifyGowmEvidenceRetention` 通过；两设备历史 + 被引用全局诊断保留、无关联过期诊断删除、同 recoveryRun 重入幂等。已接入现有 PG driver 供最终相关回归使用，本次未重新执行全部 23 组。artifact_replay_case/experience 清理及与并发引用新增交错的验证仍开放。


2026-09-08 Evidence retention 并发收敛：共享 append 在分区锁之前获取现有 runtime.evidence-export 协调键的事务共享锁；清理/配置沿用排他锁，因此追加事务相互不串行，但不会与清理检查/删除交错。复用 PG run 16b4638e 的定向 retention 场景通过：实际 appendWithinTransaction 持锁时，第二事务 try 排他锁失败，回滚后立即成功；两设备历史保留及过期无关联诊断清理仍通过。无轮询等待/工具重跑。其他删除链仍待完成。


2026-09-08 Replay expiry：正常 Server 为 PostgresArtifactReplayValidationRepository 传入 DeviceWorkScope。共享过期扫描从实际 source episode/Task 约束归属，仅处理仍关联 promotion_eligible 数据集的过期案例；复用既有失效、successor 和验证 run 失效事务，保留案例历史，返回物理删除数 0。已失效案例退出后续扫描，避免固定批次饥饿。Standalone 删除语义不变。

定向真库：使用 runtime-test.env + gowmSharedPoolConfiguration + verifyGowmReplayRetention，复用正常 Task `37b691dc-d0f8-4fcb-8f91-06035fdf071b`、`309ab54b-e13f-4788-9ca2-cb8c7195d74a` 的已有经验 episode；本设备数据集失效、另一设备不受影响、两案例保留、重复扫描不新增 successor 全部通过。测试内容为 storage retention fixtures，不宣称候选实际执行。未重跑模型或 MCP。显式 purgeTenant/deleteUserScope/deleteActorScope 删除语义仍开放，未与自动过期混为同一结果。


2026-09-08 删除入口追踪与 MCP 快照保护：明确 compilation.deleteUserScope / replay.purgeTenant 当前没有正常 Server 调用入口，仅测试调用；Fast Gateway actor 删除属于显式管理传播，其范围继续审查。发现 MCP deleteServer 会删除 canonical 补关联仍需的 mcp_protocol_snapshot，因此共享模式存在 invocation/admission/remote binding 或 GOWM directory 引用时以 MCP_SHARED_HISTORY_RETENTION_REQUIRED 拒绝物理删除。依据 FULL_CN D09 的保留限制，不创造 tombstone 表、不改外部 Schema。Application 调整为仓储成功后才断开 transport，拒绝不影响连接。

验证：mcp-registry.unit 76 项通过，含仓储拒绝时 disconnect 零调用；直接复用隔离 run 16b4638e 的 MCP Server 验证删除拒绝且原快照列表完全相等。相关 PG driver 已加入同一断言；未重跑整套远程协议链。公开错误沿既有管理 API code/message 400 规则返回；MCP 刷新/目录替换及完整管理契约验证仍开放。


2026-09-08 Fast Gateway 范围：正式 Server 传入 DeviceWorkScope；request 原生 device_id 在同一事务从 Task/context 推导。findByTaskId/idempotency、幂等冲突检查、feedback 的 request/decision 一致性均限定实际来源 Task。显式 actor 删除先锁定范围内 request 集合，再删除该集合的派生 outbox/feedback/decision，保留其他设备及两台设备核心 Task；不将主动投影删除改成后台物理历史清理。

复用隔离 PG run 16b4638e，直接调用 verifyGowmGatewayCases 通过：原生设备列、重复保存、越界/错 context 拒绝、反馈幂等与跨请求拒绝、同 actor 只删除设备 A、第二次删除为 0、两个 Task 保留。已接入现有 PG driver；本次只定向执行，不重新启动正常业务链。定向 lint / typecheck 通过；范围矩阵更新。整体消费者盘点和单仓交付仍未完成。


2026-09-08 共享 Goal 证据隔离修复：RuntimeCore 的 node event、readiness gate、confirmation 在共享模式按 workflow_plan.gowm_task_id 关联当前设备 Task，防止仅按 Goal 混入其他 Task 的执行事实。共享 Goal/用户计划定义仍可复用；非设备兼容分支保持可识别，不能将本项当作全部共享效果事实已归属。completed_effect/outcome_decision 的 Goal 级复用及证据来源仍需独立核对。

发现旧 PG 根夹具仅 Plan/Instance 共享 Goal，Task.goal_id 未绑定，不足以证明真正的 Task 共享 Goal。已用 Domain transitionTask/bindTaskGoal + 正式 Task 仓储补齐夹具，不修改业务断言。当前 run `sdar-pg-6de69d56-bc7a-4a1b-88fa-bf43416ae810` 的 24 组真实 PG 场景通过，含两个 Task.goal_id 确认为相同且各自仅读取一个本 Task instance 的 node event；1 项 source unit 通过。历史报告保留但不得为本场景背书。此处扩大到现有 PG 集合是因为根夹具影响相邻场景，未重跑正常模型/MCP 链或全量门禁。


2026-09-08 Goal 效果/判定来源：Domain JSON 增加可选 executionTaskId；共享 findOutcomeContext 从实际受限 Task 提供来源与 deviceId。Controller 给三层判定/完成效果附带来源，设备效果指纹升级为含 deviceId 的 2.0，其他情况保留旧算法。Goal 判定/恢复的 prior 和 completed effects 按来源 Task 设备+服务过滤，Task Evidence 仅读取自身产生的记录；不原地改历史 JSON/hash。ADR-153 已补充决定。

本批验证：11 项 Controller/Outcome Judge/Recovery 单测通过，证明两设备指纹不同、同设备稳定、来源进入真实终态提交参数。verifyGowmGoalOutcomes 使用真正共享 Goal 的隔离 run 6de69d56，通过同一 user plan 上的双设备判定/效果与 Evidence 来源隔离；已接入现有 PG driver。一次正常 Server immediate 链 run `gowm-runtime-167a1865-8abb-4181-b977-56b2defc4744` 通过，每设备 3 decisions + 1 completed effect 带来源，工具总计 2、cleanupErrors=[]、modelFixtureFailures=[]。后台采样 failedItems=0，但仍有 canonical_backlog_not_quiescent，不能宣称封存完成。定向 lint/typecheck 通过。进度向量/恢复状态的来源、旧无来源状态转换及剩余消费者未关闭。


2026-09-08 恢复进度来源隔离（模块回归）：ProgressVector / RecoveryDecision 以可选 executionTaskId 保存来源；共享正常恢复从实际 Task context 传递，写入前在同一事务核对 Plan/Goal、Task 及设备服务范围。读取前次进度按当前设备/服务过滤；存在不早于当前可验证进度、且无来源的旧记录时，以 RECOVERY_PROGRESS_SOURCE_UNPROVEN 明确失败，不改历史或从 START 重放。

验证：相关 Application 两文件 7 项通过；既有隔离 PG Plan 的定向运行 d0a4a7ee-446e-47e9-a08a-4942690c4675 通过双设备进度隔离、幂等、越界写拒绝、缺来源写拒绝和旧状态明确拒绝。最初重跑整个 Goal fixture 因已有 revision=1 唯一键失败，随后直接复用已有 Plan，只执行恢复断言；未重建数据库、未调用模型/MCP、未重跑全量门禁。新 PG driver 的 Goal fixture 已包含这些断言，但本轮没有重跑整个 driver。整体 Goal 仍 INCOMPLETE，剩余后台范围、组合链路及最终单仓交付开放。

本批收口：定向 ESLint、pnpm typecheck、5 个改动代码文件 Prettier 及 git diff --check 通过；补来源传播断言后只重跑 progress-recovery 单文件，3 项通过。后续按缺陷批量实现，复用既有有效结果；不逐修复重跑正常业务全链。


2026-09-08 Goal 结果写入与终态范围收敛：共享判定、完成效果在原事务写入前核对 executionTaskId、Plan/Goal 与设备服务范围；working/terminal 三层判定及效果必须与承载 Task 同源。效果失效要求前驱属于同设备/服务，避免伪造来源撤销另一设备效果。正常 Server 将 DeviceWorkScope 传入终态仓储，commit 在任何业务写入前拒绝越界 Task；find/findByControl/warning 也按实际 Task 限定。无 Scope 的 standalone 路径保持兼容。

验证：verifyGowmOutcomeWriteScope 复用隔离 PG 6de69d56 的 Plan，通过同批混入外设备判定时整批回滚、合法幂等、越界效果写拒绝、跨设备前驱失效拒绝及终态提前拒绝。已接入现有 PG driver，没有重跑整个 driver。首次定向 lint 指出已缩窄行的多余 optional chain，修正后定向 lint、pnpm typecheck 通过。

因正常终态装配变化，运行一次正常双设备链：gowm-runtime-ce11aff1-9f1d-47a6-abc5-7fbd44199a06，PASS、工具 2 次、modelFixtureFailures=[]、cleanupErrors=[]；canonical_backlog_not_quiescent 仍存在，不宣称封存完成。随后仅对该运行的已有 Task 调用 verifyGowmTerminalProjectionScope：本设备终态可读、另一设备 find/findByControl 不可见，外设备 warning 拒绝且原 JSON 不变，PASS。测试使用隔离 PostgreSQL 与本地协议桩，非真实设备。

剩余组合链、后台消费者盘点及单仓最终交付仍开放，整体 INCOMPLETE；未运行全量门禁。


2026-09-08 Skill 子调用归属：准备 Usage 和子 DSL 规划优先继承不可变父 Plan.executionTaskId；continuation authority 若提供不同 Task，在规划前拒绝。正常 Server 为 SkillCallWorkflow 仓储传入 DeviceWorkScope。关联写入在同事务核对父实例/父计划、子计划同 Task/设备，以及可选子实例与子计划对应；查询按父计划范围过滤。callId 冲突不能改变父、node-run、子计划或 Skill 身份，旧无 node-run 记录也不能借此覆盖其他设备关联。

验证：skill-call-workflow.unit.test.ts 28 项通过；verifyGowmSkillChildScope 复用正常 run ce11aff1 的两设备父记录，定向 PostgreSQL 通过合法/幂等、外设备读写拒绝、跨设备子计划拒绝与旧 callId 身份劫持拒绝。夹具为关联存储测试，未实际执行子 Workflow；没有重跑正常模型/MCP 链或全量门禁。普通 subworkflow 的共享定义到设备执行计划实例化、通用 WorkflowChildCall 范围及真正子调用全链仍开放；整体 INCOMPLETE。

本批定向 ESLint、pnpm typecheck、相关代码 Prettier 与 git diff --check 通过。


2026-09-08 普通子工作流计划实例化与关联范围：SubworkflowExecutionService 读取父计划 executionTaskId，按 parent instance + node-run 保存独立子执行计划，保留确认定义与 sourceConfirmedPlanId，不修改共享源；重复调用复用关联，已有执行计划在身份/定义相等时可被认领，已有无实例关联仍按原规则拒绝重放。continuation Task 不同于父 Task 时拒绝。共享 confirmed definition 检索允许无归属模板，不等于允许无归属设备执行。正常 Server 将 DeviceWorkScope 传入通用 WorkflowChildCall 仓储，原事务核对父/子计划同 Task/设备及可选子实例所属计划；读取按父 Task 范围。

验证：subworkflow-execution.unit 9 项通过，包括 Task 子计划实例化及重复调用一次执行。运行时代码定向 lint/typecheck 通过。verifyGowmSubworkflowScope 复用隔离正常 run ce11aff1 的父记录：无归属共享模板可检索、两个 Task 分别保存子执行计划、原模板不变、关联幂等与跨设备拒绝 PASS。该真库用例只证明计划/关联持久化，不冒充实际 LangGraph 子调用执行；新的 helper 定向 lint 与执行通过。未重跑模型/MCP 全链及全量门禁，完整普通/Skill 子调用正常 Server 联调仍开放，Goal INCOMPLETE。


2026-09-08 实际 LangGraph 普通子调用：新增 apps/server/test/gowm-child-execution.ts，直接装配既有 WorkflowExecutionService / SubworkflowExecutionService / LangGraphWorkflowExecutor 和共享 PG 仓储，复用正常 ce11aff1 双 Task；外部 LLM/MCP/Skill 端口拒绝调用。两设备分别执行子 human_confirmation 暂停，再从父恢复至父子 succeeded；子计划保留 Task，关联只有一个子实例，父固定成本 1、子 LLM/MCP 调用 0。入口调度数为 3（含暂停恢复重入），不能当作工具调用次数；随后只读实际节点事件，两设备 result 各 started/succeeded 一次。

本次结果：gowm-child-b3757099-1913-48ae-8938-816113942fe3，报告已保存。前两次夹具失败分别为非法对象 literal/遗漏 continuation 装配、复用查询选到同一设备的两个 Plan；修正为合法标量、正式 continuation 仓储及每 Task 一个根计划，不放宽断言或清除旧记录。定向 lint/typecheck 通过；结果事件断言已补入 helper，并已对上述已保存事件核对，没有为追加断言重跑执行。

该证据是实际 Application + LangGraph + PG 的普通子调用暂停恢复，不代表 Server/API admission、Remote MCP 等待或 Skill 子调用全链。后者和剩余组合/后台范围/最终交付仍开放，整体 INCOMPLETE。本次没有重装依赖、重建 DB 或跑完整门禁。


2026-09-08 Evidence 期望/manifest 原生归属：正常 refreshEpisodeExpectations 在事务写入前验证 Task 设备范围，并拒绝已存在的 episode→其他 Task 关联；期望行与 manifest 都从实际 Task 推导原生 device_id。第一次真库刷新暴露遗漏该列，被 GOWM TASK_PROVENANCE_DEVICE_MISMATCH 拒绝；修复 SDAR 写入，不修改上游结构/触发器。期望重建的 DELETE 只清除同 episode/policy 过期派生期望，不删除 outbox 历史。

验证：verifyGowmExpectationScope 复用 ce11aff1 已完成 Task，合法重建/重复重建、外 Task 与 episode 所有者混用拒绝、外设备期望零改变通过。实际 EpisodeEvidenceCoverageService 生成 projecting manifest，原生设备列正确、重复保存成功、越界 saveManifest 被拒绝；不宣称 sealed。定向 lint、运行时代码 typecheck 通过；没有重跑模型/MCP/Workflow 链或全量门禁。

同时代码检查确认 MCP saveServerAndTools/registerFrozenProvider 仅替换当前 mcp_tool，保留旧 mcp_protocol_snapshot；物理 Server 删除由已有历史保护负责。retention-matrix 更新为代码检查/本次行为验证的不同证据类型。Evidence 管理/recovery/读取的其余范围及并发跨来源归属仍开放，整体 INCOMPLETE。


2026-09-08 Evidence 显式 Task 读取范围：listExpectedRecords/loadManifest 与管理 listOutbox/getManifest 使用已有实际 Task 设备/服务谓词，非设备/无 Task 全局记录保留明确分支。内部事务的 identity 冲突读取不被隐藏，避免将不允许的已有记录误当作缺失覆盖。

验证：verifyGowmEvidenceReadScope 仅查询 ce11aff1 已保存期望、manifest、outbox，本设备非空、另一设备为空，PASS。没有重建 Evidence 或执行 Workflow/模型/MCP。定向 lint 与运行时代码 typecheck 通过；checkpoint、quality/projection issue、recovery 管理的剩余范围仍开放，整体 INCOMPLETE。


2026-09-08 Evidence recovery 目标检查：record/episode/partition/dead-letter 重试在 request 入库、claim 及实际 action 前按 outbox 实际 Task 验证设备范围；含外设备的集合整体拒绝，避免局部处理共享恢复目标。显式 coverage episode 校验 Task，批量 coverage target 插入限定范围。保留既有配置锁和独立 request/claim/action 事务。

verifyGowmRecoveryScope 复用隔离 16b4638e 的配置与 Evidence，证明外设备 request 零入库、已有外设备 replay 在 claim 前拒绝且 recovery status 仍 requested、外设备 outbox 行完全未变；本设备 request 可接受。首次验证只在 action 前拒绝仍会改为 failed，随后把检查前移到 claim 并重跑该断言通过。没有连接导出端点，也未重跑模型/MCP/Workflow。运行时代码 typecheck 与定向 lint 通过。

未关闭：恢复队列列表/持久请求所属范围、coverage target claim/complete/fail 以及其他管理读取仍需核对；本项不宣称整个 recovery 管理闭环完成，整体 INCOMPLETE。


2026-09-08 recovery 请求持久范围：在现有 target JSON 写入设备范围 hash（设备集合排序/去重、SDAR service、非设备开关），不新增 Schema 或生命周期。get/listRecoverable/coverage claim 限定摘要；start 幂等重入、resume 两事务、complete/fail 都核对持久范围。complete 同时核对 episode/Task 与实际设备。旧缺少摘要的请求不改写，以 EVIDENCE_RECOVERY_SCOPE_UNPROVEN 拒绝自动接管；不把旧记录伪装成当前所有。

verifyGowmRecoveryScope 在隔离 16b4638e 复用配置/Evidence，证明外范围 read/list/claim 无结果、resume/complete/fail 拒绝且原状态不变；同范围设备顺序变更仍可读，本范围队列可见；旧无摘要请求拒绝且保持 requested。测试最后通过各自所属仓储将本次三个 fixture 请求终结为 FIXTURE_FINISHED，不影响此前历史。定向 lint 与运行时代码 typecheck 通过，无导出端点/模型/MCP调用。正向批量 coverage 完整 claim→manifest→complete 链以及其他 Evidence quality/projection 管理仍未关闭，整体 INCOMPLETE。


2026-09-08 coverage recovery 正向闭环：新增 verifyGowmCoverageRecovery，复用正常 ce11aff1 双 Task 与现有隔离库，按单设备范围发起不指定 episode 的批量 reconcile_coverage。实际恢复 action 只创建本设备目标；外范围 claim 无结果，首次本范围 claim 成功，重复 claim 无结果。调用正式 EpisodeEvidenceCoverageService 保存 manifest，再 completeRecoveryTarget 到 succeeded，重复 complete 修订不变，终态不能再次 claim，全部 PASS。

该测试复用/正式应用隔离 Evidence 配置，endpoint 为 example.test 且未连接；不启动导出 worker，不重跑 Workflow/模型/MCP。目标完成代表此次 coverage 重建完成，不宣称业务证据齐全或 sealed。剩余 quality/projection/checkpoint 管理范围、其他模块及最终单仓交付仍开放，整体 INCOMPLETE。


2026-09-08 Evidence issue/死信读取：共享 issue 谓词结合真实 Task episode 与已持久 Evidence；envelope 未入库时可凭实际 Task 归属读取，存在外设备关联时拒绝，不把未知记录默认为全局。管理 quality/projection 与 Store episode quality 读取采用同一规则；死信管理读取沿原 outbox Task 归属过滤。

verifyGowmIssueReadScope 复用隔离 16b4638e 双 Task，新增无 envelope 的 diagnostic quality/projection issue：本设备能读，外设备不能读。首次死信分支实际为空，明确不作为双设备证据；随后补实际两设备死信并要求 distinct task 数为 2，读取正反例通过。无模型/MCP/导出连接、无全链重跑。定向 lint 与运行时代码 typecheck 通过。

Checkpoint 的分区到来源 Task 关系、issue 写入/resolve 路径仍需独立核对，不能用本次读取回归关闭这些入口；整体 INCOMPLETE。


2026-09-08 Evidence issue 创建/resolve：recordQualityIssue/recordProjectionIssue 的 INSERT SELECT 在候选行上核对来源范围，ON CONFLICT 同时核对已有记录范围，防止用允许的 episode 覆盖已有外设备 issue。五个 resolve 入口复用相同谓词：projection 单项、quality 单项、episode、rule 与 source 批量操作。保留现有身份冲突错误、修订与重复 resolve 语义。

verifyGowmIssueResolveScope 在隔离 16b4638e 一次覆盖两类创建/幂等更新及五种 resolve：本设备重复写入保持修订，外设备创建拒绝、借外设备 ID 改 episode 拒绝；resolve 本设备修订为 2、外设备始终 revision=1 且 resolved_at=NULL。保留先前诊断记录，只使用本次 fixture 做断言。定向 lint 与运行时代码 typecheck 通过；未执行外部服务或正常业务链。Checkpoint 分区归属及没有显式 episode/record 关联的来源分类仍需盘点，整体 INCOMPLETE。

本批静态收口曾发现测试 fixture 循环的类型推断与 optional episodeId 错误；补显式 readonly string[] 与存在性断言，未修改业务断言、未重跑真库。Checkpoint 下一步已定位实际分区约定：runtime-core:<task>、skill:<task>、mcp-capability:<task>；Experience 使用 v141:<kind>:<length>:<sourceId>，不能用统一截断猜 Task。


2026-09-08 直接 Task checkpoint 范围：识别 runtime-core、skill、mcp-capability 及 v141:experience_task 分区，通过实际 Task 检查设备；Experience 长度编码按原 JS 字符串规则校验，不截断含冒号/中文 ID。saveCheckpoint 在原事务内先校验 Task，并使用既有 partition 锁拒绝已含外设备 Evidence 的分区；管理列表按对应 SQL Task 关联和分区 Evidence 范围过滤。无直接 Task 的共享定义分区继续保留现有语义。

verifyGowmCheckpointScope 复用隔离 16b4638e 双 Task，使用独立 fixture sourceFamily（不覆盖真实投影 checkpoint），验证四类本设备写入/幂等/列表、外设备拒绝、非法长度编码拒绝与共享 pattern 兼容，通过。前两次夹具分别缺少成对 source revision、共享夹具有 projectedAt 却无 source cursor，被既有 CHECK 拒绝；补合法字段，没有改约束或业务断言。无模型/MCP/Workflow 重跑。

下一处实际未接入范围：正常 Server 的 PostgresEvidenceInfrastructureSource(pool)；需核对派生 evidence generation=1 的来源归属，不能把本次直接 Task checkpoint 结论扩大到该投影源。整体 INCOMPLETE。


2026-09-08 Evidence infrastructure 在途修改收尾：正常 Server 为 PostgresEvidenceInfrastructureSource 传入 DeviceWorkScope；候选 SQL 在 LIMIT 前过滤来源，直接读取复用范围谓词，已解析引用存在外设备记录时拒绝。直接 Task checkpoint 和 issue 可沿实际 Task 补归属。projector v2 对新增 Task 归属生成独立 sourceRevision，旧 manifest/未归属来源身份保持；旧记录/hash 不改写。质量扫描排除 infrastructure 全版本，避免 v2 诊断反向递归。

验证：phase10-evidence-sealing.unit.test.ts 3 项通过，新增断言覆盖未归属→有归属时 recordId/sourceRevision 改变、旧 envelope 不变、第二次投影跳过。verifyGowmInfrastructureScope 复用隔离 PG run 16b4638e 的双设备 checkpoint：本设备非空加载并携带 task_id、另一设备直接加载为空、pending 列表及其实际加载范围检查通过；只读，无新 Task、模型/MCP/Workflow 调用。复现入口为 packages/runtime-control-persistence-postgres/test/gowm-infrastructure-scope.postgres-cases.ts 的 verifyGowmInfrastructureScope(pool,[run+'-task-0',run+'-task-1'])，Pool 使用现有 test.env 与 gowmSharedPoolConfiguration。

首次静态检查发现新增用例给可选 checkpoint 显式赋 undefined；补必须已保存的存在性断言，未放宽行为。跨设备 reference 拒绝代码已加入，但本次只读 PG 场景不单独证明该异常分支；export/global/shared-definition 全部归属分类和正常 Server 派生证据完整链仍开放。不据本次子集关闭完整 Evidence 或 Goal。

本批最终定向 format/lint、pnpm typecheck、git diff --check 通过；补 checkpoint 存在性断言后同一单测文件再次 3 项通过。未执行全量门禁。


2026-09-08 Skill 子执行实际链与自动确认修复：复用 gowm-child-execution.ts，增加 skill 模式；真实 SkillCallWorkflowService、WorkflowPlannerService、WorkflowValidator、SkillCompositionPlanner、TransitiveSkillConfirmationEvaluator、WorkflowExecutionService、LangGraph 与共享 PostgreSQL 执行。模型边界返回显式本地 Echo DSL fixture，不作为真实模型、正式 Usage 选择或 Server/API 链证明。

实际链暴露 WORKFLOW_PLAN_CONFIRMATION_FAILED：子计划已有 executionTaskId，但自动确认只传 childPlanId，共享仓储拒绝缺少 Task 关联的确认。修复 skill-call-workflow.ts 自动确认传递已确定 executionTaskId；standalone 无 Task 保留单参数语义，没有放宽仓储校验。单测增加 Task 确认参数断言，28 项通过。

真库 run gowm-skill-child-d07acdc5-e576-4232-bf5e-71f04609ab02：两设备父/子 succeeded、分别 planningCalls=1、dispatches=1、parentCost=1；重入返回相同 Echo 结果，子实例唯一、结果节点 started/succeeded 各一次、子 MCP/LLM 预算为 0。报告 reports/sdar-gowm-shared-storage-integration-v0.1/gowm-skill-child-d07acdc5-e576-4232-bf5e-71f04609ab02.json。复现为 verifyGowmChildExecution(pool,ce11aff1Report.taskIds,'skill')，使用原 runtime-test.env 和 gowmSharedPoolConfiguration；不重建库、不调用外部模型/MCP。

保留失败：前两次 fixture 在 Workflow 前缺 Outcome/缺 sha256 前缀被 Domain 拒绝；检查前置约束后修正。随后实际确认失败定位并修复业务代码。编辑单测时出现一次语法错误导致 0 项运行，已修正后完整相关文件 28 项通过，不将该失败计作通过。未关闭 Skill Remote 子调用/正式 Usage 全链及整体 Goal。

本批最终定向 ESLint、pnpm typecheck、格式化及 git diff --check 通过。仅运行相关 Skill 回归，未重跑普通子工作流或全量门禁。


2026-09-08 补缺去重：逐条核对 gowm-targets.unit.test.ts、gowm-targets.postgres-cases.ts 和 postgres-task-workflow-results.json。现有断言已覆盖 Polygon REQUESTED、Point/LineString PLANNED、WGS84/本地 CRS、幂等冲突、自交几何拒绝及失败时 Input/Plan/supersede 回滚无孤儿目标。对应已有通过报告存在；不重复新建夹具或重跑同类验证，冻结源码最终回归仍须执行原 driver。该判断不升级为非 Point 正常 Server 全链通过。

2026-09-08 正常 Server Business Event 闭环：新增 apps/server/test/gowm-business-event-execution.ts，复用隔离 PostgreSQL/Redis、官方 frozen 协议本地 mock 与正常 startServerRuntime/registerMcpServer 装配。两设备目录归属下接收相同重复事件，经正常 subscription/coordinator/ingress/impact worker 持久化；每设备一个 inbox、一个 assessment，admitted/processed cursor 均为 1，设备及 smpp_service_key 正确，无重复影响记录。run gowm-events-147d9fdf-37bf-46e2-a8b1-99ac9574f0b9，PASS，cleanupErrors=[]；报告同名 JSON 位于现有报告目录。

复现：node --env-file=.state/gowm-storage/runtime-test.env --import tsx --input-type=module 中导入 verifyGowmBusinessEventExecution 并执行。该函数只接受本任务 loopback 55490/sdar_gowm_runtime_test，使用现有受限 consumer 启动 Server，独立 fixture role 添加合成目录；关闭 Runtime、provider、Pool 并保存失败/清理结果。不调用模型、工具或真实设备。事件没有关联实际 Remote Binding，此结果不证明事件驱动取消/重规划，也不替代相应组合场景。

首次静态检查发现夹具 handle 方法命名及 pg 查询默认 any[]；已使用正式 registerMcpServer 与显式 Record<string,unknown> 查询边界。正常链通过后仅修正类型，不重跑业务链。

本批定向 format/lint、pnpm typecheck、git diff --check 通过；未运行全仓门禁或重复目标链。


2026-09-08 正常 Remote 管理取消闭环：原 gowm-runtime-execution driver 增加 --cancel，Frozen MCP fixture 可保持 working 直到真实 tasks/cancel。通过正常 A2A→Skill→DSL 确认→MCP 派发，再对 binding 管理 API 重复发送相同取消键。最终 run gowm-runtime-0b57b0fe-4626-4d3b-8fd3-6115e152b034：双设备分别一个取消 request、一次 delivery attempt、一次 MCP invocation，Provider cancelled、binding reentered；Goal 恢复产生新 planId 并等待确认，工具总数仍为 2。modelFixtureFailures=[]、cleanupErrors=[]。复现命令：node --env-file=.state/gowm-storage/runtime-test.env --import tsx scripts/gowm-runtime-execution.mts --cancel。

语义边界：单个 Remote binding 的取消不等于取消整个父 Task；现有 Goal 恢复允许生成待确认 successor。本测试明确断言 successor 与旧 planId 不同、无额外工具执行，不把 awaiting_plan_confirmation 宣称为 Task 终态。父 Task 取消/进程丢失真实恢复和过期回调组合仍开放。现有 gowm-recovery.postgres-cases.ts 已证明受范围约束的 failInterrupted 及重复幂等，无需再造相同仓储用例。

保留失败证据：48906c1a 早期报告 PASS 只证明 Provider 取消，仍 terminal_event_pending 且 modelFixtureFailures 非空，不作为闭环证明；833be716 因模型桩只支持成功 Goal 评价失败；00e57321 模型零失败，但夹具错误要求父 Task 必须 failed。依据既有 Remote 管理 API 与 Goal 恢复语义改为精确验证新计划等待确认，未更改业务恢复行为。模型 fixture 新失败分支要求实际 failed Workflow 和 cancel 错误，返回 unachievable，不伪造成功。driver 现在在 PASS 前显式要求 model.failures 为空。

仍观察到启动知识/经验 MODEL_INVOCATION_FAILED、周期 retention 的 EVIDENCE_RECOVERY_SCOPE_UNPROVEN 及 canonical_backlog_not_quiescent；取消场景 PASS 不关闭后台健康或封存要求。后续按有限清单定位这些实际正常装配问题，不追加泛化审计。

本批定向 format/lint、pnpm typecheck、git diff --check 通过。ESLint 对 .mts runner 没有配置，仅报告 ignored warning；其实际执行已包含在上述场景中。未运行完整门禁。


2026-09-08 正常定时 retention 告警根因及修复：runtime 的每日幂等身份原为 exportId/revision/day，但恢复仓储保存 deviceScopeHash 并拒绝其他范围；多个范围同日调度命中同一记录，持续抛 EVIDENCE_RECOVERY_SCOPE_UNPROVEN。新增 evidenceRetentionIdentity，shared 身份 v2 包含排序去重的 allowedDeviceIds、SDAR service、includeNonDevice；standalone 仍使用原始 identity/hash。runtime 调度采用该身份；不改旧恢复记录，不放宽仓储 authority。

验证：apps/server/test/evidence-retention-identity.unit.test.ts 1 项覆盖等价集合、不同设备/服务/非设备通道、配置/日期和旧 standalone hash。隔离 PG 复用 ce11aff1 两设备和现有配置，在相同配置/日期下用新调度 key 创建两条独立 apply_retention 测试恢复记录，各自重复 start 幂等；跨范围 resume 仍 EVIDENCE_RECOVERY_SCOPE_UNPROVEN。最后通过所属仓储 failRecoveryRun(FIXTURE_FINISHED) 关闭这两条测试记录。没有执行 retention action 或删除数据，没有重跑 Server/模型/MCP。原范围保护和历史记录保留。

本次证据证明调度身份碰撞修复与仓储交接；最终正常 Server 回归还需确认周期告警消失。知识/经验启动 MODEL_INVOCATION_FAILED 尚需区分历史 fixture 路由与实际业务装配问题，canonical backlog 和原上游 link 合同阻塞仍开放。

本批定向格式化、ESLint、pnpm typecheck、git diff --check 通过。未执行全仓门禁。


2026-09-08 临时 Skill 原生归属批次：PostgresTemporarySkillRepository 及正常 runtime 接入 DeviceWorkScope；创建在事务中锁定真实 Task/Context/范围并写 device_id，find/list/experience 查询沿 Task 范围，显式 expireAndSaveExperience 核对 Skill/Task/Context 与经验身份并写原生 device。共享 formalization 定义仍保留既有全局语义。

隔离真库 verifyGowmTemporarySkillScope 运行 77a39e98：双设备创建/读取正反例通过（越界 create/find/list 拒绝），但 Task 自带终态触发器未填 experience.device_id，两个设备均 TASK_PROVENANCE_DEVICE_MISMATCH；回读 Task queued、Skill active、experience null，事务整体回滚。报告状态 INCOMPLETE，不把预期失败当成功。实际 pg_get_functiondef 确认缺列，新增 docs/gowm-shared-storage/UPSTREAM_STORAGE_GAP.md 给出触发器、参数、复现及缺少能力；不改 GOWM，不提前失效 Skill 以绕过原生终态事务。原任务完整关闭继续受此合同缺口约束。

本批定向 ESLint、pnpm typecheck、格式化和 git diff --check 通过；早期 lint 的多余 optional chain 已修正。未因单一原生触发器冲突重复运行全部终态排列或全仓门禁。


2026-09-08 交付清单核对：重新核对 MASTER、D07、D12/D13 与正常 runtime 构造入口。新增规定的 worker-scope-inventory.json，列出 15 组实际路径及 source/claim/expiry/recovery/test，明确 PARTIAL/OPEN/上游阻塞；不是完整盘点或验收证明。Evidence quality authority source 仍无范围装配，Artifact 可选 Task 路径及队列/缓存/共享服务协调未全面证明。RuntimeConfigurationStore/RuntimeModelControl 的构造当前只出现在集成测试，正常 Server 未装配；记为开放，不借此扩大本轮到不可达路径改造。

补齐 package.json 要求的 test:gowm-storage:runtime，复用现有 runner；增加 --help 无环境退出入口。pnpm test:gowm-storage:runtime --help 实际 exit 0，只打印用法，无数据库/模型/工具调用。package/runner 格式与 git diff --check 通过；仅入口和文档变化，不重跑业务测试。README 汇总已存在正常 2.0 证据，纠正早期文字时效，并链接上游缺口。

最终开发聚合回归、FINAL_REPORT/acceptance-results、单仓 commit/push/Draft PR 尚未执行；当前不满足 DEV_READY，完整 Goal 继续开放。


2026-09-08 Evidence quality 正常范围装配：PostgresEvidenceQualityAuthoritySource 接收 DeviceWorkScope，正常 Server 传入；SQL 最终 finding 通过真实 Task/episode/record 谓词过滤，含外设备记录的 export batch finding 整体排除，防止以 NULL episode 全局诊断路径漏出混合设备批次。原质量规则、窗口计算和断言保持；standalone 使用原查询。该修改限定返回候选，不声称数据库执行器完全不扫描外范围行，也不新增服务级协调器。

verifyGowmQualitySource 复用隔离 16b4638e 双 Task，在实际 projection issue 写入两条 payload_hash_conflict 诊断：无范围 source 都能读，单设备 source 只返回本设备；十类实际 SQL 查询执行通过，其他返回结果无已知外设备 episode。新增两条诊断最终 resolve，未执行模型/MCP/Workflow/清理。首次夹具缺 severity 被 NOT NULL 拒绝，补齐字段后同一场景通过；未放宽约束。混合 export batch 专门正反例及共享服务协调仍需原整体范围审查，不以本次候选子集关闭全部质量规则。

复现入口为 packages/runtime-control-persistence-postgres/test/gowm-quality-source.postgres-cases.ts 的 verifyGowmQualitySource(pool,[run+'-task-0',run+'-task-1'])，使用现有 test.env + gowmSharedPoolConfiguration。源码定向 ESLint/typecheck 通过；新增 fixture 定向格式/lint 通过，未为 fixture 字段修正再次全仓 typecheck。后台清单更新为部分验证。

## 上一版收敛方案（历史存档，已由顶部替代）

## 当前实施方案：收敛剩余工作（2026-09-08）

本节是当前执行顺序和状态索引，优先于下方历史 P0–P7 排期。历史记录、失败证据和原需求全部保留；未验证项不因调整排期而关闭。此次调整只更新计划，不表示新增代码通过测试。当前目标为可审查的 SDAR 共享存储开发交付，不宣称整个 Runtime 或原任务包全部完成。

### 当前事实与剩余清单

| 工作项 | 当前状态 | 下一步及边界 |
| --- | --- | --- |
| 正常 Server、正式 Skill/DSL/LangGraph、双设备原生持久化 | 已实现，有正常链记录 | 复用已有链，在最终回归统一执行；不逐补丁重跑 |
| Remote 等待恢复、冻结 Schema、延迟 canonical、Point 目标 | 已实现，有分项正常链记录 | 补下述高风险差异，不重新证明所有排列 |
| Goal 效果/进度、Skill call 关联、普通子调用暂停恢复 | 已实现，有定向回归；普通子调用有实际 LangGraph 记录 | Skill 实际子执行仍缺集成证据；不将关联仓储测试称为完整执行 |
| Evidence infrastructure source/projector | 当前工作树已有修改，尚未收尾和验证 | 必须先完成来源/reference 范围以及身份兼容检查 |
| 后台消费者、共享制品和删除路径 | 已修复多批，但盘点未闭合 | 做一次正常装配入口清单；仅修复可达的越界处理/数据破坏缺陷 |
| Business Event 正常入口到持久影响 | 单元/仓储证据存在，正常链仍缺 | 补一个代表性正常入口链 |
| 非 Point 目标、目标修订回滚 | 已核对现有单元/PG 断言和通过报告覆盖 Polygon/LineString、修订回滚 | 本轮不新增同类测试；冻结源码回归复用现有 driver，不宣称非 Point 正常 Server 全链 |
| Remote 取消、重复/过期回调、进程丢失组合 | 分层修复和证据存在，当前集成覆盖不齐 | 选共享身份传播与不重复调用的关键差异；不做全排列 |
| 辅助 Provider link 跨设备同 handle | 上游唯一约束缺口已复现，INCOMPLETE | 保留最小复现和影响说明；不改上游 DDL、不重复重试 |
| 最终回归、文档归并、提交/push/Draft PR、资源清理 | 未完成 | 最后统一处理；不自动 merge/tag/release |

证据定位：正常双设备 `execution-gowm-runtime-ce11aff1-9f1d-47a6-abc5-7fbd44199a06.json` 为 PASS、toolCalls=2、cleanupErrors=[]；它早于当前投影修改，不能作为冻结源码最终证明。普通子调用见 `gowm-child-b3757099-1913-48ae-8938-816113942fe3.json`。上游缺口见 `auxiliary-link-contract-gap.json`。以上均位于 `reports/sdar-gowm-shared-storage-integration-v0.1/`，模拟证据不代表实车或真实模型泛化。

### 阶段一：收尾在途修改，一次确认剩余缺陷

1. 完成 `evidence-infrastructure-source.ts`、`evidence-infrastructure-projector.ts`、`gowm-evidence-scope.ts` 与正常 Server 装配。核对来源过滤发生在 LIMIT 前、直接加载与引用均有范围检查；新增 Task 归属不能在旧 record identity 下改变历史 hash，checkpoint 不能跳过需要的新投影。采用追加兼容处理，不重写旧记录。
2. 复用现有双设备 issue/manifest/checkpoint，集中做一个 source 仓储回归和一个 projector 身份/幂等回归。不要为每个 SQL 分支新建独立环境或报告。
3. 仅沿 `startServerRuntime` 实际装配的后台消费者、共享制品和删除入口做一次清单，复用现有矩阵。分类为已覆盖、明确缺陷、未证明；不把全库每一张表都变成独立修复项目。
4. 将实际发现的可达越界读写、重复执行、历史破坏列为有限修复清单并集中处理。未知项保持开放；不以未知项不断递归扩展审计。

完成条件：在途改动有最小行为回归；相关静态检查集中通过；得到明确、有限的剩余缺陷列表。无需完整门禁，不宣布里程碑验收完成。

### 阶段二：只补关键行为缺口

按依赖顺序复用现有 driver/fixtures，先检查已有断言再补充：

1. **Skill 子调用**：实际执行一个子实例，验证父 Task/设备传递、结果回到父节点以及重入不重复执行。普通 subworkflow 已有暂停/恢复证明，不另做同构全链。
2. **Remote 恢复边界**：通过正常入口覆盖取消与重复/过期回调；进程丢失通过持久恢复入口证明不自动重放运行中 Task、不重复派发工具。已有仓储正反例不逐项重跑正常模型链。
3. **Business Event**：一个事件从正常接收入口到订阅/影响持久化，验证所属设备且不改变另一设备；复用本地协议桩。
4. **目标**：补缺失的 LineString/Polygon 解析与修订失败回滚断言；纯解析用单元测试、事务用现有 PostgreSQL，不为每种几何重新执行完整 Skill/模型链。
5. 阶段一发现的实际高风险缺陷，按缺陷增加最小回归。与本批无关的新增功能进入延期清单。

完成条件：上述关键差异均有明确通过/失败/阻塞结论；失败集中修复。不能用最小集成集合宣称原任务包全部场景完成。

### 阶段三：一次开发收口和交付

1. 稳定后冻结源码，运行一次原计划指定开发检查：修改文件 format、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm verify:architecture`、`pnpm verify:protocol`、`pnpm verify:migrations`，以及已有 GOWM check/verify、PostgreSQL driver 和正常 runtime smoke。`pnpm test` 已包含 unit/contract，不再另跑同一完整集合。离线清单若随源码改变，只生成必要的既有产物，不扩建证据平台。
2. 默认复用隔离依赖、PostgreSQL/Redis 与本地 Model/MCP；最终正常链统一核对调用次数、设备归属、持久终态及关闭资源。此前单次 cleanupErrors=[] 不代表当前所有测试资源已清理。
3. 若失败，只修复相关缺陷并跑相关回归；再次稳定后才重跑受源码变化影响的最终检查。不得在未修复失败时启动另一轮全门禁。
4. 在本计划和现有状态/追踪矩阵中集中更新一次结论；保留旧失败，不新增逐小步 progress JSON。最终报告区分已验证、仅实现、延期、上游阻塞。
5. 审查 git diff 和未跟踪文件，排除秘密、运行状态和不属于本次交付的旧调试产物；单仓提交、push、Draft PR。清理本任务拥有的隔离资源；不影响用户实例。若上游合同阻塞仍在，Draft PR 明确 INCOMPLETE，不标记 SOURCE_READY/INTEGRATION_DEV_READY。

### 明确延期与停止事项

- 全量 Schema/worker/retention 逐表证明、共享定义/无来源诊断的全面分类、所有 Remote×子调用×事件排列：保留原要求为开放；本轮只处理实际正常入口及关键风险，原任务包因此仍不能宣布全部完成。
- F06/F07 演化候选完整验证与发布、完整 Console 编辑器、发布级全部 AC、独立 frozen install、真实模型泛化/设备验证：沿用既有延期，不搭载到共享存储收尾。
- 不新建测试框架、证据平台或重复计划；不重装未变依赖、重建已有可用库；不因文档修改跑业务测试。
- 不重复复现已确认的上游唯一键缺口，不修改 GOWM/SMPP、不增加 shadow storage，不把拒绝作为支持该能力的通过证据。
- 正常联调前先解决本地确定性错误；模型请求不用于反复诊断可由类型、SQL或本地协议桩直接证明的问题。

### 执行预算与停止规则

按行为批次汇报，不按测试数量汇报。每批只记录解决的阻塞、必要命令结果和下一步。某个夹具连续两次失败时先检查夹具前置条件，停止扩大测试；环境无法提供必要证据则记录阻塞并继续独立工作，不能据此标为通过。新增缺陷只有直接影响当前闭环、设备隔离、恢复幂等或历史完整性才进入本轮。

- [x] 2026-09-08 完成现有工作树/状态/代表报告核对，重新整理计划；本次未运行代码测试。
- [ ] 阶段一：在途 Evidence 修改收尾、有限缺陷清单及相关回归。
- [ ] 阶段二：补关键行为缺口，记录原要求仍开放的范围。
- [ ] 阶段三：冻结源码开发检查、资源清理及单仓 Draft PR 交付。



2026-09-08 R1 Artifact：上次会话句柄均已失效，隔离库无执行记录，未据此推断通过。重新执行暴露夹具 ENOENT（错误 packages/schemas 路径）；改为相对 import.meta.url 的现有 golden fixture 后，verifyGowmArtifactExecutionScope 在既有 ce11 双设备 Task 上通过 start 原生 device_id、越界 start/complete/feedback 拒绝及所属完成/反馈写入。仅证明仓储和事务入口，不证明 Artifact 全生命周期。

2026-09-08 R1 静态补充：Artifact 源码定向 eslint 无报错；新夹具首次 eslint 报 inferred any，补充正式 ArtifactExecutionStart 类型后，定向 eslint 与 prettier --check 均退出 0。类型注解不改变运行行为，未重复运行已通过的 PG 场景；完整 typecheck/lint 仍留待集中检查。


2026-09-08 R2 父 Task 取消：复用现有 runtime driver 新增 --parent-cancel，经官方 A2A 客户端每设备重复取消两次。报告 execution-gowm-runtime-cf538662-4ffe-4cd5-828f-3c49d587046b.json 为 PASS：两个 Task 和对应 Workflow instance 均 canceled 且 device_id 正确，工具总调用 2，本地模型夹具失败 0，cleanupErrors=[]。此证据不宣称 Provider 已终止、物理进程重启或迟到回调全部完成；启动仍有已有模型路由 MODEL_INVOCATION_FAILED 告警。进程丢失现有 gowm-recovery.postgres-cases.ts 已证明持久恢复范围、重复调用无新增状态，真实进程重启组合仍开放。


2026-09-08 集中开发检查：全仓 pnpm lint 退出 0；pnpm verify:architecture 首次拒绝两处测试内部 compiler 引用，改用模块既有公开导出（无规则放宽）后退出 0；pnpm verify:protocol、pnpm build、pnpm gowm-storage:check 均退出 0（离线 87 文件）。pnpm verify:migrations 退出 1：脚本默认 docker pull 遭 spawnSync docker EPERM，清理尝试也失败，未创建已确认的迁移容器；本轮不追加默认 Docker 环境，不计为通过。完整 pnpm test 已以 SDAR_VERIFY_ISOLATED=true 启动，尚待结果；不要重复启动。


2026-09-08 集中回归结束：SDAR_VERIFY_ISOLATED=true pnpm test 退出 0，351 文件/3064 项全通过，124.36 秒；本批 136 个修改代码文件 prettier --check 通过。完整日志保存 development-checks/，不重复启动已通过集合。迁移检查仍失败；验收索引保留全部 45 项及开放状态，最终交付尚未完成。


2026-09-08 开发交付整理：最终 PG driver 26 组通过（616862f8）；正常 Remote 代表链 d6f0a68a 通过，两次工具、2.0 continuation 完成、canonical 延迟补齐无重发，cleanupErrors=[]。FINAL_REPORT.md/json、postgres-results、runtime-smoke-results、optional-smpp-interop 和 45 项 acceptance-results 已保存，整体 INCOMPLETE。两个本任务隔离容器及匿名 PG 卷已清理并回查为空；用户实例未动。准备单仓提交与 Draft PR；原 Goal 的未完成范围保持开放。


2026-09-08 交付状态：实现提交 83286afe607a59d9d05e06cd589d549d6549a122 已推送指定分支，HEAD 与本地 origin 跟踪引用一致。Draft PR 创建被自动审批两次拒绝；核实目标仓库与任务包一致、当前账号 ADMIN 后仍被拒绝，要求用户明确授权公开正文。已询问用户，等待答复；未改写正文绕过拒绝。此次仅归并本地交付状态，不新增测试、部署或外部发布。
