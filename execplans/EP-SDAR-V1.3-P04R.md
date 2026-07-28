# EP-SDAR-V1.3-P04R — P03/P04 Semantic Alignment Remediation

Status: COMPLETION_EVIDENCE_PENDING

Branch: `feature/v1.3-sequential-implementation`

## Purpose

Close only the frozen P04R findings against the existing P03/P04 implementation. The observable
outcome is a reproducible formal-fact path from Activity Identity V1.2 through P03 process mining and
P04 bounded Plan Template candidate compilation into the P02 Artifact authority and transactional
Outbox, with P03, P04 and P04R handoffs closed as `COMPLETED`. P05 implementation is out of scope.

## Requirements Covered

- AC-P04R-001–003 and AC-P04R-042–047: frozen authority, package ordering, Registry/consumer/audit
  alignment and no P05 implementation.
- AC-P04R-004–017: Activity Identity V1.2, activity-based variants, loops, explicit parallel and
  recovery evidence, real quality metrics, reproducible P03 output and accepted P03 handoff.
- AC-P04R-018–030: real P03 input, bounded generalization, Capability Catalog validation, distinct
  fingerprints, exact DAG/parallel/conditional semantics, parameter/applicability/lineage/recovery
  preservation and Static Validator V1.2.
- AC-P04R-031–041: durable candidate generation service/worker, PostgreSQL run authority, P02
  candidate authority, Outbox, duplicate/retry/recovery behavior, real vertical integration and
  accepted P04 handoff.

## Frozen Baseline

- P00, P01 and P02 are read-only. Their self-checks, full tests and evidence are not regenerated.
- `reports/goal/v1.3-p02-handoff.json` freezes P02 `ArtifactRepository` V1.1 as candidate authority.
- Existing P03/P04 code, migrations 0126/0127 and V1.1 reports are preserved and remediated in place;
  no history rewrite or wholesale replacement is allowed.
- PostgreSQL remains the system of record. Redis/BullMQ contains reconstructable run-ID wakes only.
- Domain owns compiler contracts; Application owns deterministic normalization/mining/compiler
  services; PostgreSQL adapters own persistence/leases/outbox; Server composition owns reachability.
- LangGraph.js remains the only workflow runtime. P04 candidates are pure planning data and cannot
  approve, activate or execute.

## Findings Closure Matrix

| Frozen finding | Planned implementation boundary | Evidence |
| --- | --- | --- |
| Lifecycle `eventType` used as Activity | Domain V1.2 activity ref plus formal-fact normalizer extraction | activity schema/report and focused tests |
| P03/P04 fixture semantic mismatch | reproducible formal facts → real P03 WorkflowPattern V1.2 fixture | real golden output and integration |
| Self-loop/recovery semantics lost | activity-key mining with repeated nodes, A→A and complete recovery refs | mining semantics report/tests |
| Constant quality metrics | cohort-derived denominators for support/coverage/fitness/precision | quality metric report/tests |
| Anti-overfitting rules not executed | five fail-closed generalization gates using scope/failure evidence | safety report/tests |
| Capability and fingerprint semantics wrong | current Catalog validation and three independent hashes | capability/fingerprint report/tests |
| DAG silently loses edges / parallel degrades | exact activity map, fail on missing ref, parallel group constraint | DAG report/tests |
| Parameter/applicability/lineage/recovery loss | lossless bounded compilation and V1.2 validation | lineage/recovery report/tests |
| Wake-only P04 worker | durable run application service, fencing/retry/dead-letter and server wiring | runtime-path report/integration |
| Candidate/validation/event partial state | one PostgreSQL transaction through P02 save and Outbox | rollback/duplicate integration |
| Stale P03/P04/registry consumers | V1.2 contracts, handoffs, Registry, P05/P13/Matrix/validator alignment | migration report/Review C |

## Contract Version Migration

- Upgrade `ExperienceActivityRef`, `ExperienceTraceEvent`, `ProcessVariant`, `WorkflowPattern`,
  `FusedPattern`, `GeneralizedPattern` and `CandidateStaticValidationResult` to V1.2.
- Keep V1.1 evidence auditable but reject or explicitly recompile it before downstream use.
- Validate runtime factories against the P04R JSON Schemas and their frozen SHA-256 values.
- Publish Shared Interface Registry V1.2 and compute its real complete-file SHA-256.
- Update P03/P04 locks and handoffs, P05 consumer lock, P13 consistency audit, package execution
  matrix and `validate-all.mjs` without changing P02 Artifact authority.

## Architecture and Interfaces

- `ExperienceTraceEvent.eventType` records lifecycle fact; optional `activity` records a stable
  business/workflow identity traceable to formal Plan Node, Skill Goal/Attempt, Capability, Effect and
  Provider Operation where present.
- Process mining admits only `event.activity.activityKey`; pure lifecycle events are excluded and
  unknown activity lowers completeness rather than being generalized.
