# Phase 12 First Failures

This log preserves the first functional failures encountered by the resumable Phase 12 runner.
Passing reruns did not delete the original `12-*.json` files.

| Area | First failure | Root cause | Repair and direct rerun |
|---|---|---|---|
| A2A task-service E2E | five Redis timeouts | fixture hard-coded `56379` instead of the isolated Phase 12 port | read `SDAR_REDIS_PORT`; mapped group later passed |
| Skill procedure | rescheduling case failed alone | the selected test depended on an earlier test importing the Skill | map the required scenario to the self-contained recursive procedure test; passed |
| Remote Task composition | stack timeout | second fixture also hard-coded Redis `56379` | read `SDAR_REDIS_PORT`; 1/1 passed |
| Node Event reconnect | sequence 10 appeared before 9 | SQL ordered a `sequence::text` output alias lexicographically | order the numeric table column; 1/1 passed |
| P03->P04->P02->P05 | Phase 8 pending rows were empty | P11 correctly requires an active Evidence export configuration | install an explicit all-family test configuration; 1/1 passed |
| Export DLQ status | two stale pending-count assertions | unrequeued DLQ records are intentionally excluded from deliverable pending work | expect zero deliverable pending; 3/3 passed |
| Evidence restart | pending row was absent | the restart fixture had no active export configuration | install the explicit test configuration; 1/1 passed |
| Runtime/Skill/MCP/Experience projectors | all pending collections were empty | the shared fixture had no active export configuration | install one all-family configuration after seeding; 4/4 mapped tests passed |
| Manifest stages | complete retained the degraded revision | quality issue removal reused the same authority snapshot hash | change the hash with the issue set; 1/1 passed |

One manual focused command used the nonexistent database `sdar_v141_phase12`; it failed in
`beforeAll` before any test executed. The corrected command reused the runner's existing isolated
database `sdar_v122_integration_gate` and passed 4/4 mapped tests. This setup mistake is not counted
as a product-test failure.

The final resumable command reported:

```text
[evidence-e2e] PASS 44/44 scenarios; 42 direct tests in 25 shared suites
```
