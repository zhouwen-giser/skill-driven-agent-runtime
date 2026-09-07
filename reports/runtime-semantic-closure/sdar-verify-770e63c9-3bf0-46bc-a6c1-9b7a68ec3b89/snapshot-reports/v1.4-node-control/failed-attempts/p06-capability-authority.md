# P06 Retained Failed Attempts

## Focused implementation repairs

- `pnpm exec vitest` could not resolve the Windows shim; the repository-local
  `.\\node_modules\\.bin\\vitest.cmd` ran the exact tests successfully.
- Initial lint/typecheck found strict optional-property, unsafe call and style failures. The unsafe
  call exposed that `hasCommandReceipt` had been placed on the wrong Repository interface; the port
  was corrected without weakening ESLint or TypeScript.
- The first real Capability integration run exposed that strict Ajv rejected a fixture whose
  `required` key lacked matching `properties`. The fixture was corrected; schema strictness remained.
- The first idempotency replay assertion exposed different optional-array shapes between initial
  create and database replay. Domain normalization now emits stable empty arrays, and replay after
  publication is covered.

## Independent review repairs

- Review pass 1 closed at 0 Blocking / 1 Major / 1 Minor: compile JSON Schemas and remove
  locale-dependent canonical ordering.
- Review pass 2 closed at 0 Blocking / 2 Major / 1 Minor: enforce Idempotency-Key on creates,
  If-Match on mutable lifecycle commands and canonical implementation versions.
- Review pass 3 closed at 0 Blocking / 0 Major / 0 Minor.

## Full verification

- One `pnpm verify` launch used a 5-second execution-tool timeout and was terminated before a code
  result. It was rerun with the correct command timeout.
- The first complete gate passed 914 regular Unit, 22 performance Unit and 214 Contract tests, then
  found two stale P01 foundation assertions that still expected Control migration `0005` to be
  latest. The test now expects `0006`, proves rollback removes only Capability tables and proves
  `0005` MCP Binding tables remain.
- A focused rerun that pointed Runtime and Control at the same database correctly failed the ledger
  isolation assertion. The official integration harness created two isolated databases and passed
  all 25 files / 138 tests.
- The final exact `pnpm verify` passed in 349,754 ms with 1,150 Unit/Contract, 138 Integration and 72
  E2E tests, 29 Runtime migrations, build and all process smokes.

No assertion was weakened, no test was skipped, and no existing Docker volume was deleted.
