# P02 Retained Failed Attempts

## Static and focused gates

- Initial typecheck and lint runs exposed exact-optional-property mismatches, deprecated callback
  forms and unused imports in the new contract adapters. The types and call sites were corrected;
  no strictness or assertion was weakened. The final focused suite passes 13 tests.

## Real integration environment and schema repairs

- The first sandboxed integration attempt could not access Docker. The user-authorized Docker run
  was repeated outside that restriction.
- Reusing the default Compose project reached the preserved PostgreSQL volume with incompatible
  collation metadata and failed with `XX000`. The volume was not deleted or modified; all P02 proof
  uses an isolated Compose project.
- An initial isolated run moved Redis away from the repository test port and timed out because
  predecessor tests intentionally use the fixed local test endpoint. The isolated stack was
  restarted on the expected port.
- The first real database run then exposed three implementation defects: the Runtime migration
  loader rejected `v14`, migration 0135 omitted its ledger record, and predecessor cleanup did not
  account for new foreign keys. Each root cause was fixed and the 134-test Integration suite passed
  twice, including the SSE watch path.

## Full verification attempts

- The first `pnpm verify` passed static, Unit/Contract, migration, Integration and E2E stages, then
  failed infrastructure smoke because only the test database URL was set. The authoritative
  Runtime database URL was added to the isolated environment.
- The second full run passed infrastructure and normal Server smoke, then the nested Runtime smoke
  inherited the outer test URL after Control shutdown. The nested environment now sets both Runtime
  database variables explicitly. A subsequent readiness timeout was made diagnosable with bounded
  per-probe container/PostgreSQL/Redis details; direct and Node Control smokes then passed.
- The third full `pnpm verify` passed in 373,986 ms: 1135 Unit/Contract tests, 134 real Integration
  tests, 72 E2E tests, 28 Runtime migrations, production build and all three smoke stages.

No failed attempt was hidden, no assertion was weakened, and no existing Docker volume was deleted.
