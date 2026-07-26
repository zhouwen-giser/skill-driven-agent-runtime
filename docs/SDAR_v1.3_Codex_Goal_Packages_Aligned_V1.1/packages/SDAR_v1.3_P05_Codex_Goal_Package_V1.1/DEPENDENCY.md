# P05 Dependency Contract

## P00

必须：

```text
READY_FULL
```

## P01

提供：

- Artifact Type；
- Candidate / Active 生命周期；
- Applicability；
- Lineage；
- Validation Contract。

## P02

提供：

- Validation Persistence；
- Candidate Version；
- Immutable Repository；
- Audit / Outbox；
- Approval 与 Validation 分离。

P05 不写 Approval 或 Active Pointer。

## P03

提供：

- ExperienceTrace；
- Source / Authority Refs；
- Cohort；
- Process Pattern；
- Pattern Quality；
- Counterexample Source。

## P04

提供：

- FusedPattern；
- GeneralizedPattern；
- ArtifactCandidate；
- PlanTemplateCandidate；
- Candidate Lineage；
- Candidate Fingerprint；
- StaticValidation；
- Golden Candidate Fixtures；
- Known Unknowns。

## v1.2.2 / v1.2.3

提供：

- Goal Contract；
- Plan Validator；
- Accepted Plan；
- Skill Goal；
- Capability Catalog；
- Readiness；
- Policy；
- Workflow；
- Attempt；
- Outcome；
- Recovery；
- Planning Correction；
- User Feedback。

## 输出给 P06

- Dataset Manifest Version；
- Split Policy Version；
- ReplayCase Schema；
- Replay Engine Version；
- Metric Catalog Version；
- Validation Result；
- Validation Failure；
- Counterexample；
- Baseline Comparison；
- Unsafe Flag；
- Known Limitations；
- Shadow Eligibility Candidate。
