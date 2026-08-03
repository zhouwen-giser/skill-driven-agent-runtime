# SDAR v1.4.0 Single-Node Control Backend Release Report

## Release identity

- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Branch: `feature/v1.4-node-control-backend`
- Baseline and latest synchronized main: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- Verified code candidate: `e6d0b698fb0430386edba66474f8214f9f4bd740`
- Evidence and first remote publication commit: `d5368bd460c2d0dff46fbfa2b83b644372a59bda`
- Pull request: [#15](https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/15), merged
- Release head: `4dade4349258126f06a3b1fb09b4ee27a69b107f`
- Merge Commit: `0cbb42da3e6c7c98726d7502a769430eeeacc2e0`, parents `a7a7c62` and
  `4dade43`, merged at `2026-08-03T18:44:04+08:00`
- Post-merge verification: candidate/evidence/release head are `origin/main` ancestors; remote
  feature branch deleted; main worktree clean

`origin/main` was fetched again after qualification and remains an ancestor of the candidate at
0 behind / 66 ahead. No empty merge commit was created.

## P00-P14 commit inventory

| Phase | Implementation / qualification | Evidence |
|---|---|---|
| P00 | `c8ec915` | `c5ffbda` |
| P01 | `bf56489` | `ef93c26` |
| P02 | `deaa555` | `9a283eb` |
| P03 | `21c7a37` | `5980243` |
| P04 | `11d13d0` | `7c9b733` |
| P05 | `f409911` | `526155f` |
| P06 | `f5be34f` | `f7692d0` |
| P07 | `be9d01d` | `0097883` |
| P08 | `c76a4d0` | `8e59a2a` |
| P09 | `39298c3` | `5a82b5e` |
| P10 | `9e53ebb` | `b75d1b1` |
| P11 | `7f631fd` | `3a2d872` |
| P12 | `7eb5b83` | `062bd2a` |
| P13 | `ee64870`, clean candidate `ec10587` | `b840104` |
| P14 | `47fb8c3`, recovery fix and clean candidate `e6d0b69` | `d5368bd` |

All intermediate fix/test/reconciliation commits remain in history; the table identifies each
phase's principal implementation and evidence anchors.

## Migrations

- Runtime PostgreSQL: 107 additive up migrations, current v1.4 head
  `0143_v14_node_event_projection.up.sql`.
- Control PostgreSQL: 8 independent up migrations, current head
  `0008_organization_node_events.up.sql`.
- `pnpm verify:migrations` passed 36 migrations on the exact frozen v1.2.3 upgrade path through the
  v1.4 Runtime head, including rollback/reapply, checksum drift, ledger and interruption recovery.
- Control migration `0001` through `0008` passed fresh create, rollback/reapply and real repository
  tests. No Control migration writes Runtime business tables and no Runtime migration writes the
  Control database.

## API and schema hashes

| Artifact | SHA-256 |
|---|---|
| Frozen MANIFEST | `a06a13c60c31a3b914462b4a16d62a2f652217c6f5df7adf640d73b98bb4d7fc` |
| Node Control OpenAPI | `d4693a3c38ac0449e63804804fcdcea93c8fbf154fa1e7959806afc1c7652394` |
| Runtime Control OpenAPI | `09796b7cdc9e05c0ec990485d23e1045c679e7d87c662db6bf7618ca32a91177` |
| Node Events AsyncAPI | `d117282d3fe65c20a7af5444b5c14edd78d77a04f3ec5cb3916dc5d676098f59` |
| Telemetry Export contract | `46824f8472395342f3e4bffd05116a0f9db23f5bba103c083c2de3a8ba5ee279` |
| v1.4 traceability CSV | `7f414ff5633a474d3a8774a75a596adea3c811e94c64a0f5db805171c96af8a4` |

Frozen validation passes 76 files, 28 schemas, 111 operations, 20 events and 7 fixtures. The
Management API separately validates 164 operations.

## Validation

Exact isolated worktree commit `e6d0b698fb0430386edba66474f8214f9f4bd740`:

- `pnpm verify`: passed, `dirty=false`, 581,785 ms.
- Unit: 938; exclusive performance: 22; Contract: 220; Integration: 149; E2E: 72.
- Architecture: 644 TypeScript source files.
- A2A HTTP/JSON MUST TCK: 74 passed, 161 skipped, 30 deselected, 100% applicable compatibility.
- `pnpm verify:v14-security`: 4,436 current/history files, 0 secret findings; SBOM/licenses/project
  license/frozen contract passed.
- `pnpm audit --prod --audit-level high`: 0 Critical, 0 High; 1 documented Moderate.
- GitHub's separate High alert is development-only `postcss@8.5.16`, is already present unchanged
  on `origin/main`, and is not introduced by this PR; no required Dependency Review check exists.
- `pnpm verify:v14-recovery`: passed the real local Docker PostgreSQL/Redis drill.

The machine summary is `reports/verification/summary.json`, SHA-256
`06dfda472b63f01b4d58bc478db3edf2324ef13e056edbd1cd3f112200d45fde`.

## Architecture and authority

Control PostgreSQL is the authority for Node Profile, desired/observed configuration, governance
definitions, public Operations/Audit and Node Event delivery. Runtime PostgreSQL remains the
authority for Tasks, execution, readiness, immutable bindings, Agent Card Active/LKG and telemetry
export delivery. Redis/BullMQ owns wake/scheduling only. LangGraph.js remains the sole workflow
runtime; official A2A and MCP SDK types remain behind adapters.

The independent P14 read-only review reports 0 Blocking / 0 Major / 0 Minor.

## Security and recovery

Distinct role credentials, tenant-bound Organization reads, administrator-only writes, bounded
request/rate limits, exact/CIDR allowlists, non-loopback TLS, URL user-info/redirect rejection,
SecretRef-only contracts, immutable audit/CAS/idempotency and credential rotation/revocation are
covered by Contract and real smoke evidence. The recovery drill performs a custom-format
`pg_dump`/`pg_restore`, reconstructs after API restart, stops Control, and proves Runtime plus its
production Console bundle still start independently.

## Explicit non-goals and known limits

This release adds no formal Node Control Console, hierarchical organization plane, Telemetry Query
or ClickHouse proxy, telemetry dashboard, global supervision/interaction platform, multi-node HA,
automatic recovery of running work, production deployment, or measured production SLO/capacity/
RTO/RPO. The existing Runtime Console remains part of the Runtime smoke and was not expanded by
this Goal. See `known-limitations.md`.

## Rollback

Use the additive migration and service rollback procedure in `rollback.md`: stop new Control writes,
preserve both databases, restore the prior application, roll back only the affected database ledger
when explicitly approved, and retain Runtime LKG. Never restore Control data over Runtime or delete
unknown volumes.

## Failed attempts

The stale versioned SBOM, sandbox Docker denial, repeated clean-worktree Console 404 and offline
tarball miss are retained with root causes and successful reruns in
`failed-attempts/p14-release-qualification.md`.
