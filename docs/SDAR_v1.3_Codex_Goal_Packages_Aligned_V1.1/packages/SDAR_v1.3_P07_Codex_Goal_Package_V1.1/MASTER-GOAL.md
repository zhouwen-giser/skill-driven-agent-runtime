# MASTER GOAL：SDAR v1.3 P07

## Goal ID

```text
SDAR-V1.3-P07
```

## 原子 Goal

```text
G13：Artifact Index、Semantic Retrieval 与候选排序
G14：Applicability、参数绑定与依赖有效性
```

## 目标

建立：

```text
P06 Active Artifact Authority
        |
        v
Artifact Retrieval
        |
        v
Applicability / Parameter Binding
        |
        v
Capability / Readiness / Policy
        |
        v
Runtime Candidate Decision
```

## 输入权威

- P06 Active Pointer / Artifact Status；
- Artifact Definition / Applicability；
- Validation / Promotion Summary；
- Dependency Snapshot；
- Tenant / Domain / Task Type；
- Request Context；
- User-confirmed Goal Contract；
- Trusted World State；
- Capability Summary；
- Skill Registry；
- Provider Readiness；
- Safety Policy；
- Current Catalog / Policy / Schema Versions。

## 输出权威

P07 输出：

```text
ArtifactMatch[]
ArtifactApplicabilityResult
ParameterBindingResult
CapabilityReadinessResult
PolicyDecision
RuntimeExecutionDecision
```

P07 不输出正式 Plan、Attempt 或执行结果。

## 权威边界

```text
PostgreSQL Active Pointer
> Cache / Index

User-confirmed Goal Contract
> Request / World / Preference / Model Candidate

Current Capability / Skill / Readiness
> Historical Success / Validation Score

Safety Policy
> Business Ranking

Hard Gates
> Match Score

Formal Runtime
> P07 Candidate Decision
```

## 完成合同

- 只返回 Active Artifact；
- Candidate / Revalidating / Deprecated 永不进入在线候选；
- Tenant / Authorization 隔离；
- Exact / Structured / Semantic 三层检索；
- Progressive Loading；
- Ranking 可解释且稳定；
- 近分歧义回退；
- 硬条件不被 Score 覆盖；
- 参数来源和 Trust 明确；
- 关键参数不可模型默认；
- Current Capability / Readiness / Policy 实时检查；
- Dependency Snapshot 有效；
- OOD / Uncertainty 可回退；
- Cache 可重建；
- 未实现 Fast Gateway；
- P08 Handoff 完整。
