# P13 Security / Privacy Contract

## Authentication / Authorization

验证：

- Management API；
- Console；
- A2A；
- SSE；
- Service Principal；
- Operator；
- Break-glass；
- Approval；
- Activation；
- Kill Switch；
- Rollback。

## Tenant

验证所有：

- Query；
- Command；
- Cache；
- Embedding；
- Queue；
- SSE；
- Feedback；
- Usage；
- Audit；
- Export；
- Model Route；
- Case；
- Artifact。

## Credential

Credential 只存在正式 Credential Authority。

扫描：

- Source；
- Database；
- Logs；
- Events；
- Artifact；
- Profile；
- Console；
- API；
- A2A；
- Test Fixture；
- Build Artifact。

## PII / Privacy

验证：

- Redaction；
- Data Classification；
- Retention；
- User Deletion；
- Tenant Deletion；
- Dataset Invalidation；
- Usage / Feedback Deletion；
- Embedding Removal；
- Model Prompt Minimization；
- No Private Chain-of-thought Persistence。

## Injection

- SQL；
- XSS；
- Command；
- Prompt；
- Rule DSL；
- Regex；
- Template；
- Artifact Definition；
- A2A；
- SSE；
- Export。

## SSRF / Network

- Model Provider；
- MCP；
- Callback；
- URL Evidence；
- External Artifact；
- Console Links。

## Supply Chain

- SBOM；
- License；
- Source Lock；
- Dependency Pin；
- Container Base；
- Vulnerability Scan；
- Reproducible Build。

## Secrets

- Secret scan；
- Logs；
- Error；
- Stack；
- CI artifacts；
- Environment；
- Browser storage。

## Security Gate

Critical / High 未关闭：

```text
RELEASE_CANDIDATE_BLOCKED
```
