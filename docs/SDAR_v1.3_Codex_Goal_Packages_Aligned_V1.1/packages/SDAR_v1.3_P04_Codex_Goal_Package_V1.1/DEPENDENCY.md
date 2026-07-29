# P04 Dependency Contract

## P00

必须是：

```text
READY_FULL
```

## P01

提供：

- ArtifactType；
- ArtifactStatus；
- Applicability；
- DependencySnapshot；
- Lineage；
- Validation Contract；
- Runtime Binding 边界。

P04 不修改 P01 生命周期。

## P02

提供：

- Candidate Persistence；
- Artifact Version；
- Lineage；
- Audit；
- Outbox；
- Feature Flag；
- Active Pointer 隔离。

P04 不写 Active Pointer。

## P03

提供：

- ExperienceTrace；
- Event Catalog；
- Source / Authority Refs；
- CohortDefinition；
- ProcessVariant；
- DiscoveredProcessPattern；
- WorkflowPattern；
- PatternQuality；
- support / contradiction；
- environment coverage；
- Recovery Pattern。

P04 不重新计算 P03 统计。

## v1.2.3

提供：

- Task Type；
- Capability Summary；
- Capability Pattern；
- Goal Contract；
- User Goal Plan；
- Skill Goal；
- Skill Outcome Specification；
- Criterion；
- Evidence / Artifact Requirements；
- Planning Corrections；
- Counterexamples。

## 输出给 P05

- Candidate Schema Version；
- Generalization Version；
- Candidate Generator Version；
- Plan Template Compiler Version；
- Candidate Fingerprint；
- Static Validation；
- Lineage；
- Required Replay Cases；
- Known Unknowns；
- Negative Conditions；
- Golden Candidate Fixtures。
