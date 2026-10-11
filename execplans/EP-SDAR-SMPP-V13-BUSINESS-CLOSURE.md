# EP-SDAR-SMPP-V13-BUSINESS-CLOSURE

状态：`LOCAL_COMPLETE`（2026-10-11 04:48 Asia/Shanghai）。现场与发布为 `NOT_RUN`。规格版本：1.0.0。编制日期：2026-10-10。目标仓库：`zhouwen-giser/skill-driven-agent-runtime`。本文件是新升级计划，不把历史 PR 的 CI 结果作为本计划实施完成证据。

## 1. Purpose / Outcome

用户可通过正式 SDAR Task/Skill 入口读取完整任务业务状态，在原任务内回答有效的非发射观察请求、调整导航计划，并看到已受理/已应用/业务结果及证据质量的差异。实际轨迹与完整确认链能够从既有输出途径检索。重启后仍能找到同一远端任务并核对未决命令，不重复派发。

本轮只升级 SDAR 消费方。沿用 development/live；Provider ID 为 isr.vehicle.ugv.ugv，resource 为 vehicle:ugv，GOWM device 为 ugv:ugv。发射持续禁用，不新增独立锁定或接管 Provider 内部动作。

## 2. Requirements Covered

范围为 [追踪矩阵](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/acceptance/TRACEABILITY.md) 的 UPG-V13-R01–R19，映射 [AC-001–AC-050](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/acceptance/CASE_MATRIX.md)。W0 将这些局部编号挂接到仓库正式需求与 accepted ADR；发生冲突时记录决策，不静默修改基线。

覆盖 W0 合同治理、W1 精确绑定、W2 同步与投影、W3 受管写入、W4 结果与证据、W5 恢复与交付。排除 PMS-api/pms-web、设备端、SDK、第二运行时/数据库、未部署新 AutoLock 与全面重构。

## 3. Context and Orientation

已观测 main 为 f94d0b98d140dd22514029ccdc34978209426940；PR34 head 为 52f54a11a40380f7c73bd9da277d640e49bdfbf7，读取时 Open/Draft，专项 workflow success。其适配器、Registry 读取和请求预检已存在，但并不证明正式业务写入与现场闭环。

兼容 SMPP 提交 0a4a7c36865d4c9920a4e65857c0903e9ef12533；Frozen MCP 2026-07-28、TaskBusiness 1.0-rc2、BusinessEvents 1.0。仓库部署记录不是本次现场重探测。版本与来源详见 [BASELINE.lock.json](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/BASELINE.lock.json)、[SOURCES](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/SOURCES.md)。

现有 `RemoteTaskInputService`、`BusinessEventSubscriptionService`、RemoteTaskBinding、governed-control、PG repositories 必须优先复用，入口与拟新增模块见 [CODE_MAP](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/CODE_MAP.md)。

## 4. Architecture and Interfaces

正式调用链：Task/Skill/Capability → 原 RemoteTaskBinding → McpRegistryService → FrozenV1McpClient/SmppTaskBusinessClient → SMPP。反馈链：原业务事件 inbox + Task polling → 完整 Context/精确 Artifact → 业务投影 → Skill/Agent 输入与结果。

读取只产生事实与候选；控制走真实授权、持久命令意图、最终发送边界、Runtime ack、精确业务确认。完整轨迹通过原 artifact 存储引用，模型只读摘要。Provider 接收时间作为源时间，设备时间和 SDAR 时间保留。

设计依据：[身份存储](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/contracts/01_IDENTITY_AND_STORAGE.md)、[事件投影](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/contracts/02_EVENTS_AND_PROJECTION.md)、[写入恢复](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/contracts/03_MUTATION_AND_RECOVERY.md)、[结果证据](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/contracts/04_RESULTS_TIME_AND_EVIDENCE.md)、[公开 wire](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/contracts/05_FROZEN_WIRE_BOUNDARY.md)。内部示意名称不强制新增等价模块，亦不修改外部协议。

## 5. Progress

