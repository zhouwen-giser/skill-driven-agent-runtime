# P11 Failed Attempts

| Attempt | Failure | Root cause | Repair / disposition |
|---|---|---|---|
| early PostgreSQL fixture | prepared query rejected multiple SQL commands; then required `agent_task.request_text` was missing | the real fixture did not match PostgreSQL prepared-query and current Task schema rules | split statements and populated the required Task fields |
| first vertical delivery | wait timeout and global pending/ACK leakage | a new export reused the previous collector cursor and state was not scoped to the active export | reset cursor/ACK on export identity change and scope pending/status/ACK to the active export |
| retained vertical reruns | fixed revision conflict; selected-family event was skipped; global pending assertion drifted | retained Control revisions and unrelated Runtime events exposed non-isolated test and cursor assumptions | calculate the real next revision, filter families before advancing the cursor, and query the active export authority |
| initial lint | 20 issues, followed by one unbound-method issue | new code had formatting/type-style violations | corrected all findings; final format/lint/typecheck pass |
| first exact full verify | P11 status observed `pendingRecords=1` immediately after the endpoint received the batch | HTTP receipt occurs before the durable ACK transaction completes | wait for authoritative status convergence; focused and full reruns pass |
| second exact full verify | Docker credential/config access failure during the isolated migration verifier | the sandboxed shell could not read the local Docker credential session | reran the same migration/full commands in the user-authorized Docker context; 35-migration gate passed |
| third exact full verify | `CONTROL_SINGLE_NODE_IDENTITY_CONFLICT` | a serial integration test replaced the already-authoritative single Node ID | preserve the existing NodeProfile through a read-only probe; no production identity rule was weakened |
| first isolation rerun | `runtime_capability_summary_one_active` unique violation | an older P04R/P05 integration test did not clear its active Capability Summary between cases | added the owning test's authority table to its `beforeEach` cleanup; 146/146 integration tests pass |
| next exact full verify | architecture gate rejected a Runtime test import of the Control migration adapter | the first test-isolation repair crossed the Control/Runtime dependency boundary | replaced it with a read-only table-existence/profile probe; architecture and integration gates pass |
| independent Review | 2 Major: a newer Draft could be selected by `/test`; near-watermark capture could overshoot capacity | Active selection used newest revision and capture used the full batch limit | select newest `applied` revision and cap capture by remaining durable capacity; added real regressions |
| first Review regression rerun | audit count expected one but observed two | the new distinct Active test command correctly creates its own Operation/Audit while the original replay remains idempotent | assert 2 distinct commands and 2 audits; replay still creates no duplicate |
| retained Control regression reruns | `CONTROL_REVISION_CONFLICT` | the test calculated a global telemetry revision across target IDs and retained prior configuration rows | isolate configuration tables and calculate revision for the authoritative local target |

No failed attempt is represented as passing product evidence.
