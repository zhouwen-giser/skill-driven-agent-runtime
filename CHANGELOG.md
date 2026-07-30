# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog, and planned commits use Conventional Commits.

## SDAR v1.3 P11 Case Template and Model Route Runtime

- Added ten frozen V1.1 Case/Model Route contracts with exact registry hashes,
  immutable values, stable reason codes and deterministic decision/profile
  snapshot hashes.
- Added a type-keyed Fast Gateway adapter registry without changing P10
  authority ordering. Case retrieval/adaptation preserves tenant, failure,
  scope, sensitive-data and current-state gates and submits candidates only
  through the existing P08 formal handoff port.
- Added Provider Registry/readiness-owned secret-free Model Profiles, hard
  capability/classification/residency/schema/capacity gates and a bounded
  serial Cascade with stale, cancellation, deadline, token, cost and output
  validation checks.
- Reused the existing encrypted credential authority, provider transport and
  model invocation audit. Migration 0133 persists immutable Case, Route and
  Cascade evidence with transactional `model_route.selected` and
  `model_cascade.escalated` Outbox facts; P02 Artifact rows remain unchanged.
- Added bounded Management API/OpenAPI/Console-client evidence projection with
  no credentials or sensitive prompt content, plus Unit/Contract, real
  PostgreSQL Integration and Gateway-to-provider E2E coverage.

## SDAR v1.3 P10 Fast Gateway and Artifact Runtime Feedback

- Added frozen V1.1 request, Gateway, decision-record and feedback contracts
  with canonical hashes, bounded immutable data and stable reason codes.
- Added a feature-gated Task preparation orchestrator with strict Auth, Tenant,
  Authorization, Policy and Kill Switch ordering before P07 retrieval, P09
  Rule evaluation, P08 Template/formal handoff or existing Cognitive Fallback.
- Added absolute deadline/cancellation propagation, fallback reserve, late
  discard, formal commit guards, independent adapter/fallback bulkheads,
  tenant/adapter/failure circuits and authority-preserving load shedding.
- Added migration 0132, PostgreSQL idempotency/decision/feedback/Outbox
  authority, P02 Artifact feedback correlation, P06-only drift signals and
  actor deletion propagation through Gateway-owned Outbox evidence.
- Added bounded Management API/OpenAPI/Console Gateway evidence without request
  text, credentials or private reasoning; A2A and SSE Task semantics remain
  unchanged.
- Added Unit/Contract, real PostgreSQL/Redis Integration, A2A E2E, concurrency,
  resilience, security and local performance evidence. Final verification
  passes 1,069 Unit/Contract, 119 Integration, 63 E2E and 25 migrations.

## SDAR v1.3 P09 Decision Rule and Policy Runtime

- Added frozen V1.1 P09 decision context, condition result, decision result,
  conflict resolution, bounded plan patch and runtime contracts with a strict
  portable Rule DSL, typed operator catalog, three-valued logic and pure stable
  hashing.
- Added fail-closed active Rule evaluation with Rule/pointer/tenant/Goal/Plan,
  policy, authorization, catalog, readiness and kill-switch double rechecks;
  policy and authorization always override Rule advice.
- Added deterministic deny/confirmation/specificity/priority/version/stable-ID
  conflict handling, low-risk confirmation-bound parameter suggestions and
  conservative plan patches admitted only through the existing validator and
  P08 interactive planning authority.
- Reused P02 `artifact_execution`, `artifact_feedback` and Outbox authority
  through an exact-replay/idempotency adapter; formal Outcome remains
  reference-only and drift only signals P06 revalidation.
- Added focused Unit/Contract and real PostgreSQL integration coverage for
  bounds, injection, stale state, cross-tenant/auth failures, concurrency,
  replay conflicts, formal handoff and 1k-rule deterministic resolution. P09
  adds no public route, Fast Gateway or direct Skill/MCP/Workflow execution.

## SDAR v1.3 P08 Plan Template Runtime and Formal Planner Handoff

- Added frozen V1.1 P08 Domain contracts for template instantiation, immutable
  Goal context, materialized candidate graph, result and formal handoff facts.
- Added a fail-closed P07-to-P08 materializer with active pointer/hash/version,
  Goal/policy/catalog/readiness/kill-switch double rechecks; parameter source,
  trust and schema checks; DAG, criteria, parallel, conditional and recovery
  preservation; and bounded adaptation evidence.
- Reused the existing validator, interactive planning session, confirmation,
  Goal lock and UserGoalPlan handoff through a narrow materialized-candidate
  session seam. P08 never creates a second plan authority or executes a Skill,
  Provider, MCP operation or Workflow.
- Recorded P08 usage/handoff correlation through P02 Artifact execution and
  feedback authority. Added focused regressions for success, stale discard,
  forbidden parameter source and formal-session confirmation.
- Made infrastructure/server smoke checks create and drop an isolated database
  so complete verification does not depend on or reset an operator's historical
  local database.

## SDAR v1.3 P07 Active Artifact Retrieval and Applicability

- Added nine frozen V1.1 P07 contracts for active-index entries, matches,
  applicability, parameter binding, dependencies, readiness and the
  non-executable runtime decision handoff.
- Added P02 PostgreSQL active-pointer Level-0 projection and immutable
  definition reloads, deterministic exact/structured/semantic retrieval and
  stable score ordering that cannot override hard safety gates.
- Added restricted AST applicability, source/trust/confidence parameter
  binding, current capability/Skill/provider checks, policy/OOD/kill-switch
  gates, durable match/decision audit and migration 0131.
- Added dependency evidence validation and a P06-atomic revalidation request
  that preserves global P05 dataset ID/version/hash pins; Redis remains
  rebuildable wake/cache state only.
- Added focused P07 unit/contract/PostgreSQL integration coverage, a global
  evidence-pin regression, independent read-only review closure and passed
  full verification. No P08 public gateway or execution path was implemented.

## SDAR v1.3 P06 Shadow, Promotion and Governance

- Added six frozen P06 governance contracts and a pure Domain canonical
  SHA-256 primitive that preserves the compiler-domain runtime boundary.
- Added migration 0130 and PostgreSQL-authoritative Shadow lifecycle,
  promotion evidence/policy/package, approval/activation, revalidation,
  critical deprecation and rollback projection records.
- Added non-blocking current-state-pinned Shadow orchestration and wake-only
  BullMQ workers; prohibited operations produce durable unsafe evidence rather
  than physical actions.
- Bound promotion coverage to immutable P05 replay/P06 formal evidence,
  persisted P02 activation validation summary IDs, and atomically cleared P02
  parent leases at Shadow terminalization.
- Added real P05 -> P06 -> P02 PostgreSQL integration, safety-source failure,
  P02 parent lease and active-definition regressions. Independent review closed
  with no Blocking/Major/Minor findings; final isolated `pnpm verify` passed.

## SDAR v1.3 P05 Replay Dataset and Artifact Validation Engine

- Added strict immutable V1.1 contracts for Replay Cases, Dataset manifests, Validation Runs,
  Results, Failures and Counterexamples with the frozen Registry hashes.
- Added deterministic four-purpose Dataset construction, snapshot completeness and group/time/
  near-duplicate/Candidate-source leakage guards plus tenant deletion and bounded retention.
- Added a fail-closed snapshot-only Replay provider that rejects credentials, network, MCP,
  Provider, device, external writes and formal runtime mutations before a physical boundary.
- Added Plan Replay through the existing `validateUserGoalPlan`, Rule and Counterfactual evaluators,
  a transparent 29-metric catalog, immutable result pins and reproducible result hashing.
- Extended P02's canonical `artifact_validation_run` through migration 0129 and added durable
  Case/Dataset/Result/Failure/Counterexample children, lease fencing, bounded retry, cancellation,
  stale-pin rejection and completion Outbox without changing Candidate lifecycle state.
- Added wake-only BullMQ dispatch/reconciliation and Server composition. Real PostgreSQL/Redis
  integration covers the Formal P03 -> P04 -> P02 -> P05 chain, Redis loss/rebuild/deduplication
  and tenant deletion propagation.
- Added reproducible 1k/10k Dataset and 2k Replay performance measurements. P05 does not implement
  Shadow, Approval, Promotion, activation, Fast Gateway or P06 behavior.
- Closed the independent Review findings by deriving Replay fixtures from native frozen Episode
  facts, connecting NoPhysical denial to persisted unsafe Result/Failure/Counterexample evidence,
  emitting `artifact.validation_completed`, and executing Metric Catalog aggregation/minimum-sample
  rules with run-independent Result hashes.
- Replaced destructive source-deletion cascades with Dataset/Run invalidation, immutable successor
  Dataset versions and retained terminal audit facts; added database protection for terminal Runs.
- Added exact Case alignment, Environment/Device/five-minute split grouping, Rule unknown/conflict/
  policy override and Counterfactual criterion/risk/recovery deltas.
- Added real PostgreSQL fencing, retry/dead-letter, cancellation, stale-pin, four-worker bounded
  throughput/backpressure tests and measured BullMQ queue lag. P06 changes remain dependency and
  immutable-Handoff alignment only.
- Pinned production Replay inputs to the exact historical Task Understanding and Capability
  Summary revision/catalog hash instead of mutable current Skill rows; the regression disables all
  current Skills and still reconstructs five valid historical Episodes.
- Closed five independent read-only Review rounds at `14eb978` with 0 Blocking, 0 Major and
  0 Minor. All 43 acceptance criteria and the complete repository verification gate pass; the
  Candidate remains non-executable and P06 implementation has not started.

## SDAR v1.3 P04R P03/P04 Semantic Alignment Remediation

- Upgraded Activity Identity, Trace Event, Process Variant and Workflow Pattern contracts to V1.2,
  separating lifecycle `eventType` from formal `activityKey` and preserving repeated, self-loop,
  explicit parallel, branch and recovery semantics with cohort-derived quality.
- Added fail-closed P04 generalization safety, live Capability Catalog validation, three independent
  fingerprints and exact DAG/parallel/conditional compilation without losing parameters,
  applicability, lineage or recovery data.
- Added Static Validator V1.2 and a durable Candidate generation application/runtime path through
  PostgreSQL, P02 `ArtifactRepository.saveCandidate`, transactional validation/lineage/Outbox and a
  completed run; Redis stores run-ID wakes only.
- Added migration 0128, real Formal-fact P03→P04→P02 PostgreSQL integration and real Redis
  loss/restart/fencing/dead-letter coverage.
- Published Shared Interface Registry V1.2 and aligned P03/P04/P05 locks, P13 audit, the execution
  matrix and P04R-aware aggregate validation without changing P00-P02 authority or adding G23.
- Independent Reviews A/B/C closed with 0 Blocking and 0 Major findings. P03, P04 and P04R Handoffs
  are `COMPLETED`; 47/47 P04R criteria and the exact clean `pnpm verify` gate pass.

## SDAR v1.3 P04 Pattern Generalization and Plan Template Candidate Compiler

- Added frozen `FusedPattern`, `GeneralizedPattern`, and `CandidateStaticValidationResult` Domain
  contracts with strict factories, content-hash helpers, and schema hashes matching
  `CONTRACT-LOCK.json`.
- Added `PatternFusionService` that fuses P03 structural facts with optional LLM semantic
  candidates; structural facts are read-only and never overwritten by model output. A `NoOpSemanticModel`
  provides a zero-LLM default path.
- Added `PatternGeneralizationService` with five anti-overfitting rules: no single-device
  globalization, no cross-user preference hardening, no temporary-auth hardening, no one-success
  universal pattern, and no failure-boundary deletion.
- Added `ArtifactCandidateGenerator` producing `CompiledArtifact` with `status=candidate`,
  `artifactType=plan_template`, `executable=false` (domain invariant), and a 7-input SHA-256
  fingerprint for duplicate detection.
- Added `PlanTemplateCompiler` with step classification (action/observation/reasoning/verification/
  recovery/human_gate), capability-only mapping (no `skill:` prefix), acyclic Skill Goal DAG,
  parameter extraction with trust-level policy, completion contract template, and recovery branches
  with `sideEffectReplayPolicy=forbidden`.
- Added `CandidateStaticValidator` with 8 checks (schema, DAG, criteria coverage, capability shape,
  parameter policy, replay safety, bounds, duplicate fingerprint). `passed_static` is explicitly not
  a promotion signal.
- Added migration `0127_v13_artifact_candidate_generation` with 5 non-authoritative child tables.
- Added wake-only BullMQ worker for `sdar-compiler-pattern-generalization` and
  `sdar-compiler-artifact-generation` queues.
- Moved hash computation (`createHash`) from Domain to Application layer to satisfy the
  `ARCH_ARTIFACT_DOMAIN_IMPORT_FORBIDDEN` architecture gate.
- Full `pnpm verify` gate passes on a clean self-managed-compose database (7/7 steps, 841
  unit/contract, 100 integration, 62 E2E, 20 migrations through 0127, architecture, build, smoke).
- Review 1 self-audit concludes 0 Blocking / 0 Major / 0 Minor; final ACCEPTED verdict is
  `PENDING_USER_CONFIRMATION`. P05 Handoff emitted with 3 produced and 3 consumed contracts.

## SDAR v1.3 P03 Experience Trace and Process Mining — remediation closure

- Added strict frozen ExperienceTrace, event, cohort, variant, discovered-pattern and
  WorkflowPattern Domain contracts with deterministic, redacted formal Episode normalization.
- Added migration 0126 projections and PostgreSQL-authoritative compiler runs with lease fencing,
  bounded retry/dead letter, source-event lineage, deletion propagation and tenant isolation.
