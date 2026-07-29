# P13 Evidence Contract

## 必需报告

```text
reports/goal/v1.3-final-baseline.md
reports/goal/v1.3-final-handoff-integrity.json
reports/goal/v1.3-final-architecture.md
reports/goal/v1.3-final-authority-audit.json
reports/goal/v1.3-final-package-consistency.json
reports/goal/v1.3-final-package-consistency.md
reports/goal/v1.3-final-migration-report.json
reports/goal/v1.3-final-upgrade-report.md
reports/goal/v1.3-final-verification-report.json
reports/goal/v1.3-final-security-report.json
reports/goal/v1.3-final-privacy-deletion-report.json
reports/goal/v1.3-final-capacity-report.json
reports/goal/v1.3-final-slo-report.json
reports/goal/v1.3-final-chaos-recovery-report.json
reports/goal/v1.3-final-kill-switch-rollback-report.json
reports/goal/v1.3-final-openapi-report.json
reports/goal/v1.3-final-console-report.json
reports/goal/v1.3-final-a2a-tck-report.json
reports/goal/v1.3-final-sse-report.json
reports/goal/v1.3-final-sbom.json
reports/goal/v1.3-final-license-report.json
reports/goal/v1.3-final-sources-report.json
reports/goal/v1.3-final-reproducibility-report.json
reports/goal/v1.3-final-rollout-plan.md
reports/goal/v1.3-final-rollback-plan.md
reports/goal/v1.3-final-known-limitations.md
reports/goal/v1.3-final-architecture-review.md
reports/goal/v1.3-final-security-review.md
reports/goal/v1.3-final-operations-review.md
reports/goal/v1.3-release-candidate-report.md
reports/goal/v1.3-final-completion.md
```

## 日志

保存：

- command；
- cwd；
- start / end；
- duration；
- exit；
- environment；
- log path；
- retry；
- failure root cause；
- final result。

## Release Manifest

必须包含：

```text
repository
candidate SHA
base v1.2.3 SHA
P00-P13 goals
migrations
api version
console version
a2a version
feature flags
build hashes
container digests
sbom hash
known limitations
decision
authorization status
```

## Review

三个 Review 的 blocking / major / minor 必须分开记录。

## 失败

若 BLOCKED，仍需完整输出：

- passed gates；
- failed gates；
- blockers；
- exact commands；
- repair recommendation；
- no false ready claim。
