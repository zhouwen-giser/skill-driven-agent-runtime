# SDAR v1.2 Phase 5 — Bounded Recursive Composition and Three-mode IR

- Goal: resolve exact-version Skill composition through the existing Skill Graph and planner
- Dependency class: `V11-INDEPENDENT / V11-CONTRACT-SENSITIVE`
- Base SHA: `a65d27007ecdcb431d1a637df3b78a6ec7c55958`
- Resulting SHA: `9b218732b66db8d928a5daa15923d4ee66018f51`
- v1.1 Gate after publication: OPEN

## Delivered

The existing `SkillCompositionPlanner` now resolves fixed dependencies and declared capability slots
against the existing `SkillGraphRepository`. It accepts an exact root version and exact slot choices,
requires current enabled versions and an admitted graph relation, derives an immutable exact-version
candidate set, and rejects unused or duplicate choices. Parent/child input and output mappings are
declarative property paths checked against both schemas; executable strings never enter the plan.

Every parent/child expansion consumes one shared usage budget. The usage default is three and the hard
maximum remains five; plans also cap expanded Skills at 32 and nodes at 128. Active-stack cycles,
duplicate expansion, disconnected topology, duplicate edges, incorrect depths, candidate-set drift and
budget contradictions all fail closed. The Domain snapshots and freezes every reference, candidate,
mapping and plan collection.

The same planner interprets a selected exact Skill/mode/plan into one of three safe IRs:
`SkillGuidanceContext`, `SkillTemplateInstance` or `SkillProcedureProgram`. Procedure IR contains only
context, confirmation, exact child-call, Task-binding and evidence-gate steps. It is not Workflow DSL and
is not compiled or executed in this phase. Failure projection gives the four declared policies distinct
parent states: fail-fast aborts, recoverable enters recovery, optional records and continues, and
degraded continues only with explicit bounded missing-effect or missing-evidence data.

The formal area-patrol package now carries reviewed input/output mappings on its exact move dependency
and inspection slot. Its composition artifact checksum is
`149fb9b07d3912bb270b5d216df09acec9d4dfc4653a70df42c50fb9930ab546`; the resulting full package
checksum is `194ed0c08582c9a779e56df7dfc084c2c53a4351e5a8714510dde28de933a747`. This is an additive Phase 5
contract extension; the Phase 3B report intentionally preserves the checksum of its already-published
historical artifact.

## Architecture guardian evidence

The implementation extends the existing graph, relation repository and composition planner. It adds no
parallel graph, Workflow runtime, Provider state, MCP/A2A SDK type, persistence model, API or Console
path. Domain owns immutable plan/IR/failure contracts; Application owns repository coordination and
schema compatibility. Procedure data is never executable source and never reaches LangGraph compilation
in this phase. No ADR is needed because these boundaries and limits are frozen requirements rather than
a new architectural authority.

## Verification

- targeted existing/new composition plus formal-package regression: 3 files / 20 tests passed;
- full self-managed `pnpm verify`: passed in 139,408 ms;
- unit/contract: 80 files / 542 tests passed;
- real PostgreSQL/Redis integration: 9 files / 80 tests passed;
- real PostgreSQL/Redis/model/MCP E2E: 2 files / 49 tests passed;
- architecture: 246 TypeScript source files passed;
- A2A MUST: 74 passed / 0 failed / 0 errors; Management OpenAPI: 110 operations;
- acceptance maps: 18 baseline and 16 MCP Tasks scenarios passed;
- 68 runtime migrations, production builds, infrastructure smoke and Server/Console smoke passed.

Tests cover fixed and dynamic edges, exact candidates, relation and mapping compatibility, required and
duplicate slot choices, cycles, duplicate expansion, default depth, size limits, forged/disconnected
plans, all three IRs, wrong-plan/mode rejection and all four failure policies. A direct sandbox-only
contract invocation first reported 73 loopback `listen EPERM` failures; the authorized complete gate ran
the same contracts successfully. The failure is classified as an execution-environment restriction, not
a product defect.

## Limitations and next step

This phase resolves and validates plans but does not persist, expose, compile or execute them. Dynamic
Task Provider readiness remains behind the Phase 4 mock Port; Phase 8 owns the real v1.1 adapter. After
this phase commit is pushed, the required v1.1-main Gate is repeated immediately. Phase 6 then records
the canonical merged-main baseline and freezes shared contracts without manufacturing an empty merge.

## Publication

Commit `9b218732b66db8d928a5daa15923d4ee66018f51`
(`feat(v1.2): resolve bounded recursive skill composition`) was pushed immediately to the tracked
origin branch and the remote SHA matched exactly. The mandatory post-push Gate fetched current
`origin/main` `667146a3639eefdfed9b89c2417c08e1ac50e9a9`, proved v1.1 final submitted commit
`9e32311e45a9257741fb7c62f4f89b76dce8360f` is its ancestor, and proved main is already an ancestor of
the Phase commit. The branch was 0 behind / 13 ahead, so the Gate remains OPEN. This evidence is
recorded in a follow-up commit without amend, rebase or force-push.