- Added deterministic TypeScript process mining for variants, direct-follows, precedence, explicit
  parallel evidence, recovery/failure separation and frozen quality metrics without a Python
  sidecar, model authority, Skill binding or Artifact creation.
- Connected the product Server lifecycle to source-event dispatch, wake-only BullMQ workers and
  PostgreSQL reconcilers so Redis loss cannot lose durable work.
- Closed the first independent review's 2 Blocking, 4 Major and 2 Minor findings: formal Source
  compatibility, real 10k PostgreSQL persistence, content-hashed Brotli Pattern envelopes,
  terminal-attempt crash recovery, strict nested schemas, real Redis rebuild, tenant-scoped reads
  and quantitative DB/worker/queue evidence.
- Remediation tests pass 828 unit/contract, 100 integration and 62 E2E plus migration, architecture,
  A2A/OpenAPI and build gates. Final operator infrastructure smoke and independent re-review remain
  open; P03 is not yet marked complete and P04 has not started.
- The second independent review closed all original findings but rejected `1f7e043` with three new
  Major findings: timestamp-colliding/unbounded mining triggers, synchronous event-loop work and
  missing formal Task Source attribution.
- Working-tree remediation batches up to 1,000 source events per cohort, uses event-set identity plus
  a cohort advisory lock and 60-second durable rate window, limits mining concurrency to one, yields
  every 128 traces, compresses with asynchronous Brotli and restores `task_request` authority refs.
  Static regression passes 829 unit/contract tests; real integration and another review are pending.

## SDAR v1.3 P02 Artifact Persistence, Registry and Governance — complete

- Added migration 0125 with the ten exact frozen Artifact authority tables, replayable rollback,
  bounded JSON depth/size, immutable versions and a unique CAS Active Pointer.
- Added lossless P01 Artifact/Lineage/Runtime Binding persistence, projection-drift detection,
  validation, approval, execution and feedback repositories.
- Added transactional activation with validation/approval evidence, idempotent PostgreSQL audit,
  pointer locking/CAS and Outbox publication in one commit boundary.
- Added the frozen Artifact Registry, rebuildable Level-0/Level-1 and version projections, canonical
  event/queue/feature-flag vocabularies and durable at-least-once Outbox cursor.
- Added fail-closed production identity, RBAC, tenant scope, reason/idempotency/expected-version
  governance, separate approval/activation, revalidation, deprecation, rollback and bounded kill
  switch foundations.
- Added frozen-contract, migration, JSON-bound, immutable-round-trip, no-approval, concurrent
  activation, idempotency, rollback, execution/feedback, cache and Outbox tests. The working-tree
  full gate passes.
- The first independent review rejected `591cbe4` with 4 Blocking, 6 Major and 1 Minor finding.
  Remediation prevents stale revalidation evidence and cross-tenant governance, preserves monotonic
  Pointer CAS after deprecate/kill switch, delivers late Outbox events, enforces immutable
  projections and bounded canonical JSON, assigns per-run/approval/feedback event revisions,
  keyset-rebuilds all Active entries and removes mutable Set surfaces.
- Added explicit regressions for different-body idempotency conflicts, two validation/approval
  cycles, kill-switch ABA, tenant denial, two feedback rows, late events, 501-entry rebuild, exact
  table columns, complete JSON boundaries and startup composition. The remediated working-tree full
  gate passes 795 unit/contract, 89 real integration and 62 real E2E tests.
- The second independent review rejected first-remediation commit `ee52158` with 1 Blocking and
  2 Major findings. The projection consumer now uses database-monotonic insertion sequence plus its
  private CAS cursor, never marks shared Outbox rows published, refreshes version cache across the
  full validation/approval lifecycle, and checks immutable Lineage creation time.
- Added real Server-startup regression with mixed handled/unhandled Outbox events, lifecycle cache
  transitions and database-rejected Lineage mutation. Focused verification passes; the
  second-remediation working-tree full gate passes 795 unit/contract, 91 integration and 62 E2E
  tests, and exact commit `e740fa1` passes the same gate with `dirty=false`.
- The third independent review rejected `e740fa1` with one Blocking finding: IDENTITY allocation can
  be observed out of transaction commit order. Relevant-event cursor allocation now acquires a
  transaction-scoped advisory lock before assigning `max + 1`, with a concurrent PostgreSQL
  regression proving the second producer waits and remains readable after cursor advance. Focused
  type/lint/contract, 18-migration replay and 8/8 real integration scenarios pass. The complete
  working-tree gate passes 795 unit/contract, 92 integration and 62 E2E tests plus all build/smoke
  stages.
- Exact implementation commit `14abffe` passes the same full gate with `dirty=false`. A fourth new
  independent read-only reviewer accepts with zero Blocking/Major/Minor findings; P02 emits its
  exact 28-field `COMPLETED` Handoff for P03.

## SDAR v1.3 P00 foundation gate — complete

- Added the frozen fifteen-package execution bundle and persistent serial-orchestration state.
- Verified the execution baseline SHA, all package contracts and a clean full local gate without
  changing the protected operator database.
- Added a reproducible P00 actual-contract/Handoff evidence validator and immutable P00 verification
  report.
- Recorded explicit repository-owner acceptance of the audited v1.2.3 external-merge deviation across
  all three authoritative records without claiming native auto-merge or the absent unmerged state.
- Re-ran the complete clean gate at `6e27d70` and obtained a fresh independent `READY_FULL` review.
- Restored authenticated publication, pushed the integration branch and created Draft PR #12 without
  merge, tag, release or deployment.

## SDAR v1.3 P01 Runtime Artifact Domain — complete

- Added all 15 frozen P01 Artifact Domain contracts and registry-pinned hashes, including five
  definition kinds, applicability, dependency snapshots, lineage and rebuildable runtime bindings.
- Added immutable factories, bounded declarative JSON/conditions, deterministic canonicalization and
  lifecycle transitions requiring validation plus approval evidence before activation.
- Added strict Zod and draft-2020-12 JSON Schema contracts, a five-definition golden fixture and
  cross-validator negative tests.
- Aligned PlanTemplate nested fields with the exact shared-design/P04 consumer contracts and added
  SDAR AJV keywords for recursive depth, condition complexity and keyed uniqueness.
- Closed the first independent review's activation and enum findings with direct-construction
  evidence enforcement, nested enum guards and exhaustive lifecycle/cross-validator regressions.
- Added an architecture gate that prevents Artifact Domain dependencies on database, application,
  Skill/MCP/Provider execution, Console, queue, LangGraph, Zod or AJV.
- The first independent review rejected readiness; remediation passes 20/20 focused tests and the
  post-remediation full gate passes 785 unit/contract, 84 real integration, 62 real E2E, architecture,
  A2A, migration, Replay, build and smoke. A new independent re-review accepts with zero
  blocking/major findings. Completion commit `8ac5f5e` passes the same full gate with `dirty=false`;
  the standard Handoff is `READY_FULL` with zero blockers.

## [1.2.3] - Unreleased

### Added

- G17 unified PostgreSQL-authoritative cognitive startup reconciliation, named user-deletion
  propagation, review-only retention application and executable six-stage rollout policy.
- v1.2.3 clean release verification, classified security/recovery/capacity evidence and protected-review
  release report.
- G16 immutable Planning Replay datasets with request/world/accepted Contract and Plan/corrections/
  Outcome/catalog/knowledge provenance, six cognitive evaluation dimensions and complete planning
  quality/cost metrics.
- Disjoint deterministic `mutate_dev`/`promotion_test` partitions, side-effect-free
  Baseline/Champion/Candidate Shadow verdicts, hard-failure non-regression and reproducible Promotion
  reports through audit-only migration 0124.
- A conservative production Replay evaluator, explicit `NoPhysicalProvider` zero-call guard,
  incubating Candidate enforcement, generated fixture artifact and `verify:cognitive-replay` gate.
- The complete SDAR v1.2.3 Goal package, Master ExecPlan and machine-readable Goal sync state.
- ADR-111–114 for cognitive planning authority, Experience/knowledge governance, deterministic
  snapshots/CAS and post-v1.2.2 migrations.
- G00 cognitive Domain factories, stable errors/states/events/feature flags, Application Ports, JSON
  Schema Golden fixture and additive 0108 DDL skeleton.
- A cognitive reverse-dependency/Python-runtime architecture guard and six exact-commit OSS
  design-reference intakes with license/NOTICE verification.
- G01 deterministic exact-Skill Capability Catalog hashing, declared Capability Summary aggregation,
  bounded Level-0 Index/Level-1 Detail, PostgreSQL active snapshots and catalog-change projection.
- Management `GET /api/v1/capabilities/summary` and `POST /api/v1/capabilities/rebuild` contracts with
  OpenAPI schemas; summaries intentionally exclude live Provider readiness.
- G02 allowlisted Public Capability Profile/Card snapshots, transactional PostgreSQL activation,
  deterministic narrative fallback, A2A snapshot projection and the optional
  `io.sdar/capabilityProfile` extension.
- Management `GET /api/v1/capabilities/card` and `POST /api/v1/capabilities/card/rebuild`, plus a real
  Capabilities Console view over the activated snapshot.
- G03 bounded Generic Task Understanding with deployment-owned Task Type fixtures, Capability Summary
  checks, three-severity missing dimensions, immutable PostgreSQL revisions and audited model lineage.
- Management current/revision Task Understanding reads and Task Console evidence links.
- G04 restart-safe Interactive Goal Sessions with information-gain clarification, immutable
  Understanding revisions, reviewable Goal Contract candidates/diffs, bounded rounds and
  PostgreSQL CAS/idempotency/outbox evidence.
- Management Goal Session read/action operations, operational Task Console review controls and A2A
  `io.sdar/interaction` metadata at the existing `INPUT_REQUIRED` boundary.
- G05 restart-safe Interactive Planning Sessions, immutable User Goal Plan candidates, strict audited
  natural-language patch compilation, full candidate validation and confirmed-only v1.2.2 handoff.
- Management Planning Session read/action operations, operational DAG/diff/validation Console controls
  and A2A plan-review metadata at the existing `INPUT_REQUIRED` boundary.
- G06 immutable Planning Correction Facts and deterministic Interaction Episode revisions spanning
  Understanding, Goal Contract, Plan review, final Outcome and later counterexamples.
- G14 governed Experience-enriched planning decorator with off/shadow/advisory/low-risk-active modes,
  bounded fail-open base replanning and immutable Contract/readiness/terminal authority.
- Transactional planning knowledge usage lineage from Plan Candidate and affected Skill Goals through
  Validator/user action to final runtime Outcome, with additive migration 0122.
- Scoped low-risk user-preference projection into the existing Memory service, exact-user retrieval,
  propagated deletion, task/user/tenant correction queries and management interaction evidence.
- G07 PostgreSQL-transactional terminal outbox, leased/retryable Experience jobs, immutable redacted
  Goal Episodes, rebuildable BullMQ job-id wakes, dead-letter inspection/replay and operational API
  evidence. The implementation is pushed; real integration/E2E remain an explicit release blocker.
- G08 source/model-linked Experience Observations, twelve independent Zod/JSON-Schema typed
  extractors, evidence partitioning, bounded prior-Observation consolidation, fast/reasoning tiers,
  no-op and failure isolation, PostgreSQL Observation/outbox/reflect-job persistence, rebuildable
  BullMQ observation wakes, migration 0116 and operational API/Console evidence. Publication and real
  Docker-backed verification remain blocked by the platform approval limit.
- G09 Candidate-only Experience Reflection with helpful/harmful/neutral impact, de-instantiated
  fingerprint plus lexical/semantic identity, strict six-operation Curator Deltas, deterministic
  no-op validation, positive/negative evidence and merge/supersede lineage. Migration 0117,
  PostgreSQL/BullMQ persistence, Reflection API/Console and A2A evidence are published and
  Docker-backed verification passes.
- A Management API contract regression for the `experience_reflection` model route, plus real
  terminal-authority integration fixtures covering Contract, Plan, Skill Attempt and User Goal
  Judgment eligibility.
- G10 Candidate-only Task Type induction with seven-dimensional canonical fingerprints,
  deterministic pre-model clustering, strict Recognition/Negative Example/dimension/Criteria/
  Capability/Goal/Dependency abstraction, Offline/Online revisions, 1–3 real Episode Exemplars and a
  current-context Applicability Guard.
- PostgreSQL Task Type origin/model lineage, fingerprint index, compatible support evidence and
  `knowledge.candidate_created` transaction through migration 0118, plus
  `GET /api/v1/task-types`, 142-operation OpenAPI and Cognitive JSON Schema/Golden coverage.
- G11 grounded Candidate Capability Pattern induction with complete applicability/effect/evidence/
  artifact/prerequisite/dependency/failure/limitation signals and separate
  Declared/Observed/Validated evidence.
- Exact current Skill Version mapping with mandatory current Readiness/compatibility checks,
  catalog/policy invalidation, separate non-executable Capability Gap Candidates, migration 0119,
  `GET /api/v1/capability-patterns` and 143-operation OpenAPI/JSON Schema coverage.
- G12 governed Knowledge Promotion with shared deterministic evidence/replay/duplicate components,
  separate Heuristic/Task Type/Capability Pattern targets, exact-revision CAS/audit and manual
  activation.
- Active-only rebuildable Memory projection, contradiction/rejection/policy/catalog/Skill-version
  invalidation, migration 0120, four lifecycle APIs and 147-operation OpenAPI/JSON Schema coverage.
