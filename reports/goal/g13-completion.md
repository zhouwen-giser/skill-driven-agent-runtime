# G13 Goal Completion Report

## Summary

G13 implements governed Planning Knowledge Retrieval over the exact PostgreSQL Active Knowledge
authority. Vector recall over rebuildable Memory projections and PostgreSQL full-text recall execute
in parallel, deterministic reciprocal-rank fusion combines them, and every result is rechecked against
Active status, Promotion policy, Capability Catalog, scope, applicability and exact Skill Version.

The returned context follows strict progressive disclosure: a reduced Level-0 index contains no full
definition, selected Level-1 definitions obey the frozen 3 Task Type / 8 Capability Pattern / 8
Planning Heuristic limits, and every emitted Capability definition includes its complete current
Enabled Skill declaration at Level 2. The complete disclosed context, including conflicts, is
factory-validated at no more than 20,000 characters.

PostgreSQL records each exact knowledge revision once per Planning Session under an advisory lock and
emits `planning.knowledge_used` transactionally. Candidate Reflection lineage now projects `related`
relations, newer Candidate revisions project `supersedes`, and the bounded one-hop reader preserves
all five frozen relation semantics without merging contradictions or superseded knowledge.

## Goal Contract Result

```text
completed
```

All G13 affected implementation and verification gates are green. Implementation commits
`1879ff1aca1e7ac6806f111f951909db4d2b698f` and
`3201325d7cd9c59d047301b0ef1f16188a4adff4` are pushed. Draft PR #9 remains Draft.

## Implementation

- Domain owns immutable Active definitions, reduced index entries, exact Skill declarations,
  relation records, usage records and budgeted Planning bundles under `KNOWLEDGE_USAGE_INVALID`.
- `KnowledgeQueryFingerprintBuilder` hashes normalized query terms plus exact Task/tenant/user scope,
  Catalog Hash and Promotion policy version.
- `PostgresKnowledgeSearchRepository` unions only Active revisions with an exact passed Promotion
  evaluation. Capability Patterns additionally require the current Catalog Hash.
- Vector and FTS searches run in parallel. Memory supplies only recall embeddings and never authority;
  generic Memory searches explicitly exclude `active_knowledge`, preventing a scope-bypass path.
- `ReciprocalRankFusion` applies the frozen default rank constant, minimum confidence, stable
  authoritative-reference tie-break and per-channel influence evidence.
- `KnowledgeApplicabilityEvaluator` fail-closes on matching negative examples and incompatible
  constraints, and requires a matching declared applicability condition when one exists.
- `KnowledgeRelationExpander` processes at most one bounded hop. `requires`, `supported_by` and
  `related` may expand; `contradicts` and `supersedes` remain separate conflicts and are never merged.
- `PlanningContextBudget` loads Level 0 before selected Full Definitions and complete current exact
  Skill declarations. It never emits a Capability definition with a missing or oversized Skill
  declaration.
- Usage reservation uses one Planning-Session advisory lock plus a Session/knowledge/revision unique
  index. Concurrent duplicate retrieval returns only rows actually reserved by that transaction.
- Migration 0121 adds replayable fingerprint/rank/authority fields, Session-level dedupe, bounded
  relation storage and Active FTS indexes. Its up migration refuses unverifiable pre-G13 usage rows;
  its down migration refuses to discard usage or relation evidence.
- The runtime composition root creates the Retriever for G14. G13 intentionally adds no Management
  API, A2A extension or model stage.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G13-01 | verified | real PostgreSQL test returns only exact-policy Active global/user-A rows, excludes user-B and Candidate, and rechecks relations through the same filters |
| AC-G13-02 | verified | focused unit proves deterministic vector/text RRF order and dual-channel influence; real integration persists two dual-channel usages |
| AC-G13-03 | verified | focused unit covers all five relation types, one-hop seed restriction and count bound; real Reflection transaction persists a Candidate relation |
| AC-G13-04 | verified | unit and real PostgreSQL tests retrieve once then return an empty bundle for the same Session; transaction/unique-index reservation is concurrency-safe |
| AC-G13-05 | verified | reduced index has no `definition`; Full Definitions follow kind limits; complete current exact Skill declarations follow and oversized Skill detail removes the dependent definition |
| AC-G13-06 | verified | PostgreSQL tenant/user/task/global filter is fail-closed; generic Memory cannot read Active projections; factory-enforced total disclosed context is at most 20K |
| AC-G13-07 | verified | 20 repeated real PostgreSQL retrievals report P95 4.476 ms against the frozen ≤500 ms target |

## Validation