- [x] 2026-10-10 形成详细任务规格、固定来源、25 个子任务与 50 个验收场景；这不是实现完成。
- [x] M1 / 批次一：W0 与现有 PR34 基础收口；2026-10-10 全部门禁 PASS，冻结输入 101c40af…，证据 M1_VALIDATION.json / sdar-verify-4367bcdc-e7e8-4bc9-ba98-dd1ea8e0cf4a。
- [x] M2 / 批次二：W1/W2 持久关联、同步投影与 Skill 消费；30 项完整门禁 PASS，冻结输入 14013bbf…，M2_VALIDATION.json。
- [x] M3 / 批次三：W3 两类受管写入、竞争和结果核对；30 项冻结门禁 PASS，输入 5d63724f…，M3_VALIDATION.json。
- [x] M4 / 批次四：W4/W5 完整证据、恢复迁移、隔离 E2E 与本地门禁；2026-10-11，30 项 frozen-install 门禁 PASS，输入 8e908f0f…，M4_VALIDATION.json。受限 GOWM 正式链与原生边界通过，2,807 个仓库文件逐字节一致。
- [ ] 独立 SITE：NOT_RUN，用户仅授权本地实现和隔离验证。
- [ ] 独立 SITE-WRITE：NOT_RUN，无单独现场目标与范围授权。

执行者为每个完成项添加真实时间、实现 SHA、命令与证据；不能只勾选而无材料。

## 6. Discoveries and Surprises

初始事实：已有 Input service 和双水位事件 inbox，可减少重复基础设施。现有 client 中同 Context revision 输出去重需要与事件/对象去重分开验证。Input 发送前的意图/授权事务必须沿完整调用链审查，不能凭一个方法片段判定缺失。实际 Provider 接收时间字段路径尚需 W0 确定。

发现表格式：日期｜源码/合同位置｜事实或冲突｜影响需求｜处理与证据。新增事实不得改写原失败历史。

## 7. Decision Log

| ID  | 初始决定                                                         | 后续更改要求                                 |
| --- | ---------------------------------------------------------------- | -------------------------------------------- |
| D01 | 接续现有适配，不另建 MCP 客户端/任务状态机                       | 更改须说明无法复用的证据及 ADR               |
| D02 | 兼容已部署 0a4a7c3，不追随未部署新功能                           | 新兼容版本需独立合同差异与授权               |
| D03 | sourceTime=Provider 接收时间，缺失不回填 now                     | 保留用户约定；字段来源必须核定               |
| D04 | 已准入状态恢复≠重新执行整个工作流                                | 现有 accepted ADR/基线优先，禁止扩大自动重试 |
| D05 | 两阶段事件事务：admit 和 project                                 | 不为图简单而合并水位语义                     |
| D06 | ack≠applied≠业务/物理成功                                        | 每层使用真实证据                             |
| D07 | 工作树本地实现和隔离验证可推进；现场、push/merge/deploy 独立授权 | 无授权项 NOT_RUN，其他工作继续               |
| D08 | GOWM 正式持久适配必须保持，禁止直写上游私有表                    | 权限/schema 缺口明确阻塞，不绕过             |

重大领域/存储/上位协议变更另写 ADR，不在本表一句话带过。

## 8. Implementation Steps

按 [W0](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/work-items/W0_CONTRACT_AND_GOVERNANCE.md) → [W1](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/work-items/W1_BUSINESS_BINDING.md) → [W2](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/work-items/W2_SYNC_AND_SKILL_PROJECTION.md) → [W3](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/work-items/W3_GOVERNED_MUTATION.md) → [W4](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/work-items/W4_RESULT_TRAJECTORY_EVIDENCE.md) → [W5](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/work-items/W5_RECOVERY_AND_DELIVERY.md) 执行。

W0–W2 可在代码理解后准备并行独立测试，但共享存储、authority 和运行接线应串行集成。每批形成可运行增量并写交接；不把全部后续实现塞入 PR34。缺外部权限只阻塞相关现场项，不阻塞可本地完成的验证。

## 9. Validation

[COMMANDS](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/acceptance/COMMANDS.md) 列出源仓库存在的命令。每次改动最小相关测试，每个正式里程碑按仓库当前要求运行完整 gate；任何减少门禁的安排必须来自已接受的仓库规则，而不是本包擅自授权。完整 gate 绑定同一源码身份，保留原失败、耗时、环境与清理记录。

全部 case 初始 NOT_RUN。正式入口隔离 E2E 必须覆盖两条业务路径；PG/GOWM/真实现场各自分开标注。核心断言为：不串 Task/Execution，不伪造完整性，不重复变更，原 authority 不漂移，正式 Skill 使用了业务事实。

## 10. Idempotence and Recovery

本地脚本只审计工作树、包结构与 hash，不连接现场。迁移增量且保留旧记录。事件重复只允许重复读取/幂等投影；控制命令通过持久 claim 防止重复发送。不确定发送后必须恢复原命令核对，不能换 ID 重发。

取消与控制在最终发送边界形成清晰先后；已经发送的请求无法由本地事务撤回。Lease 失效不是重新发送许可。回滚遇 pending/uncertain 命令时停止旧版写接管，先核对或保持受管只读，详见 [运维手册](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/operations/DEPLOYMENT_AND_ROLLBACK.md)。

