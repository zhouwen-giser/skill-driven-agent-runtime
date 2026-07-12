# EP-04 完整任务生命周期与 Goal 闭环

## Purpose / Outcome

实现计划确认、补充输入、暂停/恢复/取消、Goal Patch、Result Processor、目标评估和外层重规划。

## Requirements Covered

FR-GOAL-001, FR-GOAL-002, FR-GOAL-003, FR-GOAL-004, FR-GOAL-005, FR-GOAL-006, FR-GOAL-007, FR-GOAL-008, FR-EXE-001, FR-EXE-002, FR-EXE-003, FR-EXE-004, FR-EXE-005, FR-EXE-006, FR-EXE-007, FR-EXE-008, FR-EXE-009, FR-EXE-010, FR-RST-001, FR-RST-002, FR-RST-003, FR-RST-004, FR-RST-005, FR-RST-006

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] confirmation via A2A and management API
- [ ] pause/resume thresholds and cancellation
- [ ] goal patch invalidation and compensation planning
- [ ] result normalization and structured output
- [ ] goal evaluation/replanning budgets
- [ ] replacement skill plan confirmation

## Progress

- [x] 2026-07-12: fail interrupted Task/Workflow state atomically on process start.
- [x] 2026-07-12: verify BullMQ attempts=1/no stalled retry and queued-job retention across Redis client restart.
- [x] 2026-07-12: implement fixed-stage Goal Patch, atomic old-state invalidation, A2A/management history, compensation evidence, and forced reconfirmation.
- [ ] Implement general pause/resume/cancel policy and unified wait timeout.

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

- [ ] `lifecycle e2e matrix`
- [ ] `no tool call before confirmation`
- [x] `goal patch invalidation tests`: unit + real PostgreSQL integration + management contract + A2A/MCP e2e.
- [ ] `timeout auto-cancel`
- [ ] `pause short/long behavior`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-04-task-lifecycle-goal-loop/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
