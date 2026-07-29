# P03 Evidence Contract

## G05 Completion Report

必须包含：

- Source Inventory；
- Trace Schema；
- Ordering Policy；
- Redaction；
- Fingerprints；
- Tables / Migration；
- Repository；
- Worker；
- Tests；
- Failure Attempts；
- Commit。

## G06 Completion Report

必须包含：

- Cohort；
- Algorithm；
- Variant；
- Direct-Follows；
- Precedence；
- Parallel；
- Recovery；
- Quality Metrics；
- Golden Dataset；
- Performance；
- Optional PM4Py Comparison；
- Commit。

## 必需机器证据

```text
reports/goal/v1.3-p03-source-map.json
reports/goal/v1.3-p03-trace-schema.json
reports/goal/v1.3-p03-golden-dataset.json
reports/goal/v1.3-p03-mining-report.json
reports/goal/v1.3-p03-completion.md
reports/goal/v1.3-p03-review.md
```

## Review

独立只读 Review 重点检查：

- 是否用文档替代正式 Source；
- 是否把同时间戳误判为并行；
- 是否丢失失败和修订；
- 是否泄露 PII / Credential；
- 是否提前创建 Artifact；
- 是否把 PM4Py 变成生产权威；
- 是否越过 Tenant；
- 是否阻断在线任务。

## Git

至少：

```text
feat(v1.3): normalize experience traces
feat(v1.3): discover workflow patterns
docs(v1.3): record P03 evidence
```

可以按仓库规范调整提交数，但 G05/G06 必须可独立审查。
