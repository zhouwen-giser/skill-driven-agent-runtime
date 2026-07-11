# EP-00 仓库初始化与兼容性基线

## Purpose / Outcome

形成可构建的 monorepo、Docker 基础设施、CI 门禁、开源版本锁定与三份可执行 Spike 报告。

## Requirements Covered

基础设施与所有阶段前置条件

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] pnpm workspace、strict TS、lint/format/test/build 脚本
- [ ] PostgreSQL+pgvector+Redis docker compose
- [ ] A2A 1.0 SDK compatibility report and contract fixture
- [ ] MCP Streamable HTTP client/server spike
- [ ] LangGraph dynamic compiler spike
- [ ] third_party pins, SBOM baseline and license report

## Progress

- [x] 2026-07-11 17:14 +08:00 读取 `AGENTS.md`、`PLANS.md`、项目状态、原始 SRS（226 个段落、38 张表）、需求基线、架构/复用/测试/DoD/追踪材料，并记录当前代码状态。
- [x] 2026-07-11 17:14 +08:00 将具体产物、依赖 intake、Spike 和验证步骤补充到本计划。
- [ ] 完成直接依赖 OSS Intake，锁定精确 npm 版本、仓库 tag/commit、LICENSE 与 NOTICE 证据。
- [ ] 建立 pnpm workspace、strict TypeScript、格式/lint/test/build 统一门禁和最小可运行服务。
- [ ] 建立 PostgreSQL+pgvector、Redis、Mock MCP/Model 的 Docker Compose 基础设施。
- [ ] 完成 A2A 1.0.1、MCP Streamable HTTP、LangGraph StateGraph 三项可执行 Spike 和报告。
- [ ] 生成 SBOM、第三方通知和许可证扫描基线，消除 `sources.lock.yaml` 中所有 `UNPINNED`。
- [ ] 完成实现增量。
- [ ] 完成测试与验证。
- [ ] 更新 Traceability Matrix、PROJECT_STATUS、ADR 和 Outcomes。

## Discoveries and Surprises

- 2026-07-11：仓库当前只有需求、架构、Schema、示例、ADR 和 ExecPlan 材料；不存在 `package.json`、应用源码或可执行测试门禁。
- 2026-07-11：当前目录没有 Git 元数据，`git status` 返回“not a git repository”。因此可以保持文件级可构建状态，但在 Git 仓库恢复/初始化前无法形成 Conventional Commit 证据。
- 2026-07-11：npm 官方页面显示 `@a2a-js/sdk` 稳定版 `0.3.14` 仅实现协议 v0.3；A2A v1.0 支持仍通过 `@next` beta 和 `epic/1.0_breaking_changes` 分支提供。需求锁定的是协议 1.0.1，因此必须以协议契约 fixture 验证 beta SDK，不能把安装成功等同于兼容。
- 2026-07-11：官方包页面显示候选版本 `@langchain/langgraph@1.4.7`（MIT）和 `@modelcontextprotocol/sdk@1.29.0`（MIT）；最终锁定前仍需核对对应 tag/commit 的 LICENSE/NOTICE 与 Node 兼容性。

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

- [ ] `pnpm install && pnpm verify:bootstrap`
- [ ] `docker compose up -d postgres redis`
- [ ] `A2A、MCP、LangGraph Spike tests pass`
- [ ] `sources.lock.yaml 不存在 UNPINNED`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-00-repo-bootstrap/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
