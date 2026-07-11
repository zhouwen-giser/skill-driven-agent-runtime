# EP-01 协议与领域骨架

## Purpose / Outcome

第三方 A2A 客户端可发现 Agent Card、提交/查询/取消/流式读取 Task；内部 Task/Context/Goal 和 BullMQ 串行调度真实运行。

## Requirements Covered

FR-A2A-001, FR-A2A-002, FR-A2A-003, FR-A2A-004, FR-A2A-005, FR-A2A-006, FR-A2A-007, FR-A2A-008, FR-A2A-009, FR-A2A-010, FR-A2A-011, FR-A2A-012

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] domain entities and state machines
- [ ] A2A adapter and public capability projection
- [ ] Postgres repositories and migrations
- [ ] BullMQ queue and context serialization
- [ ] A2A test client and contract suite

## Progress

- [ ] 读取材料并记录当前代码状态。
- [ ] 将具体文件、接口和步骤补充到本计划。
- [ ] 完成实现增量。
- [ ] 完成测试与验证。
- [ ] 更新 Traceability Matrix、PROJECT_STATUS、ADR 和 Outcomes。

## Discoveries and Surprises

执行期间持续追加，包含 SDK 实际行为、失败测试和与原假设不同之处。

## Decision Log

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

- [ ] `A2A contract tests`
- [ ] `same context serial e2e`
- [ ] `stream disconnect task continues`
- [ ] `anonymous/default context behavior`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-01-protocol-domain-skeleton/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
