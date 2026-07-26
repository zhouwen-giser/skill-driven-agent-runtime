# P04 Evidence Contract

## G07 Completion Report

必须包含：

- Pattern Fusion；
- Generalization；
- Variables / Invariants；
- Required / Forbidden Condition；
- Model Stage；
- Candidate Generator；
- Candidate Fingerprint；
- Lineage；
- Persistence；
- Tests；
- Failed Attempts；
- Commit。

## G08 Completion Report

必须包含：

- Step Classification；
- Capability Mapping；
- Skill Goal DAG；
- Dependencies；
- Parameters；
- Completion Contract；
- Recovery；
- Static Validator；
- Golden Fixtures；
- Performance；
- Commit。

## 必需机器证据

```text
reports/goal/v1.3-p04-generalization-schema.json
reports/goal/v1.3-p04-candidate-schema.json
reports/goal/v1.3-p04-plan-template-schema.json
reports/goal/v1.3-p04-golden-candidates.json
reports/goal/v1.3-p04-static-validation-report.json
reports/goal/v1.3-p04-completion.md
reports/goal/v1.3-p04-review.md
```

## Review

独立只读 Review 重点检查：

- 是否改变 P03 Pattern；
- 是否删除反例；
- 是否过度泛化；
- 是否绑定 exact Skill；
- 是否允许模型默认安全字段；
- 是否把静态通过当验证通过；
- 是否提前激活；
- 是否产生正式 Goal / Plan；
- 是否越过 Tenant；
- 是否引入第二 Candidate Authority。

## Git

建议：

```text
feat(v1.3): generalize workflow patterns
feat(v1.3): compile plan template candidates
docs(v1.3): record P04 evidence
```
