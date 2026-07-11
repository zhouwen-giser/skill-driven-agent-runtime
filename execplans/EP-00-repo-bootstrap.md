# EP-00 仓库初始化与兼容性基线

## Purpose / Outcome

形成可构建的 monorepo、Docker 基础设施、CI 门禁、开源版本锁定与三份可执行 Spike 报告。

## Requirements Covered

基础设施与所有阶段前置条件

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [x] pnpm workspace、strict TS、lint/format/test/build 脚本
- [x] PostgreSQL+pgvector+Redis docker compose
- [x] A2A 1.0 SDK compatibility report and contract fixture
- [x] MCP Streamable HTTP client/server spike
- [x] LangGraph dynamic compiler spike
- [x] third_party pins, SBOM baseline and license report

## Progress

- [x] 2026-07-11 17:14 +08:00 读取 `AGENTS.md`、`PLANS.md`、项目状态、原始 SRS（226 个段落、38 张表）、需求基线、架构/复用/测试/DoD/追踪材料，并记录当前代码状态。
- [x] 2026-07-11 17:14 +08:00 将具体产物、依赖 intake、Spike 和验证步骤补充到本计划。
- [x] 2026-07-11 17:31 +08:00 完成直接依赖与参考项目 OSS Intake，锁定精确 npm 版本/commit/integrity，并消除 `sources.lock.yaml` 全部 `UNPINNED`。
- [x] 2026-07-11 17:28 +08:00 建立 pnpm workspace、strict TypeScript 和格式/lint/test/build 统一 bootstrap 门禁。
- [x] 2026-07-11 18:43 +08:00 建立并真实验证 PostgreSQL+pgvector、Redis Docker Compose 基础设施；Mock MCP 由真实 loopback 官方 SDK Spike 提供，Mock Model 属于 EP-03。
- [x] 2026-07-11 17:28 +08:00 完成 A2A wire fixture、真实 loopback MCP Streamable HTTP、LangGraph StateGraph 三项初始可执行 Spike（10/10 tests）和分类报告；A2A endpoint/TCK 与 MCP cancellation 仍在本 EP 后续扩展。
- [x] 2026-07-11 17:44 +08:00 扩展 A2A 为官方 SDK 真实 loopback REST/streaming endpoint，补协议版本拒绝；MCP 补远端 AbortSignal 取消验证。三项 Spike 共纳入 14 个测试。
- [x] 2026-07-11 17:44 +08:00 生成 CycloneDX SBOM、266 npm 包许可证报告、2 个外部服务清单和 `THIRD_PARTY_NOTICES.md`，并加入 freshness gate。
- [x] 2026-07-11 18:43 +08:00 完成实现增量。
- [x] 2026-07-11 18:44 +08:00 完成测试与验证。
- [x] 2026-07-11 18:44 +08:00 更新 Traceability Matrix、PROJECT_STATUS、ADR、CHANGELOG 和 Outcomes。

## Discoveries and Surprises

