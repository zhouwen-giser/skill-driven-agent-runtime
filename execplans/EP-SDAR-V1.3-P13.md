# EP-SDAR-V1.3-P13 — Hardening, Release and Final Consistency Audit

## Purpose / Outcome

Audit and harden the complete SDAR v1.3 P00-P12 implementation without adding
product capability or moving any domain authority. The observable outcome is a
reproducible release-candidate decision backed by real PostgreSQL/Redis,
protocol, migration, security, capacity, recovery and rollback evidence. The
only permitted decision values are `RELEASE_CANDIDATE_READY` and
`RELEASE_CANDIDATE_BLOCKED`.

## Requirements Covered

- P13 `AC-P13-001` through `AC-P13-075`.
- Baseline SRS functional and non-functional requirements, especially
  `NFR-PERF-001/002`, `NFR-REL-001/002`, `NFR-SEC-001/002`,
  `NFR-OBS-001/002`, `NFR-MNT-001`, `NFR-COMP-001`,
  `NFR-DATA-001` and `NFR-UX-001`.
- Acceptance scenarios `AC-01` through `AC-18`.
- P13 specialist contracts for authority, migration/upgrade,
  security/privacy, protocol/management, capacity/SLO, recovery/chaos,
  release evidence and rollout/rollback.

## Context and Orientation

- Repository: `zhouwen-giser/skill-driven-agent-runtime`.
- Branch: `feature/v1.3-sequential-implementation`.
- Starting commit: `e3d7c8662de78d6a99289183d5345d89adad96cb`
  (`docs(v1.3-p12): close verification evidence and handoff`).
- P00 is frozen `READY_FULL`; P01-P12 are frozen completed predecessor
  inputs. P04R is the mandatory remediation package between P04 and P05.
- PostgreSQL is authoritative. Redis/BullMQ is wake, queue and ephemeral
  runtime state only. Domain owners and frozen application ports remain the
  only formal writers.
- The user explicitly authorized P13 to start from the current sequential
  feature branch instead of an `origin/main` merge baseline. This deviation is
  limited to source-baseline selection. It does not waive any technical,
  evidence, review or clean-worktree gate.
- The user also requires publication to wait until P14 is complete. P13 will
  therefore be committed locally without push; the branch will be pushed and
  a merge request to `main` created or updated only after P14 closure.

## Architecture and Interfaces

P13 produces no Goal, Plan, Task, Outcome, Artifact or runtime business
authority. It consumes the frozen P00-P12 contracts and produces only:

- release evidence reports;
- the `ReleaseCandidateDecision` V1.1 contract with schema hash
  `370b260730ee559a3f292d57c82b9296f626c4b437defa1dc2776f59020f9045`;
- minimal hardening scripts or regression tests where an audit exposes a real
  release blocker.

All release checks are read-only with respect to formal product state. Any
test fixtures use isolated non-production PostgreSQL/Redis resources and
synthetic non-PII data.

## Progress

- [x] 2026-07-30 Confirmed repository root, expected branch, clean worktree
      and P12 baseline commit.
- [x] 2026-07-30 Located P13 by `manifest.json.packageId` and passed only its
      package self-check.
- [x] 2026-07-30 Read the complete P13 package, original SRS, core
      architecture/domain/DoD sources and applicable repository instructions.
- [x] 2026-07-30 Recorded the user-authorized current-branch and deferred-push
      execution deviation.
- [x] 2026-07-30 Inventoried P00-P12 Handoffs, architecture/authority,
      package drift and existing evidence; the preflight validator reports
      zero blocking drift and 16/16 package self-checks.
- [x] 2026-07-30 Closed migration, protocol, capacity/SLO, chaos/recovery,
      rollback, supply-chain and container reproducibility gaps. The exact
      v1.2.3 logical migration, recovery drills, stable PostgreSQL image
      identity and final PostgreSQL/Redis critical/high scans pass.
- [x] 2026-07-30 Ran focused gates and retained first failures. Current
      management/identity unit tests pass 11/11, full E2E passes 72/72, the
      prior full integration run passes 129/129, and format/lint/typecheck/
      architecture/OpenAPI/source/license/secret gates pass.
- [x] 2026-07-30 Conducted the three independent read-only review phases:
      Architecture/Authority, Security/Privacy and Operations/Release.
