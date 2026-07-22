# SDAR v1.2.2 Traceability

All v1.2.2 acceptance rows are verified. “Verified” means implementation, an owning automated or
repeatable test, and a reproducible report exist. The authoritative source remains the frozen Goal
package under `docs/SDAR_v1.2.2_Codex_Goal_Package_SDAR_Only/`.

| Acceptance | Goal    | Implementation                                                  | Verification and evidence                                                                          | Status   |
| ---------- | ------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| AC-001     | G01     | Frozen-only MCP registry/adapter; removed compatibility symbols | architecture zero-symbol gate; `G01-COMPATIBILITY-REMOVAL.md`                                      | verified |
| AC-002     | G01     | native Skill Usage only                                         | Skill inventory contracts; G01 report                                                              | verified |
| AC-003     | G02     | clean baseline SQL/runner                                       | empty/idempotent migration gate; `G02-CLEAN-BASELINE.md`                                           | verified |
| AC-004     | G02     | guarded `db:reset:v1.2.2`                                       | environment/name/confirmation rejection and real reset                                             | verified |
| AC-005     | G04     | required `SkillOutcomeSpecification`                            | enabled package/fixture inventory; `G04-SKILL-GOAL-SCHEDULER.md`                                   | verified |
| AC-010     | G03     | planning before selection                                       | planning/processor unit and A2A E2E; `G03-USER-GOAL-PLANNING.md`                                   | verified |
| AC-011     | G03     | 100% criterion coverage validator                               | uncovered-criterion unit                                                                           | verified |
| AC-012     | G03     | bounded DAG validator                                           | cycle/missing-dependency unit                                                                      | verified |
| AC-013     | G03     | execution-ID rejection                                          | injected Skill/Tool/Provider/Workflow ID unit                                                      | verified |
| AC-014     | G03     | immutable Goal Patch revision                                   | Goal Patch unit/E2E                                                                                | verified |
| AC-015     | G03/G06 | completed-effect inheritance                                    | revision/no-replay unit and PostgreSQL integration                                                 | verified |
| AC-020     | G04     | ready predicate                                                 | ready/blocked scheduler unit                                                                       | verified |
| AC-021     | G04     | compatibility admission                                         | capability/effect/evidence/artifact/policy matrix                                                  | verified |
| AC-022     | G04     | active-attempt CAS/unique index                                 | duplicate-dispatch unit and PostgreSQL race                                                        | verified |
| AC-023     | G04     | bounded safe parallel dispatch                                  | disjoint-effect scheduler unit                                                                     | verified |
| AC-024     | G04     | conservative serialization                                      | conflicting/unknown-effect unit                                                                    | verified |
| AC-025     | G04     | immutable Goal execution contract                               | replacement/version E2E and persistence                                                            | verified |
| AC-030     | G05     | `TaskGoalJudge`                                                 | Provider completed/Goal unmet unit; `G05-LAYERED-OUTCOME-AUTHORITY.md`                             | verified |
| AC-031     | G05     | `TaskGoalJudge` effect authority                                | Provider failed/effect achieved unit                                                               | verified |
| AC-032     | G05     | `SkillGoalJudge`                                                | Workflow completed/Goal unmet unit                                                                 | verified |
| AC-033     | G05     | `UserGoalJudge`                                                 | partial coverage remains working unit                                                              | verified |
| AC-034     | G05     | `UserGoalPlanController`                                        | 100% coverage terminal unit/integration                                                            | verified |
| AC-035     | G05     | confidence policy                                               | low-confidence fail-closed matrix                                                                  | verified |
| AC-036     | G05     | single terminal controller                                      | architecture audit and controller unit                                                             | verified |
| AC-037     | G05     | atomic terminal CAS                                             | PostgreSQL concurrent/stale-worker race                                                            | verified |
| AC-040     | G06     | strategy fingerprint admission                                  | same-strategy rejection; `G06-PROGRESS-RECOVERY-NO-REPLAY.md`                                      | verified |
| AC-041     | G06     | progress/recovery coordinator                                   | stalled/change-strategy unit                                                                       | verified |
| AC-042     | G06     | four-level persisted budgets                                    | exhaustion unit/integration                                                                        | verified |
| AC-043     | G06     | User Goal recovery authority                                    | achieved User Goal stop unit                                                                       | verified |
| AC-044     | G06     | Skill Goal recovery authority                                   | achieved Skill Goal stop unit                                                                      | verified |
| AC-045     | G06     | Task Goal/no-replay authority                                   | achieved Task Goal stop unit                                                                       | verified |
| AC-046     | G06     | remote reconciliation guard                                     | uncertain Task reconcile-first unit                                                                | verified |
| AC-047     | G06     | completed effect/forbidden replay                               | append-only PostgreSQL integration                                                                 | verified |
| AC-048     | G06     | PostgreSQL budget authority                                     | new-repository restart integration                                                                 | verified |
| AC-050     | G07     | exact vendored Skeleton lock                                    | 23 hashes, OSS intake/ADR-110; `G07-BUSINESS-EVENTS-FROZEN-CLIENT.md`                              | verified |
| AC-051     | G07     | strict discovery/header/Ack client                              | valid/invalid Provider fixtures and contract suite                                                 | verified |
| AC-052     | G07/G08 | transactional durable admission                                 | runtime unit, PostgreSQL integration and E2E                                                       | verified |
| AC-053     | G08     | independent admitted/processed cursors                          | processing-failure/restart unit; `G08-BUSINESS-EVENTS-RUNTIME.md`                                  | verified |
| AC-054     | G08     | generation drain coordinator                                    | current/closed/retired replay tests and real interop                                               | verified |
| AC-055     | G08     | continuity handler                                              | Reset/idempotency tests and real interop                                                           | verified |
| AC-056     | G07/G08 | relation resolver                                               | preview/pagination contract and real 128/128/4 interop                                             | verified |
| AC-057     | G07/G08 | completeness policy                                             | incomplete-negative rejection                                                                      | verified |
| AC-058     | G07/G08 | isolated notification/event state                               | architecture, contracts and parallel E2E                                                           | verified |
| AC-059     | G08     | subscription recovery                                           | durable cursor/runtime restart tests and real reconnect                                            | verified |
| AC-060     | G09     | rule-first impact                                               | related/no-impact unit; `G09-EVENT-IMPACT-RECOVERY.md`                                             | verified |
| AC-061     | G09     | binding-to-current-Goal mapping                                 | Task Event trace unit                                                                              | verified |
| AC-062     | G09     | dependency/criterion mapping                                    | future dependency unit                                                                             | verified |
| AC-063     | G09     | evidence invalidation                                           | evidence lineage unit                                                                              | verified |
| AC-064     | G09     | EventHandlingSkillGoal revision                                 | confirmation-pending DAG revision unit                                                             | verified |
| AC-065     | G09     | Incident AgentTask idempotency                                  | dedupe and interrupted-attachment repair unit                                                      | verified |
| AC-066     | G09     | conservative continuity recovery                                | continuity trace/runtime tests                                                                     | verified |
| AC-067     | G09     | policy/confirmation boundary                                    | low-confidence and Emergency Skill isolation unit                                                  | verified |
| AC-070     | G10     | unified release gate                                            | clean `2db3996` `pnpm verify` all-pass summary                                                     | verified |
| AC-071     | G10     | external Provider runtime                                       | real POST/SSE interop against exact `8a81b1b`; interop md/json                                     | verified |
| AC-072     | G10     | A2A SUT/TCK                                                     | 74/74 applicable MUST, 161 scoped skips, 0 failures/errors                                         | verified |
| AC-073     | G10     | Management/OpenAPI/React Console                                | 124-operation contract, React view unit, production bundle/server smoke                            | verified |
| AC-074     | G10     | capacity/security/SBOM/container                                | 10-context/20-waiter tests, strict boundaries, 286-package SBOM, Compose and real DB-restart audit | verified |
| AC-075     | G10     | release evidence                                                | final clean-worktree audit after evidence commit                                                   | verified |
| AC-076     | G10     | declaration boundaries                                          | client/final acceptance reports distinguish five claim levels                                      | verified |
| AC-077     | G00/G10 | read-only Provider policy                                       | exact archive plus before/after external HEAD/status audit                                         | verified |
| AC-078     | G10     | release policy                                                  | Draft PR only; no merge/tag audit                                                                  | verified |

## Evidence sets

- G00–G02: `reports/v1.2.2/G00-BASELINE.md`, G01/G02 reports and G00 evidence index.
- G03–G09: `reports/v1.2.2/evidence/G03-G09-EVIDENCE-INDEX.md` and the seven Goal reports.
- G10: `reports/v1.2.2/acceptance/`, `reports/v1.2.2-interop/` and
  `reports/verification/summary.{md,json}`.

Evidence classification is explicit: PostgreSQL/Redis/HTTP/A2A/LangGraph/API/build/smoke/database
restart and external Provider interop are real; loopback model choices and Frozen Mock scenario
semantics are simulated contract fixtures; no v1.2.2 acceptance row remains unverified.