- 2026-07-11：仓库当前只有需求、架构、Schema、示例、ADR 和 ExecPlan 材料；不存在 `package.json`、应用源码或可执行测试门禁。
- 2026-07-11：当前目录没有 Git 元数据，`git status` 返回“not a git repository”。因此可以保持文件级可构建状态，但在 Git 仓库恢复/初始化前无法形成 Conventional Commit 证据。
- 2026-07-11：npm 官方页面显示 `@a2a-js/sdk` 稳定版 `0.3.14` 仅实现协议 v0.3；A2A v1.0 支持仍通过 `@next` beta 和 `epic/1.0_breaking_changes` 分支提供。需求锁定的是协议 1.0.1，因此必须以协议契约 fixture 验证 beta SDK，不能把安装成功等同于兼容。
- 2026-07-11：官方包页面显示候选版本 `@langchain/langgraph@1.4.7`（MIT）和 `@modelcontextprotocol/sdk@1.29.0`（MIT）；最终锁定前仍需核对对应 tag/commit 的 LICENSE/NOTICE 与 Node 兼容性。
- 2026-07-11：`pnpm peers check` 拒绝最初的 `@langchain/core@1.0.6` 与 `zod@4.1.12`，因为 LangGraph 1.4.7 分别要求 `^1.1.48` 与 `^3.25.32 || ^4.2.0`；已修正为精确版本 1.2.2 与 4.4.3，peer gate 通过。
- 2026-07-11：A2A beta 的 protobuf-ts 生成对象只提供 `fromJSON/toJSON`，没有稳定版示例常见的 `create`；Adapter 必须消化该差异。
- 2026-07-11：A2A、MCP 和 LangChain 的发布声明在 `exactOptionalPropertyTypes` 下存在第三方声明内部不一致。保持本项目 `strict: true` 与全部自有严格选项，对外部 `.d.ts` 使用 `skipLibCheck: true`；SDK 数据仍只在 Adapter 边界进入并由契约测试约束。
- 2026-07-11：`pnpm verify:bootstrap` 通过；3 个测试文件共 10 个测试通过。当前证据分类为 MCP loopback 与 LangGraph 真实验证、A2A wire fixture 模拟验证、PostgreSQL/Redis 未验证。
- 2026-07-11：A2A beta 的 REST/streaming server 和官方 ClientFactory 已在真实 loopback HTTP 上通过；A2A 证据升级为真实本地 endpoint 验证，但完整 1.0.1 TCK 和断流重连仍未验证。
- 2026-07-11：Docker CLI/Compose 可用但 daemon 未运行；尝试启动 `com.docker.service` 被主机权限拒绝。Compose、镜像 manifest digest、pgvector migration 和 healthcheck 已静态验证，真实 PostgreSQL/Redis smoke 保持未验证。
- 2026-07-11：客户端关闭 A2A 流后，SDK server 的任务继续执行，独立 `getTask` 轮询最终得到 completed；LangGraph 并行分支汇聚后执行 compiled subgraph 也已真实验证。统一门禁增至 16/16 tests。
- 2026-07-11：官方 A2A TCK commit `5996b79f9cefa6fc390980e383e358a66fb9e49e` 提供 `uv.lock`，但 LICENSE/README 为 Apache-2.0、pyproject metadata 为 MIT。已 conditional intake，计划在 EP-01 SUT 生命周期完备后以临时 checkout 运行。
- 2026-07-11：新增并实际执行 `pnpm smoke:infra`。命令会验证 pgvector version、migration marker、vector distance 和 Redis write/read，但本次在拉取/检查镜像前被 Windows `docker_engine` named pipe `Access is denied` 阻止。解除阻塞只需让当前用户可访问运行中的 Docker engine 后重跑该命令。
- 2026-07-11：恢复后的环境提供 Docker Desktop 4.81.0 / Engine 29.6.1；未修改 smoke 断言即通过 pgvector 0.8.4、migration、vector distance 和 Redis write/read，原环境阻塞关闭。

## Decision Log

- 2026-07-11：EP-00 先完成直接依赖 intake 和可执行兼容性 Spike，再确定生产依赖版本；原因是 A2A SDK 稳定通道与需求协议版本不一致。
- 2026-07-11：不因仓库缺少 `.git` 而停止文件实现与测试，但把提交证据明确列为环境限制，且不擅自初始化新仓库。

## Implementation Steps

1. 为 LangGraph.js、A2A JS SDK、MCP TS SDK 以及新增工具链依赖填写 `templates/OSS_INTAKE_TEMPLATE.md`，记录 package、tag、commit、LICENSE、NOTICE、用途和禁止边界。
2. 创建根 `package.json`、`pnpm-workspace.yaml`、共享 TypeScript/ESLint/Prettier/Vitest 配置，以及 `apps/server`、`apps/console`、`packages/*` 的最小模块边界。
3. 创建 `compose.yaml`，固定 PostgreSQL+pgvector 和 Redis 镜像 digest/tag，添加健康检查、迁移入口与 Mock MCP/Model 服务。
4. 在 adapter 边界实现 A2A 1.0.1 fixture 映射 Spike，验证 Agent Card、消息、Task 状态、非流式和流式事件；报告 SDK 无法表达或与 1.0.1 不一致的字段。
5. 实现 MCP Streamable HTTP Mock server/client Spike，验证发现、原始 input schema 校验、调用、超时和尽力取消。
6. 实现 LangGraph StateGraph Spike，验证动态状态、条件、并行汇聚、受限循环、子图和事件；不得引入第二 Runtime。
7. 生成 lockfile、SBOM、license report、`THIRD_PARTY_NOTICES.md` 与 `reports/EP-00-repo-bootstrap/*`，更新 ADR、状态、CHANGELOG 和追踪证据。
8. 运行 `pnpm verify:bootstrap`，再以真实 PostgreSQL/Redis 执行 EP-00 smoke；逐项修复，不跳过失败。

## Validation

- [x] `pnpm install && pnpm verify:bootstrap`
- [x] `docker compose up -d postgres redis`（由 `pnpm smoke:infra` 执行并等待 health）
- [x] `A2A、MCP、LangGraph Spike tests pass`
- [x] `sources.lock.yaml 不存在 UNPINNED`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-00-repo-bootstrap/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

EP-00 完成了可构建 strict TypeScript workspace、精确依赖/源码 pins、A2A/MCP/LangGraph 兼容性 Spike、真实 PostgreSQL/pgvector/Redis 基础设施、SBOM/许可证基线与统一门禁。最终证据为 `pnpm verify:bootstrap` 16/16 tests 和 `pnpm smoke:infra` 真实容器通过。外部 A2A TCK 需要完整生命周期 SUT，归属 EP-01；BullMQ restart 归属 EP-04；Mock Model 归属 EP-03，不作为 EP-00 未完成项。
