# SDAR v1.2 Phase 0 Baseline

- Phase: 0 — repository discovery and design freeze
- Dependency class: `V11-INDEPENDENT`
- Branch: `feature/v1.2-skill-driven-capability-usage`
- Base/main SHA: `667146a3639eefdfed9b89c2417c08e1ac50e9a9`
- Resulting SHA: `3e5ed759de421d1d6b687da67ad400ceb7cca962`
- Package: `skill-driven-agent-runtime@1.1.0`
- Migration high-water: `0104_workflow_external_wait_event`
- ADR high-water: `ADR-095`

## v1.1 main Gate

Final submitted SHA `9e32311e45a9257741fb7c62f4f89b76dce8360f` is an ancestor of
`origin/main`. GitHub connector evidence reports PR #4 merged on 2026-07-17. Current main contains the
Remote Task, availability/timing, external wait/continuation, input, cancel/reconcile, restart and final
acceptance implementation. The latest-main full baseline passed. Gate status: **OPEN**.

## Authoritative input

The supplied Goal package is retained exactly at
`docs/sdar_v1_2_skill_driven_capability_usage_codex_goal_package.md`, SHA-256
`70663c7b20578b2520b074090e3a2b206aaff868b42666b812b03bc2ed44a9af` (content-complete;
Markdown trailing whitespace normalized).
The separately named `SDAR_v1.2_Skill_Driven_Capability_Usage_Overall_Design.md` was not present in the
attachment directory, repository, remote branches or tags. `docs/24_V1_2_SKILL_DRIVEN_CAPABILITY_USAGE_DESIGN.md`
is therefore a clearly labelled normalization of the frozen task package, not a fabricated source copy.

## Baseline verification

`CI=true pnpm install --frozen-lockfile` passed with the locked supply-chain policy. A corrected
self-managed Compose `pnpm verify` passed in 150,801 ms:

- 75 unit/contract files, 493 tests;
- 80 real PostgreSQL/Redis integration tests;
- 49 real local E2E tests;
- 232 TypeScript architecture files;
- A2A HTTP/JSON MUST 74 passed, 0 failed/errors;
- 110 Management OpenAPI operations;
- 68 migration pairs including empty/0049 and isolated v1.1 paths;
- production Server/Console build, infrastructure smoke and Server/Console smoke.

Two earlier attempts were environment diagnostics, not hidden passes: ignored `.env` selected
operator-managed infrastructure without a server and then mapped PostgreSQL to 54329 while the migration
verifier expects default 55432. The passing run temporarily isolated that ignored file with an EXIT trap;
the file was restored unchanged. Model and Provider business behavior remain deterministic simulations.

## Architecture decisions and boundaries

Skill usage types and state belong to Domain; orchestration extends existing Application services;
Workflow and remote Provider state remain owned by their existing authorities. The v1.2 usage recursion
budget is distinct from existing depth-8 graph/call safety limits. No production code, migration, shared
v1.1 integration file or second runtime is changed in Phase 0.

## Changed files

- normalized design and exact Goal package;
- EP-10;
- baseline, repository, symbol, overlap and sync-state reports;
- Phase 0 status/changelog entries.

## Limitations and deferred work

All v1.2 production behavior is deferred to Phases 1–15. External production Provider interoperability
is not claimed. The missing separate design source remains a documented non-blocking input gap because
the supplied package freezes the required product and safety decisions in full.

## Publication

Commit `3e5ed759de421d1d6b687da67ad400ceb7cca962`
(`docs(v1.2): freeze skill usage goal-mode baseline`) was pushed immediately to
`origin/feature/v1.2-skill-driven-capability-usage`. Draft PR #5 is open against `main` at
`https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/5`. This publication evidence is a
follow-up commit; the already-pushed Phase 0 commit was not amended or rebased.
