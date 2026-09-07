# G00 Baseline Report

## Result

G00 baseline is reproducible on SDAR main commit
`0f52a6dd277f8ca850b47467814680c8fee09901`, branch
`feature/v1.2.2-user-goal-planning-business-events`. The required ancestor is present and the complete
pre-upgrade gate passes.

## Repository and package integrity

- `origin/main` and initial `HEAD`: `0f52a6dd277f8ca850b47467814680c8fee09901`.
- `git merge-base --is-ancestor 0f52a6d HEAD`: passed.
- v1.2.2 package `SHA256SUMS.json`: all 21 declared files passed `sha256sum -c`.
- Package manifest limits writes to this repository and forbids merge/tag.
- The package directory was the only untracked input at Goal start; it is preserved as the user-supplied
  authoritative upgrade package.

## Complete verification

Final command, using the explicitly bootstrapped disposable database
`sdar_v122_baseline_20260722` and repository Compose Redis:

```text
TEST_DATABASE_URL=<compose-admin-url> \
SDAR_POSTGRES_URL=<disposable-v1.2.2-baseline-url> \
SDAR_TEST_POSTGRES_URL=<disposable-v1.2.2-baseline-url> \
SDAR_REDIS_HOST=127.0.0.1 SDAR_REDIS_PORT=56379 \
pnpm verify
```

Result: passed, 7/7 stages in 143,043 ms.

| Gate | Evidence |
| --- | --- |
| Static/unit/contract/build | 650 tests; architecture 285 TS files; A2A MUST 74/74; OpenAPI 122 operations; build passed |
| V1.1 MCP Tasks acceptance map | 16/16 passed with evidence classifications |
| Migrations | empty/0049, post-main through 0107 and Frozen rollback/gap gates passed |
| Integration | 84/84 with real PostgreSQL/Redis |
| E2E | 60/60 with real local infrastructure and deterministic model/Provider behavior |
| Infrastructure smoke | pgvector 0.8.5, bootstrap ledger and Redis PONG |
| Server/Console smoke | A2A, management, Agent Card and built Console reachable |

Machine and human reports: `reports/verification/summary.json` and `summary.md`.

## Failed attempts retained as evidence

1. Initial `pnpm verify` failed at migration verification because PostgreSQL was not listening at
   `127.0.0.1:55432`. Code/static/unit/contract/build had passed.
2. Starting Compose exposed an operator-managed `.env` URL at unavailable port 54329 and missing
   `TEST_DATABASE_URL` for the Frozen migration verifier.
3. Reusing the historical operator `sdar` database failed closed on the known 0100–0104 migration-ledger
   gap. It was not reset or repaired.
4. A fully empty temporary database lacked the required bootstrap ledger. The final run recreated only
   the explicitly named disposable database and applied `0001_sdar_bootstrap.up.sql` before verification.

These were environment preparation failures. No test assertion, strictness, migration history or product
code was weakened.

## Baseline risks entering v1.2.2

- The product contains intentional Legacy MCP and Legacy Skill compatibility paths, contrary to v1.2.2.
- Workflow/old Goal control currently owns terminal paths that must move to UserGoalPlanController.
- The current migration chain is incremental through 0107; v1.2.2 requires a guarded clean baseline.
- SDAR has no Business Events client assets or persistence yet.
- The external Provider has a candidate Skeleton/runtime but its report worktree is dirty and real SDAR
  Business Events interop is explicitly blocked/unexecuted.

## Evidence boundary

PostgreSQL/pgvector, Redis/BullMQ, HTTP, A2A endpoint, migration execution, build and smoke are real local
components. Model and MCP Provider business behavior inside the SDAR regression suite are deterministic
test implementations. No v1.2.2 external Provider Business Events interop is claimed by G00.
