# P03 Dependency Contract

## P00

必须提供：

- READY_FULL；
- 未来 v1.2.3 完成态基线；
- Authority Map；
- Experience / Knowledge 正式接口；
- Migration 起始位置。

`READY_FOUNDATION_ONLY` 不允许执行 P03。

## P01

提供：

- Artifact 类型与边界；
- Candidate / Active 区分；
- Applicability / Lineage 基础类型；
- 禁止直接执行约束。

P03 不创建 Artifact。

## P02

提供：

- Artifact Persistence / Registry / Governance；
- Outbox、Audit、Feature Flag 模式；
- 后续 Artifact Feedback 接口；
- Repository / Transaction 规范。

P03 不修改 P02 状态机。

## v1.2.3 必需能力

```text
GoalExperienceEpisode
Experience Outbox / Job
Observer
Typed Extractors
Reflector / Curator
Task Type
Capability Pattern
Planning Heuristic
Knowledge Promotion
Retrieval
Planner Injection
Replay / Shadow 基础
```

P03 至少依赖 Episode、Observer、Extractor、Outcome、Recovery 正式可读。

## 输出给 P04

- ExperienceTrace Schema Version；
- Event Type Catalog；
- Fingerprint Algorithm Version；
- CohortDefinition；
- DiscoveredProcessPattern；
- WorkflowPattern；
- Pattern Quality；
- Source / Lineage；
- Repository Ports；
- Migration；
- Worker Contract；
- Golden Fixtures；
- Known Limitations。
