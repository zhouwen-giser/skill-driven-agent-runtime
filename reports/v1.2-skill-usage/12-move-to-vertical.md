# SDAR v1.2 Phase 12 — `embodied.move_to` Vertical Acceptance

Date: 2026-07-17

Status: Passed and published

Dependency: V11-MAIN-BASELINE-DEPENDENT

Input SHA: `4ae28c6f31f52af3b98395571a6505fd5492f71a`

Feature SHA: `873ee8024178d4b4e4f53e2c86099bf01dd58d2b`

## Result

The formal `embodied.move_to` package now runs through the existing exact-version Skill selection,
bounded Usage policy, Workflow planning/validation/outer confirmation, LangGraph execution, V1.1 MCP
Task continuation and append-only Skill execution-record authorities. Guidance uses the bounded planner
instruction, while template and procedure modes compile deterministic Workflow data. All three modes
invoke the exact `embodied.move` operation with only `{resourceId,target}` and never bypass the existing
confirmation or Provider readiness checks.

The vertical fixed four integration defects found by executable acceptance: formal required attributes
now use canonical V1.1 semantics; deterministic Usage expressions receive explicit `skillInput`,
`context` and `evidence` roots; deterministic Task success returns Provider output instead of a literal;
and terminal execution projection publishes the outcome reference before its terminal status. The last
ordering makes `completed` the visibility barrier for the complete evidence snapshot while preserving
Task/Workflow/Provider authority.

Deployment-owned context resolution is an optional trusted adapter input. The default remains empty and
fail-closed. Required target/context gaps and forbidden-area policy block before `tools/call`. Provider
evidence is read from the adapter-owned `io.sdar/evidence` metadata projection; a Provider `completed`
claim without `final-position` evidence cannot complete the A2A Task or Skill execution record.

## Fourteen-Scenario Matrix

| # | Scenario | Result | Reproducible evidence |
| -: | --- | --- | --- |
| 1 | guidance + immediate Tool | Passed | real A2A/Server/Workflow vertical selects guidance, calls `embodied.move` once and completes with final-position evidence |
| 2 | template + remote MCP Task | Passed | real A2A vertical observes remote working/completed Task and continuation re-entry |
| 3 | procedure + deterministic DSL | Passed | real A2A vertical verifies compiled `usage_task_0`/`usage_evidence_0`, exact arguments and compliant plan |
| 4 | missing target position | Passed | input resolution returns `target` as unresolved; no Provider side effect |
| 5 | forbidden area | Passed | confirmed plan fails closed on policy/context evidence; no Provider side effect |
| 6 | Provider available | Passed | the three successful verticals retain ready selected Provider evidence |
| 7 | Provider restricted + reschedule | Passed | A2A planning retains restricted availability window; readiness unit accepts only a valid in-window reschedule |
| 8 | required Provider disabled | Passed | readiness unit keeps the exact required Provider unavailable |
| 9 | remote `input_required` | Passed | MCP Tasks contract performs one call, input request/update and terminal result; existing remote runtime integration remains green |
| 10 | cancel | Passed | MCP Tasks contract proves cooperative cancel acknowledgement/terminal observation with one call; existing cancellation integration remains green |
| 11 | Runtime restart and continuation | Passed | production `ServerRuntime` restart integration continues `embodied.move` without replaying `tools/call` or an ordinary running Task |
| 12 | Provider success without final-position evidence | Passed | remote Provider reaches terminal success, while A2A and Skill execution remain non-completed behind the hard gate |
| 13 | valid final-position evidence | Passed | guidance/template/procedure verticals complete and expose terminal outcome/evidence references |
| 14 | legacy Skill still works | Passed | the complete 55-test A2A file retains all existing legacy Skill/Task behavior |

Every successful vertical asserts exact Skill/version and mode, structural plan compliance, exact Task
arguments, one invocation, correct external waiting/continuation where applicable, terminal outcome
reference and a complete execution-record view. The missing-evidence vertical waits through remote
terminal observation before proving that no false completion occurred.

## Verification

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` passed for the feature
  tree; unit/contract result was 84 files and 565/565 tests.
- `node scripts/check-architecture.mjs` verified 256 TypeScript source files.
- Real local PostgreSQL/Redis A2A/Server/LangGraph/MCP loopback vertical:
  `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` passed 55/55.
- Real local PostgreSQL/Redis restart, remote continuation, input and cancellation regression:
  three integration files passed 11/11.
- Formal package/golden checksum, expression roots, deterministic compilation, required-disabled
  readiness and MCP Provider input/cancel contracts are included in the complete 565-test gate.
- No test is skipped in the complete unit/contract or A2A commands. Deterministic loopback models and
  Providers are test doubles; PostgreSQL, Redis, BullMQ, Server Runtime, Workflow and adapters are real.

Repository-owned `sdar-postgres-1` and `sdar-redis-1` were stopped after verification with volumes
preserved. The ignored operator `.env`, the operator-owned `sdar` database and the external
provider-runtime PostgreSQL were unchanged.

## Remaining Scope

Phase 13 must prove recursive `embodied.area_patrol` parent/child composition and degradation. Phase 14
retains adversarial/fix and mandatory full verification, and Phase 15 retains final audit/release gates.
Draft PR #5 remains Draft and is not merged. External production MCP Tasks Provider interoperability
remains unverified.
