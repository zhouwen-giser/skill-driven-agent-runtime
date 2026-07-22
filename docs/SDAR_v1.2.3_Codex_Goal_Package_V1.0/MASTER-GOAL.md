# MASTER GOAL：完成 skill-driven-agent-runtime 的 SDAR v1.2.3 升级

## Goal ID

```text
SDAR-V1.2.3-MASTER
```

## 唯一可写仓库

```text
zhouwen-giser/skill-driven-agent-runtime
```

最低必含祖先：

```text
35cb9277396e0316b1c6b8aac57e6fa69a8a29df
```

执行时必须从最新 `origin/main` 开始；最低祖先只用于防止从 v1.2.2 之前的错误基线启动。

## 目标

实现两个闭环：

```text
在线：
Understand → Clarify → Confirm Goal → Plan → Human Patch/Confirm → v1.2.2 Execute/Judge/Recover

离线：
Runtime Facts → Episode → Observe/Extract → Reflect/Curate → Candidate → Replay/Shadow/Human Promote → Reuse
```

最终产品包含：

- 确定性 Runtime Capability Summary；
- 可授权、可追溯的 Public Capability Card；
- Generic Task Understanding 和 Missing Dimension；
- Interactive Goal Contract 与 Skill Goal Plan；
- Planning Correction Fact 和 Interaction Episode；
- Goal Experience Episode、Observer、Typed Extractors、Reflector；
- Candidate Task Type、Capability Pattern、Planning Heuristic；
- Replay、Shadow、人工门禁和 Knowledge Promotion；
- Active Knowledge Retrieval、RRF、Progressive Disclosure；
- Experience-enriched Planner 和基础 Planner Fallback；
- Management API、Console、A2A input-required；
- 安全、租户隔离、容量、恢复、灰度和发布证据。

## 开发模式

这是一个长生命周期 Goal。Codex 必须：

1. 执行 `/plan` 并持续更新 Master ExecPlan；
2. 完成 G00～G17，而不是只完成设计或 Skeleton；
3. 每个 Goal 交付 Implementation、Tests、Documentation、Evidence、Commit、Push；
4. 在 G00 后创建 Draft PR，并持续更新阶段、测试和阻断；
5. 发现 v1.2.2 接口变化时做兼容映射，但不得重写其权威；
6. 遇到局部外部源码或模型阻断时继续全部不受影响工作；
7. 最终运行完整验证、Replay/Shadow、A2A TCK、Security/Capacity；
8. 不自动 Merge，不创建 Tag。

## 建议分支

```text
feature/v1.2.3-cognitive-planning-runtime
```

## Master Goal 完成合同

### 功能

- 18 个子 Goal 完成；
- 在线交互链和离线学习链 E2E 完成；
- Capability、Task Type、Experience 和 Knowledge 状态可通过 API/Console 审查；
- 经验关闭、故障或无匹配时基础 Planner 正常；
- 高风险知识人工确认；
- v1.2.2 执行和终态语义无回归。

### 质量

- Format/Lint/Typecheck/Build；
- Unit/Contract/Integration/E2E/Replay/Chaos/Security；
- 空库 Baseline/Reset；
- 并发、重启、Redis 丢失、数据库重启、Model 不可达；
- Migration/OpenAPI/Architecture/A2A TCK；
- Sources Lock/License/SBOM；
- 工作树干净、证据可重放。

### 声明边界

最终报告必须准确声明：

```text
v1.2.3 Experience = Advisory
Candidate ≠ Active Knowledge
Capability Summary ≠ Runtime Readiness
Capability Pattern ≠ Skill
Workflow completed ≠ User Goal achieved
No Python Sidecar
No automatic Skill publication
```