- G13 scoped Active-only Vector+FTS retrieval with deterministic RRF, bounded five-type relation
  expansion, Planning-Session usage dedupe and transactional `planning.knowledge_used` evidence.
- Strict Level-0 Index → selected Full Definition → complete current exact Skill disclosure, with
  frozen kind limits, conflict separation and a factory-verified 20K total context budget.
- G15 complete Capability/Understanding/Goal Session/Planning Session/Experience/Knowledge management
  reads, exact-ID history, Planning Heuristic inventory and PostgreSQL cognitive-action audit.
- `InteractiveActionRouter` for exact-session A2A continuation and
  `A2AInteractionProjection.toInputRequired` with routing-only public metadata.
- Operational Experience/Knowledge/Task Type governance Console, audit/error details and optional
  per-tab bearer token support without Provider/Outcome/Active Plan mutation controls.
- ADR-115, optional deployment-configured bearer authentication and restart-stable
  actor/reason/CAS/idempotency audit through additive migration 0123.

### Changed

- G17 publication evidence now distinguishes the verified external owner-authenticated PR #9 merge
  from an unproven native auto-merge mechanism, with exact public event IDs, merge metadata, current
  repository settings and corrective Draft PR #11 containment.
- The task-package self-check now uses `fileURLToPath` on Windows and remains protected by its updated
  package hash manifest.
- Runtime migration startup accepts only the ordered v1.2.2 baseline plus known `01xx_v123_*` prefix;
  the v1.2.2 baseline SQL remains unchanged.
- Skill version writes append `skill.catalog_changed`; the single Server process retries deterministic
  Summary projection while PostgreSQL remains the only durable authority.
- Successful Skill catalog mutations now await the serialized Summary-to-Card projection. A2A requests
  never call a model and fail closed rather than serving a hash-mismatched Card.
- Ambiguous Task preparation now persists a validated Understanding before requesting input; explicit
  requests preserve the v1.2.2 Goal path and unconfirmed candidates never become authority.
- Confirmed G04 Goal Contracts now generate non-authoritative plan candidates first. Only an explicit
  G05 accept under the `goalId + goalVersion` lock may create the existing formal plan and schedule it.
- G04/G05 interaction actions and terminal Outcomes now append non-authoritative correction/Episode
  evidence; task, tenant, global-candidate and safety/authorization corrections never auto-promote.
- Terminal Outcome commits now atomically append `user_goal.terminal_committed`; asynchronous
  Experience capture cannot become Goal/Plan/Outcome authority or delay the terminal transaction.
- Cognitive Outbox JSONB constructors use explicit text boundary casts, and duplicate Episode delivery
  completes against the already persisted immutable Episode after a crash/retry boundary.
- G03 continues to read deployment-owned static Task Types only. G10 induced Candidates remain
  operational evidence and cannot affect formal Understanding before G12 promotion.
- G11 Candidate Patterns likewise remain outside Understanding and Planner. Observed success cannot
  assert Skill or Provider Readiness, and unmapped Gap proposals are manual-only with
  `publishAllowed=false`.
- Only G12 Active knowledge can be projected for retrieval. PostgreSQL remains authoritative and
  Memory reconciliation rebuilds missing projections and invalidates stale ones; Promotion cannot
  publish a Skill or bypass current Readiness/compatibility and confirmation.
- Generic Memory searches exclude Active Knowledge projections. G13 alone joins vector projections
  back to exact scoped PostgreSQL authority, while Reflection persists governed Candidate relations
  that remain unavailable until Promotion.
- Cognitive write requests now use one strict actor/reason/expectedVersion/idempotency envelope.
  Trusted-intranet/no-auth remains the default; configured bearer deployments authenticate before any
  action claim or business mutation.
- A2A `io.sdar/interaction` no longer embeds Candidate Contract/Plan or internal Understanding data;
  it carries only Session routing metadata at the standard `INPUT_REQUIRED` boundary.

### Verification

- G15 affected gates pass 597 unit, 157 contract, 84 real PostgreSQL/Redis integration and 62 real
  Server/A2A E2E tests, 152 OpenAPI operations, 419-source architecture, A2A MUST 74/74, production
  build, isolated Server/Console smoke and all 16 additive migrations through 0123.
- G00 verified. The isolated-database full gate passes 635 unit/contract, 68 integration, 59 E2E,
  A2A MUST 74/74, 124 OpenAPI operations, migration rollback/reapply, build and both smoke stages in
  168,876 ms; implementation commit `ffd9791` is pushed and Draft PR #8 remains Draft.
- G01 affected gates pass 501 unit, 144 contract, 70 real integration and 60 real E2E tests, migration
  0108/0109 rollback/reapply, 126 OpenAPI operations and production build. The first E2E run retained an
  unrelated remote-lifecycle timing failure; recurrence exposed an empty-array polling defect, whose
  stronger wait condition is covered by the final 166,839 ms full `pnpm verify` including both smokes.
  Implementation `820d78d` is pushed and Draft PR #8 remains Draft.
- G02 passes the isolated 159,967 ms unified gate on implementation `2ec8987`: 656 unit/contract, 71
  real integration, 61 real E2E, A2A HTTP-JSON MUST 74/74, 128 OpenAPI operations, 318-source
  architecture, migration 0108–0110 rollback/reapply, production build and both smokes. The retained
  first E2E failure (54/61) identified and fixed the Skill-to-Card projection gap; Draft PR #8 remains
  Draft.
- G03 affected gates pass 663 unit/contract, 72 real integration, 62 real E2E, 130 OpenAPI operations,
  323-source architecture, migration 0108-0111 rollback/reapply and production build. The retained first
  E2E failure was an absent-property assertion defect; the product path already reached
  `INPUT_REQUIRED`. Implementation `05b4df4` is pushed and Draft PR #8 remains Draft.
- G04 affected gates pass 667 unit/contract, 73 real integration, 62 real E2E, 132 OpenAPI operations,
  329-source architecture, migration 0108-0112 rollback/reapply and production build. Implementation
  `d226bfb` is pushed and Draft PR #8 remains Draft.
- G05 affected gates pass 526 unit, 149 serial contract, 74 real integration, 62 real E2E, 134 OpenAPI
  operations, 338-source architecture, migration 0108-0113 rollback/reapply and production build.
  The retained parallel-contract timing flake passes in isolation and the full serial contract gate;
  implementation `02a367d` is pushed and Draft PR #8 remains Draft.
- G06 affected gates pass 529 unit, 150 serial contract, 75 real integration, 62 real E2E, 136 OpenAPI
  operations, 344-source architecture, migration 0108-0114 rollback/reapply and production build.
  Failed test-first, assertion-shape, formatting, lint, CLI-option and non-TTY build attempts are
  retained in `reports/goal/g06-completion.md`; implementation `cade96f` is pushed and Draft PR #8
  remains Draft.
- G07–G09 closure passes 549 unit, 152 contract, 79 real PostgreSQL/Redis integration and 62 real
  Server/A2A E2E tests, plus 141 OpenAPI operations, 372-source architecture and the ten additive
  migrations through 0117 with idempotency, rollback/reapply, guarded reset and rogue-ledger rejection.
  The earlier platform, stale-`dist`, API-enum and SQL/fixture failures remain recorded. Commits
  `301606e`, `2d600fc` and `c8754fd` are pushed; replacement PR #9 remains Draft.
- G10 passes 554 unit, 153 contract, 80 real PostgreSQL/Redis integration, 62 real E2E, 142 OpenAPI
  operations, 378-source architecture, A2A MUST 74/74, production build and the eleven additive
  migrations through 0118. The test-first, optional-constraint, PostgreSQL inference and lint failures
  remain recorded in `reports/goal/g10-completion.md`; implementation is `c36e83d`.
- G11 passes 560 unit, 154 contract, 81 real PostgreSQL/Redis integration, 62 real E2E, 143 OpenAPI
  operations, 385-source architecture, A2A MUST 74/74, production build and the twelve additive
  migrations through 0119. Test-first, sandbox/port, command-name, lint/type and restart-idempotency
  failures remain recorded in `reports/goal/g11-completion.md`; implementation is `16441f3`.
- G12 passes 568 unit, 155 contract, 82 real PostgreSQL/Redis integration, 62 real E2E, 147 OpenAPI
  operations, 397-source architecture, A2A MUST 74/74, production build, Server smoke and the
  thirteen additive migrations through 0120. Test-first, sandbox/port, migration-ledger, command,
  fixture-ID, HTTP-conflict and exact-revision review failures remain recorded in
  `reports/goal/g12-completion.md`; implementation is `59f20f6`.
- G13 passes 575 unit, 155 contract, 83 real PostgreSQL/Redis integration with measured P95 4.476 ms,
  62 real E2E, 147 unchanged OpenAPI operations, 408-source architecture, production build, Server
  smoke and the fourteen additive migrations through 0121. Retained failures and fixes are recorded
  in `reports/goal/g13-completion.md`; implementations are `1879ff1` and `3201325`.

## [1.2.2] - Unreleased

### Added

- The complete SDAR-only v1.2.2 Goal package with verified SHA-256 manifest.
- EP-12, ADR-109 and a frozen User Goal Plan/Skill Goal DAG, Skill outcome, layered judgment, progress,
  recovery/no-replay and Business Events client/impact implementation contract.
- AC-001–AC-078 traceability, G00 baseline, repository/symbol map, Legacy removal inventory, external
  dependency status and evidence index.
- Versioned User Goal completion contracts, validated Skill Goal DAG planning, compatibility-aware
  scheduling/attempts, layered outcome judges and persisted bounded recovery/no-replay.
- Strict Provider Business Events Profile 1.0 client, durable Inbox/dual cursors, generation drain,
  continuity/relation resolution, event impact, Incident handling and real Console/API projections.

### Changed

- v1.2.2 is a clean-slate development upgrade: Legacy MCP, Legacy Skill projection and competing terminal
  authorities are removed; Frozen MCP Tasks and the sole LangGraph runtime remain.
- User Goal planning must precede Skill selection, and only UserGoalPlanController may commit the User
  Goal/A2A terminal state.

### Verification

- Clean candidate `2db3996` passes unified verification: 629 unit/contract, 68 real integration, 59 E2E,
  296-source architecture, A2A MUST 74/74, 124 OpenAPI operations, clean baseline/migrations, production
  build and both smoke stages.
- Real Streamable HTTP interop passes against exact Provider `8a81b1b` with 260 Tasks, Task/Resource
  Events, 128/128/4 Relation pages, drain, Reset, continuity, unavailability, restart and reconnect.
- Evidence commit `3ba0d59` is pushed and Draft PR #7 is open/mergeable/clean; no merge or tag was made.

## [1.2.1] - Unreleased

### Added

- Frozen MCP Tasks V1.0 source/derived protocol package pinned to MCP commit `26897cc322f356487da89113451bd16b520b9288`, schema blob `cc44564e33305dbc07e820cdd0a97648f3852019` and SHA-256 `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708`.
- Frozen/Legacy Domain contracts, task-behavior outcome matrix, canonical runtime revision and Provider Evidence types plus a Workflow DSL union that keeps historical Legacy `mode` readable while rejecting it from Frozen plans.
- Migration 0107 and PostgreSQL repositories for append-only protocol snapshots, Server/Tool authority, output schemas, Workflow protocol contracts and Frozen binding/observation/control revisions, with fail-closed unsafe rollback.
- Frozen stateless HTTP client with normative per-request metadata/headers, validated discovery snapshots, JSON/SSE response correlation, frozen error normalization and explicit no-fallback Legacy/Frozen routing.
- Frozen Task lifecycle contracts for flat creation, immediate reconciliation, real TTL, numeric Runtime Revision monotonicity, partial MRTR, restart-safe input dedupe and cooperative cancel intent.
- Frozen Availability profile/client, frozen-only readiness attribute derivation and refreshed `embodied.move_to`/`embodied.area_patrol` package policies requiring observations plus Task Notifications.
- Frozen POST SSE Task subscriptions with Ack-first authorization, bounded interests, reconnect reconciliation and unified Runtime Revision admission across polling and notifications.
- Frozen Evidence A parsing/output-schema validation, exact-type local Skill matching, validated-only Workflow hard gates and execution-reference lineage for Provider evidence, local requirements, pointers/hashes and Runtime Revisions.
- Frozen Provider/Remote Task operational projections, transactional Frozen registration/refresh, protocol diagnosis, baseline audit, immutable mode guard, reconnect surface, version-CAS reconciliation and Console protocol/revision/observation status.
- Composed Frozen Notification runtime with durable post-Ack reconciliation, shared poll/Notification Runtime Revision admission, persisted Frozen contract/task behavior/TTL/revision authority and output-schema validation on every observation source.
- Explicit local Frozen Mock Provider conformance for send-time Task authorization and bounded producer overflow, plus a bounded 1 MiB client SSE receive buffer.
- ADR-108 explicit Legacy/Frozen dual-protocol boundary, Phase 0 OSS Intake and Draft PR #6 upgrade evidence.
- Nine derived JSON Schemas, nine valid fixtures, twelve Legacy/invalid fixtures and an eleven-file drift lock verified by `pnpm verify:protocol` and the normal bootstrap gate.

### Changed

- PROJECT_STATUS and v1.2 sync state now reflect protected PR #5 merge commit `922f428`; historical v1.2 reports remain unchanged.
- The exact MCP source Schema is vendored unmodified with attribution; derived SDAR schemas are separate modified artifacts and Frozen traffic cannot use the Legacy SDK Bridge.
- Package and SBOM component metadata target 1.2.1; the version remains unreleased while the refreshed clean exact-commit and remote publication gates are pending.

