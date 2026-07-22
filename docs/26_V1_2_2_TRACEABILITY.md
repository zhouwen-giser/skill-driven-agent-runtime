# SDAR v1.2.2 Traceability

Status values: `planned`, `implemented`, `verified`, `blocked_external_dependency`.

The authoritative requirement source is the v1.2.2 Goal package. This matrix maps every acceptance item
to one Goal and an owning implementation/test/evidence target. Symbol names are frozen targets until the
implementation introduces the exact source path.

| Acceptance | Goal | Implementation owner/target | Verification target | Status |
| --- | --- | --- | --- | --- |
| AC-001 | G01 | MCP adapter: remove Legacy client/router/mode | architecture Legacy-symbol zero gate | planned |
| AC-002 | G01 | Skill Registry: remove Legacy Usage projection | enabled-Skill inventory contract | planned |
| AC-003 | G02 | v1.2.2 baseline SQL/runner | empty database baseline test | planned |
| AC-004 | G02 | `db:reset:v1.2.2` guard | wrong environment/name rejection | planned |
| AC-005 | G04 | `SkillOutcomeSpecification` publication invariant | enabled inventory/schema test | planned |
| AC-010 | G03 | `UserGoalPlanningService` before selection | Task preparation order E2E | planned |
| AC-011 | G03 | `SkillGoalPlanValidator` coverage | uncovered criterion fixture | planned |
| AC-012 | G03 | `SkillGoalPlanValidator` DAG | cycle fixture | planned |
| AC-013 | G03 | forbidden execution-ID validator | injected Skill/Tool/Provider fixture | planned |
| AC-014 | G03 | immutable Goal Patch plan revision | Goal Patch repository/E2E | planned |
| AC-015 | G03/G06 | completed-effect inheritance | plan revision/no-replay test | planned |
| AC-020 | G04 | `SkillGoalScheduler` ready predicate | blocked/ready unit + integration | planned |
| AC-021 | G04 | compatibility admission | capability/effect/evidence/artifact/policy matrix | planned |
| AC-022 | G04 | active-attempt unique constraint/CAS | duplicate dispatch race | planned |
| AC-023 | G04 | safe parallel dispatch | disjoint-effect concurrency test | planned |
| AC-024 | G04 | conservative serialization | conflicting/unknown-effect test | planned |
| AC-025 | G04 | immutable Skill Goal contract | replacement/version test | planned |
| AC-030 | G05 | `TaskGoalJudge` | Provider completed / Goal not achieved | planned |
| AC-031 | G05 | `TaskGoalJudge` | Provider failed / effect achieved | planned |
| AC-032 | G05 | `SkillGoalJudge` | Workflow completed / Goal not achieved | planned |
| AC-033 | G05 | `UserGoalJudge` | Skill Goal achieved / User Goal working | planned |
| AC-034 | G05 | `UserGoalPlanController` | all criteria → A2A completed | planned |
| AC-035 | G05 | confidence policy | low-confidence fail-closed matrix | planned |
| AC-036 | G05 | terminal repository port restricted to controller | terminal symbol architecture audit | planned |
| AC-037 | G05 | terminal unique/CAS transaction | concurrent terminal race integration | planned |
| AC-040 | G06 | strategy fingerprint admission | same-strategy rejection | planned |
| AC-041 | G06 | progress/recovery coordinator | stalled strategy-change test | planned |
| AC-042 | G06 | persisted four-level budgets | exhaustion matrix | planned |
| AC-043 | G06 | recovery authority order | achieved User Goal no-recovery | planned |
| AC-044 | G06 | recovery authority order | achieved Skill Goal no-attempt | planned |
| AC-045 | G06 | Task Goal/no-replay authority | achieved Task Goal no-task replay | planned |
| AC-046 | G06 | remote reconciliation guard | uncertain Task reconcile-first | planned |
| AC-047 | G06 | completed effect/forbidden replay | plan revision no side-effect replay | planned |
| AC-048 | G06 | PostgreSQL budget repository | process restart counter test | planned |
| AC-050 | G07 | vendored external Skeleton lock | commit/hash/requirements-lock report | planned |
| AC-051 | G07 | strict Business Events discovery/header adapter | valid/invalid frozen fixtures | planned |
| AC-052 | G07/G08 | inbox admission transaction | durable insert + cursor integration | planned |
| AC-053 | G08 | independent admitted/processed cursors | process-failure restart test | planned |
| AC-054 | G08 | generation drain coordinator | current/closed replay test | planned |
| AC-055 | G08 | continuity handler | reset/idempotency test | planned |
| AC-056 | G07/G08 | relation resolver | preview/pagination contract | planned |
| AC-057 | G07/G08 | relation completeness policy | incomplete-negative rejection | planned |
| AC-058 | G07/G08 | isolated notification/event state | concurrent streams test | planned |
| AC-059 | G08 | subscription/recovery repository | runtime restart test | planned |
| AC-060 | G09 | rule-first impact service | related/no-impact test | planned |
| AC-061 | G09 | binding→current Skill Goal mapping | current-goal impact trace | planned |
| AC-062 | G09 | dependency/criterion mapping | future dependency test | planned |
| AC-063 | G09 | evidence invalidation action | evidence lineage test | planned |
| AC-064 | G09 | event handling Goal insertion | DAG revision test | planned |
| AC-065 | G09 | Incident AgentTask idempotency | cross-Goal dedupe integration | planned |
| AC-066 | G09 | continuity conservative recovery | continuity-loss trace | planned |
| AC-067 | G09 | policy/confirmation boundary | model cannot execute side effect | planned |
| AC-070 | G10 | unified verification | `pnpm verify` report | planned |
| AC-071 | G10 | external Provider candidate interop | real interop md/json | blocked_external_dependency |
| AC-072 | G10 | A2A SUT/TCK | applicable MUST TCK report | planned |
| AC-073 | G10 | Management/OpenAPI/React Console | contract + production UI E2E | planned |
| AC-074 | G10 | capacity/security/SBOM/container | release hardening reports | planned |
| AC-075 | G10 | release evidence commit | `git status --porcelain` empty | planned |
| AC-076 | G10 | final report classifications | declaration-boundary audit | planned |
| AC-077 | G00/G10 | external repository read-only policy | before/after Provider status/hash audit | planned |
| AC-078 | G10 | release policy | no merge/tag audit | planned |

## Requirement and Goal coverage

| Source | Coverage |
| --- | --- |
| Master functional/quality/declaration contracts | G00–G10 and AC-001–AC-078 above |
| Frozen Clean-slate decisions | G01/G02, ADR-109, AC-001–AC-005 |
| Frozen Goal Runtime limits | G03/G04/G06, AC-010–AC-025 and AC-040–AC-048 |
| Frozen layered Outcome authority | G05, AC-030–AC-037 |
| Frozen Business Events client semantics | G07/G08, AC-050–AC-059 |
| Frozen Event Impact semantics | G09, AC-060–AC-067 |
| Release/interop boundary | G10, AC-070–AC-078 |
| Provider V0.5.2 requirements used by SDAR consumer | G07/G08 contract lock and client fixture suite |

No Master Goal acceptance item is unmapped. A row becomes `verified` only when its implementation path,
test path and reproducible report are all present.