| Command / gate | Result | Evidence |
| --- | ---: | --- |
| test-first G13 unit | failed 5/5, then passed 7/7 | initial constructors/services were absent; final suite covers RRF, all relations, dedupe, filtering and budgets |
| Cognitive Schema + focused suite | 8/8 | 7 G13 unit tests plus the complete cognitive Golden Schema contract |
| full `pnpm test:unit` | 575/575 | 98 files; sandbox-external loopback rerun |
| full `pnpm test:contract` | 155/155 | 19 files; sandbox-external loopback/subprocess rerun |
| real PostgreSQL/Redis integration | 83/83 | 8 files; Active authority, scope, Memory isolation, relation projection, usage/Outbox and P95 |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | 2 files; v1.2.2 execution and terminal authority remain unchanged |
| migration path | passed | v1.2.2 baseline plus 14 additive migrations; idempotency, rollback/reapply, guarded reset and rogue-ledger rejection |
| Prettier / ESLint / strict TypeScript | passed | all configured files; zero errors |
| architecture | passed | 408 TypeScript sources; 19 Domain/56 Application cognitive files; no Python runtime |
| Management OpenAPI | passed | unchanged 147 operations; G13 adds no endpoint |
| production build / Server smoke | passed | strict TypeScript, Console Vite build, Agent Card, Console and trusted-intranet warning |

The final integration performance event was:

```json
{"event":"planning.knowledge_retrieval.p95","samples":20,"p95Ms":4.476,"targetMs":500}
```

## Failed Attempts and Root Cause

1. The test-first suite failed 5/5 because the G13 Domain and Application symbols did not exist. The
   final focused suite passes 7/7 without weakening an assertion.
2. Early type/lint runs found an omitted runtime-handle field, a redundant literal comparison,
   optional-chain style and deprecated Zod shape use. The owning types and validators were corrected.
3. The first direct integration reached the protected operator `sdar` database with a preserved
   incompatible historical ledger. It was not reset; the standard isolated runner passed.
4. The first real usage-event integration reused the Planning Session as an Outbox aggregate and hit
   the existing aggregate/version uniqueness invariant. Each immutable usage row now owns its event
   aggregate while the Planning Session remains the correlation.
5. The FTS fixture expected `inspection` to match `inspect` under PostgreSQL's intentionally simple
   dictionary. The fixture now contains the exact lexical term; production FTS semantics were not
   weakened.
6. Full Unit/Contract sandbox attempts failed only on `listen EPERM` and `spawnSync EPERM`. Approved
   sandbox-external reruns passed 575/575 and 155/155 without product changes.
7. Final review found Level 0 still carried Full Definition fields, exact Skill loading carried only a
   summary, generic Memory could expose Active projection summaries, conflicts were outside the 20K
   calculation, and relations had no product ingestion path. Reduced index/exact declaration types,
   Memory exclusion, a factory-checked full budget and transactional Candidate relation projection
   close those gaps with regression evidence.
8. `psql` was unavailable for the isolated smoke database. The existing pinned `pg` driver created
   and deleted only `sdar_v123_g13_smoke`; the operator `sdar` database was untouched.

## Architecture, Authority and Source Intake

The architecture guardian confirms one TypeScript modular monolith and the sole LangGraph workflow
runtime. PostgreSQL remains the only Knowledge and usage authority. Memory is a rebuildable vector
projection readable only through the scoped authority join. Redis remains ephemeral. No LLM output,
Candidate row, projection text or relation can commit Goal, Plan, Skill, Outcome, Recovery or terminal
state, and G13 cannot invoke tools.

Implementation is original repository TypeScript using only already locked conceptual references.
No code was copied or translated, no runtime dependency was added, and no Source Intake, lockfile,
license, NOTICE or SBOM update is required.

## Commit, Push and Draft PR

- Primary G13 implementation: `1879ff1aca1e7ac6806f111f951909db4d2b698f`
- Relation-ingestion correction: `3201325d7cd9c59d047301b0ef1f16188a4adff4`
- Push: published to `origin/feature/v1.2.3-cognitive-planning-runtime`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft
- Merge/tag: not performed and not authorized

## G14 Handoff

G14 receives one composed `PlanningKnowledgeRetriever` that returns replayable, bounded Active-only
context and records exact usage. It must decorate the existing G05 Planner before model planning,
honor the frozen injection modes and always fall back to the unchanged base Planner when retrieval,
knowledge validation or enriched planning fails. It must not confirm a Plan, call a Tool or let
knowledge replace current Skill compatibility, Provider Readiness or v1.2.2 execution authority.
