# EP-SDAR-V1.3-P03 — Experience Trace Normalization and Process Mining

Status: ACTIVE

Branch: `feature/v1.3-sequential-implementation`

## Purpose / Outcome

Implement P03/G05-G06 so frozen v1.2.3 PostgreSQL facts can be normalized asynchronously into an
immutable, replayable `ExperienceTrace`, then deterministically grouped into versioned cohorts,
`ProcessVariant`, `DiscoveredProcessPattern` and `WorkflowPattern` outputs. Mining must remain
offline and non-blocking, preserve incomplete/failure/recovery evidence, and produce no executable
Artifact, Skill binding, online routing decision or second workflow/runtime authority.

## Requirements Covered

- AC-P03-001–002: baseline and exact P01/P02 Handoff ancestry.
- AC-P03-003–010: strict frozen contracts, deterministic normalization, incomplete-data handling,
  redaction, deletion propagation, tenant isolation and PostgreSQL authority.
- AC-P03-011–013: PostgreSQL-idempotent workers, bounded retry/dead letter, Redis reconstruction and
  versioned cohort scope.
- AC-P03-014–024: deterministic variants, direct-follows/precedence/parallel/recovery/failure
  semantics, auditable thresholds, contradiction/environment/quality evidence and a
  non-Skill-bound `WorkflowPattern`.
- AC-P03-025–027: no downstream Artifact/template/rule/gateway scope, no online blocking, no Python
  product sidecar.
- AC-P03-028–032: complete gate, separate G05/G06 commits and evidence, independent read-only review,
  Draft PR only, and exact P04 Handoff.

## Context and Orientation

- `goal_experience_episode` and `goal_experience_episode_source` hold immutable v1.2.3 Episode facts.
  `PostgresCognitiveRuntimeFactReader` assembles Goal Contract, Plan revision, Skill Attempt, Outcome,
  Progress, Recovery, Business Event and Planning Interaction facts into each Episode snapshot.
- Migration 0125 already created the canonical `experience_trace` and `pattern_candidate` tables.
  P03 must reuse them; adding aliases would create a second authority and violate ADR-117.
- Existing `experience_job`/dead-letter and BullMQ worker patterns prove the PostgreSQL-authoritative,
  Redis-reconstructable delivery model. P03 adds compiler-specific durable runs without changing the
  v1.2.3 Episode observer.
- Domain compiler modules own frozen types and invariants. Application compiler modules own pure
  deterministic normalization/mining and orchestration Ports. PostgreSQL adapters own source reads,
  persistence, leases/fencing and Outbox writes. Runtime Redis owns wake-only queues.

## Architecture and Interfaces

- Add Domain-owned exact 1.1 contracts: `ExperienceTrace`, `ExperienceTraceEvent`,
  `CohortDefinition`, `ProcessVariant`, `DiscoveredProcessPattern`, `WorkflowPattern`, their nested
  value types and strict factories.
- `ExperienceTrace.trace` is a bounded immutable envelope containing ordered frozen events,
  corrections, outcome and explicit missing-fact codes. The remaining canonical table columns are
  transactionally checked projections.
- `pattern_candidate.definition` is a bounded immutable envelope containing the versioned cohort,
  variants, discovered pattern and mapped Workflow Pattern. It never contains a Compiled Artifact.
- Migration 0126 adds only non-authoritative child/support tables with foreign keys:
  `experience_trace_source`, `pattern_candidate_support` and `compilation_run`. PostgreSQL remains
  the only durable authority; Redis jobs contain only compiler run IDs.
- Normalization queue: `sdar-compiler-normalization`. Mining queue:
  `sdar-compiler-process-mining`. Both are existing frozen names. The durable run owns status,
  attempts, lease owner/token/expiry, retry time and result/error evidence.
- `experience.trace_created` and `compiler.pattern_discovered` are written transactionally to the
  existing `cognitive_runtime_outbox`; no second Outbox is introduced.
- Tenant/user scope is derived from persisted source facts, never caller claims. User deletion
  removes scoped trace/pattern payloads and compiler projections transactionally while retaining
  only permitted non-PII audit tombstones already owned by the deletion authority.
- Parallelism is inferred only from explicit concurrency/partial-order/dependency evidence. Equal or
  overlapping timestamps alone never establish parallelism.

## Progress