### Verification

- Phase 1 passes the focused protocol contract, `pnpm verify:protocol`, 20-source lock verification, format, lint and strict typecheck. The baseline contract remains 111/112 on this Windows host because the unchanged symlink fixture fails during setup with `EPERM`; Docker-backed baseline remains unverified while operator port 55432 is occupied.
- Phase 2 passes all 471 unit tests, focused Workflow unit/schema contracts, format, lint, strict typecheck and the 260-source architecture gate. The full contract suite is 112/113 because the unchanged Windows symlink setup still fails with `EPERM`.
- Phase 3 passes isolated real PostgreSQL migration verification, 58/58 Repository integration tests, all 471 unit tests, 260-source architecture, build and the static 71-migration/Compose gate; the unchanged symlink-only contract limitation remains explicit.
- Phase 4 passes 10/10 focused Frozen HTTP contracts, all 471 unit tests, 263-source architecture, format/lint/typecheck and production build; full contract is 122/123 only because of the unchanged Windows symlink `EPERM` limitation.
- Phase 5 passes 12/12 focused lifecycle contracts, all 471 unit tests, 265-source architecture, format/lint/typecheck and production build; full contract is 134/135 with only the unchanged Windows symlink `EPERM` limitation.
- Phase 8 passes 11/11 focused Evidence unit tests, 18/18 focused Evidence/lifecycle contracts, all 475 unit tests, isolated PostgreSQL Repository integration 58/58, 273-source architecture, format/lint/typecheck and production build; full contract is 153/154 with only the unchanged Windows symlink `EPERM` limitation.
- Phase 6 passes 6/6 Frozen Availability plus 5/5 formal Skill package contracts, all 471 unit tests, 267-source architecture, format/lint/typecheck and production build; full contract is 140/141 with only the unchanged Windows symlink `EPERM` limitation.
- Phase 7 passes 7/7 subscription and 19/19 combined subscription/lifecycle contracts, all 471 unit tests, 269-source architecture, format/lint/typecheck and production build; full contract is 147/148 with only the unchanged Windows symlink `EPERM` limitation. Provider-side queue overflow remains a Phase 10 component gate.
- Phase 10 passes 54/54 focused Frozen contracts, 480/480 unit, 84/84 real PostgreSQL/Redis integration, 60/60 E2E, 16/16 Legacy acceptance, migration 0107, protocol, 122-operation OpenAPI, 285-source architecture and production build. Full contract is 166/167 solely because Windows cannot create the unchanged symlink fixture. Local Client/Mock Provider component conformance is distinct from Phase 11 real Provider interoperability.
- Phase 12 maps all 26 adversarial items and clean exact commit `f7bdd7b` passes the complete self-managed `pnpm verify` with `dirty=false`: 648/648 unit+contract, 84/84 integration, 60/60 E2E, migrations, build and both smoke stages. Cross-platform link-fixture, migration-lifecycle and Mock TTL/window regressions are fixed. Phase 11 real Provider Runtime interop remains blocked by four external Frozen wire mismatches: missing Availability `reservationMode`, invalid MRTR/terminal fields in CreateTaskResult, and non-identical get/Notification content at one Runtime Revision. G3/G4/G5 remain blocked and PR #6 stays Draft.
- Provider Draft PR #15 was refreshed at exact head `65ac78a`: its shared get/Notification projection closes one prior mismatch, but required Availability `reservationMode` and base-only CreateTaskResult remain incompatible. Green CI plus 13/13 focused Provider tests do not establish SDAR interop, so G3/G4/G5 and Draft PR #6 remain unchanged.
- Phase 11 closure against Provider merged baseline `217e089` plus candidate `b30d839` passes Provider `verify:v2` (74/74 frozen, 29/29 closure, 79 unit, 9 contract, 199 integration, 9 recovery, 29 security, 6 E2E, TS/Python conformance, capacity and container) and the real SDAR HTTP Availability/MRTR/business/technical/Notification matrix. Projection-aware SDAR admission fixes the discovered base CreateTaskResult to first same-revision DetailedTask false mismatch while requiring identical Task base fields and retaining strict later equality; focused lifecycle passes 15/15. G3/G4 pass locally; G5 awaits the refreshed clean exact-commit SDAR gate and green remote checks.
- The first refreshed clean gate at `2ada181` passed 650/650 unit+contract, migrations and 84/84 integration before one E2E exposed a read-after-request race in lifecycle evidence. The test now waits for the unchanged strict PostgreSQL reconciliation projection instead of assuming that observing the mock `tasks/get` request means the following transaction has committed; the full E2E suite passes 60/60.
- Clean exact SDAR commit `61142f9` passes the refreshed seven-stage `pnpm verify` with `dirty=false` in 184,634 ms: 650/650 unit+contract, 84/84 integration, 60/60 E2E, 71 migrations, production build, infrastructure smoke and Server/Console smoke. Local G5 evidence is complete; final disposition awaits both PR remote checks.
- Provider PR #16 publishes the correction at final evidence head `4d90b199`; Actions run `29882714727` passes `runtime-ci` and `runtime-compose`. SDAR has no configured Actions workflow. G5 and PR #6 Ready status now await only protected Provider PR #16 review/merge; no automatic merge is authorized.

## [1.2.0] - 2026-07-18

### Added

- Phase 14 adversarial coverage for prompt-injected self-attestation plus a 22-threat audit across package, selection, planning, Provider readiness, recursive execution, evidence, confirmation, restart and legacy behavior.
- Phase 13 formal `embodied.area_patrol` recursive acceptance across exact fixed/dynamic child versions, bounded depth/cycles, four failure policies, parallel external waits, restart/cancel/input continuation, distinct degradation and complete parent/child execution trees.
- Phase 12 formal `embodied.move_to` vertical acceptance across guidance/template/procedure modes, exact Task calls, V1.1 remote waiting/continuation/input/cancel/restart, final-position hard gates and complete execution records.
- Phase 11 append-only Skill execution records with exact Goal/Skill/selection/policy/Workflow/Task identity, ordered lifecycle evidence, parent/child lineage, thin Provider/resource/RemoteTaskBinding/evidence/hard-gate/intervention/outcome references and queryable management trees.
- Phase 10 exact selected Usage evidence, bounded composition/interpretation and immutable policy wiring through the existing Task→Workflow Planner→Validator→outer confirmation path, including policy persistence and replan/revision/Goal Patch inheritance.
- Phase 9 exact-version Skill Usage planning policy, bounded guidance context, deterministic template/procedure-to-Workflow compilation, explicit Skill failure-policy DSL metadata and post-plan compliance checks through the existing Validator.
- Phase 8 exact Skill Task Type resolution, deterministic validated-semantics candidate attributes, required/preferred/forbidden Provider policy filtering and immutable v1.1 live-readiness summaries in the production Skill selection path.
- Phase 7 migration 0105 persists native exact-version Skill Usage snapshots and checksum-bound package import audit through the existing Registry transaction, with real validate/import, exact-version and filtered catalog API/Console surfaces.
- Phase 6 regenerated main-baseline repository/symbol/overlap maps and ADR-097–103 for exact usage, three modes, normative authority, bounded composition, package import, V1.1 readiness/continuation reuse and minimal execution records.
- Phase 5 bounded exact-version recursive composition through the existing Skill Graph/planner, dynamic capability slots, declarative parent/child mappings, immutable plans, four failure projections and safe guidance/template/procedure IR.
- Phase 4 structured applicability/context/readiness/mode decisions, fixed context authority ordering, mock-only `SkillTaskReadinessPort` and fail-closed filtering before the existing Skill model decider.
- Phase 3B reviewed `embodied.move_to` and `embodied.area_patrol` packages with three modes, Provider bindings, bounded composition/failure policy, evidence gates and checksum-pinned golden import snapshots.
- Phase 3A immutable current/exact-version catalog summaries, native/legacy usage diff, package import continuity, lifecycle projection and visibility/mode/derived-domain/exact-capability-tag filters through the existing Skill Registry.
- Phase 2 strict Skill Package JSON Schema, checksum-bound bounded UTF-8 reader, path/symlink/type/size guards, embedded-schema validation and immutable import candidates behind a filesystem adapter.
- Phase 1 immutable `sdar.io/v1alpha1` Skill Usage contracts with native/legacy snapshots, normative/adaptive separation, three modes, bounded Provider/composition/evidence policies and candidate-only patches.
- Frozen SDAR v1.2 EP-10, exact Goal task package, normalized Skill-driven capability-usage design, v1.1 overlap/symbol maps and recoverable Phase 0 baseline evidence.
- Frozen SDAR v1.1 MCP Tasks EP-09, requirement/acceptance addendum, Provider extension contract, repository/symbol/hardening maps and exact OSS pins.
- Phase 1 domain-owned immediate/remote result union, official v2 beta Tasks adapter, five-state snapshots, capability negotiation and real modern/legacy loopback contracts.
- Phase 2 durable `RemoteTaskBinding`, ordered observations, idempotent controls/protocol attempts, isolated migration 0100, versioned PostgreSQL polling and one-attempt BullMQ reconciliation.
- Phase 3 domain-owned Task timing/readiness, strict bounded DSL, structured risk decisions, fail-closed confirmation guards, exact-argument pre-call refresh, append-only migration 0101 evidence and read-only management/Console projections.
- Phase 4 bounded persisted-frontier continuation, PostgreSQL control inbox claims/attempts, one-attempt BullMQ continuation scheduling, fresh LangGraph branch continuation, parallel join evidence, child Skill Workflow propagation and Goal Patch/cancellation invalidation through migration 0102.
- Phase 5 bounded remote form elicitation, A2A structured input mapping, exact `tasks/update`, multi-round/echo-safe polling, cooperative cancellation request/ack/uncertainty/Provider-terminal separation, one-attempt BullMQ cancellation delivery and structured Provider business outcomes through migration 0103.
- Phase 6 deterministic MCP Tasks Provider scenarios and a machine-readable 16-scenario acceptance report; real PostgreSQL/Redis vertical, restart, parallel/child and A2A continuation evidence is paired with explicitly classified Provider/model simulation.
- Real management API and Console remote-task lifecycle projections, observations, input/cancellation state and operator poll/cancel actions with trusted-intranet and Provider-authority warnings.
- Migration 0104 permits the durable `node_waiting_external` Workflow event required by remote continuation and includes a guarded rollback that refuses to discard existing external-wait evidence.

### Changed

- PR #5 review hardening now applies exact declarative child output mappings after Schema validation on both immediate and persisted-continuation paths, binds empty child mappings to `skillInput`, gates mapped object evidence with a restricted presence expression, and excludes non-user-selectable Skills before top-level scoring/model selection.
- Native Skill Usage child policy is now an exact recursive allowlist even without legacy composition context, while immutable legacy Usage projections continue to use the existing Skill Graph authority.
- Deterministic Skill Usage execution now receives explicit `skillInput`, trusted context and Provider-evidence roots; terminal Skill execution status is published only after its outcome reference is durable.
- The post-main released migration profile now applies the single monotonic chain through 0106; the disposable `v1.1-isolated` profile guard remains for compatibility tests and ledger gaps still fail closed.
- Skill execution status is an append-only evidence projection of existing Task/Workflow/Provider authority; terminal projections cannot transition, and evidence-write failure never rewrites an authoritative terminal outcome.
- Skill Usage confirmation uses the existing outer Workflow Plan boundary. The complete policy remains immutable review data and no duplicate in-graph confirmation node is generated.
- Usage-aware selection is always wired when Skill selection is enabled; deployments without v1.1 Task metadata return no candidates for native Task bindings and fail closed, while the existing exact-argument pre-invocation readiness guard remains final.
- V1.2 applied migration high-water is now 0106 for minimal Skill execution records.
- ADR-096 keeps capability classification and lifecycle single-authority: catalog domains/tags derive from exact capabilities and lifecycle derives from existing Skill status.
- v1.1 and the complete published `v1.0.13-bug-fixed` hardening chain are merged. V1.1 ADRs are renumbered above the hardening high-water mark to avoid ambiguous decision IDs.
- The V1.1 migration compatibility guard now requires the complete released 0064 chain before 0100.
- Local Task/Goal cancellation remains immediately authoritative locally while active remote bindings enter `cancel_observing`; only later Provider snapshots can establish remote `cancelled`, `completed` or `failed`.
- Startup recovery preserves only Tasks backed by an active, valid PostgreSQL external-wait continuation/binding; ordinary executing, paused and evaluating work still fails with `PROCESS_EXECUTION_LOST` and is never automatically retried.
- Cross-package acceptance helpers now live under their dependency-owning `test-support` boundaries so PostgreSQL, BullMQ and A2A SDK types remain within the architecture-enforced adapters.

### Verification

