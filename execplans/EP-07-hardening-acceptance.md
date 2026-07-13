# EP-07 加固、文档与完整验收

## Purpose / Outcome

全部 P0/NFR/AC 有证据，项目可一键启动、验证和发布。

## Requirements Covered

NFR-PERF-001, NFR-PERF-002, NFR-REL-001, NFR-REL-002, NFR-SEC-001, NFR-SEC-002, NFR-OBS-001, NFR-OBS-002, NFR-MNT-001, NFR-COMP-001, NFR-DATA-001, NFR-UX-001

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] performance/concurrency and timeout tests
- [ ] security and prompt-injection tests
- [ ] migration and disaster behavior tests
- [x] complete docs and troubleshooting
- [x] SBOM/notices/license scan
- [x] all AC reports and release evidence package

## Progress

- [x] Add `pnpm verify:migrations` to the full gate and pass isolated empty-database plus historical 0049-to-0053 upgrade checks, including the 0053 ledger and current model-stage constraint.

- [x] Add and execute `pnpm demo:local` plus `pnpm demo:acceptance`; the latter builds and runs all 41 E2E scenarios with PostgreSQL, Redis, Mock Model, Mock MCP, Server, Console bundle, and the documented example A2A Client.
- [x] Fix graceful Runtime shutdown to wait for tracked confirmed-Task background controls before closing MCP/PostgreSQL; the demo first reproduced the pool-after-end defect and now passes without unhandled rejection.
- [x] Replace the task-package README with product quickstart, verification, safety, endpoint, demo, architecture, and operations guidance.
- [x] Execute the previously pending real Redis single-attempt Worker assertion as part of the 2-file/36-test integration gate.

- [x] Run the recovered real gate: integration 2 files/36, E2E 1 file/40, infrastructure smoke, Server/Console-bundle smoke, and unified 54 files/242 all pass.
- [x] Promote NFR-PERF-002, NFR-OBS-001, and NFR-UX-001 with current PostgreSQL/Redis/E2E/browser evidence; all matrix rows are now verified.
- [x] Record ADR-072 for monotonic runtime migration application after the real repetition exposed a schema-regression risk.

- [x] Reconcile NFR-SEC-001 against its exact warning/checklist acceptance; 4 files/56 tests plus explicit firewall/no-public-route release checks verify it without inventing an OS namespace gate.

- [x] Reconcile NFR-OBS-002 against its exact no-hidden-reasoning acceptance; 6 files/63 Provider/A2A/management/Console tests directly verify the boundary without requiring Docker.

- [x] Reconcile NFR-DATA-001 against its exact no-automatic-delete/reserved-fields acceptance; historical migration/PostgreSQL/E2E and current 49-test posture evidence verify it without adding a non-baseline soak gate.

- [x] Reconcile NFR-MNT-001 against its requirement-specific interface-unit-test acceptance; 6 files/57 substitution tests and the 165-file architecture guard pass, so the requirement is verified independently of Docker.

- [x] Reconcile NFR-REL-001 with the completed EP-04 real queue/startup recovery evidence and mark it verified.
- [x] Add the missing NFR-REL-002 real-Redis Worker exception assertion for one processor call, one attempt, and retained failure.
- [x] Run unified `pnpm verify` with 54 files/240 tests and all static/build gates passing.
- [x] Reconcile NFR-REL-002 against its exact no-whole-Task-retry/no-duplicate-side-effect acceptance using historical real single-attempt Redis, startup failure, MCP no-replay, and exactly-one model-failure evidence.
- [x] Execute the new NFR-REL-002 Redis assertion in the recovered real integration gate.