- [x] 2026-07-27 Read the complete P03 package, frozen registry fields, scope, test plan and evidence
      contract without entering P04 implementation material.
- [x] 2026-07-27 Read architecture/domain baselines, ADR-111–117, v1.2.3 cognitive design and
      existing Episode/job/worker/persistence authority.
- [x] 2026-07-27 Pass P03 self-check (21 files), all-package validator, P01/P02 ancestry and clean
      cursor `5689bc7c3a602a7343bee56aafc94951c7568341`.
- [x] 2026-07-27 Implement and test G05 contracts, deterministic normalizer, migration, repository
      and wake-only worker; focused 19/19 and real PostgreSQL integration 93/93 pass.
- [x] 2026-07-27 Verify migration 0126 fresh/idempotent/rollback/reapply and rogue-ledger rejection.
- [x] 2026-07-27 Run focused G05 gates and create meaningful commit `22cf9a3`.
- [x] 2026-07-27 Implement and test G06 cohorting, deterministic mining, quality metrics and
      evidence-only Workflow Pattern mapping.
- [x] 2026-07-27 Run focused G06 gates and create meaningful commit `119fe43`.
- [ ] Generate all six required P03 evidence files and update status/traceability/changelog; the
      four machine-readable source/schema/golden/mining reports are present and the completion/review
      records are pending final gate/review closure.
- [ ] Run the complete clean verification gate. On `1f7e043`, 828 unit/contract, 100 integration,
      62 E2E, migration rollback/reapply, build and architecture checks passed; the final
      infrastructure smoke is blocked because the operator-managed `/sdar` database lacks the
      `v1.2.2_clean_slate_baseline` ledger row.
- [ ] Obtain fresh independent read-only review and close every Blocking/Major finding.
- [ ] Publish exact 28-field `COMPLETED` Handoff, push Draft PR and advance cursor to P04.

## Discoveries and Surprises

- P02 intentionally created `experience_trace` and `pattern_candidate` before P03, so P03 can store
  complete lossless envelopes inside their existing JSON columns and must not alter their frozen
  column sets.
- The package `SHA256SUMS.json` is structured JSON, not `sha256sum -c` syntax. P03's own self-check
  validates all 21 entries and passed; the failed generic command did not mutate the tree.
- v1.2.3 already preserves corrections, recovery, business-event impact and terminal Outcomes in
  Episode snapshots. P03 should normalize those source facts rather than query live provider state.
- The first 10k benchmark exposed that the generic 4,096-identifier bound also constrained mining
  evidence references. P03 now keeps ordinary collections at 4,096, gives only mining evidence
  references a finite 65,536 bound, and proves 10,000 accepted / 65,537 rejected.
- The first independent review correctly found that an in-memory 10k proof was insufficient. The
  canonical pattern definition is now Brotli-compressed with a content hash, the JSON projection is
  capped at 4,096 references, and the full 10k evidence set is persisted in
  `pattern_candidate_support`; a real PostgreSQL regression measures query and persistence time.
- The formal v1.2.3 Task projection has no active Task Type authority. P03 therefore records the
  gap and uses a deterministic request fingerprint only as a compatibility cohort key under the
  frozen trusted-intranet tenant; it does not promote that fingerprint to a new Task Type authority.
- The remediation full gate reached the last smoke step after all implementation tests passed, but
  the operator database no longer contained the clean-baseline marker required by `smoke-infra`.
  This is tracked as an external environment blocker and is not masked by pointing smoke at a test
  database.
- The second independent review closed all original findings but found three new Major issues:
  timestamp-based trigger collision/unbounded per-Trace mining, synchronous miner/Brotli event-loop
  blocking, and omitted formal `task_request` Source attribution.

## Decision Log

- 2026-07-27: Reuse the canonical P02 tables and store lossless versioned envelopes; add only
  foreign-keyed child/support/run tables. Recorded in ADR-118.
- 2026-07-27: Keep deterministic normalization/mining pure and model-free. Any future semantic model
  assistance may propose offline labels only and cannot override order, counts, Outcomes or quality.
- 2026-07-27: Treat absence as an explicit missing-fact code that reduces completeness; never
  synthesize an event to fill a gap.
- 2026-07-27: Require explicit concurrency group/parent/dependency facts for parallel candidates;
  timestamps are ordering evidence only.
