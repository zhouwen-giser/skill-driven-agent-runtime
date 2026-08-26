# PR #26 integration and repeatable UGV debug startup

## Purpose / Outcome

Resolve `codex/live-dev-evaluation-chain` against `main`, include the already validated ADR-141
Provider lifecycle repair used by the debug deployment, and publish the source branch to the
existing PR #26 targeting `main`. Codify the existing debug startup without modifying the running
checkout, databases, Provider or Device state.

## Requirements / Architecture

FR-A2A-001/006, FR-EXE-001/002, FR-MCPT-009/010 and ADR-140/141 retain their existing owners.
The host supervisor alone owns process identity, sanitized environment and side-effect configuration.
The new command is only a thin dispatcher; PostgreSQL remains admission/Binding authority and
LangGraph remains the only workflow runtime. No new dependency, protocol, authorization mode or ADR.

## Progress

- [x] Inspect PR #26, both parent histories and actual debug entrypoints.
- [x] Merge current `main` plus tested lifecycle repair in an independent worktree; preserve both
      startup import sets and all CHANGELOG entries.
- [x] Add a repeatable existing-stack debug command and configuration/runbook documentation.
- [x] Run the relevant combined regressions and static/build checks; record actual results.
- [ ] Commit and push to the existing #26 source branch; retarget the PR to `main` and verify status.

## Discoveries

- #26 targets `codex/sdar-ugv-smpp-integration`, which is already merged into `main`. Retargeting
  alone does not resolve its two conflicts (`main.ts` imports and CHANGELOG).
- The current checkout is `codex/provider-binding-lifecycle@67dfb81`; changing it underneath the
  source-running debug processes is unnecessary. All integration work uses a separate worktree.
- `restart-server --side-effects NO` is an intentional no-op when already NO, so it does not reload
  changed code. An explicit full supervisor stop/start reloads Server, Control API and worker.
- At this turn's read-only check the supervisor reported `UAP_PROCESS_NOT_RUNNING` and A2A 10999
  refused connections. This task does not silently restart services or claim a live acceptance pass.

## Decisions / Recovery

- Keep #26 admission observation, trusted-intranet natural-language admission and ADR-141 lifecycle
  changes together; do not choose one side wholesale.
- `pnpm ugv:debug restart` reuses containers/state and stops then starts the existing three processes.
  A failed stop aborts before start. Per the operator's follow-up, debug start/restart defaults to YES,
  using the existing authorized run identity and the supervisor's explicit acknowledged transition.
  Explicit NO remains available and needs no run identity. The low-level acceptance supervisor still
  starts NO; the debug entrypoint then selects the requested mode. No clean, bootstrap, qualification,
  Task or Device call is performed. Existing supervisor ownership checks remain intact.
- Preserve historical reports and private credentials. Use a normal fast-forward push to the existing
  source branch, never force-push. Request merge via #26; do not bypass repository merge checks.

## Validation

New command contracts cover exact dispatch, full reload order, stop failure, invalid/extra arguments
and the package entrypoint. Combined tests cover the PR's migration/admission observation and
natural-language/Provider authority seams. Typecheck, production build, scoped lint/format,
architecture, shell syntax and diff checks are required. No external simulator or live DB tests.

Executed on 2026-08-26 in the independent integration worktree:

```bash
./node_modules/.bin/vitest run \
  apps/node-control-acceptance/test/ugv-debug-command.contract.test.ts \
  apps/node-control-acceptance/test/ugv-agent-profile-simulation-deployment.contract.test.ts \
  apps/server/test/environment.unit.test.ts \
  apps/server/test/runtime-migration-selection.contract.test.ts \
  apps/server/test/ugv-move-binding.unit.test.ts \
  apps/server/test/governed-control-management-identity.unit.test.ts \
  apps/server/test/provider-binding-reconciler.unit.test.ts \
  apps/node-control-api/test/provider-health-reconciler.unit.test.ts \
  packages/application/test/remote-task-admission-recovery.unit.test.ts \
  packages/persistence-postgres/test/remote-task-admission-intent-store.unit.test.ts \
  packages/management-api/test/http-endpoint.contract.test.ts \
  packages/application/test/task-capability.unit.test.ts \
  packages/persistence-postgres/test/task-capability-repository.unit.test.ts \
  packages/application/test/frozen-mcp-registry.unit.test.ts \
  packages/node-control-application/test/mcp-provider-binding-service.unit.test.ts \
  packages/node-control-application/test/a2a-exposure-service.unit.test.ts \
  packages/a2a-adapter/test/node-control-agent-card.contract.test.ts
```

- All **295 unique tests across 17 files pass**: the 16 non-supervisor files pass in the combined
  run; the 13-test supervisor file passes when rerun alone in the host process namespace. The initial
  worktree lacked the sibling Provider checkout and console dependency links; after restoring this
  local layout, sandbox `/proc` identity validation required the host-only rerun. No assertion or
  test was removed, skipped or weakened. The new debug dispatcher contributes 15 of these tests.
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false`: PASS.
- `pnpm_config_verify_deps_before_run=false pnpm build`: PASS (Server TypeScript and console
  TypeScript/Vite). This worktree reuses installed dependencies; pnpm's default automatic reinstall
  initially hit its inaccessible metadata database. The explicit setting avoids changing shared
  dependencies, not any build or type check. No lockfile/dependency changes.
- ESLint on all 72 changed/new TS/TSX/MJS files relative to `main`: PASS. Prettier on changed/new
  supported files: PASS. `node scripts/check-architecture.mjs`: PASS, 858 source files.
- `bash -n deploy/ugv-agent-profile-simulation/debug.sh`, `node --check` on both changed migration
  scripts, `git diff --check` and `git diff --cached --check`: PASS. No unresolved merge markers,
  new dynamic source execution, skipped/focused tests or `any` debt.
- The already recorded ADR-141 isolated PostgreSQL evidence remains valid; this merge does not
  modify that migration/repository implementation or rerun tests against debug databases. No live
  navigation, Tool invocation, debug restart or whole-project acceptance is claimed.

## Outcomes

Implementation and relevant verification complete; source-branch push and PR retarget pending.