- [ ] Close every Blocking/Major review finding and rerun affected gates.
      The promotion-control and reproducibility findings are fixed. The
      Architecture reviewer is rechecking the validation-type alias fix;
      Security and Operations re-review must bind to the exact candidate
      evidence generated after the local candidate commit.
- [ ] Run the clean exact-commit full verification gate.
- [ ] Complete all 75 acceptance items, release-candidate report, completion
      report and handoff.
- [ ] Commit P13 locally without push.

## Discoveries and Surprises

- P13's package text assumes the final candidate is audited from merged
  `origin/main`; the user explicitly selected the already-integrated
  sequential feature branch as the candidate source. The exact candidate SHA
  and the divergence from `origin/main` will remain visible in final evidence.
- P13's package asks for a Draft PR during its own closure, while the user
  explicitly defers all push/PR activity until P14 completes. The PR criterion
  will be satisfied in the combined P13/P14 publication step and P13 evidence
  will state that timing dependency truthfully.
- P12 already completed a clean real-database `pnpm verify`; P13 must replay
  the release gates on its own exact candidate and may cite earlier evidence
  only as predecessor context, not as a substitute.
- The hardened PostgreSQL image changes the libc boundary from the prior
  frozen v1.2.3 Debian image to Alpine. Attempting to mount an existing Debian
  data directory failed on `template1` collation metadata. The old volume was
  preserved; an isolated fresh project passed all schema/data migration
  semantics, and P13 is adding a tested logical backup/restore upgrade path
  instead of pretending that cross-libc physical-volume reuse is safe.
- The first real recovery fixture inserted a Goal without its required
  Conversation Context. The fixture was repaired, and the rerun passed Redis
  flush/restart plus PostgreSQL restart with zero lost authoritative facts.
- Repeated Compose builds initially changed only the BuildKit provenance
  manifest and therefore changed the image digest after the first Trivy scan.
  Container evidence cannot bind that incidental digest. Disabling provenance
  and SBOM attestations for the local image export, fixing the Compose project
  identity and setting `SOURCE_DATE_EPOCH=0` produced the stable image ID
  `sha256:856ba6c2ed2292bba994e945ebf1bd638d2c1c78c2562bc9c8b57ea6b9138762`,
  which is the identity used by the final Trivy and recovery evidence.
- The first cross-container fixture selected an unrelated Bookworm pgvector
  image. The frozen v1.2.3 Compose authority instead resolves to
  `pgvector/pgvector@sha256:69573b32242ca232f65871d4cb916ba7210a372b9bd74068204c1a9a57bada4f`;
  correcting that source preserved the exact predecessor boundary.
- A fresh Compose project initially reported PostgreSQL healthy during its
  temporary initialization server and produced `ECONNRESET`. After the final
  PostgreSQL log boundary was checked, Docker Desktop could still report
  healthy before its Windows host port proxy was usable, producing
  `ECONNREFUSED`. A failed port allocation also left healthy containers with
  no published endpoints. The infrastructure helper now force-recreates only
  the disposable service containers and requires PostgreSQL and Redis probes
  through the host endpoints before tests begin. No volume is deleted.
- An independent Architecture/Authority review found that a disabled promotion
  flag still allowed P12 approve/activate commands; those governance writes are
  now gated while rollback and kill-switch controls remain available. Its
  follow-up found `validate` could carry `shadow` or `revalidation` as a
  semantic alias. Policy evaluation now uses the effective validation type
  before any governance write, with unit and durable PostgreSQL/Outbox
  zero-write regression evidence.
- The initial Operations/Release review found that reproducibility allowed
  only `summary.json` to change even though the full gate intentionally writes
  both `summary.json` and `summary.md`. The allowlist now matches that exact
  evidence behavior without permitting any implementation drift.

## Decision Log

- 2026-07-30: Treat the current feature branch as the P13 candidate baseline
  under direct user authorization. Do not merge, rebase or rewrite history.
- 2026-07-30: Preserve P00-P12 code and contracts. Any P13 implementation
  change must be a minimal hardening fix with a regression test.
- 2026-07-30: Classify evidence as `real`, `simulated`, `static` or
  `unverified`; only real or contract-accepted simulated evidence may close a
  hard gate.
- 2026-07-30: Keep P13 unpushed until P14 finishes, then publish both through
  one branch update and a merge request targeting `main`.