- 2026-07-27: Freeze the process-mining evidence reference ceiling at 65,536 so the required 10k
  cohort is supported without unbounding ordinary domain collections.
- 2026-07-27: Persist the complete mining payload as a bounded Brotli+base64 envelope with canonical
  SHA-256 integrity, retaining only the first 4,096 evidence references as the existing JSON index
  projection and all references in the tenant-scoped support child table.
- 2026-07-27: Treat the deterministic request fingerprint as a compatibility-only grouping key when
  the formal v1.2.3 source has no Task Type candidate. Preserve `task_type_missing` and
  `task_type_compatibility_fingerprint` so downstream packages cannot mistake it for authority.
- 2026-07-27: Compose dispatcher, queues, workers and reconcilers only in `apps/server/src/runtime.ts`;
  PostgreSQL outbox/source-event lineage drives durable runs and Redis remains wake-only.
- 2026-07-27: Batch at most 1,000 pending Trace events by tenant/Task Type, bind mining identity to
  the sorted event set, serialize cohort scheduling with an advisory lock and permit at most one
  active/recent automatic mining run per 60 seconds. Explicit/manual mining remains separately
  versioned and does not consume source events.
- 2026-07-27: Preserve the single-process invariant while protecting online work through cooperative
  128-trace yields, asynchronous libuv Brotli compression and production mining concurrency one.

## Implementation Steps

1. Add strict Domain contracts/factories and exhaustive unit tests for bounds, ordering,
   immutability and exact top-level fields.
2. Build a source inventory and deterministic Episode normalizer with canonical SHA-256 identities,
   redaction/abstraction, explicit missing facts and tenant-aware fingerprints.
3. Add migration 0126, PostgreSQL source/trace/run repositories, transactional Outbox emission,
   deletion propagation and query indexes.
4. Add durable compiler job service/reconciler and two wake-only BullMQ queues/workers with bounded
   retries, lease fencing, dead letters and Redis-loss reconstruction.
5. Commit the complete G05 runnable increment.
6. Implement exact cohort matching, deterministic variants, direct-follows/precedence evidence,
   explicit parallel candidates, recovery/failure separation and frozen quality metrics.
7. Persist pattern envelopes/support evidence, emit `compiler.pattern_discovered`, map
   `WorkflowPattern`, and prove repeated runs are byte-stable and idempotent.
8. Commit the complete G06 runnable increment.
9. Generate evidence/docs, run full gates on a clean commit, obtain independent review, remediate as
   needed, then publish Handoff and push without merge/tag/Ready transition.

## Validation

- `node .../P03.../scripts/self-check.mjs`
- `node docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/scripts/validate-all.mjs`
- focused Vitest for Domain/Application/Redis compiler modules
- real PostgreSQL integration for migration, Episode→Trace, idempotency, lease fencing, retry/dead
  letter, cohort mining, Redis reconstruction and deletion propagation
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`,
  `pnpm test:integration`, `pnpm test:contract`, `pnpm test:e2e`, `pnpm build`,
  migration verification, architecture verification and both smoke checks through `pnpm verify`
- final `git status --short` must be empty and review must contain zero open Blocking/Major findings

## Idempotence and Recovery

- Trace identity is derived from source Episode identity, source hash and normalizer version.
  Reprocessing an identical Episode returns the persisted Trace; source drift under the same
  identity fails closed.
- Pattern identity is derived from cohort fingerprint, algorithm version and canonical trace set.
  Repeated mining is byte-stable and inserts no duplicate.
- PostgreSQL leases use an opaque fencing token. Completion/failure by a stale token affects no row.
  Expired retryable runs are reconstructable into Redis; a lost Redis database loses only wakes.
- Down migration refuses to destroy P03 rows. Test databases can delete fixture rows before rollback.

## Artifacts and Evidence

- `reports/goal/v1.3-p03-source-map.json`
- `reports/goal/v1.3-p03-trace-schema.json`
- `reports/goal/v1.3-p03-golden-dataset.json`
- `reports/goal/v1.3-p03-mining-report.json`
- `reports/goal/v1.3-p03-completion.md`
- `reports/goal/v1.3-p03-review.md`
- `reports/goal/v1.3-p03-handoff.json`
- ADR-118, migration 0126, traceability/status/changelog updates and clean-gate log

## Outcomes and Retrospective

Pending implementation, full evidence gate and independent review.
