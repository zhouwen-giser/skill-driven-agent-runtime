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
- [x] 为 NFR-DATA-001 暴露机器可读和 Console 可见的 indefinite/no-cleanup posture，并复用领域/数据库双重禁用自动清理约束。
- [x] 为 NFR-DATA-001 运行 48 个目标测试和统一 `pnpm verify`（54 文件/221 测试及全部静态/构建门禁）。
- [x] 为 NFR-PERF-001 固化 Worker 默认并发 10，并证明十个 context 并发、每个 context 的后继操作严格串行且状态不交叉。
- [x] 为 NFR-PERF-001 运行统一 `pnpm verify`（54 文件/222 测试）；隔离 Redis 集成无输出并在 49 秒后超时，保持未验证。
- [x] 为 NFR-SEC-001 增加非 loopback 默认拒绝、显式可信网络确认、README/安全文档/发布清单隔离检查和 50 个目标测试。
- [x] 为 NFR-SEC-001 运行统一 `pnpm verify`（54 文件/224 测试及全部静态/构建门禁）。

## Discoveries and Surprises

- Model/MCP 已拥有显式耗时，Workflow 节点只有开始/终止时间戳；仅在前端推算无法满足 PostgreSQL 权威和可复现证据要求。
- Anthropic 扩展思考响应可在 displayable text 前包含 thinking/signature block；原严格数组 Schema 会拒绝整个响应。现在允许未知内容块进入 Adapter 局部解析，但仅验证后的 text block 能跨越 Adapter 边界。
- 现有唯一服务端定时器是 Task 等待超时 sweep，不执行历史清理；保留天数字段是规划元数据，不能触发归档或删除。
- Worker 并发限制和 context 串行是两个独立约束：前者限制全局活动 Job，后者在并发槽内阻止同 context 应用处理重叠。
- 默认 localhost 不足以防止运维误配；非 loopback 配置必须在启动前显式确认，但该确认绝不冒充认证或放宽“禁止公网”基线。

## Decision Log

- ADR-067 规定节点耗时由唯一 LangGraph 编译器测量、领域事件拥有、PostgreSQL 持久化，Console 不自行推算。
- ADR-027 的私有推理边界扩展到 Provider content block：管理审计保留可展示原始响应而不保留 vendor thinking/signature。
- ADR-059 的禁止自动清理决策扩展为明确的全历史数据运行姿态，通过 health 和 Console 暴露；显式管理生命周期操作不等同于后台保留清理。
- ADR-005 明确 BullMQ 默认并发 10 与进程内 `context_id` 串行器的组合；串行器不拥有任务状态。
- ADR-012 增加监听地址 fail-closed 规则；可信网卡仍需显式风险确认和发布清单网络隔离证据。

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