## 11. Artifacts and Evidence

仓库报告建议根路径 `reports/sdar-smpp-v13-upgrade/<run-id>/`，保留 baseline、contract diff、source time field map、代码定位、各批 validation、完整轨迹样例、确认链、迁移回滚、失败记录和最终 closeout。路径是建议新增，不表示现有文件。

复制 [templates](../reports/sdar-smpp-v13-upgrade/20261010-local/taskpack/templates/STAGE_HANDOFF.md) 中对应模板；报告不得包含密钥、凭据或私密思维。更新 PROJECT_STATUS.md、CHANGELOG.md、docs/17_TRACEABILITY_MATRIX.md 及实际相关文档。

## 12. Outcomes and Retrospective

当前本地结果：四批代码/合同/受管读取/受管写入/隔离 E2E/owner GOWM 隔离兼容验证完成；48 个本地 AC PASS，现场 AC-045/046、现场选定 GOWM 资格与发布部署 NOT_RUN。逐项实现、精确测试、命令/哈希、失败历史和原始完整样例见 [FINAL_CLOSEOUT](../reports/sdar-smpp-v13-upgrade/20261010-local/FINAL_CLOSEOUT.md) 与 [CASE_RESULTS](../reports/sdar-smpp-v13-upgrade/20261010-local/CASE_RESULTS.json)。工作树未提交，不代表全项目发布 DoD 或现场业务验收完成。下文 execution updates 保留各阶段原始状态。

最终分别填写代码、合同、受管读取、受管写入、隔离 E2E、选定 GOWM、现场只读、现场业务、发布/部署状态。局部开发完成可以独立收口，但现场未经验证必须直说。总结已实现能力、仍缺的上游事实、对历史任务的影响与回滚条件，不把缺失必需能力写成“后续优化”。

## W0 execution update — 2026-10-10 Asia/Shanghai

Progress: baseline clean/main and current PR34 verified, all original commits preserved in local branch.
Exact public contract intake, source map, clock map and minimum architecture repair implemented.
Five-file focused regression PASS 107; first catalog suite FAIL 2/106 preserved and corrected.
AC-004 adds real PostgreSQL historical authority regression; formal Source successor is also covered by existing Node Control integration.
M1 is awaiting full isolated gate, not yet marked complete.

Discoveries: PR34 direct Ajv import conflicts with architecture import policy; fixed via original schema adapter.
An early architecture command overlapped the edit and is INVALIDATED, not accepted as a frozen check.
Pinned trajectory geometry lacks per-sample clocks/IDs and can be sampled; upstream time/history gap explicit.

Decisions: ADR-156; no schema changes or new dependencies. No site authorization inferred from linked chat.
Validation: baseline 102, fixed catalog plus original regressions 106, final diff plus contract suite 107 PASS.
Outcomes: report root reports/sdar-smpp-v13-upgrade/20261010-local; M1 full gate is next.

## W1/W2 execution update — 2026-10-10 Asia/Shanghai

Progress: native binding-derived Context/Artifact hydration, immutable object/content retention, bounded chunks,
native projection and original inbox composition implemented (ADR-157). Original lifecycle polling remains the owner.
ResultProcessingService now supplies bounded untrusted business facts to the real Skill result model stage.
M1 full frozen gate and M2 full gate are still pending; no formal milestone is marked complete.

Discoveries: first W1 PG run failed one fixture's reused native subscription identity (95/96 PASS);
distinct fixture identities repaired it without altering production constraints. Initial snapshots prove current state,
not event history; historyContinuous remains false when the beginning of the stream was never received.
Native processing leases need stale-token rejection and bounded retries; both now use original inbox columns.

Decisions: no new table, DDL, runtime dependency, per-Task event stream or control permission in projection.
Content is capped at 8 MiB per object/16 MiB per refresh, chunked within original observation JSON limits.
Unknown Providers retain their native Task lifecycle; failed refreshes retain diagnostics and remove control candidates.

Validation: real isolated PostgreSQL/Redis `w1-w2-postgres-repair-224755055629`: 96/96 PASS, cleanup 0;
`w1-w2-unit-repair-224122847450`: 110 PASS and same runtime input digest
03dcb112db1856b08048acbc7526d2f46717eeba10611e5fd372a8a072ba07ca (see result.json).
Typecheck PASS on that input; lint FAIL 10 preserved, repairs and latest small tests in progress.
New shutdown, same Context revision SSE, finite retry and model budget repairs await latest tests/full gate.