- PR #5 review-blocker fix `df65de4` is published and all three review threads are resolved. Its focused gate passed format, lint, strict typecheck, all 465 unit tests, the 3 Workflow DSL contracts, 256-source architecture and production build. Full contract reached 111/112; the unchanged symlink fixture is blocked by Windows `EPERM` even elevated. Integration startup is blocked by an operator container owning fixed port 55432 and was not forced.
- SDAR v1.2 Phase 15 clean release-candidate SHA `b3b6e67` passed every explicit final command and the 148,794 ms self-managed `pnpm verify`: 574 unit/contract, 82 integration, 59 E2E, 256-source architecture, 116-operation OpenAPI, 18+16 acceptance scenarios, A2A MUST 74/74, 70 migrations, fresh 1.2.0 SBOM, build and both smoke stages.
- SDAR v1.2 Phase 14 clean-feature-SHA self-managed `pnpm verify` passed at `74344ce` in 153,204 ms with 574 unit/contract, 82 integration, 59 E2E, 256-source architecture, 116 OpenAPI operations, 18+16 acceptance scenarios, A2A MUST 74/74, 70 migrations, production build and both smoke stages.
- SDAR v1.2 Phase 13 passed all 20 area-patrol scenarios at `83753db`: 569 unit/contract tests, 82 isolated real integration tests, 59 real PostgreSQL/Redis A2A E2E tests, empty/0049 migration verification, production smoke, format/lint/typecheck/build and 256-source architecture.
- SDAR v1.2 Phase 12 passed all 14 move-to scenarios at `873ee80`: 565 unit/contract tests, 55 real PostgreSQL/Redis A2A E2E tests, 11 restart/remote integration tests, format/lint/typecheck, production build and 256-source architecture.
- SDAR v1.2 Phase 11 clean-feature-SHA format/lint/typecheck, 562 unit/contract tests, 256-source architecture, 116-operation OpenAPI and production build passed at `dc55f47`; real PostgreSQL repositories passed 57/57, final remote continuation runtimes passed 10/10, and the 0106 released/rollback/reapply/gap path passed.
- SDAR v1.2 Phase 10 clean-tree `pnpm verify` passed at `efb03e8` in 106,796 ms with 556 unit/contract tests, 81 real integration tests, 50 real E2E tests, 251-source architecture, 69 migrations, production builds and both smoke stages.
- SDAR v1.2 Phase 9 passed 68 focused planning/Validator/schema/LangGraph tests, all 448 unit tests and all 107 contract tests, including bounded repair, outer-plan confirmation preservation and adversarial normative/Provider/depth/failure/context/evidence compliance rejection.
- SDAR v1.2 Phase 8 passed 23 focused readiness/usage/selection tests, 8 real MCP registry integration tests, 56 real PostgreSQL plan-snapshot repository tests and 48 real A2A/MCP E2E tests, including every required Provider policy/readiness edge and the selection-before-planning availability request.
- SDAR v1.2 Phase 7 passed full format/lint/typecheck, 83 focused unit/contract tests, 56 real PostgreSQL repository tests, 48 real Server E2E tests, 114-operation OpenAPI, 246-source architecture, 69 migration pairs through isolated 0105, and production builds.
- SDAR v1.2 Phase 6 post-main-sync self-managed Compose `pnpm verify` passed in 141,005 ms with 542 unit/contract, 80 integration, 49 E2E, 246-source architecture, 68 migration pairs, production builds and both smoke gates.
- SDAR v1.2 Phase 5 self-managed Compose `pnpm verify` passed in 139,408 ms with 542 unit/contract, 80 integration, 49 E2E, 246-source architecture, migrations/build and both smoke gates; targeted composition/formal-package regressions passed 20/20.
- SDAR v1.2 Phase 4 targeted application/formal-package regression tests passed 23/23, all 428 unit tests passed, strict typecheck/target lint passed and architecture verified 244 sources.
- SDAR v1.2 Phase 3B formal package schema/import/invalid/legacy/golden tests passed 5/5 and all 106 contract tests passed.
- SDAR v1.2 Phase 3A targeted catalog/selection tests passed 12/12, all 417 unit tests passed, strict typecheck passed and architecture verified 240 TypeScript sources.
- SDAR v1.2 Phase 2 self-managed Compose `pnpm verify` passed in 149,172 ms with 513 unit/contract, 80 integration, 49 E2E, 239-source architecture, migration/build and both smoke gates; the final package security suite passes 10/10.
- `pnpm demo:acceptance` passed production build, 10 Provider contract tests, 402 unit tests, 80 real PostgreSQL/Redis integration tests, 49 real E2E tests and the V1.1 acceptance report verifier.
- Clean self-managed Compose `pnpm verify` passed at `13194b8` in 162.0 seconds: 75 unit/contract files and 493 tests, 80 real integration tests, 49 real E2E tests, 232-source architecture, 110-operation OpenAPI, 68 migration pairs and both smoke stages.

### Known limitations

- Phase 1–6 functionality and clean local acceptance are verified against merged `v1.0.13-bug-fixed`; `v1.1.0-rc.1` and ready PR #4 are published. External production Provider interoperability, protected review/merge and stable `v1.1.0` remain pending; this entry is not a stable v1.1 release announcement.

## [1.0.13] - 2026-07-16

### Added

- A bounded process-local `TaskStateNotifier` wakes A2A synchronous/streaming waits after committed
  Task changes while retaining a low-frequency PostgreSQL safety read.
- Commit notifications now cover ordinary Task saves, input continuation, wait expiry, process
  recovery, Goal Patch, Goal cancellation and atomic Runtime Terminal Outcomes.

### Changed

- A2A synchronous waits no longer query PostgreSQL every 10 ms. The default safety interval is one
  second, configuration below 100 ms is rejected, and every wake reloads PostgreSQL authority.
- Wait-window expiry returns the current standard Task snapshot instead of throwing
  `A2A_TASK_WAIT_TIMEOUT`; working Tasks continue in the background and remain pollable/resubscribable.
- Runtime close releases all notifier waiters before the A2A endpoint and database are closed.

### Verification

- The complete operator-managed `pnpm verify` passed in 89,011 ms with 296 unit, 64 contract, 60
  integration and 46 E2E tests, 185-source architecture, production build, migrations and smoke.
- Actual local samples recorded 4 reads for one 250 ms wait, 83 reads for 20 concurrent 250 ms waits,
  94 ms missed-notification recovery at a 100 ms safety interval, and sub-millisecond rounded close
  release. These are test-environment measurements, not production throughput claims.

## [1.0.13-bug-fixed] - 2026-07-16

### Fixed

- The final safety wake now returns its already-reloaded Task snapshot without an extra deadline read.
- Runtime close finishes released waiters before another database read or status publication, and an
  executor already closed rejects new Task submission with `A2A_TASK_EXECUTOR_CLOSED`.
- Transaction rollback regressions now prove failed terminal commits emit no Task notification.
- Configuration tests prevent reintroducing the old 10 ms interval or a non-positive wait window.

### Verification

- Required `pnpm verify` passed in 88,363 ms with 298 unit, 64 contract, 60 integration and 46 E2E
  tests, 185-source architecture, production builds, migrations and both smoke gates.
- Required `pnpm demo:local` completed its confirmed real A2A task and `pnpm demo:acceptance` passed
  all 46 E2E scenarios. Operator-managed mode disabled Docker lifecycle commands throughout.
- Bug-fixed local samples recorded 3 reads for one 250 ms wait, 60 reads for 20 concurrent waits,
  85 ms missed-notification recovery and zero post-close reads.

## [1.0.12] - 2026-07-16

### Added

- Domain-owned Memory durability (`durable`, `volatile`, `unknown`) and authority (`mcp`, `skill_experience`, `admin`, `model_inferred`) evidence, including a strictly validated seven-field refinement result.
- Migration 0064 converts new Memory embeddings to generic positive-dimensional pgvector values, adds durability/authority evidence, conservatively classifies legacy rows, and supplies a guarded rollback.
- A credential-free terminal-outcome query exposes post-commit enhancement warnings without changing the committed Task result.

### Changed

- Automatic long-term admission now embeds, deduplicates and persists only model-refined durable Memory; volatile and unknown candidates are rejected before embedding, and live device state must be requeried from MCP.
- Similarity search compares only active durable rows with the exact embedding provider and vector dimension, supporting tested 3-, 8- and 1536-dimensional providers without cross-provider comparison.
- Memory creation, embedding, deduplication or persistence failure after the authoritative terminal transaction records an enhancement warning and never reverses a completed Task or fabricates Memory success.

### Verification

- The complete operator-managed `pnpm verify` passed in 86,193 ms with format, lint, strict TypeScript, 284 unit tests, 64 contract tests, 60 integration tests, 46 E2E tests, 182-source architecture, 106-operation OpenAPI, production build, empty/0049→0064 migrations and both smoke gates.
- Real PostgreSQL migration tests cover provider/dimension isolation, durable-only retrieval, legacy exclusion and guarded rollback. No Docker command ran.

## [1.0.12-bug-fixed] - 2026-07-16

### Fixed

- A structured model can no longer elevate a durable processed-result candidate to administrator or Skill-experience authority; durable authority must match the application-owned source path.
- Current coordinates, battery, online state, occupancy and device-task state are deterministically forced to `volatile`/`mcp` before embedding even when a model falsely claims they are durable; direct creation cannot bypass the same policy.
- Memory content is copied, finite-JSON validated, depth/cycle bounded and deeply frozen at the domain boundary; provider embeddings are copied and frozen after finite positive-dimension validation, preventing asynchronous caller mutation from changing persisted evidence.

### Verification

- The required bug-fixed `pnpm verify` passed in 85,277 ms with 287 unit tests, 64 contract tests, 60 integration tests, 46 E2E tests, 182-source architecture, 106-operation OpenAPI, production build, empty/0049→0064 migrations and both smoke gates.
- Adversarial regressions cover forged durable classifications for every named dynamic-state class, authority elevation, direct-create bypass, cyclic/non-finite content and post-validation vector/content mutation. No Docker command ran.

## [1.0.11] - 2026-07-16

### Added

- Domain-owned MCP Tool execution semantics for effect, execution, cancellation, idempotency, replay and authoritative source.
- Migration 0063 stores declared, administrator and effective Tool values, call-time Invocation snapshots, and immutable Planner-time Workflow plan/attempt snapshots.
- Credential-free management API and Console controls for retained administrator overrides, plus semantics display in MCP inventory, plan confirmation and Skill Tool Policy views.

### Changed

- Official MCP SDK annotations, task support and the validated `io.sdar/tool-execution-semantics` metadata extension are translated inside the adapter; SDK types never enter domain/application contracts.
- Workflow planning and repair use a frozen semantics snapshot. Refresh preserves administrator input, while an available MCP declaration remains higher priority per the task package.
- LLM Tool Enhancement remains descriptive data and cannot set real execution authority.

### Verification

- The complete operator-managed `pnpm verify` passed in 86,700 ms with format, lint, strict TypeScript, 281 unit tests, 62 contract tests, 59 integration tests, 46 E2E tests, 182-source architecture, 105-operation OpenAPI, build, empty/0049→0063 migrations and both smoke gates.
- Compose daemon/config validation was deferred by operator-managed mode and no Docker command was run.

## [1.0.11-bug-fixed] - 2026-07-16

### Fixed

- `default_unknown` semantics can no longer carry non-unknown values, and accepted semantics snapshots are frozen at the domain boundary.
- A malformed exact `io.sdar/tool-execution-semantics` declaration now fails discovery instead of silently falling back to weaker annotation or administrator authority.
- Administrator semantics override and its management audit now commit in one PostgreSQL transaction; concurrent Tool removal returns not-found without a phantom audit, and audit failure rolls back the override.
- Persisted Tool source fields and Invocation snapshots are revalidated through the domain invariant before becoming runtime evidence.

### Verification

- The operator-managed bug-fixed `pnpm verify` passed in 85,191 ms with 283 unit, 63 contract, 59 integration and 46 E2E tests, 182-source architecture, 105-operation OpenAPI, production build, empty/0049 migrations through 0063 and both smoke gates.
- Real MCP SDK and PostgreSQL regressions prove fail-closed malformed declarations and atomic override/audit rollback. No Docker command ran.

## [1.0.10] - 2026-07-16

### Changed

- `capability_gap` is now a terminal Task and WorkflowControl outcome; the original Task has no resume path and keeps `errorCode=CAPABILITY_GAP` with its structured missing-capability evidence.
- A2A now projects capability gaps as standard `TASK_STATE_FAILED` with `nextAction=register-capability-and-submit-new-task`, never as `input-required`.
- A new Task in the same Context uses the normal serialized queue and may continue the still-active Goal; Tool registration or refresh never scans, resumes, enqueues or executes the old Task.
- PostgreSQL terminal mutation guards, Goal/runtime cancellation and implicit-feedback terminal lookup now treat capability gap consistently.

### Verification

- Terminal transition/follow-up/cancellation, structured A2A projection, stale Worker persistence, active-Goal successor submission and wait-timeout exclusion regressions pass.
- The operator-managed feature gate passed 274 unit, 60 contract, 58 integration and 46 E2E tests, 181-source architecture enforcement, 104-operation OpenAPI verification, production build and empty/historical-0049 migration paths through 0062.

## [1.0.10-bug-fixed] - 2026-07-16

### Fixed

- A Goal Patch initiated by a newer Task can no longer invalidate an older terminal capability-gap Task sharing the active Goal.
- WorkflowControl round insertion locks and rechecks non-terminal authority, so a stale Worker cannot append evidence after capability gap.
- PostgreSQL reads and the A2A projection fail closed when a capability-gap row lacks `CAPABILITY_GAP` or structured evidence; domain evidence fields must be non-empty.

### Verification

- The operator-managed bug-fixed gate passed 274 unit, 61 contract, 58 integration and 46 E2E tests, 181-source architecture, 104-operation OpenAPI, production build and empty/0049 migration paths through 0062.

## [1.0.9] - 2026-07-16

### Added

