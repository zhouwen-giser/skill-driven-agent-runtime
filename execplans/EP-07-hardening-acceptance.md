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

- [x] 读取 SRS、Definition of Done、追踪矩阵、架构/领域基线并记录当前证据缺口。
- [x] 将 NFR-PERF-002 节点耗时持久化增量补充到计划、ADR 和验收报告。
- [x] 在唯一 LangGraph Runtime 计时并贯通领域事件、PostgreSQL、管理 Trace 和 Console 回放。
- [x] 完成目标单元/静态 Console 测试与统一 `pnpm verify`；PostgreSQL 集成命令无输出并在 64 秒后超时，仍未验证。
- [x] 更新 NFR-PERF-002 Traceability、PROJECT_STATUS、ADR、验收报告和 CHANGELOG。
- [x] 加固 NFR-OBS-002：两个 Provider Adapter 丢弃私有推理块，A2A 仅投影必要摘要，管理端保留 Prompt/净化原始响应/结构化决策审计。
- [x] 为 NFR-OBS-002 运行 48 个目标测试和统一 `pnpm verify`（53 文件/220 测试及全部静态/构建门禁）。

## Discoveries and Surprises

- Model/MCP 已拥有显式耗时，Workflow 节点只有开始/终止时间戳；仅在前端推算无法满足 PostgreSQL 权威和可复现证据要求。
- Anthropic 扩展思考响应可在 displayable text 前包含 thinking/signature block；原严格数组 Schema 会拒绝整个响应。现在允许未知内容块进入 Adapter 局部解析，但仅验证后的 text block 能跨越 Adapter 边界。

## Decision Log

- ADR-067 规定节点耗时由唯一 LangGraph 编译器测量、领域事件拥有、PostgreSQL 持久化，Console 不自行推算。
- ADR-027 的私有推理边界扩展到 Provider content block：管理审计保留可展示原始响应而不保留 vendor thinking/signature。

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