Outcomes: exact Execution CAS, full large-content integrity and checkpoint-hole/crash tests have PG evidence.
Formal Registry→Skill→Task business E2E, real governed writes, exported chain and rollback are still required in M3/M4.

## M1 full gate completion — 2026-10-10 23:00 Asia/Shanghai

`sdar-verify-4367bcdc-e7e8-4bc9-ba98-dd1ea8e0cf4a` passed all 30 stages on the unchanged M1 source snapshot.
Input 101c40afb75143ee390965e031e224b3f49ab8ed1333ab5daa568de1274d3eeb;
baseline 81e4d15a7401b2c62098abec2b5bd4cce91e81199e59e871643bcdbe0e668923;
source/baseline unchanged, cleanup 0, official A2A TCK and all three smokes passed.
Used bundled Python 3.12.14 after confirming system Python lacks ensurepip. No threshold, assertion or contract waived.
All four earlier failed full-gate runs remain in reports/runtime-semantic-closure; details in M1_VALIDATION.json.
M2 first full-gate run c9a29db1 failed new model-facts file formatting; corrected and retained, M2 still pending.

## W3 native command closure — 2026-10-11 Asia/Shanghai

Progress: explicit published Capability/Skill policy, original trusted human confirmation, native
command journal, immutable exact command identity, original RequiredInput continuation, running
navigation review and seven real management routes are implemented. Nine real PostgreSQL cases
PASS in w3-native-input-final-migration-002208972906. M3 full isolated gate is still required.

Discoveries: native confirmation dispatchHash requires the sha256 prefix (fixed, earlier failures
retained). Clean-slate native input source constraint omitted remote_task even though its original
repositories require it; appended 0184 restores that path without editing baseline SQL. The down
migration refuses to erase retained native requests. Object state changes require new revisions;
regressions preserve that immutable contract. W2 retries also exposed a shared Docker tag race;
the migration verifier now creates both containers from captured immutable IDs, with a real Docker
retag regression. Wrong-copy frozen-report failures and original product/environment failures remain.

Decisions: ADR-158/159. No site, push, merge or deployment. GOWM retains its existing workflow-source
projection and owner/device scope. Optional public deadlines use a bounded local review lifetime.
Validation: management HTTP/adapter/domain/application/React focused regressions and strict types;
native PG confirms acceptance versus own application, single consumption/sender, cancellation,
lost-ack finite reads, stale Input and guarded rollback. Full M3 gate is next.
Outcomes: formal Registry/Skill/Task positive E2Es, canonical full-content/confirmation-chain export
and actual two-process recovery remain required in M4.

## M2 gate completion and M3/M4 discoveries — 2026-10-11 Asia/Shanghai

M2 COMPLETE: sdar-verify-6d401db7-abc8-4cf4-be82-52a21bf1dfd0 passes all 30 stages, including
real PG/Redis, migrations, A2A TCK, E2E and three smokes. Input 14013bbf3b01099dbb0234b6d40edeced9f795aab36b5b847350610bdca09582;
source and baseline unchanged, cleanup 0. Immutable image identity repair is covered by a real
parallel-tag Docker regression; prior failures remain. M2_VALIDATION.json contains every command/log.

M3 remains IN_PROGRESS: prior full runs failed formatting, lint and the formal UGV initial-plan
binding path. Preparing a Task now binds the original Capability attempt before publishing its
plan; a held-bind regression proves this order. Structured binding diagnostics preserve original
invalid-state denial. Formal UGV focused rerun passes, but original intermittent failure remains
under the complete gate. The native command transaction now reads bindings through its current
client: an actual single-connection worker previously deadlocked while requesting another pool
connection. Two independent OS processes plus SIGKILL regression and all 13 PG command cases PASS
in w4-native-transaction-worker-repair-014412914819; this is a send-seam proof, not site wire proof.

M4 remains IN_PROGRESS. Skill mutation/evidence policy was dropped by the native registration/
read DTOs; explicit typed validation and round-trip preservation are being completed. Original
Task outputs now export canonical immutable references and a Task-scoped integrity-verified HTTP
read. Formal navigation and recon Input E2E fixtures are being verified; failures are retained.
No local parser test or isolated SQL fixture is substituted for this required formal chain.
All site actions remain NOT_RUN; no push, merge, deployment or linked-chat message occurred.

## M3 completion and M4 local closeout — 2026-10-11 04:48 Asia/Shanghai

