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
- [ ] complete docs and troubleshooting
- [ ] SBOM/notices/license scan
- [ ] all AC reports and release package

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

- [ ] `pnpm verify`
- [ ] `all traceability rows verified`
- [ ] `all AC e2e pass`
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