- 2026-07-30: Do not delete or reuse an existing Debian PostgreSQL volume
  with the Alpine runtime. Run destructive migration tests only against
  explicitly isolated resources, and require a logical backup/restore for the
  image-family boundary.
- 2026-07-30: Treat a changed container digest after an identical rebuild as a
  release-evidence defect even when the root filesystem layers are cached.
  Final SBOM, Trivy and Release Manifest evidence must name the same stable
  image identity.
- 2026-07-30: Treat deployment controls as operation-semantic controls, not
  only route-name controls. `validationType=shadow|revalidation` must be
  evaluated under the shadow control before any governance or Outbox write.
- 2026-07-30: A Docker health check is not sufficient host-readiness evidence
  on Docker Desktop. Test infrastructure must prove PostgreSQL and Redis
  through their actual host endpoints and may recreate disposable containers,
  but it must preserve named volumes.

## Implementation Steps

1. Validate all predecessor Handoffs and contract hashes and generate the
   baseline, integrity and fourteen-package consistency reports.
2. Inventory module ports, writers, databases, queues, Outbox events, APIs and
   feature flags; run the static architecture/authority checks.
3. Run empty-database, upgrade, idempotence, rollback/reapply, interruption,
   rogue-ledger, reset and PostgreSQL restart migration scenarios.
4. Run security/privacy/tenant, credential, PII/deletion, injection, source,
   license, vulnerability, secret and SBOM checks.
5. Run OpenAPI, Console, A2A MUST TCK, formal task-state and SSE gates.
6. Measure baseline/expected/stress capacity for request concurrency,
   Artifact scale, retrieval/rules/templates, cases/models, Console/API/SSE
   and background queues; evaluate the package SLOs.
7. Run Redis, Worker, PostgreSQL, network/provider, queue/Outbox/cache/server,
   deadline/cancellation/late-result and duplicate-event recovery drills.
8. Run feature-flag, kill-switch, Artifact rollback, gateway disable, compiled
   path disable/cognitive fallback and application/data rollback drills.
9. Rebuild twice from the locked dependency graph, hash build products, and
   produce release reproducibility and rollout/rollback evidence.
10. Freeze the implementation for three independent read-only reviews, repair
    Blocking/Major findings, then repeat affected and full gates.
11. Complete traceability, status, changelog, 75-item acceptance,
    release-candidate report, completion and handoff.

## Validation

Focused validation is discovered from `package.json` and the owning package
scripts. The final gate is:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm verify:migrations
pnpm verify:architecture
pnpm build
pnpm verify
```

Additional P13 gates include package self-check, cross-package validation,
secret/dependency/license/source/SBOM inspection, build reproducibility and the
real Docker PostgreSQL/Redis recovery scenarios defined by the package.

Expected final state:

- every required command passes on the recorded candidate SHA;
- no open Blocking or Major review finding;
- all 75 acceptance items pass;
- the decision is `RELEASE_CANDIDATE_READY`.

If any hard gate remains unresolved, reports and handoff must instead record
`RELEASE_CANDIDATE_BLOCKED` with exact commands and repair guidance.

## Idempotence and Recovery

- Audit scripts must be rerunnable and must not mutate formal product state.
- Database tests use isolated test schemas/databases and repeatable migrations.
- Redis is disposable test runtime state; no report may treat it as authority.
- Failed commands retain their first output and root cause. Recovery resumes
  from the narrow failed gate, followed by the full verification gate.
- No destructive Git history operation, automatic merge, tag, release or
  production deployment is permitted.

## Artifacts and Evidence

P13 will generate every report listed by
`docs/.../SDAR_v1.3_P13_Codex_Goal_Package_V1.1/EVIDENCE.md`, including
baseline, handoff integrity, architecture, authority, package consistency,
migration/upgrade, verification, security/privacy, capacity/SLO,
chaos/recovery, kill-switch/rollback, OpenAPI/Console/A2A/SSE,
SBOM/license/sources/reproducibility, rollout/rollback, known limitations,
three reviews, release-candidate, completion and standard handoff evidence.

The exact commands, environment classification, timestamps, duration, exit
status, retries and first-failure repair trail remain in machine-readable
reports under `reports/goal/`.

## Outcomes and Retrospective

Pending. This section will record the exact release candidate SHA, gate totals,
review findings, known limitations, final decision and the downstream P14
handoff without overstating local or simulated evidence as production proof.
