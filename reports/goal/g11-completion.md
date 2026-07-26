# G11 Goal Completion Report

## Summary

G11 implements Candidate-only Capability Pattern induction and explicit Capability Gap Candidates
without changing v1.2.2 Goal, Skill, Outcome, Recovery, Provider Readiness or compatibility
authorities. Declared, Observed and Validated evidence remain separate. A strict grounded model may
name and summarize only deterministic evidence groups; Application code owns capability identity,
catalog binding, exact current Skill Version mappings, revision, status and persistence.

Every mapping explicitly requires a fresh current Readiness/compatibility check. An empty mapping
creates an auditable, non-executable Gap with a manual-only Skill Authoring Proposal whose
`publishAllowed` flag is false. Catalog Hash, exact Skill Version and policy changes move affected
Active Patterns to `validating` through a CAS/audit/Outbox transaction.

## Goal Contract Result

```text
completed
```

All affected implementation and verification gates are green. This report is included in meaningful
G11 implementation commit `16441f37446bae3bead5d4a3b0d92ced8392042b`; publication state is
recorded by the follow-up evidence commit. Draft PR #9 remains Draft.

## Implementation

- Domain owns immutable `CapabilityPatternInductionExample`,
  `CapabilityPatternDefinitionSnapshot`, three-level evidence, exact-version mapping and
  `CapabilityGapCandidateSnapshot` factories with stable `CAPABILITY_PATTERN_INVALID` validation.
- Input signals cover Skill Outcome, Attempt, Evidence, Artifact, Correction, Recovery and Event
  Impact, plus Applicable Conditions, Effect, Prerequisite, Dependency, Failure and Limitation.
- `CapabilitySkillMapper.mapCurrentVersions` reads only G01's current enabled exact Skill
  declarations and canonical Catalog Hash. It never reads or asserts Provider state, live
  availability, Readiness or compatibility.
- `CapabilityPatternInductionService.induce` groups sorted real Episode evidence by deterministic
  Capability ID, requires at least two Episodes, computes a source-content fingerprint and invokes
  the audited `capability_pattern_induction` stage once per eligible group.
- Strict Zod/JSON Schema rejects malformed output, and a deterministic grounding check rejects every
  model-produced field value that is absent from the supplied Experience or current Skill Outcome
  declarations. The model cannot choose identity, status, version, mapping or authority.
- Pattern snapshots preserve Applicable Conditions, Effect, Evidence, Artifact, Prerequisite,
  Dependency, Failure and Limitation alongside separate Declared/Observed/Validated evidence.
- Every exact Skill Version mapping stores
  `requiresCurrentReadiness=true` and `compatibilityStatus=requires_current_check`; past success
  therefore cannot satisfy current execution gates.
- `CapabilityGapService.createCandidate` creates or reuses a deterministic, restart-idempotent Gap.
  The embedded authoring proposal is manual review only, non-executable and unable to publish a
  Skill. No Skill Authoring or Skill Registry mutation port is injected.
- `CapabilityPatternInvalidator.invalidateByCatalog` is called at Server startup and after G01
  catalog rebuilds. PostgreSQL locks Active rows, performs version-CAS `active→validating`, records
  `knowledge_status_transition` and emits `knowledge.validating`.
- `PostgresCapabilityPatternRepository` verifies real Goal Episode lineage and current exact Skill
  mappings, serializes Candidate revisions, and transactionally writes Pattern definition,
  Pattern/Experience evidence and `knowledge.candidate_created`.
- Gap persistence uses a separate operational `capability_gap_candidate` table and an atomic
  `capability.gap_candidate_created` Outbox event. It is not promotable knowledge and does not reuse
  the v1.2.2 terminal Task `capability_gap` authority.
- Migration 0119 adds Capability Pattern identity/model lineage, the Gap table, indexes and Model
  stage. Its rollback refuses to discard Pattern/Gap data or configured routes.
- `GET /api/v1/capability-patterns`, the 143-operation OpenAPI, the cognitive JSON Schema and Golden
  fixture expose Patterns and non-executable Gaps. No Candidate is supplied to formal Understanding
  or Planner.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G11-01 | verified | focused unit and real PostgreSQL integration preserve Declared/Observed/Validated arrays independently; Skill declaration remains byte-identical |
| AC-G11-02 | verified | Domain, Zod, cognitive JSON and OpenAPI schemas plus unit assertions cover applicability/effect/evidence/artifact/prerequisite/dependency/failure/limitation |
| AC-G11-03 | verified | mapper and integration bind `skill.capability-pattern.db:1`; unmapped capability creates one explicit Gap |
| AC-G11-04 | verified | all mappings require current Readiness and compatibility checks; no Provider/readiness authority is stored |
| AC-G11-05 | verified | exact Skill v1→v2 changes Catalog Hash and CAS-transitions the Active Pattern to validating with transition/Outbox evidence |
| AC-G11-06 | verified | Gap is non-executable, proposal is manual with `publishAllowed=false`, and integration proves no Skill version is created |

