# EP-SDAR-V1.3-PR13 - Merge Remediation

## Purpose

Close every actionable unresolved review thread that currently prevents PR #13
from merging into `main`, without changing the v1.3 authority model or claiming
that P13/P14 release prerequisites are complete.

## Baseline

- Branch: `feature/v1.3-sequential-implementation`.
- Starting HEAD: `f53ed69d1fce612393c856605fcf77356082676c`.
- PR: #13, targeting `main`.
- `origin/main`: `940bb96439186acf2151935cc953a51b512abab1`.
- `git merge-tree` reports no textual conflict.
- GitHub reports no workflow run or commit status for the current head.

## Findings

| Thread | Severity | Required closure |
| --- | --- | --- |
| `PRRT_kwDOTXmUNs6Vo1HT` | P1 | include request identity in Model Route evidence references |
| `PRRT_kwDOTXmUNs6Vo1HW` | P1 | tenant-scope Artifact Read Audit projection |
| `PRRT_kwDOTXmUNs6Vo1HY` | P2 | preserve secondary failure when Template error evidence persistence fails |
| `PRRT_kwDOTXmUNs6Vo6ol` | P1 | schedule a Task after an auto-confirmed formal Gateway handoff |
| `PRRT_kwDOTXmUNs6Vo6om` | P1 | enforce the Gateway stage deadline inside the P08 handoff transaction |
| `PRRT_kwDOTXmUNs6Vo6op` | P2 | use a route-and-Cascade cursor for Model Usage pages |

## Authority Decisions

- Model Route decision content hashing remains unchanged; only the durable
  evidence identity becomes request-scoped.
- PostgreSQL remains the audit authority. Tenant filtering occurs in the
  PostgreSQL query, not in a post-query display filter.
- Template Runtime still returns classified outcomes when it can persist the
  failure evidence. If that evidence write fails, the caller receives both the
  original and persistence errors and cannot mistake the operation for handled.
- A committed Fast Gateway plan re-enters the existing confirmed planning
  continuation and Task scheduler; the Gateway remains a thin orchestrator.
- The stage-owned deadline is passed through P08 to the existing interactive
  planning repository. PostgreSQL enforces a bounded statement timeout and a
  database-clock check before the authority transaction commits.
- Model Usage pagination keeps PostgreSQL as projection authority and uses an
  opaque composite cursor without changing Cascade evidence ownership.
- No new migration or ADR is required because these changes enforce existing
  P08/P11/P12 contracts and ADR-122 rather than changing them.

## Progress

- [x] 2026-08-01 Fetched current `main`, checked merge-tree, PR metadata,
      workflow/status state and complete review threads.
- [x] 2026-08-01 Implemented the initial three review closures with regression tests.
- [x] 2026-08-01 Re-read GitHub after the first push and implemented three newly
      posted review closures with regression tests.
- [x] 2026-08-01 Ran focused Unit and real PostgreSQL Integration tests.
- [x] 2026-08-01 Ran format, lint, typecheck, architecture and isolated E2E gates.
- [x] 2026-08-01 Updated traceability, status and changelog.
- [x] 2026-08-02 Published implementation commits `bf3f017` and `7ee8799`,
      resolved all six threads and re-checked the live merge state.

## Validation

Executed commands and results:

```text
node node_modules/vitest/vitest.mjs run --project unit \
  packages/application/test/template-runtime-p08.unit.test.ts \
  packages/application/test/case-model-runtime-p11.unit.test.ts
  PASS: 2 files, 19 tests

node node_modules/vitest/vitest.mjs run --project unit \
  packages/application/test/plan-preparation-processor.unit.test.ts \
  packages/application/test/template-runtime-p08.unit.test.ts \
  packages/application/test/fast-gateway-adapters-p10.unit.test.ts
  PASS: 3 files, 27 tests

pnpm test:unit
  PASS: 133 files, 908 tests

node node_modules/vitest/vitest.mjs run --project integration \
  packages/persistence-postgres/test/artifact-management-p12.integration.test.ts
  PASS: 1 file, 7 tests, real isolated PostgreSQL

pnpm test:integration
  PASS: 20 files, 130 tests, real isolated PostgreSQL/Redis

pnpm test:contract
  FIRST RUN: one unmodified timing-sensitive frozen component test failed
  EXACT RERUN: PASS, 1 file, 7 tests
  CLEAN FULL RERUN: PASS, 30 files, 214 tests

pnpm test:e2e
  PASS: 6 files, 72 tests, real isolated PostgreSQL/Redis

pnpm format:check
pnpm lint
pnpm typecheck
pnpm verify:architecture
  PASS

pnpm build
  PASS: strict production TypeScript and Console Vite build

pnpm smoke:server
  FIRST RUN: sandbox could not read Docker config/Buildx state
  ISOLATED RERUN: PASS against disposable PostgreSQL/Redis
```

The first repository-managed Integration attempt could not use the existing
PostgreSQL named volume because its Debian-to-Alpine collation metadata is
incompatible. No user volume was removed or rewritten. Disposable PostgreSQL
and Redis containers were used instead. The first focused SQL regression also
caught a PostgreSQL placeholder-type error in the new tenant query; the query
was corrected to a dedicated `$1/$2/$3` parameter set before the passing runs.

The first deadline-fence implementation used PostgreSQL `transaction_timeout`.
All 130 assertions passed, but Vitest correctly reported an unhandled pool
connection termination. It was replaced with transaction-local
`statement_timeout` plus a database-clock check immediately before commit; the
clean full Integration rerun passed 20 files / 130 tests without unhandled
errors.

The final E2E run reused operator-managed disposable containers. The package's
recorded Redis digest was no longer resolvable from the registry, so the run
used the locally available Redis 7.0 image without changing repository pins.
The first Server smoke invocation was also blocked before product startup by
the sandbox's denied Docker configuration access; its isolated-infrastructure
rerun passed and the temporary containers were stopped and auto-removed.

## Outcomes

The implementation, local evidence and publication checks are complete.
GitHub independently reports all six review threads resolved, head
`7ee8799877ecafe428b4a56e0ac5707f3fd74835`, `mergeable=MERGEABLE`,
`mergeStateStatus=CLEAN`, Ready (`isDraft=false`), no review decision and no
status checks. PR #13 remains OPEN and unmerged. No automatic merge, tag,
release or deployment was performed.
