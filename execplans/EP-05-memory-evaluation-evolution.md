# EP-05 记忆、评估与 Skill 演化

## Purpose / Outcome

执行轨迹可提炼全局记忆，任务产生多评估器报告，相似经验可归纳、模拟验证并发布 Skill 新版本。

## Requirements Covered

FR-EVO-001, FR-EVO-002, FR-EVO-003, FR-EVO-004, FR-EVO-005, FR-EVO-006, FR-EVO-007, FR-EVO-008, FR-EVO-009, FR-EVO-010, FR-MEM-001, FR-MEM-002, FR-MEM-003, FR-MEM-004, FR-MEM-005, FR-MEM-006, FR-EVAL-001, FR-EVAL-002, FR-EVAL-003, FR-EVAL-004, FR-EVAL-005

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] stage-specific memory retrieval
- [ ] memory version/status/replacement
- [ ] five evaluator pipeline
- [ ] implicit feedback inference
- [ ] experience clustering threshold
- [x] skill test generation/replay/simulation/all-pass publish for repeated Temporary Skill success (FR-SKL-015); broader FR-EVO-004/005/007 evolution remains open
- [ ] prompt optimization candidate generation

## Progress

- [x] 2026-07-12: establish source-traceable global MemoryItem storage, pgvector retrieval, management contracts, and cross-user E2E evidence for FR-MEM-001.
- [x] 2026-07-12: connect repeated Temporary Skill Experience to structured induction, persisted evolution drafts, static/history/normal/boundary/exception simulation, fail-closed all-pass publication, and dynamic Agent Card evidence.
- [x] 2026-07-12: collect every evaluated controller round into a PostgreSQL-authoritative Evolution Experience with Goal, Tool/Skill versions, immutable Workflow, result/errors, evaluation and duration (FR-EVO-001).

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

- [ ] `memory conflict/version tests`
- [ ] `evaluation report schema`
- [ ] `experience threshold tests`
- [ ] `failed validation remains draft`
- [ ] `manual correction learning evidence`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-05-memory-evaluation-evolution/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