Progress: M3 and M4 COMPLETE within the authorized local scope. M3 full run
`sdar-verify-ecbbb50e-29bc-472a-86fd-7bfc4fcb2610` and M4 frozen-install run
`sdar-verify-80dc2518-c4ae-47d4-b2ac-ac58d2d85506` each passed all 30 stages.
All four stage handoffs, 19 requirement results and 50 case results are written.
AC-045/046 remain NOT_RUN. No commit, remote PR mutation, push, merge or deployment.

Discoveries: formal end-to-end tests exposed native input continuation claims that
excluded awaiting_input/wait, frozen acknowledgment revisions that must survive
original SQL constraints, polling races around immutable Task admission, Task/Binding
lock inversion, and deterministic success-policy denials incorrectly entering
transient retry. Each repair has regression evidence. Two OS processes and SIGKILL
prove the native send claim; they do not prove device-side exactly-once delivery.
The first M4 full run `dcba6ca5` failed the old AC-006 exact projection assertion after
canonical source references were added. Its strict expected value now independently
constructs all four original references and verifies every source byte/digest; original
projection and restart equality assertions remain. The failed run was retained.
Shared-stream AC-014/015/016 also have real PostgreSQL plus loopback SSE evidence.
Report copying changes mtimes, so new final samples are selected by immutable
pre-run manifest absence and original projection timestamps inside the E2E stage.

Decisions: ADR-157–160 preserve immutable admission, original Task terminal
authority, no continuation/tool replay on known terminal denials, source-clock gaps,
full canonical bytes and separate accepted/applied/success states. 0184 only extends
the original native input source constraint; the original baseline SQL is unchanged.
GOWM uses owner-pinned schema and restricted consumer roles without consumer DDL
or private SMPP writes. Pending native commands block old-version write takeover;
retained remote inputs block 0184 down. No source, authority, schema or test threshold
was weakened to accept this result.

Validation: final runtime input
`8e908f0f4ed0a632d67dc7c1d9e364f95b3a20ae2d650bc1167c1c0b1da5e1d0`,
baseline `f5e3e050d640c81a84d8b87f662f7fd933db900f22e6a7680909c3ff5a35f16e`.
`pnpm verify:isolated --frozen` passes 30/30; 2,629 unit, 552 contract, 270 real
integration and 77 E2E tests, production build/migration and three smokes pass.
Source/baseline unchanged and cleanup exit 0. Main E2E and isolated performance
runs cover their filtered cases together. Official HTTP JSON/MUST TCK: 74 passed,
161 skipped, 30 deselected, zero executed failures; NOT TESTED remains unverified
(the upstream terminal table counts it in Failed). Original JSON/JUnit and exact
scope are preserved in TCK_SCOPE_AND_COUNTS.json.
`node scripts/sdar-smpp-v13/verify-gowm.mjs` run
`sdar-smpp-gowm-a8ea1ec0-51a3-4d81-8713-f804b79513e4` passes all eight steps
and resource cleanup. All 2,807 repository runtime/baseline files match the final
full gate; six existing sibling fixtures explain the differing overall hashes.
See M4_VALIDATION.json, SAME_SOURCE_ALIGNMENT.json and FAILED_ATTEMPTS.json.

Outcomes: exact original Task/Execution projections, bounded model facts, genuine
published Skill policies and confirmation consumption, single sender/finite read-only
reconciliation, original native input and running navigation are implemented. Both
formal paths restart the real runtime and export full canonical confirmation and
256-point trajectory source content. The same published navigation Skill rejects
a failed business outcome despite protocol completed. Actual PR34 reader/down-up
compatibility and GOWM restricted-role tests pass.
Per-sample source clocks and full upstream event history remain explicit gaps.
The existing auxiliary-link and temporary-Skill GOWM gaps are not closed.
Current Provider/Model evidence is simulated protocol services; site/real device/real
model and whole-project release are unverified. See FINAL_CLOSEOUT.md,
EVIDENCE_SAMPLES.md, REQUIREMENT_RESULTS.json, ACCEPTANCE_AUDIT.json,
MIGRATION_AND_ROLLBACK.md and M1_HANDOFF–M4_HANDOFF under the report root.

## Authorized publication — 2026-10-11 Asia/Shanghai

User requested commit, push and merge after the local closeout. Preserve all original
code, gate logs and failed attempts. PR34 and the separate upgrade PR use normal
merge rules without administrator bypass. Source and baseline still match all 2,807
files from the passed frozen gate; only publication status and evidence packaging
change. Site and deployment remain NOT_RUN. Progress, exact commit/remote/merge
identities and GitHub CI are tracked in
`reports/sdar-smpp-v13-upgrade/20261010-local/publication-20261011/`.