- [x] 读取 SRS、Definition of Done、追踪矩阵、架构/领域基线并记录当前证据缺口。
- [x] 将 NFR-PERF-002 节点耗时持久化增量补充到计划、ADR 和验收报告。
- [x] 在唯一 LangGraph Runtime 计时并贯通领域事件、PostgreSQL、管理 Trace 和 Console 回放。
- [x] 完成目标单元/静态 Console 测试与统一 `pnpm verify`；PostgreSQL 集成命令无输出并在 64 秒后超时，仍未验证。
- [x] 更新 NFR-PERF-002 Traceability、PROJECT_STATUS、ADR、验收报告和 CHANGELOG。
- [x] 加固 NFR-OBS-002：两个 Provider Adapter 丢弃私有推理块，A2A 仅投影必要摘要，管理端保留 Prompt/净化原始响应/结构化决策审计。
- [x] 为 NFR-OBS-002 运行 48 个目标测试和统一 `pnpm verify`（53 文件/220 测试及全部静态/构建门禁）。
- [x] 为 NFR-DATA-001 暴露机器可读和 Console 可见的 indefinite/no-cleanup posture，并复用领域/数据库双重禁用自动清理约束。
- [x] 为 NFR-DATA-001 运行 48 个目标测试和统一 `pnpm verify`（54 文件/221 测试及全部静态/构建门禁）。
- [x] 为 NFR-PERF-001 固化 Worker 默认并发 10，并证明十个 context 并发、每个 context 的后继操作严格串行且状态不交叉。
- [x] 为 NFR-PERF-001 运行统一 `pnpm verify`（54 文件/222 测试）；隔离 Redis 集成无输出并在 49 秒后超时，保持未验证。
- [x] 为 NFR-SEC-001 增加非 loopback 默认拒绝、显式可信网络确认、README/安全文档/发布清单隔离检查和 50 个目标测试。
- [x] 为 NFR-SEC-001 运行统一 `pnpm verify`（54 文件/224 测试及全部静态/构建门禁）。
- [x] 为 NFR-SEC-002 统一 MCP/Model 环境主密钥 Cipher 注入，并用生产 Cipher 定义数据库无明文/可认证解密集成断言。
- [x] 为 NFR-SEC-002 运行统一 `pnpm verify`（54 文件/224 测试及全部静态/构建门禁）。

- [x] NFR-OBS-001 audit closed the indirect-only Plan-confirmation and Goal-Patch links with migration 0052, persisted Task/time correlation, 65 targeted tests, and a classified acceptance report.
- [x] NFR-OBS-001 unified `pnpm verify` passed with 54 files/225 tests and all static/build gates; bounded probes still found PostgreSQL and Redis unreachable, so real persistence/E2E stays unverified.

- [x] NFR-MNT-001 audit mapped all five required replaceable boundaries and expanded the architecture guard to the Server composition root and dependency manifest; 164 source files pass.
- [x] NFR-MNT-001 unified `pnpm verify` passed after guard expansion with 54 files/225 tests and all static/build gates.

- [x] NFR-COMP-001 now pins the A2A v1.0.1 specification, official JavaScript SDK beta, and official TCK commits in a machine-readable baseline and unified verification gate.
- [x] Production HTTP contracts cover `application/a2a+json` and legacy `application/json`; the official HTTP+JSON/MUST TCK passes 74 tests with 0 failures/errors and 161 explicit scope skips.
- [x] NFR-COMP-001 unified `pnpm verify` passed with 54 files/227 tests and every static/build gate.
- [x] NFR-SEC-002 reconciled against historical real PostgreSQL/same-process MCP and Model credential flows plus the current 5-file/50-test AES-GCM, environment-key, and disclosure-boundary regression.
- [x] NFR-PERF-001 reconciled against historical real BullMQ Worker serialization and the current deterministic ten-context, twenty-result no-crossover concurrency test.

## Discoveries and Surprises

- The HTML smoke alone missed that Vite emitted root `/assets/...` URLs while Express mounted Console under `/console/`; fetching the emitted bundle is now a required smoke assertion.
- Current real gates exposed three stale integration fixtures and one Zod-stripped E2E projection; fixing the fixtures to satisfy production constraints and retaining the asserted response field restored evidence without weakening behavior.

- The Server migration runner stopped at 0049 even though repository integration setup included 0050–0052. The infrastructure static gate now compares every migration file to the runtime startup list and requires a rollback pair.

