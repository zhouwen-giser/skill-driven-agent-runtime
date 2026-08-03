# P13 Completion Report

## Goal

Harden the single-node Control backend with explicit service identities and role profiles, bounded
ingress and egress, secret-reference-only configuration, auditable writes, reproducible recovery
and honest operational limits without creating a second Runtime authority.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `ee1826ede8c8d1c3e404eddf08e9cff8cf169a11`
- implementationSha: `ee64870d9527bf7aeaef63a08897b411f9de7d1a`
- reproducibilityFixShas: `63c6961`, `ec10587`
- fullVerifyCandidateSha: `ec10587073828b1fd940e475a30a8ceebfaedd57`
- evidenceSha: `PENDING_EVIDENCE_COMMIT`
- remoteSha: `PENDING_P14_PUSH`

## Implementation

- Added distinct Node Administrator, Operator, Viewer, Security Administrator and Organization
  service credentials with constant-time matching, exact read/write profiles, tenant-bound
  Organization identity and per-credential fixed-window rate limits. Runtime service authentication
  remains a separate internal credential.
- Added configurable 1-1024 KiB request limits, stable 413/429 Problems and duplicate public
  credential rejection. Non-loopback public/internal URLs require TLS.
- Added LLM and SMPP outbound endpoint validation with exact authority/IPv4 CIDR allowlists,
  user-info rejection and HTTPS outside real loopback addresses. A deceptive DNS name beginning
  with `127.` is regression-tested and rejected.
- Preserved SecretRef-only Provider/SMPP/MCP/Telemetry configuration, Runtime-owned credential
  resolution, existing If-Match/idempotency/reason/Operation/Audit guards and PostgreSQL authority.
- Extended the real Node Control smoke with cross-role denial, cross-tenant denial, credential
  rotation/revocation, custom-format `pg_dump`/`pg_restore` reconciliation, API restart reconstruction
  and Runtime startup after Control shutdown.
- Added backup/restore, fresh-baseline upgrade/rollback and local capacity/SLO/chaos runbooks. They
  explicitly do not claim production HA, zero downtime, capacity, RTO or RPO.
- Made the four frozen CSV matrices byte-reproducible across fresh Windows checkouts while retaining
  their exact MANIFEST sizes and SHA-256 values.

## Acceptance

| P13 criterion | Result | Evidence |
|---|---|---|
| Cross-role and cross-tenant rejection | passed | HTTP Contract plus real Node Control smoke |
| Service credential and SecretRef boundaries | passed | distinct credentials, frozen SecretRef Domain tests, secret scan 0 findings |
| Rate limit, request size, SSRF, allowlist and TLS | passed | 413/429/422 regressions, deceptive-loopback regression and environment validation |
| Audit, actor, reason, idempotency and expected revision | passed | writes remain Node Administrator-only; existing immutable Operation/Audit and CAS suites pass in full gate |
| Control backup/restore, Runtime LKG and restart reconstruction | passed | real disposable Docker PostgreSQL/Redis drill with `pg_dump`/`pg_restore` |
| Secret scan, SBOM, licenses and production dependency threshold | passed | 0 secret findings; 286 npm packages; 0 Critical/High production advisories |
| No hidden production guarantees | passed | capacity/SLO/chaos and upgrade/rollback runbooks |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused formatting/lint/typecheck | passed | full ESLint and strict TypeScript |
| focused Unit/Contract | passed | 2 files, 7 tests |
| `pnpm test:node-control` | passed | 19 files, 45 tests |
| `pnpm verify:architecture` | passed | 644 TypeScript source files |
| `pnpm verify:v14-security` | passed | 4457 files scanned, 0 findings; 286 npm packages; frozen contract 76 files / 111 operations / 20 events |
| `pnpm audit --prod --audit-level high` | passed | 0 Critical, 0 High; 1 documented Moderate |
| `pnpm verify:v14-recovery` | passed | real Docker PostgreSQL/Redis, backup/restore, rotation, restart and outage drill |
| `pnpm verify` | passed in 665,151 ms | exact clean `ec10587`; 938 Unit + 22 performance, 220 Contract, 149 Integration, 72 E2E; 36 Runtime migrations and all smokes |

The accepted exact-commit summary is `reports/verification/summary.json`, has SHA-256
`93d4801d8cf8413f9fade71e239427ffd3428fa65b425da4f2d994c70df9d319`, and records
`commit=ec10587073828b1fd940e475a30a8ceebfaedd57`, `status=passed`, `dirty=false`.

## Real / simulated / unverified

RBAC, tenant rejection, request/egress limits, PostgreSQL dump/restore, API restart, credential
rotation/revocation and Runtime-after-Control outage are real local evidence. Loopback model/MCP
services remain controlled test providers. Production SLO, capacity, HA, RTO/RPO, external secret
manager rotation and mTLS termination are deployment responsibilities and are not claimed.

## Review and failed attempts

The final read-only review is 0 Blocking / 0 Major / 0 Minor after closing the deceptive-loopback
TLS bypass and clean-checkout frozen-byte reproducibility findings. Failures and reruns are retained
in `reports/v1.4-node-control/failed-attempts/p13-security-recovery.md`.

## Handoff

P13 is `COMPLETED` locally. P14 must fetch and merge latest `origin/main`, retain every phase commit,
update release/version/governance evidence, run the final clean exact-candidate matrix, push once,
create the non-draft PR and merge only when GitHub checks/reviews/protection allow it.
