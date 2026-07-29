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

## P04R 强制前置

P05 仅在 P04R Handoff 为 `COMPLETED` 后启动。P04R 不创建新的原子 Goal，也不改变 P05 的 G09/G10。

P05 必须按 Shared Interface Registry V1.2 消费以下合同，禁止把 V1.1 兼容读取默认为通过：

- `WorkflowPattern V1.2`
- `FusedPattern V1.2`
- `GeneralizedPattern V1.2`
- `CandidateStaticValidationResult V1.2`
- `CompiledArtifact V1.1`

Replay 数据集中的计划步骤必须使用真实 `activityKey`。`CandidateStaticValidationResult V1.2` 新增的 Activity Identity、Parallel、Capability Catalog、Parameter Schema、Applicability、Lineage 和 Recovery 门禁必须全部为 `true`。

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
