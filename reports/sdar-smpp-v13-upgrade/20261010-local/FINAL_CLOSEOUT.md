# SMPP v1.3 本地升级交付

四批 M1–M4 / W0–W5 本地实施和验证完成。AC-001–AC-050 中 48 个本地场景 PASS，现场 AC-045/046 未授权，保持 NOT_RUN。代码尚未提交；未 push、修改 PR、merge 或 deploy。

HEAD `52f54a11a40380f7c73bd9da277d640e49bdfbf7`，冻结完整输入 `8e908f0f4ed0a632d67dc7c1d9e364f95b3a20ae2d650bc1167c1c0b1da5e1d0`，基线 `f5e3e050d640c81a84d8b87f662f7fd933db900f22e6a7680909c3ff5a35f16e`。Node v22.23.2，真实隔离 PostgreSQL/Redis，模拟 MCP/Model，真实 Server/官方 A2A 客户端。源码与基线前后不变，清理退出 0。任务包 SHA `117312939268df2ac850766e27822e436c63126990cef8d6c5af062732ffefb5`；W0 工作树/PR34 审计见 [BASELINE_AUDIT.md](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/BASELINE_AUDIT.md)。

| 结论 | 状态 | 证据 |
|---|---|---|
| 本地代码实现、冻结合同 | PASS | CASE_RESULTS / M1–M4_VALIDATION |
| 受管读取、RequiredInput、运行中导航 | PASS_ISOLATED | 正式 Registry/Skill/Task E2E、13 项原生命令事务及并发恢复测试 |
| 完整内容和确认链 | PASS_ISOLATED | EVIDENCE_SAMPLES，原 Task A2A/管理 Source Artifact |
| GOWM owner 兼容隔离存储 | PASS_ISOLATED | [原始结果](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/sdar-smpp-gowm-a8ea1ec0-51a3-4d81-8713-f804b79513e4/result.json)，无消费者 DDL/私有写权限 |
| 现场选定 GOWM 资格、现场读/业务动作 | NOT_RUN | SITE_AUTHORIZATION，未获得目标/范围授权 |
| 部署和全项目发布验收 | NOT_RUN | ACCEPTANCE_AUDIT 的范围限制 |

## 实际变更

保留 PR34 的冻结客户端和 Registry 预检。原 RemoteTaskBinding 与冻结 authority 是唯一业务关联来源；原 inbox、双水位、continuity 和 Task/Skill 输入消费完整投影。读取和派发相互独立。

业务写入复用真实受管确认、原生输入 continuation 和不可变意图 journal。最终发送前再次检查原 Task、Goal、版本、取消与权限；一个持久 claim 只交给一个发送者。受理不等于应用；未知发送结果仅有限只读核对，不自动重发。重启恢复原 Task 和精确绑定。

保留完整轨迹和几何角色、原 CRS、重复/逆序点、Provider 接收时间与明确缺口。协议 completed 不能替代业务或 Skill 成功；同一发布 Skill 的两个实际业务视图产生不同输入/输出，失败视图被原生终态路径拒绝。修复原 continuation 的确定性拒绝重试和 Task/Binding 锁顺序问题，保留瞬时故障原恢复机制。

公开 API/Console 使用真实业务投影、审核命令和规范源 Artifact 读取。原 canonical evidence 目录兼容；完整 bytes、确认/消费/receipt/application 通过 hash/size/原生 Task 归属检索。仅原生输入约束添加 0184；GOWM 复用原 owner schema。

## 验证与逐项状态

`pnpm verify:isolated --frozen` 全部 30 阶段 PASS，包含 format、lint、typecheck、unit、contract、真库 integration、正式 E2E、构建、迁移、许可证/SBOM/架构、官方 A2A MUST TCK 和三个 smoke。每条命令、exit code、输出 hash、耗时见 [M4_VALIDATION.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/M4_VALIDATION.json)。

实际计数：unit 2,629（302 文件）；contract 552（63 文件）；真库 integration 270（44 文件）；E2E 77（76 主运行 + 1 独立性能运行）。E2E 的分组过滤由两个实际运行互补覆盖。官方 HTTP JSON/MUST TCK 为 74 passed、161 skipped、30 deselected；其未执行项没有记为 PASS。上游终端汇总表把 NOT TESTED 算入 Failed 列，原 JSON/JUnit 与具体范围见 [TCK_SCOPE_AND_COUNTS.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/TCK_SCOPE_AND_COUNTS.json)。

[CASE_RESULTS.md](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/CASE_RESULTS.md) / [CASE_RESULTS.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/CASE_RESULTS.json) 列出 50 个场景的真实文件、测试名、命令、SHA、环境和证据。[REQUIREMENT_RESULTS.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/REQUIREMENT_RESULTS.json) 关联 19 个局部需求；现场状态没有被改成 PASS。

`node scripts/sdar-smpp-v13/verify-gowm.mjs` 另外通过 owner 固定提交安装、受限角色正式导航/侦察及原生边界测试。2,807 个仓库文件与完整门禁逐字节一致；门禁还收录六份既有相邻仓库夹具，SHA 范围差异见 [SAME_SOURCE_ALIGNMENT.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/SAME_SOURCE_ALIGNMENT.json)。

原失败运行均保留于 [FAILED_ATTEMPTS.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/FAILED_ATTEMPTS.json)：包括早期完整门禁、正式 Task/CAS、输入 claim/ack、锁等待、负例终态、夹具和类型/lint 失败。后续 PASS 没有改写它们。

## 完整确认和轨迹证据

见 [EVIDENCE_SAMPLES.md](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/EVIDENCE_SAMPLES.md) / [EVIDENCE_SAMPLES.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/EVIDENCE_SAMPLES.json) 的本次冻结运行原始 JSON。包含完整 canonical envelope、raw bytes、Source ArtifactRefs、确认事实、已消费派发 claim、传输 receipt 和自己 command 的应用核对。逐点时钟和完整上游事件历史没有来源，继续保留 gap。

## 未完成与操作边界

本地 Provider/Model 为协议夹具，真实设备和真实模型服务未作为本次证据。现场 AC-045/046、现场 GOWM 资格及部署仍 NOT_RUN；用户未提供独立目标和范围授权。没有直接设备访问、独立锁定或发射调用。现有项目级 GOWM auxiliary-link / temporary-Skill 上游缺口保持原状态。

本次是本地升级交付，不是全项目发布或现场业务验收通过。[ACCEPTANCE_AUDIT.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/ACCEPTANCE_AUDIT.json) 保留原 SRS、DoD、追踪矩阵 SHA 和真实/模拟/未验证分类。

## 迁移、回滚与复现

见 [MIGRATION_AND_ROLLBACK.md](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/MIGRATION_AND_ROLLBACK.md)。未决 prepared/dispatching/accepted/uncertain 阻止旧版写接管；保留 remote inputs 阻止 0184 down。实际 PR34 读取器验证跨增量兼容；这不授予旧版处理新未决写命令的能力。

复现：`pnpm verify:isolated --frozen`；GOWM 独立隔离验证：`node scripts/sdar-smpp-v13/verify-gowm.mjs`。运行环境需既有 Node/pnpm/Python 与 Docker；专用 loopback 数据库/容器自动建立和清理，不读取现场 .env/.state。各阶段交接见 M1_HANDOFF–M4_HANDOFF。

## 后续提交、推送与合并授权

上述未提交/未推送状态是本地收口时的历史结论。2026-10-11 用户随后明确授权提交、推送和合并；最新操作状态、精确提交与合并身份见 [publication-20261011/status.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/publication-20261011/status.json)。现场和部署仍 NOT_RUN。