- Domain-owned immutable `SkillCompositionContext` snapshots containing the selected exact Skill version, only graph-reachable related versions, accepted relations, allowed child IDs and a decision summary.
- Bounded initial composition traversal for `parent_child`, `depends_on`, `input_output_match`, `composition` and `capability_coverage`; `alternative` remains excluded from initial planning.
- Migration 0062 for composition and explicit capability-gap authority on every Workflow plan and planning attempt.
- Optional management `compositionRoot` input for authoritative standalone graph-aware planning.

### Changed

- Initial Task, child Skill, continuation, revision, Goal Patch and outer replan paths now establish, inherit or recompute exact composition authority before model planning.
- The Workflow validator, execution service and child Skill service reject `skill_call` targets outside the persisted allowed set unless an internal explicit capability-gap flow admits the ID.
- Transitive confirmation covers every initial-execution relation except `alternative`; the graph supplies bounded evidence while the LLM still decides which admitted Skill to call.

### Verification

- Required regressions cover dependency admission, composable planning, unrelated/alternative rejection, schema mismatch, multi-level composition, cycles, deep snapshot immutability, persistence audit and execution-time authorization.
- The operator-managed feature gate passed 270 unit, 59 contract, 58 integration and 46 E2E tests, 181-source architecture enforcement, 104-operation OpenAPI verification, production build and empty/historical-0049 migration paths through 0062.

## [1.0.9-bug-fixed] - 2026-07-16

### Fixed

- Inherited and persistence-loaded composition contexts now revalidate unique Skill/relation/allowlist IDs, selected-root reachability, cycles, depth and size before any model or execution authority is accepted.
- Skill/relation snapshot JSON is bounded to 64 levels, and accepted relation evidence is capped at 128 entries in addition to the existing 8-level/32-Skill traversal limits.
- Initial composition uses indexed source/type/limit PostgreSQL reads and requests only remaining capacity instead of loading and sorting the full Skill Graph.
- Corrupted PostgreSQL context, disconnected injected children, duplicate allowlist IDs, pathological JSON and relation floods fail closed with stable errors.

### Verification

- The required operator-managed `pnpm verify` passed in 87,491 ms with 273 unit, 59 contract, 58 integration and 46 E2E tests, 181-source architecture, A2A baseline, 104-operation OpenAPI, 18 acceptance scenarios, licenses/SBOM, production builds, empty/0049→0062 migrations and both smoke gates.

## [1.0.8] - 2026-07-16

### Added

- Domain-owned immutable `GoalExecutionContract` snapshots containing Goal identity, title, description, constraints and success criteria.
- Migration 0061 for exact Goal Contract evidence on Skill selection/replacement and Workflow plan/attempt records.
- Enriched Skill candidate snapshots with schema summaries, Tool and runtime policies, Workflow guidance, quality metrics, active MCP dependency warnings and semantic scores.

### Changed

- Skill retrieval, model selection, replacement, Temporary Skill resolution, top-level/replan/child Workflow planning and Goal Evaluation now receive the same complete Goal Contract.
- Planning, repair confirmation inheritance, Workflow execution and outer control reject stale or content-mismatched contracts before model or Tool execution.
- Registered management planning compares the complete submitted snapshot with the authoritative Goal; standalone planning still requires a complete explicit contract.
- Goal Patch plans only with the proposed new Goal version, while all model invocation and plan-attempt evidence retains the exact snapshot used.

### Verification

- Constraint-sensitive Skill selection, success-criteria-sensitive Workflow generation, safety constraint visibility, replacement retention, patched Goal versions, stale-plan rejection and exact model-audit snapshots are covered across unit, contract, real PostgreSQL migration/integration and real A2A/Model/MCP E2E tests.
- The operator-managed feature gate passed 259 unit, 59 contract, 57 integration and 46 E2E tests, 178-source architecture enforcement, 104-operation OpenAPI verification, production build and empty/historical-0049 migration paths through 0061.

## [1.0.8-bug-fixed] - 2026-07-16

### Fixed

- Every asynchronous selection/planning boundary now copies and freezes the complete Goal Contract, preventing caller mutation after invocation from changing retrieval, model input or persisted audit.
- Management Skill selection and Workflow planning reject content-drifted or terminal registered Goals before any embedding/model call; unregistered standalone contracts remain an explicit low-level capability.
- Goal Patch rejects a source plan whose complete contract differs from the active Goal even when ID/version match, before patch-model invocation or invalidation.
- Admin revision uses the same runtime-enforced snapshot as model-planned revisions and Temporary Skill resolution.

### Verification

- Mutation-during-Promise regressions cover formal selection, Workflow planning and Temporary Skill resolution; source-plan drift is rejected before the Goal Patch model.
- Real management E2E proves valid registered selection, same-version drift rejection, terminal Goal selection/planning rejection and unchanged model invocation counts.
- The operator-managed bug-fixed gate passed 262 unit, 59 contract, 57 integration, 46 E2E, 179-source architecture, 104-operation OpenAPI, production build and empty/historical-0049 migration paths through 0061.

## [1.0.7] - 2026-07-16

### Added

- Domain-owned immutable `SkillInputResolutionRecord` evidence tied to exact Task, Goal version and enabled Skill version.
- Fixed `skill_input_resolution` model stage with structured response validation, Provider/Prompt routing, invocation audit and Console configuration.
- Migration 0059 for resolution history and the durable `skill_input_resolution` Task input-request source.
- Management API and Console evidence links for Task-scoped and individual input-resolution records.

### Changed

- Formal top-level Skills now resolve and validate their `inputSchema` after selection and before planning.
- Missing or invalid required input uses the v1.0.3 same-Task continuation path; supplementary answers create a new immutable resolution.
- The schema-valid structured value becomes Workflow initial input, while raw request text remains auxiliary Task evidence.
- Ordinary replans retain the fixed structured value, and Goal Patch re-resolves against the new Goal version.

### Verification

- Unit, management contract, real PostgreSQL migration/history and real A2A/MCP E2E cover metadata, text, missing input, continuation, illegal types, source conflict, Goal Patch, child validation and structured MCP binding.

## [1.0.7-bug-fixed] - 2026-07-16

### Fixed

- Each formal Task plan now binds the exact immutable Skill input resolution used during planning; execution no longer selects a potentially newer record.
- Migration 0060 enforces the Task/Goal version/Skill version/resolution identity as one composite PostgreSQL foreign key and clears stale bindings on Skill replacement or Goal Patch.
- Authoritative metadata removes stale model-reported unresolved markers for fields it actually supplies, while root-level schema failures retain a stable `$` input request marker.
- Goal Patch preflights patched-Goal Skill input before committing invalidation, so unresolved input or model failure cannot leave an applied Patch without its promised replacement plan.

### Verification

- Regression evidence proves plan-bound input survives a newer resolution, cross-Task evidence is rejected by PostgreSQL, replacement clears stale authority, metadata wins stale model output, root errors remain resumable, and unresolved Goal Patch writes no Patch/plan.
- The operator-managed bug-fixed gate passed 251 unit, 58 contract, 56 integration, 46 E2E, 178-source architecture, OpenAPI, production build and empty/historical-0049 migration paths through 0060.

## [1.0.6] - 2026-07-16

### Added

- Domain-owned `RuntimeTerminalOutcome` records and an atomic PostgreSQL repository for achieved, unachievable and canceled runtime outcomes.
- Migration 0058 linking each WorkflowControl and terminal Round to one durable outcome with queryable post-commit enhancement warnings.
- Fault-injection coverage before Processed Result persistence and after Task, Goal, Control and Runtime Event writes.

### Changed

- Processed Result preparation now completes before the transaction, while Result Memory, evaluation Memory, Task Quality, Evolution Experience, Temporary Skill completion and Skill Evolution run independently after commit.
- Achieved/unachievable controller paths commit Processed Result, Task output/phase, Goal, Control, terminal Round and Runtime Event in one transaction.
- Cancellation of a Task with an active WorkflowControl uses the same atomic terminal boundary; early cancellation without a Control remains Task-local.
- Generic Task, Goal and WorkflowControl saves reject stale attempts to overwrite terminal state, and controller failure handling never reverses a committed terminal outcome.

### Verification

- Unit, real PostgreSQL fault-injection, migration and real A2A evidence prove full rollback, exact idempotent retry, stale-Worker rejection, canceled waiting Tasks, and completed A2A output despite a post-commit Memory failure.

## [1.0.6-bug-fixed] - 2026-07-16

### Fixed

- Generic Task, Goal and WorkflowControl repositories now reject every write once a terminal row exists, including same-status writes that previously could replace terminal output or pointers.
- Terminal Rounds must match the locked Control, current plan and evaluation decision; final Workflow instances must belong to the same Goal and valid current/prior Control evidence.
- Active-control cancellation closes waiting Task input inside the terminal transaction, so a cleanup failure cannot turn an already committed A2A cancellation into an error.
- Goal-wide cancellation creates canceled Runtime Terminal Outcomes for all active Controls, closes waiting input and emits terminal events inside its existing multi-Task cascade transaction.
- Completion/cancellation races return the already committed terminal Task instead of attempting a second terminal projection.

### Verification

- The complete operator-managed `pnpm verify` passed in 82,005 ms: 243 unit, 58 contract, 53 integration, 44 E2E, 175-source architecture enforcement, migration paths, production builds and both smoke gates.

## [1.0.5] - 2026-07-16

### Added

- One transitive Skill confirmation evaluator for initial Task planning, outer replanning and runtime child planning.
- Durable nested confirmation linkage across parent plan/instance/node, child plan, exact child Skill version and confirmation status.
- LangGraph `skill_confirmation` checkpoints that project the parent Task as A2A input-required and resume the same node after an explicit decision.
- Migration 0057 for pending/confirmed/rejected/invalidated child confirmation lifecycles.

### Changed

- `skill_call` no longer inherits parent confirmation; a child opts in independently through its current runtime policy.
- Top-level auto-confirm now requires every governing, directly planned and recursively reachable execution Skill to opt in.
- Child version changes invalidate a pending linkage and force a fresh child plan and confirmation.

### Verification

- Unit, real PostgreSQL migration/lifecycle and real A2A/MCP E2E evidence covers conservative transitive policy, independent pause/confirm/resume, rejection, cancellation, version drift and zero child MCP calls before confirmation.

## [1.0.5-bug-fixed] - 2026-07-16

### Fixed

- Task confirmation/rejection/cancellation decisions are serialized per Task, phase-checked before plan side effects, and carry an explicit top-level-versus-child confirmation target so duplicate child confirmations cannot start an outer execution path.
- Child decisions now match the complete parent checkpoint identity and revalidate the current Skill version plus immutable child-plan status immediately before confirmation and parent resume.
- Superseded child plans and changed Skill versions are invalidated and produce a newly projected child checkpoint instead of resuming stale authority or waiting invisibly.
- User cancellation is durably projected before releasing a child checkpoint; unified wait-timeout cancellation also rejects the nested wait and releases the in-memory parent execution.

### Verification

- Regression evidence covers parent/child pause state, concurrent duplicate confirmation, stale checkpoint metadata, confirmation on a canceled parent Task, superseded confirmed child plans, repeated fresh checkpoints and real version-drift/cancel A2A/MCP flows. The full operator-managed gate passes 238 unit, 58 contract, 43 integration and 43 E2E tests.

## [1.0.4] - 2026-07-15

### Added

- Domain-owned live/simulation/historical-replay execution context with stable non-live identity.
- Runtime-owned `X-SDAR-Execution-Mode` and `X-SDAR-Simulation-Id` Headers for simulation and historical replay MCP calls.
- Migration 0056 invocation audit fields for execution mode and simulation identity.

### Changed

- LangGraph MCP, Subworkflow and `skill_call` boundaries explicitly inherit execution context, including paused/resumed execution.
- Credential configuration rejects reserved Header names case-insensitively; runtime sanitization strips legacy conflicts and writes canonical reserved Headers last.
- The official-SDK loopback Mock MCP supports multiple isolated Streamable HTTP sessions so live and non-live Header sets are verified concurrently.

### Verification

- Unit, contract, real PostgreSQL migration/audit and real Skill Evolution E2E evidence prove live omission, simulation/replay Headers, stable IDs, child inheritance, credential merging/conflict rejection and sanitized invocation audit.

## [1.0.4-bug-fixed] - 2026-07-15

### Fixed

- Non-live simulation identities are limited to 256 visible ASCII characters before they can become an HTTP Header value.
- Duplicate case variants of reserved Headers in legacy decrypted credentials are stripped before canonical runtime values are written.
- Non-live transport failures retain execution mode and stable identity in sanitized invocation audit.

### Verification

- Regression evidence covers paused/resumed context retention, repeated stable-ID MCP session reuse, legacy Header conflict normalization and final 276 unit/contract, 42 integration and 42 E2E gates.

## [1.0.3] - 2026-07-15

### Added

- Durable Task input requests, responses and initial/input-response execution attempts in PostgreSQL, including exact Goal-control round linkage.
- Attempt-aware BullMQ Jobs with one-attempt execution and BullMQ-safe composite Task/attempt identity.
- `WorkflowControllerService.continueAfterInput` for a fresh, unconfirmed plan after Goal Evaluation requests more input.

### Changed

- `provide_input` now answers the original waiting request, queues continuation on the original Task/Context, and immediately projects working state.
- Goal deliberation uses persisted supplementary answers; Workflow controls merge the same data into execution input without replaying completed Workflow instances.

### Verification

