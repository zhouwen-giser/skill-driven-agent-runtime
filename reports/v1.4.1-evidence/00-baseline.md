# SDAR v1.4.1 Canonical Evidence Phase 0 Baseline

## Result

Phase 0 is `COMPLETED` on `feature/v1.4.1-canonical-evidence-export`. The branch starts from the
latest observed `origin/main` commit `cc0719f4db83dc64dc6e32e6dcad2d558823e796`; local `main`,
`origin/main`, and their merge base were identical. No product runtime file was changed in this
phase.

## Package integrity

The task package remains at `docs/sdar_v1_4_1_evidence_goal_package/`, as authorized by the user.
Every file named in `SHA256SUMS.txt` matched its expected SHA-256 digest. The package defines 100
minimum required record types and the sole external contract `sdar.evidence/v1`.

## Current release and migration baseline

- Package version: `1.4.0`.
- Runtime migration head: `0143_v14_node_event_projection`.
- Published old export migration: `0142_v14_telemetry_export`.
- 0142 up SHA-256: `37e945ac16c7340212b2c904659122aac15a7bacac36d4a3e79db43873124985`.
- 0143 up SHA-256: `d365fa192bf02b09626986e5bcfa675323df74f5906b62e759d73189479eb053`.
- Migration strategy: **Strategy B**, append a clean-cutover migration after 0143.

Strategy A is rejected because both migrations are published ancestors of `origin/main`, and the
existing verification gate enforces incremental SHA-256 checksum immutability. This task will not
rewrite them, migrate old Telemetry rows, or dual-write old and new formats.

## Current implementation gap

The v1.4 implementation exposes `x-sdar-telemetry-contract: 1.0.0`, configures only
`runtime_event`, and owns three `runtime_telemetry_export_*` tables. It cannot reconstruct the
required Goal/Contract/Skill/Plan/Action/Receipt/MCP/Capability/Verification/Outcome chain or the
Experience, Replay, Artifact, and Node Control trails. No `sdar.evidence/v1` catalog, schema set,
canonical outbox, source checkpoint, manifest, quality issue, projection issue, or DLQ exists.

## Baseline verification

`pnpm install --frozen-lockfile` passed with the existing lockfile. A final unmodified-code
`pnpm verify` passed on `cc0719f` in 660,217 ms using isolated Docker infrastructure:

- Static/unit/contract gate: 1,180 tests (938 unit, 22 performance, 220 contract).
- Integration: 30 files, 149 real PostgreSQL/Redis tests.
- E2E: 6 files, 72 tests.
- Migrations: 36 additive Runtime migrations through 0143, including backup/restore,
  rollback/reapply, interruption recovery, rogue-ledger rejection, and checksum drift rejection.
- Architecture, A2A MUST compatibility, 164-operation OpenAPI, Node Control contract, acceptance,
  source locks, protocol, license, SBOM, build, cognitive replay, infrastructure smoke, server smoke,
  and Node Control smoke all passed.

The authoritative generated result is `reports/verification/summary.json`.

## Environment isolation

Port `55432` was owned by an unrelated `smpp-continuation-postgres` container and was preserved.
The successful gate used Compose project `sdar-v141-baseline-cc0719f`, PostgreSQL port `55484`, and
the repository test Redis port `56379`. A stale repository P03 Redis test container was stopped but
not removed; no container volume was deleted.

## GitHub baseline

At observation time, the only open PR was Dependabot PR #10. No existing
`feature/v1.4.1-canonical-evidence-export` branch or evidence PR was found. This phase will publish
its own Draft PR only after the Phase 0 commit is pushed.

## Failed attempts retained

All failed attempts, exact causes, and the successful recovery path are recorded in
`reports/v1.4.1-evidence/failed-attempts/00-baseline.md`.
