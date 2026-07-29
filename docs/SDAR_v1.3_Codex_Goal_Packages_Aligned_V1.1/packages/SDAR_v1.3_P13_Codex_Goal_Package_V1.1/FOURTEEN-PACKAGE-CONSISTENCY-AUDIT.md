# SDAR v1.3 十四任务包最终一致性审计

## 包矩阵

| 包 | 原子 Goal | 冻结职责 |
|---|---|---|
| P00 | G00 | v1.3 启动门禁 |
| P01 | G01 | Artifact Domain / Schema |
| P02 | G02-G04 | Persistence / Registry / Governance |
| P03 | G05-G06 | Experience Trace / Pattern Mining |
| P04 | G07-G08 | Candidate / Plan Template Compiler |
| P04R | -- | Mandatory remediation of G05-G08; no G23 |
| P05 | G09-G10 | Replay Dataset / Validation |
| P06 | G11-G12 | Shadow / Promotion / Revalidation |
| P07 | G13-G14 | Retrieval / Applicability |
| P08 | G15 | Plan Template Runtime / Formal Handoff |
| P09 | G16 | Decision Rule / Policy Runtime |
| P10 | G17-G18 | Fast Gateway / Feedback |
| P11 | G19-G20 | Case Runtime / Model Route |
| P12 | G21 | Management / Console / A2A |
| P13 | G22 | Hardening / Release / Final Audit |

## 必查偏移

### P00

- 是否错误绑定旧当前仓库；
- 是否允许未完成 v1.2.3 启动 P03；
- 是否在门禁中实现产品。

### P01 / P02

- Domain 与 Persistence 是否重复定义；
- Active / Approval 是否唯一；
- Candidate 是否可直接执行。

### P03 / P04

- Trace / Pattern 是否被 Candidate 编译修改；
- P03 是否提前生成 Artifact；
- P04 是否提前验证 / 激活。

### P05 / P06

- Replay 是否有真实副作用；
- Replay Pass 是否自动 Promotion；
- Shadow 是否修改正式状态；
- Approval / Activation 是否合并。

### P07 / P08 / P09

- Retrieval Score 是否越过硬门禁；
- Template / Rule 是否成为第二 Planner；
- 是否固化 Skill / Provider / MCP；
- Policy / Readiness 是否被历史证据替代。

### P10

- Gateway 是否重写子系统；
- Deny 是否被 Fallback 绕过；
- Deadline 后是否提交；
- Feedback Attribution 是否错误。

### P11

- Case 是否复制实例；
- Model Route 是否含 Credential；
- 模型自评是否成为权威；
- 是否无限级联。

### P12

- API / Console 是否绕过 Service；
- A2A 是否改变正式状态；
- Candidate / Secret 是否暴露。

### P13

- 是否通过降低门禁签发；
- 是否引入新产品范围；
- 是否自动 Merge / Tag / Deploy。

## Authority 一致性

必须证明：

```text
Formal Goal / Plan / Workflow / Outcome authority unchanged
Artifact governance unique
Gateway is orchestration only
Management is projection only
PostgreSQL is source of truth
Redis is rebuildable
Human approval remains human
Safety / Authorization override optimization
```

## Schema / Version 一致性

核验所有 Handoff：

- Version；
- Port；
- Event；
- Migration；
- Feature Flag；
- Reason Code；
- Cache Invalidation；
- Hash / Snapshot。

## 结果分类

每个包：

```text
aligned
minor_drift_closed
major_drift_closed
blocking_drift
```

任一 `blocking_drift`：

```text
RELEASE_CANDIDATE_BLOCKED
```

## 最终交付

```text
reports/goal/v1.3-final-package-consistency.json
reports/goal/v1.3-final-package-consistency.md
```

## P04R Final Consistency Audit

- Package accounting is exactly 14 formal product packages, 1 mandatory remediation package (P04R), and 1 optional post-release package (P14).
- P04R is sequenced `P04 -> P04R -> P05`, is not a formal product package, and creates no G23.
- Shared Registry V1.2 is an immutable delta over untouched V1.1; P00-P02 remain frozen on V1.1.
- P03 and P04 revised handoffs must be `COMPLETED` before P04R can be `COMPLETED`.
- P05 must require P04R `COMPLETED` and consume WorkflowPattern, FusedPattern, GeneralizedPattern, and CandidateStaticValidationResult at V1.2.
- P04R cross-package validation must skip execution of frozen P00-P02 self-checks while still validating their manifests and locks read-only.