- Unit, real PostgreSQL restart, real Redis serialization/job-identity, and real A2A/MCP tests cover both recovery paths and prove the supplied value reaches subsequent MCP arguments.

## [1.0.3-bug-fixed] - 2026-07-15

### Fixed

- Supplementary-input answer, response, continuation attempt and Task phase projection now commit in one PostgreSQL transaction.
- Durable queued attempts are reconciled to BullMQ at startup and on a bounded interval; terminal stale Redis Jobs can be replaced only while PostgreSQL still records the attempt as queued.
- Startup recovery marks interrupted running attempts failed with `PROCESS_EXECUTION_LOST` and never redispatches running or failed attempts.
- Supplementary input larger than 64,000 characters is rejected before any answer or continuation-attempt write.

### Verification

- The complete operator-managed `pnpm verify` gate passed without Docker lifecycle operations: 270 unit/contract tests, 41 real PostgreSQL/Redis integration tests, 42 real E2E tests, both migration paths, production builds and both smoke stages.

## [1.0.2] - 2026-07-15

### Added

- Real planned child Workflows for `skill_call`, using the current Skill definition, current MCP planning metadata, normal Workflow validation, independent plan/instance persistence and the sole LangGraph runtime.
- Bounded Skill-call ancestry with stable cycle and maximum-depth errors.

### Changed

- Child results must pass the executed Skill version's output schema; failed, canceled or invalid children propagate to the parent instead of returning a model-fabricated success.
- Child Skill Tool policy is enforced against its own child Workflow, while parent Workflows retain child version and budget evidence.

### Known issues at feature tag

- Nested confirmation policy will be finalized in v1.0.5.
- Repeated execution of the same parent `skill_call` node retains only the latest linkage under the current persistence key; the v1.0.2 bug-fixed audit covers this case.

## [1.0.2-bug-fixed] - 2026-07-15

### Fixed

- Repeated entry into the same parent `skill_call` node now persists append-only call history keyed by `call_id`; latest-call lookup remains deterministic.
- Child outputs must be finite JSON and no larger than 64,000 serialized characters before entering parent Workflow state.
- Integration bootstrap now advances an existing migration ledger monotonically instead of replaying older constraint migrations.

### Verification

- Migration 0054 passes empty and historical-0049 upgrade paths, rollback/reapply, and real PostgreSQL repeated-parent-node repository tests.
- Unit and real E2E evidence retain child failure/cancellation propagation, plan-save failure, recursion/depth rejection, real MCP audit and output validation.

## [1.0.1] - 2026-07-15

### Added

- Recursive Workflow runtime data binding for initial input, node outputs, errors, loop counts, and result state, including immutable execution snapshots and stable missing-reference errors.
- Dynamic `llm.context`, MCP arguments, Skill input, and Subworkflow input in the public Workflow DSL.

### Changed

- MCP and Skill business-schema checks are deferred for dynamic templates and enforced again after runtime resolution against the current registered schema.
- Subworkflows receive their resolved node input instead of the parent Workflow's original input.

### Known issues at feature tag

- No known correctness issue. Bindings intentionally support finite JSON data and restricted path segments only; JSONPath, string interpolation, and executable expressions remain unsupported.

## [1.0.1-bug-fixed] - 2026-07-15

### Fixed

- Bounded recursive template and referenced-value traversal at 64 levels with a stable depth error, preventing stack exhaustion on pathological runtime values.
- Missing optional `result` state now reports the stable missing-reference code, and error messages include an unambiguous JSON path for node IDs containing dots.

### Verification

- Boundary regression covers the maximum accepted depth, template and referenced-output overflow, missing result, dotted node IDs, error objects, null/empty arrays, immutable snapshots, parallel joins and live Schema rejection.

### Added

- Apache License 2.0 project licensing for copyright holder zhouwen, including canonical `LICENSE`, project `NOTICE`, package metadata, README disclosure, and license-ledger documentation.

- Signed V1 release checklist, isolated clean-checkout/frozen-install evidence, and machine/human release-posture reports.

- Configuration/operations/troubleshooting and contribution guides covering environment, lifecycle, health, failure posture, secrets, backups, release evidence, and engineering rules.

- Isolated empty-database and historical 0049→0053 PostgreSQL migration verification, included in the full gate with cleanup and current-constraint assertions.

- `pnpm demo:local` and `pnpm demo:acceptance`, plus a documented official-SDK A2A example client that streams a task, confirms its plan, polls to completion, and is exercised against Mock MCP.
- Product-oriented README quickstart, local endpoints, complete verification, safety posture, and architecture/operations links.

- Human and machine V1 acceptance audits mapping all AC-01..18 scenarios to the current full-gate evidence, plus a static verifier for exact scenario coverage and evidence classification.

- A true full `pnpm verify` orchestrator covering static/unit/contract/build, real integration, real E2E, infrastructure smoke, and Server/Console-bundle smoke, with machine-readable and Markdown summaries under `reports/verification/`.
- A documented `pnpm smoke` aggregate command.

- Current real PostgreSQL/Redis integration (2 files/36), full E2E (1 file/40), infrastructure smoke, Server/Console-bundle smoke, and unified 54-file/242-test gate; promoted FR-MCP-008, FR-MCP-012, NFR-PERF-002, NFR-OBS-001, and NFR-UX-001 with real evidence.
- Real production-Console browser navigation evidence for Task/Goal/Workflow/Skill/MCP/model/Memory/Evaluation associations and reverse Task links.
- ADR-072 monotonic migration-ledger high-water rule, preventing legacy startup replay from regressing later constraints.

### Fixed

- Runtime-hardening baseline verification can reuse operator-managed loopback PostgreSQL/Redis without issuing Docker lifecycle commands; Compose images are again pinned by immutable OCI digest, and the external-infrastructure mode is recorded in verification evidence.

- The 20-Job Redis concurrency test now observes completion in bounded batches, avoiding a false-positive Node EventEmitter warning from BullMQ's temporary `waitUntilFinished` listeners without reducing execution concurrency or assertions.

- SBOM/license generation now filters the pnpm virtual store through the current lockfile and records package-relative license locators, excluding stale packages and peer-layout paths left by prior installs so clean-checkout evidence is deterministic.

- Clean Windows checkouts now retain the repository LF formatting baseline through `.gitattributes`, so the frozen-install verification is independent of global `core.autocrlf` settings.

- Local Compose now publishes PostgreSQL and Redis only on `127.0.0.1`; the infrastructure verifier rejects non-loopback datastore port publishing.

- Graceful Runtime shutdown now waits for tracked confirmed-Task background controls before closing MCP transport and PostgreSQL, preventing pool-after-end failures after externally terminal Tasks.

- Console production assets now use the `/console/` base served by Express; Server smoke fetches the emitted JavaScript bundle and checks the trusted-intranet warning marker.
- Integration fixtures now satisfy current Task phase and Goal/Plan/model-invocation foreign-key constraints without weakening them.
- E2E MCP registration parsing retains generated enhancement metadata before asserting the production response.

- Reconciled NFR-REL-002 with historical real single-attempt Redis/BullMQ, startup-failure, MCP no-replay, and exactly-one model-failure evidence against the exact no-duplicate-side-effect acceptance.

- Repository-owned Workflow visual topology editing with data-only node, entry/exit, and edge controls; reconciled FR-ADM-004 against historical real immutable revision/execution/event evidence and current 54-file/242-test gate.

- Reconciled FR-ADM-006 with historical real Task-rooted execution evidence and current complete query/navigation/filter projections.

- Reconciled FR-ADM-003 by mapping every Skill Studio operation to its verified real Skill/evolution lifecycle plus current API/Console wiring.

- Reconciled FR-ADM-008 with real PostgreSQL/MCP/model analytics E2E and current complete operations-dashboard projections.

- Reconciled FR-ADM-007 with real management/model/PostgreSQL Memory lifecycle E2E and current Console controls.

- Reconciled FR-ADM-005 with real PostgreSQL/model/management Prompt lifecycle E2E and current traceability controls.

- Reconciled FR-ADM-002 with historical real MCP lifecycle and 31-test PostgreSQL/Redis operation-log evidence plus current management/Console contracts.

- Verified FR-ADM-001 against its exact unauthenticated-access and trusted-intranet deployment-warning acceptance, including real browser render/navigation evidence.

- Reconciled FR-MCP-011 with historical real PostgreSQL dependency-warning evidence and current no-auto-disable management/Console boundaries.

- Exact Skill-to-Task PostgreSQL inventory navigation and Task-to-MCP-Tool focus, closing two NFR-UX-001 identifier-chain gaps with executable click evidence.

- Reconciled NFR-PERF-001 with historical real BullMQ serialization and a deterministic ten-context no-crossover concurrency regression.

- Reconciled NFR-SEC-002 with historical real PostgreSQL/same-process MCP and Model encryption evidence plus the exact no-plaintext/environment-master-key acceptance criterion.

- Bounded semantic MCP exception recovery for retry, prevalidated changed arguments, alternative Tools, enabled Skills, or termination, with immutable LangGraph routing and replay counters.

- Reconciled FR-A2A-012 and FR-LLM-005 against later real PostgreSQL/pgvector, A2A, management, model-audit, and dynamic Agent Card evidence; both stale rows are now verified.

- Direct BullMQ Worker-failure integration evidence for single-attempt retained failure, plus NFR-REL-001 recovery traceability reconciliation.

- Verified NFR-MNT-001 against its interface-unit-test acceptance with executable port substitution and 165-file single-runtime architecture enforcement.

- Reconciled NFR-DATA-001 with the historical real migration/PostgreSQL/E2E gate and its exact no-automatic-deletion acceptance criterion.

- Verified NFR-OBS-002 with real loopback Provider sanitization, official A2A SDK projection, and management structured-audit contracts.

- Verified NFR-SEC-001 against its explicit trusted-intranet warning and deployment network-isolation checklist acceptance.

- Registration-time structured LLM enhancement for all MCP Tools, editable planning metadata with original-schema authority, fixed-stage migration, and fail-closed Server migration completeness enforcement.

- Machine-verifiable A2A 1.0.1 specification/SDK/TCK pins, direct patch media-type contracts, and a 100% official HTTP+JSON/MUST TCK result with explicit skip and beta-SDK boundaries.

- Expanded architecture enforcement across package source and the Server composition root, including fail-closed rejection of known second workflow runtimes.

- Task-rooted Plan-confirmation and Goal-Patch correlation with persisted confirmation Task/time, triggering Task identity, additive migration 0052, and full-chain observability evidence.

- Unified environment-owned AES-256-GCM Cipher injection for MCP and Model credentials with real-cipher database plaintext-rejection assertions.

- Fail-closed non-loopback A2A/management binding validation with explicit no-auth trusted-network acknowledgement and release network-isolation checks.

- Explicit ten-Job BullMQ default concurrency with deterministic ten-context overlap and strict same-context tail-isolation evidence.

- Machine-readable management health and Console warnings for indefinite V1 historical retention, advisory retention fields, and disabled automatic cleanup.

- Cross-boundary private-reasoning protection for OpenAI-compatible/Anthropic Provider responses, necessary-summary-only A2A projection, and displayable management audit evidence.

- Persisted monotonic Workflow terminal-node duration with management Trace/Console replay display and an additive rollback-capable PostgreSQL migration.

- Complete FR-ADM-001..008 traceability mappings to console/runtime implementation, tests, acceptance reports, and explicitly unverified real-E2E evidence.

- Independent Goal-to-Task-history navigation using an exact management filter over persisted `agent_task.goal_id`.

- Bidirectional Task/MCP/model/Evaluation links and explicit Memory-source-to-Task navigation using persisted identifiers only.

- Exact one-click Task-to-Workflow/Skill and Workflow-to-owning-Task navigation backed by persisted identifiers and a PostgreSQL `planId` Task query.

- PostgreSQL-derived MCP usage, model effects, Skill capability growth, and evidence-counted advisory optimization suggestions for the complete FR-ADM-008 dashboard.

- Machine-readable and human-readable EP-06 acceptance audit classifying unified verification and browser rendering as real, contract/SSR coverage as simulated, and Docker-backed gates as unverified.

- Operational Evaluation dashboard for real success, duration, cost, failure distribution, Skill-version stability, and ordered quality-trend evidence.

- Validated operational controls for Task wait timeout, Memory retention values, and Skill evolution threshold, preserving the V1 prohibition on automatic Memory cleanup.

- Filterable PostgreSQL Task inventory and optional two-second refresh of the complete Task-rooted Goal/Workflow/model/MCP/evaluation trace in the operational console.

- Credential-safe model Provider and fixed-stage route inventory APIs plus operational console views for encrypted Provider configuration, routing, system policies, evolution triggers, and sanitized model invocation audits.

