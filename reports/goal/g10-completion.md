# G10 Goal Completion Report

## Summary

G10 implements Candidate-only Task Type induction without changing the v1.2.2 Goal, Skill, Outcome,
Recovery or formal Understanding authorities. Seven-dimensional deterministic fingerprints and
clustering run before a strictly validated model names the abstraction. Offline and online modes
persist immutable versioned Candidate revisions with one to three real Goal Episode exemplars;
Candidate status cannot become Active and is not wired into G03 formal Understanding. A deterministic
Applicability Guard rejects negative-example, missing-dimension, capability and current-user-constraint
conflicts.

## Goal Contract Result

```text
completed_pending_commit_publication
```

The implementation and all affected gates are green. This report is included with the meaningful G10
implementation commit; the exact SHA and push state are recorded in the follow-up evidence commit.
Draft PR #9 remains Draft.

## Implementation

- Domain owns immutable `TaskTypeInductionExample` and `TaskTypeDefinitionSnapshot` factories,
  validation, stable `TASK_TYPE_INVALID` errors, Candidate-only status and 1–3 Exemplar bounds.
- `TaskTypeFingerprintBuilder` canonicalizes semantic objective, Criteria, Artifact, Capability, DAG
  shape, Correction and Outcome dimensions. Configured deterministic aliases handle conservative
  wording variants while Criteria remain a hard fingerprint boundary.
- `TaskTypeClusterer` sorts Episodes and groups by exact canonical fingerprint before any model call.
  Duplicate Episode IDs fail closed and a singleton cluster is skipped without invoking the model.
- `TaskTypeInductionService` supports bounded `offline_batch` and `online_candidate` inputs. Its strict
  Zod/JSON Schema allows the model to name and summarize a cluster and propose Recognition hints,
  Positive/Negative Examples, required/optional dimensions, Criteria Template, Capability
  Requirements, Goal Pattern, Dependency Pattern and incompatible constraints. IDs, revision, status,
  fingerprint, exemplars and authority remain deterministic Application/Domain data.
- Repeated delivery with the same exact exemplar set returns the persisted revision without another
  model invocation or write. New evidence creates the next Candidate revision.
- `PostgresTaskTypeRepository` verifies every Exemplar is a persisted Goal Episode, serializes by
  fingerprint, enforces monotonic revision/idempotency and atomically writes
  `task_type_definition`, compatible support evidence and `knowledge.candidate_created`.
- Migration 0118 adds only Task Type origin/model lineage and an index to the G00 tables, plus the
  audited `task_type_induction` Model stage. Its down migration refuses to discard induction data.
- `GET /api/v1/task-types` and the 142-operation OpenAPI expose versioned Candidate evidence. The Server
  composes the real PostgreSQL repository and induction service, but the G03 static Task Type source
  remains unchanged; G12 promotion must govern any later Active projection.
- The v1.2.3 cognitive JSON Schema and Golden fixture now cover the complete Task Type snapshot and
  `goal_experience_episode` source kind.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G10-01 | verified | unit proves seven-dimensional, order-independent fingerprint and distinct-Criteria separation |
| AC-G10-02 | verified | singleton performs zero model calls; deterministic cluster of three invokes naming once |
| AC-G10-03 | verified | Domain/JSON/OpenAPI schemas and unit assert Recognition, Negative Examples, dimensions, Criteria, Capabilities and Goal/Dependency patterns |
| AC-G10-04 | verified | singleton creates nothing; Domain type/factory and real PostgreSQL assertion permit Candidate only |
| AC-G10-05 | verified | Server leaves G03 `StaticTaskTypeIndexSource` unchanged; API/repository return Candidate-only snapshots |
| AC-G10-06 | verified | Applicability Guard simultaneously rejects Negative Example, user constraint, missing dimension and unavailable capability |

## Validation

