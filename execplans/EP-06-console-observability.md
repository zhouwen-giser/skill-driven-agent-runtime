# EP-06 完整管理控制台与可观测性

## Purpose / Outcome

运营人员通过真实控制台管理 MCP/Skill/Prompt/Task/Workflow/Memory/Evaluation，并查看 DAG、Trace、回放和优化建议。

## Requirements Covered

FR-ADM-001, FR-ADM-002, FR-ADM-003, FR-ADM-004, FR-ADM-005, FR-ADM-006, FR-ADM-007, FR-ADM-008

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] complete management OpenAPI
- [ ] React console navigation and real CRUD
- [ ] workflow DAG editor and validation
- [ ] live task/node/LLM/MCP trace
- [ ] version diff and execution replay
- [ ] metrics dashboards and warnings

## Progress

- [x] Read the requirement, architecture, OSS, status, and current management-boundary material; inventory the current routes and traceability gaps.
- [x] Complete exact-version OSS Intake and ADR-064 for the React/Vite console stack.
- [x] Build the first strict-TypeScript console increment and serve its production assets from the same management process.
- [ ] Complete real CRUD, DAG editing, trace/replay, linked navigation, dashboards, and accessibility evidence.

- [ ] 读取材料并记录当前代码状态。
- [ ] 将具体文件、接口和步骤补充到本计划。
- [ ] 完成实现增量。
- [ ] 完成测试与验证。
- [ ] 更新 Traceability Matrix、PROJECT_STATUS、ADR 和 Outcomes。

## Discoveries and Surprises

- The backend already exposes broad real management operations, but route coverage substantially exceeds the current OpenAPI document and several resources are identifier lookups rather than filterable inventories.
- The existing root ESLint ignore matched only the root `dist`; the console build exposed that nested generated assets must use `**/dist/**` to keep generated third-party bundles outside source linting.
- No console application existed at EP-06 start. The first production bundle is now independently buildable and contains no static operational records.

执行期间持续追加，包含 SDK 实际行为、失败测试和与原假设不同之处。

## Decision Log

- ADR-064 accepts React/Vite only inside `apps/console`; the management API remains the sole operational authority.
- The console is mounted at `/console` by the existing management listener. Vite is development/build tooling, not another production process.
- The repository will implement the Workflow DAG UI itself instead of adding a second workflow or third-party console runtime.

执行期间持续追加；重大决定另建 ADR。

## Implementation Steps

1. 建立或更新本阶段接口和数据设计。
2. 先实现确定性核心和测试替身。
3. 完成真实 Adapter/Repository/Runtime。
4. 打通最短端到端链路。
5. 扩展边界、失败、取消和可观测性。
6. 完成管理接口/UI（适用时）。
7. 运行完整验证并修复全部失败。

## Validation

- [ ] `UI e2e using real APIs`
- [ ] `no static mock data in production build`
- [ ] `accessibility smoke`
- [ ] `trace and replay data consistency`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-06-console-observability/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