- Complete Skill Studio controls for constrained authoring, full definition edits, persisted draft publication, simulation/correction, version diff, lifecycle actions, warnings, and typed Skill Graph relations.
- Real Prompt version/effect controls, source-linked Memory lifecycle management, and filterable Evaluation/quality-warning console views.
- Task-rooted correlated observability across Goal, Plan/Workflow, runtime events, model and MCP calls, results, inference, evaluation, feedback, evolution, and errors.
- Workflow DAG workbench with strict DSL validation, immutable administrator revisions, explicit confirmation, PostgreSQL node-event trace lookup, and progressive execution replay.
- Real MCP and Skill console lifecycle controls plus PostgreSQL-backed, credential-safe MCP management-operation history.
- React/Vite operational console foundation with real management-API views, persistent trusted-intranet warning, exact-version OSS intake, and same-process static delivery under `/console`.
- Route-complete management OpenAPI coverage for all 94 implemented API operations, enforced by an automated drift and duplicate-operation-id gate.
- Filterable PostgreSQL Evaluation analytics for success, duration, call cost, failure types, Skill-version stability, and quality trend, including explicit model-to-Task correlation.
- Report-linked Evaluation influence across Skill quality observations, quality-gated Workflow Template induction, and inactive stage-specific Prompt optimization candidates.
- Task-linked low-confidence implicit feedback for result acceptance, continued modification, repeated submission, redo requests, and failure-driven Skill switching.
- Five-component completed-Task quality reports with strict Goal/Workflow/Skill/result/Tool assessments, deterministic aggregation, PostgreSQL evidence linkage, and management retrieval.
- PostgreSQL-managed Memory review/archive/delete policy fields with V1 domain/database enforcement that automatic cleanup remains disabled.
- Source-linked evolution Memory projections for Skill/Prompt manual corrections, Task failure reasons, and Goal evaluation conclusions through the strict refinement boundary.
- Transactional Memory supersede/invalidate lifecycle with explicit replacement links, append-only status audit, conflict rejection, historical reads, and active-only retrieval.
- Stage-specific long-term Memory retrieval with distinct type allowlists/query templates and audited evidence injection for intent, Skill selection, Workflow generation, exception handling, and Goal evaluation.
- LLM-refined long-term Memory admission from valuable processed results, with normalized structured content, pgvector-assisted exact deduplication, Task/ProcessedResult provenance, and a refinement-only management boundary.
- Versioned Workflow-template induction from repeated successful Experiences, similarity-ranked planning reuse, immutable adjustment, confirmation preservation, and source/use/effect audit APIs.
- Version-specific Skill quality observations and persistent low-score/failure-rate warnings with an enforced warning-only policy and separate administrator disable, rollback, and correction controls.
- Source-governed Skill publication with fail-closed A2A drafts, dedicated management publication, persisted publisher/SkillVersion linkage, and dynamic Agent Card evidence.
- Administrator correction and full revalidation of failed evolution drafts, with immutable actor/before/after/diff/result Experience history and corrected-Schema simulation semantics.
- Real failed-simulation acceptance evidence proving the all-pass evolution publication gate retains a draft without changing the current formal Skill version.
- Tool-indexed historical Evolution Experience replay through the single LangGraph runtime, with successful/failed outcome matching and unified static/source/normal/boundary/exception simulation reports.
- Failure-driven alternative Skill replacement with persisted initial selection identity, immutable failed-instance evidence, forced fresh plan confirmation, and same-controller continuation.
- Fail-closed selected-Skill Tool-policy enforcement during generated plan preparation and confirmed execution, rejecting missing required and referenced forbidden MCP Tools before any call.
- Global formal-Skill reuse across user identities and independently persisted LangGraph child Workflows for `skill_call`, including actual current SkillVersion and schema-evaluation evidence.
- Task-owned initial Workflow planning with persisted selected-Skill identity, strict confirmation gating, Skill opt-in auto-confirmation, outer-controller execution, and equivalent synchronous/return-immediately A2A results.
- Task-level management confirm/reject/revise actions sharing the same authoritative lifecycle path as A2A follow-up messages.
- Explainable missing-Goal-input inference over conversation history, global pgvector memory, and existing results, with strict fixed-model decisions and persisted source snapshots.
- Domain-owned global MemoryItems with mandatory source references, PostgreSQL/pgvector semantic retrieval, management contracts, and cross-user local E2E evidence.
- Task-bound capability-gap outcomes with persisted missing-tool evidence, suggested contracts, authoritative A2A `INPUT_REQUIRED` reads, and real SDK-client E2E coverage.
- Seven strict Goal-evaluation action types with action-specific evidence, explicit input/capability waiting states, immutable external replanning, and PostgreSQL per-round replay.
- Two-stage MCP/result processing with downstream envelopes, context trimming, fixed-stage Skill-directed final output, strict schema validation, and persisted facts/value/memory candidates.
- Runtime-first Goal cancellation with Skill-policy execution control, atomic Goal/Task/Plan/instance cascade, immutable history, A2A/management APIs, and stale-Worker terminal guards.
- Context-wide active Goal reuse and fixed-stage terminal-Goal relationship decisions with atomic related/unrelated history and real multi-Task A2A evidence.
- LangGraph-native execution pause/resume/cancel controls with no-next-node guarantees, Skill threshold/policy resolution, long-pause fresh-confirmation replanning, and real MCP/A2A evidence.
- PostgreSQL-authoritative unified Task wait timeout with managed configuration, atomic cancellation/audit, restart-safe scheduler, and real A2A expiry evidence.
- Versioned Goal Patch processing with atomic old-state invalidation, immutable audit history, forced new-plan confirmation, A2A/management APIs, and explicit compensation guidance/warnings.
- Fail-closed process-start recovery that atomically terminates interrupted Tasks/Workflow instances while preserving queued BullMQ work with one attempt and no automatic retry.
- Explicit Model Provider API styles with composite OpenAI-compatible/local and non-OpenAI Messages adapters, PostgreSQL configuration, strict management contracts, and normalized cross-provider audit evidence.
- Fixed-stage structured LLM final decisions for intent, Goal, Skill selection, Workflow planning, execution exceptions and Goal evaluation, including queue-path failure without fallback and richer persisted Skill candidate evidence.
- Native LangGraph human-confirmation interrupt/resume with PostgreSQL paused state, ephemeral fail-closed checkpoints, continuous budgets/events, and real MCP no-replay evidence.
- Immutable natural-language and administrator DSL/DAG plan revisions with atomic confirmation invalidation, persisted lineage, real A2A Task binding, management APIs, and confirmed LangGraph execution evidence.
- PostgreSQL-authoritative outer Goal evaluation/replanning with strict structured decisions, immutable next-version plans, ordered round evidence, confirmation pause/continue, all-Skill auto-confirm gating, and max-replan termination.
- Workflow budget resolution from system defaults and current Skill overrides, concurrency-safe LangGraph duration/LLM/MCP/cost enforcement, deadline cancellation, stable termination reasons, and persisted Skill-version/limit/usage evidence.
- Confirmed-plan LangGraph.js compilation with a type-strict expression interpreter, all-ten-node execution coverage, immutable PostgreSQL Workflow instances/node events, management confirmation/execution APIs, subworkflow recursion guards, and real MCP execution including no-second-confirmation repair evidence.
- Workflow planning with authoritative JSON Schema output, bounded same-model validation correction, persisted candidate/error history, immutable Goal-version identity, and repository-proven confirmation inheritance.
- Domain-owned Workflow DSL, draft-2020-12 Schema, restricted expression AST, strict graph/catalog validator, negative security corpus, and real MCP/Skill validation e2e.
- PostgreSQL Prompt version lifecycle with inactive automatic candidates, administrator publication, disable/rollback-as-new-version, stage runtime resolution, invocation linkage, and effect summaries.
- Database-configured fixed-stage Model Runtime with AES-GCM Provider credentials, OpenAI-compatible/local HTTP structured and embedding calls, sanitized token/duration audits, and explicit no-fallback failure behavior.
- PostgreSQL/pgvector Skill projections and semantic candidate scoring with provider/dimension guards, same-process selection API, and a separately injected final-decider boundary.
- Fail-closed structured Skill authoring with a vendor-neutral ModelProvider port, bounded Schema correction, explicit-Schema validation, optional same-process management wiring, and PostgreSQL/Agent Card e2e evidence.
- Task-scoped Temporary Skills with enabled-MCP-Tool validation, atomic expiration/Experience persistence, canonical capability fingerprints, and a repeated-success `awaiting_simulation` formalization gate that cannot publish formal Skills.
- Skill candidate metric snapshots and an LLM-decision port that prevents semantic retrieval from becoming the final selector.
- Persistent Skill selection records and alternative-only replacement plans fixed at `awaiting_confirmation`.
- Domain-owned persistent Skill Graph with six typed relation kinds, hierarchical cycle prevention, management CRUD, OpenAPI, and real e2e evidence.
- MCP remote health checks that persist enabled/unreachable state, and remotely validated AES-GCM credential rotation without Tool rediscovery.
- Skill immutable version-chain, field-diff, and rollback-as-new-version management APIs.
- Same-process management HTTP API for real MCP and Skill operations, with OpenAPI, strict Zod input validation, credential-free responses, redacted errors, and explicit trusted-intranet/no-auth warnings.
- Persistent MCP invocation audit records with task/context correlation, arguments, displayable results/errors, status, timestamps, and duration.
- Persistent dependency warnings for enabled SkillVersions affected by removed or schema-changed MCP Tools, without automatic Skill disablement.
- Editable validated Tool enhancement metadata preserved across manual refreshes while original input schemas remain authoritative.
- Remote-only MCP Registry with runtime register/delete/manual refresh, official Streamable HTTP discovery/calls, current original-schema validation, and loopback contract/e2e coverage.
- AES-256-GCM credential envelopes backed by an environment master key and PostgreSQL MCP Server/Tool persistence.
- Explicit JSON Schema draft-07 support for official MCP Tool schemas alongside SDAR 2020-12 schemas.
- Persistent immutable Skill/SkillVersion registration, schema publication gates, enable/disable and rollback versioning.
- Enabled PostgreSQL SkillVersions as the dynamic Agent Card authority and selected SkillVersion output schema as the result-validation authority.
- Unit, PostgreSQL integration, and A2A end-to-end evidence for the first EP-02 vertical increment.
- EP-00 pnpm workspace with strict TypeScript, ESLint, Prettier, Vitest and unified bootstrap verification.
- Exact dependency pins and OSS Intake records for A2A JS SDK, LangGraph.js, MCP TypeScript SDK, esbuild and reference-only projects.
- A2A 1.0 wire-shape, MCP Streamable HTTP and LangGraph bounded-loop compatibility Spikes with reproducible tests.
- Machine-readable and human-readable EP-00 bootstrap verification reports.
- Digest-pinned PostgreSQL 17/pgvector 0.8.4 and Redis 8.2.7 Compose services with health checks, bootstrap migration and rollback notes.
- Real loopback A2A REST/streaming endpoint contracts and MCP remote cancellation propagation contract.
- CycloneDX SBOM, installed-package license report and generated third-party notices with freshness verification.
- A2A stream-disconnection contract proving task execution continues and can be polled to completion.
- LangGraph parallel-join and compiled-subgraph compatibility coverage.
- Reproducible `pnpm smoke:infra` command covering pgvector migration/vector operations and Redis write/read; current host Docker denial is reported as unverified evidence.
- EP-00 real infrastructure smoke passed unchanged after Docker access was restored: pgvector 0.8.4, migration, vector operation and Redis write/read verified.
- EP-01 domain-owned Task/ConversationContext/Goal models, deterministic task state machine, stable errors and application TaskService ports.
- Automated architecture gate enforcing Domain/Application independence from A2A, MCP, LangGraph, Express, ORM and queue SDK types.
- PostgreSQL Context/Task/Event repositories with idempotent protocol-domain migration and rollback.
- BullMQ queue/Worker adapter with attempts=1, in-process same-context serialization and queued-job restart retention verified against real Redis.
- Validated A2A message/domain mappings and a PostgreSQL-backed SDK TaskStore projection that keeps the domain task as the system of record.
- Single-process server composition root connecting the official A2A endpoint, TaskService, PostgreSQL repositories and BullMQ worker through the mandatory plan-confirmation boundary.
- Whitelisted A2A follow-up actions for plan revision/confirmation, supplementary input, pause and resume, persisted through the domain state machine and verified with the official client.
- ADR-008 documenting the domain-authoritative A2A projection and metadata-based follow-up command contract.
- Reproducible official A2A HTTP+JSON MUST TCK runner, test-only protocol SUT, production diagnostic reports, and TCK-driven fixes for JSON content types, AIP-193 errors, camelCase serialization and projection decoupling.
- Request-time dynamic Agent Card capability provider plus a unified EP-01 gate covering format, lint, typecheck, unit, integration, contract, e2e, build, built-server smoke and official TCK.
- Domain-owned Skill draft intake for explicit A2A create/update requests, persisted in PostgreSQL before queueing and excluded from dynamic Agent Card capabilities.
- Ajv-backed Result Processor boundary with strict Skill output-schema validation, stable errors, authoritative Task completion and dual text/data A2A artifacts.
- Production A2A stream-disconnect continuation, polling and standard resubscribe coverage, plus forced active-connection shutdown for deterministic server lifecycle.
- Automatic capability-gap resolution into a Task-bound Temporary Skill, mandatory-confirmation LangGraph execution, completion expiration/Experience recording, and real zero-before-confirmation MCP E2E evidence.
- Repeated-success Skill evolution with persisted induction/simulation reports, fail-closed drafts, all-pass automatic `experience_evolution` publication, management report endpoints, and dynamic Agent Card evidence.
- PostgreSQL-authoritative Evolution Experiences linking Goal, immutable Workflow, actual Skill versions, MCP Tools, input, result/errors, structured evaluation and duration, with Goal/Skill management retrieval.
- PostgreSQL-authoritative configurable Evolution success threshold with management GET/PUT and immutable per-Experience trigger audit records.
- Reproducible Skill induction reports covering consistency, stability, generalizability and duplication against the current formal Skill registry.
- Fail-closed capability-boundary evolution that creates either an immutable existing-Skill version or a distinct new Skill with a persisted decision reason.
