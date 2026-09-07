# P05 Retained Failed Attempts

## Static and focused repairs

- The first typecheck found exact-optional-property mismatches, an external Catalog JSON boundary
  cast and environment fixtures missing the new optional allowlist. Call sites were made explicit;
  strictness was not weakened.
- The first lint pass found an unnecessary assertion, unsafe implicit stringification, an unused
  binding field and promise/void style violations in the new test. Each source was corrected and
  typecheck, lint, format and the focused suite were rerun successfully.

## Independent review repairs

- Review pass 1 closed at 0 Blocking / 4 Major / 1 Minor. It found terminal-state reactivation,
  implicit approval of repeated Catalog drift, an unlocked localServerId import race, redirect-based
  SSRF exposure and order-sensitive Tool hashing. All five were repaired and covered by real
  integration regressions.
- Review pass 2 confirmed those repairs but found 1 additional Major evidence gap: the retention
  proof used only an Agent Task row. A real Runtime Remote Task authority fixture and repository
  query/poll-control assertion replaced that weak evidence.
- Review pass 3 closed at 0 Blocking / 0 Major / 0 Minor.

## Infrastructure and full verification

- One official Integration run was interrupted by a long host/session pause and eventually timed
  out before Vitest output. The isolated PostgreSQL/Redis containers remained healthy and no test
  process remained. Fresh database recreation reran the same command in 82.71 seconds with all
  137 tests passing.
- A read-only migration command inside the filesystem sandbox could not access the Windows Docker
  configuration. The authorized full gate later ran the migration verifier successfully.
- The first `pnpm verify` passed formatting, 910 regular Unit, 22 performance Unit and 214 Contract
  tests, then correctly rejected the cross-authority acceptance test because it lived under the
  Control persistence package while importing the Runtime repository. The test was moved to a
  neutral acceptance app; no architecture rule was weakened.
- The exact full command was rerun from `f409911` and passed in 358,400 ms, including 1,146
  Unit/Contract tests, 137 real Integration tests, 72 E2E tests, 29 Runtime migrations, build and all
  process smokes.

No assertion was weakened, no test was skipped, no secret value was persisted, and no pre-existing
Docker volume was deleted.
