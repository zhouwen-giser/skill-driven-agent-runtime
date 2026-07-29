# P13 Test Plan

## Baseline / Handoff

```bash
git fetch origin --prune
git rev-parse origin/main
git status --short --branch
git log --oneline --decorate -n 50
```

核验 P00～P12 Commit 祖先和 Handoff。

## Full Verify

从当前 package.json / verify-full 发现命令并执行完整 Gate。

不得用旧任务包中假设的测试数量替代实际执行。

## Migration / Upgrade

- Empty DB；
- v1.2.3 Final DB；
- Production-like Data；
- Apply；
- Idempotent；
- Rollback；
- Reapply；
- Interrupted；
- Rogue；
- Reset；
- PostgreSQL Restart。

## Authority

- Static writer scan；
- Runtime integration；
- Database writer；
- Cache / Queue rebuild；
- Management / A2A projection；
- Duplicate formal commit；
- Direct activation；
- Actor spoofing。

## Security

- Auth；
- RBAC；
- Tenant；
- IDOR；
- Credential；
- Secret；
- PII；
- Deletion；
- SQL / XSS / Command / Prompt / Rule DSL；
- SSRF；
- Export；
- SSE；
- A2A；
- Supply Chain。

## Performance

- 1/10/100/1k concurrent request；
- 1k/10k/100k Artifact；
- Semantic retrieval；
- Rule set；
- Template size；
- Case；
- Model cascade；
- Console / API；
- SSE clients；
- Background queues。

## Chaos

- Redis；
- Worker；
- PostgreSQL；
- Network；
- Provider；
- Queue；
- Outbox；
- Cache；
- Server；
- SSE；
- Deadline；
- Cancellation；
- Activation race。

## Protocol

- OpenAPI；
- Console E2E；
- Accessibility；
- A2A Agent Card；
- Input-required；
- Formal Task State；
- MUST TCK；
- SSE resume / overflow。

## Rollout / Rollback

- Feature Off；
- Compiler-only；
- Shadow-only；
- Internal Tenant；
- Low-risk Artifact；
- Canary；
- Kill Switch；
- Artifact rollback；
- Gateway disable；
- Cognitive fallback；
- Application rollback。

## Reproducibility

- clean install；
- frozen lock；
- build twice；
- artifact hash；
- SBOM；
- license；
- sources；
- container digest（如有）。

## Final Drift Audit

按十四包矩阵逐包核验代码、DDL、Port、Event、Runtime 和 Evidence。

## Review

三个独立 Review，完成修复后重新执行全 Gate。
