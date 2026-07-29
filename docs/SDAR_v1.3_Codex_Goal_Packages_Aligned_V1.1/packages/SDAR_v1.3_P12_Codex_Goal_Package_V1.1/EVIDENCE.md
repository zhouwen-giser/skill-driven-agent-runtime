# P12 Evidence Contract

## G21 Completion Report

必须包含：

- Exposure Inventory；
- RBAC / Tenant；
- Query / Command API；
- OpenAPI；
- Console Registry / Detail / Diff；
- Console Validation / Promotion / Governance；
- Console Runtime / Drift；
- A2A Capability / Input-required / Evidence；
- SSE；
- Audit / Idempotency；
- Redaction；
- Accessibility；
- Security；
- Performance；
- Failed Attempts；
- Commit。

## 必需机器证据

```text
reports/goal/v1.3-p12-api-operation-inventory.json
reports/goal/v1.3-p12-openapi-report.json
reports/goal/v1.3-p12-rbac-matrix.json
reports/goal/v1.3-p12-exposure-allowlist.json
reports/goal/v1.3-p12-console-route-inventory.json
reports/goal/v1.3-p12-console-e2e-report.json
reports/goal/v1.3-p12-accessibility-report.json
reports/goal/v1.3-p12-a2a-projection-report.json
reports/goal/v1.3-p12-a2a-tck-report.json
reports/goal/v1.3-p12-sse-report.json
reports/goal/v1.3-p12-security-report.json
reports/goal/v1.3-p12-performance-report.json
reports/goal/v1.3-p12-completion.md
reports/goal/v1.3-p12-review.md
```

## Review

重点检查：

- API 是否绕过正式 Service；
- Controller 是否复制业务规则；
- UI 是否自动 Approval / Activation；
- Body actorId 是否被信任；
- RBAC / Tenant 是否一致；
- Candidate / Credential / Secret 是否暴露；
- A2A 是否改变正式 Task 状态；
- Public Card 是否暴露内部 Skill / Route；
- SSE 是否成为状态权威；
- OpenAPI 是否与实现一致；
- Console 是否使用 Fixture 冒充产品路径；
- Audit / Expected Version / Idempotency 是否完整；
- 是否重实现 P01～P11；
- 是否提前宣称 Release Ready。

## Git

建议：

```text
feat(v1.3): expose artifact management operations
feat(v1.3): integrate artifact console and a2a evidence
docs(v1.3): record P12 evidence
```
