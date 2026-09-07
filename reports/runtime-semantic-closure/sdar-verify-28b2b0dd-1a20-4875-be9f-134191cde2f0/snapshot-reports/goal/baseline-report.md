# SDAR v1.2.3 Baseline Report

## Repository / Branch / HEAD / Main

- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Required and fetched `origin/main`: `35cb9277396e0316b1c6b8aac57e6fa69a8a29df`
- Required minimum ancestor: present (`git merge-base --is-ancestor` exited 0)
- Delivery branch: `feature/v1.2.3-cognitive-planning-runtime` (the user-requested name is the repository mapping)
- G00 implementation HEAD: `ffd979152ae45468f00e2cf673e97ed5fe32616c`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8>

## Working Tree

The initial `main` worktree contained only the supplied untracked task package at
`docs/SDAR_v1.2.3_Codex_Goal_Package_V1.0/`. No existing user change was stashed, discarded or
overwritten. The G00 implementation commit included the task package and the scoped v1.2.3 changes.

## Package / Runtime Stack

- Node.js `v22.14.0`; package engine `>=20.19.0`
- TypeScript `6.0.3`, strict mode; pnpm `11.7.0`
- LangGraph.js `1.4.7` is the only workflow runtime
- official A2A JS SDK `1.0.0-beta.0`; official MCP SDK `1.29.0`
- PostgreSQL/pgvector is the system of record; Redis/BullMQ is reconstructable runtime state
- package version at baseline: `1.2.2`

## Existing Architecture and Authorities

v1.2.2 Goal/Skill/Workflow/Outcome/Recovery, Business Events, Provider and `UserGoalPlanController`
remain authoritative. G00 adds Domain/Port/schema contracts and additive DDL only; no cognitive
composition-root service, HTTP route, queue worker or product behavior is activated.

## Existing Migration / OpenAPI / Console / TCK / SBOM Gates

- v1.2.2 clean-slate baseline marker: `v1.2.2_clean_slate_baseline`
- historical 0001-0107 migrations retained for audit; v1.2.3 uses additive post-baseline 0108
- Management OpenAPI baseline: 124 operations
- applicable official A2A MUST TCK: 74/74
- generated npm SBOM baseline: 286 packages plus two external services
- v1.2.2 accepted baseline: 629 unit/contract, 68 integration and 59 E2E before G00 additions

## Commands and Results

```powershell
git pull --ff-only origin main
git merge-base --is-ancestor 35cb9277396e0316b1c6b8aac57e6fa69a8a29df HEAD
$env:CI='true'; pnpm.cmd install --frozen-lockfile
node docs\SDAR_v1.2.3_Codex_Goal_Package_V1.0\scripts\self-check.mjs
$env:CI='true'; $env:SDAR_POSTGRES_URL='postgresql://.../sdar_test_v123_full_gate'; pnpm.cmd verify
```

Pull/ancestor/install/package integrity passed. The final isolated-database full gate passed in
168,876 ms; details are in `reports/verification/summary.{json,md}`.

## Known Baseline Failures

- The supplied self-check used URL pathname parsing that treated a Windows drive path as a URL path.
  G00 replaced it with `fileURLToPath`, regenerated its manifest hash and reverified all 50 hashes.
- A first full-gate attempt observed an existing remote-lifecycle read timing failure; the unchanged
  E2E suite immediately passed 59/59 on exact retry.
- The default local `sdar` volume contains the retained historical 0001-0107 ledger, not the v1.2.2
  clean-slate marker. It was inspected read-only and not reset. Final smoke evidence used and then
  removed the task-owned `sdar_test_v123_full_gate` database.

## Path and Interface Mapping for this Goal Package

Task-package preferred `docs/execplans` and `docs/adr` paths map to repository-standard root
`execplans/` and `adr/`. Cognitive Domain contracts live in `packages/domain/src/cognitive/`, Ports in
`packages/application/src/cognitive/`, schema/fixtures in `schemas/v1.2.3/`, and per-Goal evidence in
`reports/goal/`.