- The prior guard correctly isolated package imports but did not scan the production Server composition root or fail on a newly declared second workflow-runtime dependency.

- The original SRS mixes A2A 1.0.0 and 1.0.1. The normalized baseline's stricter 1.0.1 target is defensible because patch versions still negotiate as wire `1.0`; the pinned TCK embeds 1.0.0, so direct media-type contracts are required to close the patch-specific gap.

- Plan confirmation previously persisted only a mutable status, and Goal Patch used a triggering Task only inside its transaction. Neither was sufficient for historical Task-rooted correlation after later revisions.

- Model/MCP 已拥有显式耗时，Workflow 节点只有开始/终止时间戳；仅在前端推算无法满足 PostgreSQL 权威和可复现证据要求。
- Anthropic 扩展思考响应可在 displayable text 前包含 thinking/signature block；原严格数组 Schema 会拒绝整个响应。现在允许未知内容块进入 Adapter 局部解析，但仅验证后的 text block 能跨越 Adapter 边界。
- 现有唯一服务端定时器是 Task 等待超时 sweep，不执行历史清理；保留天数字段是规划元数据，不能触发归档或删除。
- Worker 并发限制和 context 串行是两个独立约束：前者限制全局活动 Job，后者在并发槽内阻止同 context 应用处理重叠。
- 默认 localhost 不足以防止运维误配；非 loopback 配置必须在启动前显式确认，但该确认绝不冒充认证或放宽“禁止公网”基线。
- 模型与 MCP 原先各自从同一字符串构造 Cipher；统一为 composition-owned 实例可清晰证明主密钥只来自环境且两个领域服务执行相同加密策略。

## Decision Log

- ADR-072 defines monotonic startup migration application for legacy ledgers; explicit rollback remains separate from startup.

- ADR-067 规定节点耗时由唯一 LangGraph 编译器测量、领域事件拥有、PostgreSQL 持久化，Console 不自行推算。
- ADR-027 的私有推理边界扩展到 Provider content block：管理审计保留可展示原始响应而不保留 vendor thinking/signature。
- ADR-059 的禁止自动清理决策扩展为明确的全历史数据运行姿态，通过 health 和 Console 暴露；显式管理生命周期操作不等同于后台保留清理。
- ADR-005 明确 BullMQ 默认并发 10 与进程内 `context_id` 串行器的组合；串行器不拥有任务状态。
- ADR-012 增加监听地址 fail-closed 规则；可信网卡仍需显式风险确认和发布清单网络隔离证据。
- ADR-011/018 明确 MCP 与 Model 共用 composition-owned AES-256-GCM Cipher，数据库与管理边界均不持有明文。

- ADR-066 now requires persisted Plan confirmation Task/time and Goal Patch triggering Task identity; legacy rows keep explicit unknown optional values rather than inferred links.

- ADR-068 makes the existing modular-monolith decisions executable: composition may instantiate infrastructure, but Domain/Application remain port-owned and only LangGraph.js may execute Workflows.

- ADR-069 fixes the normative A2A v1.0.1 commit, wire 1.0 semantics, exact official SDK beta/TCK commits, and honest HTTP+JSON-only evidence classification.

## Implementation Steps

1. 建立或更新本阶段接口和数据设计。
2. 先实现确定性核心和测试替身。
3. 完成真实 Adapter/Repository/Runtime。
4. 打通最短端到端链路。
5. 扩展边界、失败、取消和可观测性。
6. 完成管理接口/UI（适用时）。
7. 运行完整验证并修复全部失败。

## Validation

- [x] `pnpm verify` (full static/unit/contract/build/integration/e2e/infra-smoke/server-console-smoke gate; machine and Markdown reports generated)
- [x] `all traceability rows verified`
- [x] `all AC scenarios pass` (18-scenario machine/human audit; real composed E2E/integration/browser evidence with simulated model semantics classified)
- [ ] `clean install smoke`
- [ ] `release checklist signed by evidence`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-07-hardening-acceptance/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