## Validation

| Command / gate | Result | Evidence |
| --- | ---: | --- |
| test-first G11 unit | failed 6/6, then passed 6/6 | missing factories/services retained as initial failure; final focused suite includes restart-idempotent Gap |
| cognitive JSON Schema Golden | 1/1 | Capability Pattern and Gap validate under Draft 2020-12 |
| focused Management/Application contract | 60/60 | API list and all three cognitive induction model stages |
| full `pnpm test:unit` | 560/560 | 96 files; sandbox-external loopback run |
| full `pnpm test:contract` | 154/154 | 19 files; sandbox-external HTTP/subprocess run |
| real PostgreSQL/Redis integration | 81/81 | 8 files; Patterns, evidence, exact mapping, Gap, idempotency and invalidation |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | 2 files; v1.2.2 authoritative execution path unchanged |
| migration path | passed | v1.2.2 baseline plus 12 additive migrations; idempotency, rollback/reapply, guarded reset and rogue rejection |
| Prettier / ESLint / strict TypeScript | passed | all configured files; zero errors |
| architecture | passed | 385 TypeScript sources; 17 Domain/41 Application cognitive files; no Python runtime |
| Management OpenAPI | passed | 143 operations |
| A2A baseline | MUST 74/74 | pinned HTTP-JSON TCK baseline |
| sources / licenses / SBOM / protocol | passed | 27 pinned sources; 286 npm packages + 2 services; frozen protocol package |
| production build | passed | strict TypeScript plus Console Vite build |

## Failed Attempts and Root Cause

1. The test-first suite failed 6/6 because Capability Pattern/Gap factories, mapper, induction,
   invalidator and repository ports did not exist. The same tests now pass.
2. The first strict TypeScript run found the new Domain code missing from the root
   `DomainErrorCode` union. Adding the stable code to the owning Domain union fixed the boundary.
3. ESLint found redundant runtime comparisons against compile-time literal types and one unnecessary
   generic. The duplicated checks were removed while mutable identity, source, hash, version and
   relationship validation remains.
4. The first real integration attempt failed with sandbox `EPERM`; an approved retry against stale
   port 54329 then failed `ECONNREFUSED`. Read-only Compose inspection showed healthy repository
   PostgreSQL on 55432 and Redis on 56379. The standard isolated-database script then passed 81/81.
5. Full Unit/Contract sandbox runs failed only on local `listen EPERM` and one `spawnSync EPERM`.
   Approved external reruns passed 560/560 and 154/154 without changing assertions.
6. An attempted `pnpm verify:a2a` command failed because no such script exists. The repository's exact
   `pnpm verify:a2a-baseline` command passed MUST 74/74.
7. Review found that repeated Gap creation after restart could conflict if the clock changed. A
   fingerprint lookup now returns the existing immutable Gap before constructing a new timestamped
   snapshot; unit and real PostgreSQL reruns prove idempotency.

## Architecture and Authority

The architecture guardian confirms one TypeScript modular monolith and the sole LangGraph workflow
runtime. Domain models import no PostgreSQL, HTTP, SDK or model types. PostgreSQL remains the only
durable Pattern/Gap/evidence authority. Model output is strict inert data and cannot execute code or
commit status. Observed success cannot mutate Skill declarations or bypass current readiness.
Candidate Patterns are not wired to Understanding or Planner. Gap proposals have no dependency on
Skill Authoring/Registry mutation, are non-executable and cannot publish.

## Migration and Source Intake

0119 is additive to the byte-stable v1.2.2 baseline and extends the G00 Capability Pattern tables. The
separate Gap table is an operational candidate/proposal record, not a second Skill or knowledge
authority. The implementation is original repository TypeScript informed only by the already locked
AutoSkill/Voyager/Agent Skills concept references. No code was copied or translated, no new dependency
was added, and no Source Intake, license, NOTICE, lockfile or SBOM change is required.

## Commit, Push and Draft PR

- Meaningful G11 implementation commit: `16441f37446bae3bead5d4a3b0d92ced8392042b`
- Push: published with this follow-up evidence commit
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft
- Merge/tag: not performed and not authorized

## G12 Handoff

G12 receives versioned Candidate Capability Patterns, separate evidence levels, exact current Skill
mapping evidence, Catalog Hash/policy lineage and existing `knowledge.candidate_created` events.
Promotion may govern Capability Patterns only; Capability Gaps remain non-executable operational
proposals requiring an independent manual Skill Authoring review. G03/G05/G14 must continue to ignore
Candidate Patterns until G12 creates a governed Active projection.