- `CandidateGenerationApplicationService` claims a durable PostgreSQL run, loads tenant-scoped P03
  input, fuses/generalizes, detects duplicates, compiles and statically validates, then persists the
  P02 candidate, child lineage/validation, Outbox event and completed run atomically.
- Runtime workers claim/lease/fence durable runs and never own candidate/run truth.

## Implementation Progress

- [x] 2026-07-28 Confirm repository root, expected branch, top-level structure and current HEAD
  `5b8e4c7`; preserve the untracked P04R package.
- [x] 2026-07-28 Locate P04R by parsed `manifest.json.packageId` and run only its self-check: passed,
  35 files checked.
- [x] 2026-07-28 Read the full P04R package, P02 final handoff, current P03/P04 reports, architecture
  baselines and relevant accepted ADRs.
- [x] Implement and verify P03 Activity Identity/process-mining remediation.
- [x] Complete independent read-only Review A with 0 Blocking / 0 Major.
- [x] Implement and verify P04 compiler/runtime remediation.
- [x] Complete independent read-only Review B with 0 Blocking / 0 Major.
- [x] Align cross-package contracts and complete independent read-only Review C with 0 Blocking /
  0 Major.
- [x] Run every required focused and full gate, including a complete passing `pnpm verify`.
- [ ] Publish revised P03/P04 and final P04R evidence/handoffs, then commit the evidence-only result.

## Changed Files

Implementation inventory:

- Domain: `packages/domain/src/compiler/{experience-compilation,artifact-candidate-generation}.ts`
- Application: normalizer, process miner, fusion/generalization, candidate compiler, durable
  candidate-generation service and compiler exports under `packages/application/src/compiler/`
- Persistence: P03 trace/pattern repositories, P04 fused/generalized/run repositories,
  P02 `ArtifactRepository.saveCandidate` transaction integration and source-fact projection
- Runtime: BullMQ candidate wake/worker and Server composition
- Migration: additive `0128_v13_candidate_generation_runtime` up/down pair
- Tests: focused Domain/Application tests; real PostgreSQL P03/P04/P02 vertical and rollback tests;
  real Redis wake/lease/fencing/dead-letter tests
- Contracts: P03/P04/P05 locks/handoff templates, P04R package/Schemas, Registry V1.2,
  execution matrix, P13 audit and P04R-aware `validate-all.mjs`
- Evidence: this ExecPlan, ADR-120, verification summary and P03/P04/P04R completion/review/handoff
  records

## Migrations

Migration 0128 is additive and provides durable candidate-generation runs, fused-pattern authority
children, validation/lineage linkage and lease/fencing state not representable by 0127. The down
migration removes only 0128-owned objects. `pnpm verify:migrations` passed fresh apply,
idempotency, rollback/reapply, guarded reset and rogue-ledger rejection through 0128.

## Focused Tests

- P03: domain compiler, normalizer, miner, PostgreSQL round-trip and Redis worker tests.
- P04: fusion/generalization, compiler/static validator, durable repository/worker tests.
- Vertical: formal v1.2.3 facts → ExperienceTrace → WorkflowPattern V1.2 → Plan Template candidate →
  P02 `ArtifactRepository` → static validation → Outbox.
- Record the first failure, root cause, change and rerun result in this plan and P04R evidence.

Final focused result: 7 files / 50 tests passed, including real PostgreSQL and real Redis projects.
Earlier P03 and P04 focused slices passed 29/29 and 19/19 respectively.

Preserved failure sequence:

- First real Integration attempt was sandbox-blocked on Docker access; approved Docker execution
  exposed two real P03 regressions.
- Skill Goal source refs lost the stable `skill-goal:` namespace; V1.2 normalization and fixture
  assertions were corrected.
- The 10k persistence fixture still wrote V1.1 Trace bodies, then lacked an Activity after migration
  to V1.2. It now writes the constant V1.2 version and a formal Activity identity.
- Final Integration passed 104/104; the 10k final full-gate sample queried in 515.6 ms and persisted
  in 392.32 ms.

## Full Verify