| Command / gate | Result | Evidence |
| --- | ---: | --- |
| test-first G10 unit | failed 5/5, then passed 5/5 | missing constructors retained as initial failure; final focused suite passes |
| cognitive JSON Schema Golden | 1/1 | new Task Type definition validates under Draft 2020-12 schema |
| focused Management contract | 53/53 | Candidate-only list and both new model-stage routes |
| full `pnpm test:unit` | 554/554 | 95 files; sandbox-external loopback run |
| full `pnpm test:contract` | 153/153 | 19 files; sandbox-external HTTP/subprocess run |
| real PostgreSQL/Redis integration | 80/80 | 8 files; Candidate revisions, 2→3 Exemplar evidence, Outbox and zero Active rows |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | 2 files; existing authoritative execution path unchanged |
| migration path | passed | v1.2.2 baseline plus 11 additive migrations; idempotency, rollback/reapply, guarded reset and rogue rejection |
| Prettier / ESLint / strict TypeScript | passed | all configured files; zero errors |
| architecture | passed | 378 TypeScript sources; 16 Domain/37 Application cognitive files; no Python runtime |
| Management OpenAPI | passed | 142 operations |
| A2A baseline | MUST 74/74 | pinned HTTP-JSON TCK baseline |
| sources / licenses / SBOM / protocol | passed | 27 pinned sources; 286 npm packages + 2 services; frozen protocol package |
| production build | passed | TypeScript plus Console Vite build |

## Failed Attempts and Root Cause

1. The test-first suite failed 5/5 because Fingerprint, Clusterer, Induction Service and Applicability
   Guard did not exist. The same tests now pass.
2. Strict TypeScript initially found an untyped frozen `skipped` mapping, missing schema versions in
   test SourceRefs, an absent base Domain error code and optional-property reconstruction at the
   PostgreSQL boundary. Typed reconstruction and exact optional fields fixed them.
3. The first real integration run passed 79/80 and showed that the Domain incorrectly required a
   non-empty optional user-constraint list. Only optional `constraints` and
   `incompatibleConstraints` now permit empty arrays; Evidence, Criteria, Capability and Recognition
   requirements remain strict.
4. The second real integration run passed 79/80 and exposed PostgreSQL polymorphic JSONB parameter
   inference for revision/exemplar counts. Explicit `integer` casts fixed the Outbox boundary.
5. ESLint found redundant literal-type checks, a prohibited type assertion and a constant-true test
   condition. The code now uses an explicit representative guard and exact state-array assertion.
6. Unit/Contract loopback/subprocess suites require sandbox-external execution because sandbox runs
   fail with `listen EPERM`/`spawnSync EPERM`; approved external runs pass in full.

## Architecture and Authority

The architecture guardian confirms a single TypeScript modular monolith and sole LangGraph execution
runtime. Task Type Domain data does not import PostgreSQL, HTTP, SDK or model types. Model output is
strict data and can neither execute code nor choose IDs, revisions, status or persistence. PostgreSQL
is the only durable Candidate/evidence authority. No Candidate is supplied to formal Understanding or
Planner; no Skill is generated or published. Private model reasoning is neither requested nor stored.

## Migration and Source Intake

0118 is additive to the byte-stable v1.2.2 baseline and uses the existing G00 Task Type tables. The
implementation is original repository TypeScript informed only by already locked AWM/AutoSkill design
references. No code was copied or translated, no new dependency was added, and no new Source Intake,
license, NOTICE, lockfile or SBOM change is required.

## Commit, Push and Draft PR

- Meaningful G10 implementation commit: pending publication
- Push: pending publication
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft
- Merge/tag: not performed and not authorized

## G11/G12 Handoff

G11 may use the immutable multi-dimensional examples/fingerprints and Candidate evidence when inducing
Capability Patterns, without treating Task Types as Capability authority. G12 receives versioned
Candidate Task Type definitions, support evidence, model lineage and `knowledge.candidate_created`;
only G12 may evaluate and promote. G03/G05/G14 must continue to ignore these Candidates until an Active
projection exists.
