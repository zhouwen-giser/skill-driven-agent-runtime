# SDAR v1.2.3 Release Audit

Status: **release gates passed; external auto-merge deviation**

The clean release gate passed on
`7e505412bc50917a71c4a724ef15f659c6d5c296` with `dirty=false` in 171,145 ms. It ran 765
Unit+Contract tests, 84 real PostgreSQL/Redis Integration tests, 62 real HTTP/A2A E2E tests, the
side-effect-free Replay verifier, 17 migrations, production builds and both smoke stages.

## Evidence classification

- Real: PostgreSQL/pgvector, Redis/BullMQ, HTTP/A2A, Management API, Server/Console smoke and migration
  rollback/reapply.
- Simulated: Model and MCP behavior inside the deterministic local product E2E; worker/model failures.
- Replay: deterministic `NoPhysicalProvider`, never a product or physical-device result.
- Inherited real baseline: v1.2.2 disposable PostgreSQL service restart and no-replay audit. v1.2.3
  preserves those authorities and adds startup reconstruction over their PostgreSQL records.
- Unverified/not claimed: production-scale soak, live physical Replay, and external multi-tenant
  authorization beyond the trusted-intranet baseline.

## Capacity, backpressure and retention

- Knowledge retrieval P95: 2.99 ms, target ≤ 500 ms, 20 real PostgreSQL samples.
- Notification concurrency: 20 waiters, 265 ms, 60 database reads; this exceeds the specified
  single-instance 1–10 active-task operating range without state crossover.
- Queue/worker tests retain `attempts=1`, bounded notification/producer capacity, durable admission,
  PostgreSQL Outbox/leases and reconstructable Redis wakes.
- V1 retention remains review-only. `RetentionService.apply` reports reviewed rows and always returns
  zero archive/delete counts; automatic cleanup remains Domain/DB forbidden.

## Security and privacy

Full tests cover exact tenant/user retrieval scopes, user preference deletion propagation, inert
prompt-injection content, recursive PII/credential/private-reasoning redaction, Public Card allowlisting,
encrypted secrets and trusted-intranet warnings. No authentication or cross-tenant authorization claim
is added to V1.

## Frozen release boundaries

```text
v1.2.3 Experience = Advisory
Candidate ≠ Active Knowledge
Capability Summary ≠ Runtime Readiness
Capability Pattern ≠ Skill
Workflow completed ≠ User Goal achieved
No Python Sidecar
No automatic Skill publication from the cognitive runtime
```

Default rollout is Summary/Card on, ambiguous-only Understanding, manual interaction, Capture/Observer
on, shadow induction, manual Promotion and shadow Injection. `FeatureRolloutPolicy` enforces
Capture → Observe → Candidate → Shadow → Advisory → Active Low-risk; Active requires low risk and
explicit human approval.

Sources (27 pins), Apache-2.0/NOTICE, 286 npm packages, two external services, SBOM, A2A MUST 74/74,
152 OpenAPI operations, frozen protocol and 425-source architecture all pass.

PR #9 was marked Ready only after all release gates passed. GitHub then merged it externally at
`d68195a7634a7c9694f0ba1e971d9327813fb03d` without a Codex Merge call and deleted the branch. The
branch was recreated by the already-running final evidence push. No tag was created. The merge cannot
be honestly classified as compliant with AC-G17-09/AC-MASTER-05 and is not reverted automatically.