Required final commands, each recorded exactly:

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test:unit`
5. `pnpm test:contract`
6. `pnpm test:integration`
7. `pnpm test:e2e`
8. `pnpm verify:migrations`
9. `pnpm verify:architecture`
10. `pnpm build`
11. `pnpm verify`

No skipped tests, weakened assertions, synthetic-only vertical evidence or unlabelled partial results
count as passing evidence.

Final results:

1. `pnpm format:check` - passed.
2. `pnpm lint` - passed.
3. `pnpm typecheck` - passed.
4. `pnpm test:unit` - 112 files / 670 tests passed.
5. `pnpm test:contract` - 22 files / 178 tests passed.
6. `pnpm test:integration` - 12 files / 104 tests passed against real PostgreSQL/Redis.
7. `pnpm test:e2e` - 2 files / 62 tests passed against real PostgreSQL/Redis and mock model/MCP.
8. `pnpm verify:migrations` - 21 migrations through 0128 passed.
9. `pnpm verify:architecture` - 468 TypeScript sources passed.
10. `pnpm build` - TypeScript and Console production build passed.
11. `pnpm verify` - all seven aggregate stages passed in 222,978 ms.

The first aggregate run stopped at a Windows ESM absolute-path import in Cognitive Replay; the
verification helper now uses `pathToFileURL`. The next run reached infra smoke but the smoke-only
`SDAR_POSTGRES_URL` still pointed at the protected default `/sdar`; the final run bound all three
database variables to the isolated P04R database and passed. No default-database mutation occurred.

## Review Findings

- Review A — P03 Activity Identity and Process Mining: 0 Blocking / 0 Major / 3 Minor. Accepted
  Activity Identity, repeated/self-loop, parallel/branch/recovery, quality and PostgreSQL round-trip.
- Review B — P04 Compiler and Candidate Runtime Path: 0 Blocking / 0 Major / 2 Minor after four
  earlier Major findings were remediated and independently re-reviewed.
- Review C — Registry / P05 / P13 Cross-package Alignment: 0 Blocking / 0 Major / 2 delivery-state
  Minor. Untracked-package delivery is closed by the local commits; reviewer intentionally did not
  rerun the write-producing aggregate validator, while independently validating all seven Schema
  hashes and the P04R self-check.
- Each review records `Blocking`, `Major`, `Minor`, and `Accepted`. Main implementation closes every
  Blocking/Major and reruns affected tests; reviewers do not modify files.

## P03 Revised Handoff

Implementation, focused tests, real golden WorkflowPattern V1.2 and Review A are complete with zero
Blocking/Major. The revised Handoff is emitted as `COMPLETED` and retains earlier V1.1 evidence as
historical references.

## P04 Revised Handoff

Compiler/runtime implementation, real P03-to-P04-to-P02 integration and Review B are complete with
zero Blocking/Major. The revised Handoff is emitted as `COMPLETED`; P04 remains candidate-only and
does not implement P05 replay, approval, activation or execution.

## P04R Handoff

All 47 acceptance criteria, Registry V1.2 hash, three accepted reviews and the complete full gate are
closed. Final evidence/Handoff commit remains. `nextPackage` is P05, but this plan stops before P05
implementation.

## Discoveries and Surprises

- Bootstrap found only the P04R package untracked; existing tracked implementation was clean.
- ADR-119 explicitly records the known P04 wake-only/no-event limitation, confirming the frozen
  runtime-path finding rather than completion evidence.
- Current P03 and P04 reviews are implementation-agent self-audits pending confirmation, so neither
  satisfies P04R's independent-review requirement.
- WorkflowPattern needed an explicit conditional dependency relation; ADR-120 records the additive
  V1.2 decision and requires a bounded ConditionExpression.
- A pattern containing both observational order and explicit parallel evidence for the same pair is
  invalid. P03 drops the observational order when explicit concurrency exists, while P04 still
  rejects externally supplied direct/parallel conflicts.
- Full verification helpers must convert absolute Windows paths to `file:` URLs before dynamic ESM
  import.

## Decision Log

- 2026-07-28: Treat P04R Schemas and frozen findings as the V1.2 migration authority while retaining
  V1.1 reports as historical evidence.
- 2026-07-28: Keep all new durable candidate state under PostgreSQL/P02 authority and Redis wake-only,
  preserving ADR-005, ADR-117, ADR-118 and ADR-119 boundaries.
- 2026-07-28: Use three separate read-only agents only at the explicitly required review phases;
  implementation and remediation remain with the primary agent.

## Implementation Steps

Execute the 28 ordered steps from P04R `IMPLEMENTATION.md` and the user task without re-running
P00–P02, reimplementing all of P03/P04, or starting P05. Update this plan after each runnable
increment, review and evidence gate.

## Validation

Focused commands identify exact test files/projects. Full-gate commands use the repository scripts
above. Schema hashes were recomputed and compared with P04R `CONTRACT-LOCK.json`. PostgreSQL,
pgvector and Redis evidence is real; model/MCP E2E doubles are simulated and explicitly labelled.

## Idempotence and Recovery

Factories and hashes are deterministic. Durable runs use idempotency keys, bounded attempts,
lease/fencing and transactional completion. Redis loss is recoverable from PostgreSQL. A failed
implementation step leaves V1.1 evidence intact; resume from the last checked item without resetting
or rewriting existing P03/P04 commits.

## Artifacts and Evidence

Produce every file listed in P04R `EVIDENCE.md`, revise P03/P04 completion/review/handoff records,
update traceability/status/changelog, and record exact commands/results/commit SHAs.

## Outcomes and Retrospective

Implementation, independent reviews and full verification are complete. Pending only the final
evidence/Handoff commit and a clean committed-worktree check.
