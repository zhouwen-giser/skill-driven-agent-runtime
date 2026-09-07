# P10 Failed Attempts

| Attempt | Failure | Root cause | Repair / disposition |
|---|---|---|---|
| first migration verification | `V123_MIGRATION_MARKERS_INVALID` | migration 0140 lacked the repository transaction and schema ledger marker | added standard `BEGIN`/`COMMIT` and up/down `schema_migration` entries; 34-migration gate passed |
| first retained-DB repository runs | specification hash and idempotency conflicts | globally fixed fixture hashes/keys collided with immutable rows from prior truthful runs | bound hashes and keys to each random exact Skill identity; production constraints unchanged |
| first Windows focused command | `vitest` not recognized through `pnpm exec` | this installation did not expose that shim | invoked the checked-in `vitest.CMD`; no test was skipped |
| first Plan fixture preparation | `ARTIFACT_STATE_INVALID` | candidate was saved without completing validation and approval transitions | exercised the real request-validation/result/approval path before activation |
| first real Plan query | HTTP 500 projection failure | generic redaction converted PostgreSQL `Date` objects to `{}` | preserve timestamps as ISO strings and added Unit plus vertical regression evidence |
| first real Plan publish | `ARTIFACT_OPERATION_DISABLED` | existing P06 promotion rollout flag is default-off | enabled the existing flag only for the acceptance path and documented the production prerequisite |
| first final Integration rerun | import idempotency conflict | one recovery key remained constant in a retained database | bound import/recovery keys to the random Skill identity; 5/5 focused tests passed |
| first full verify | `CONTROL_SINGLE_NODE_IDENTITY_CONFLICT` | P10 test supplied a new Node ID after another serial integration had established the single Control identity | P10 now reads and preserves the authoritative NodeProfile, bootstrapping only an empty database |
| second full verify | command timeout during Docker image build | transient Docker registry/build stall at the final Node Control smoke | daemon and cache were inspected; standalone smoke passed in 44 seconds; complete rerun passed in 391,314 ms |

No failed attempt is represented as passing product evidence.
