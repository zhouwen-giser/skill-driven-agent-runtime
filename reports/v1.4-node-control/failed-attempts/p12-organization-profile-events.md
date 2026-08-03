# P12 Failed Attempts

| Attempt | Failure | Root cause | Repair / disposition |
|---|---|---|---|
| initial integration command | Docker could not bind Redis port `56379` | an authorized prior test stack already owned the port | reused the operator-managed Redis and isolated PostgreSQL databases; no existing container/data was deleted |
| early typecheck/integration | exact-optional typing error, Control receipt FK truncate conflict and fixture cleanup CASCADE failure | new fixture/receipt declarations did not match strict optional and retained-authority cleanup rules | corrected the types, removed the unnecessary receipt FK and scoped cleanup to the owning fixture |
| Profile replay regression | an idempotent draft replay returned 409 after publication | the request hash included server-generated `updatedAt` and replay observed the now-active projection | hash only raw client input and return the immutable original draft revision on replay |
| initial command wrapper | PowerShell `pnpm exec` did not resolve local Prettier/Vitest | the pnpm/Windows binary invocation did not accept the array-based wrapper | used repository scripts and the checked-in `node_modules/.bin` commands; no gate was skipped |
| first TaskSummary integration | PostgreSQL rejected Task phase `working` | the new fixture used a value outside the frozen Task phase CHECK | used the real `executing` phase |
| next two integration reruns | list and detail assertions still expected `working` | two fixture assertions retained the invalid draft value | aligned both assertions; final 30 files / 149 tests passed |
| unsafe focused rerun proposal | direct focused test would have shared one `/sdar` database across Control and Runtime | the focused command lacked the integration harness's isolated database creation | rejected the unsafe run and used the repository full integration orchestrator |
| first exact full verify | final infrastructure smoke failed with PostgreSQL `28P01` | `smoke:infra` reads `SDAR_POSTGRES_URL`, while the run supplied only `SDAR_TEST_POSTGRES_URL` and reached an unrelated service on port 55432 | preserved the failed summary, set both variables to the authorized 55483 instance and reran the full gate; all smokes passed |
| read-only Review | 3 Major and 2 Minor findings | SSE backpressure, missing Runtime event merge and Task reads, unsafe ETag identity and numeric cursor conversion | repaired each item with regression coverage; final Review is 0 Blocking / 0 Major / 0 Minor |

No failed attempt is represented as passing product evidence.
