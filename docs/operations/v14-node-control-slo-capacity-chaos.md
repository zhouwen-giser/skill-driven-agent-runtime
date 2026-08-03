# SDAR v1.4 Node Control SLO, Capacity and Chaos Baseline

## Local acceptance indicators

- Public requests are bounded to 64 KiB by default and 1,200 authenticated requests per credential
  per fixed minute. Both limits are deployment-configurable within validated bounds.
- Event delivery reads at most 100 Control events per poll and copies at most 200 Runtime hints per
  durable synchronization transaction.
- Existing performance tests exercise 32 concurrent artifact operators, 10,000 event/plan
  projections and the Fast Gateway up to 1,000 concurrent requests.
- Telemetry pending records retain a hard configured high-watermark; Node Events and Audit remain
  PostgreSQL-owned and append-only.

## Required production measurements

Operators must set workload-specific targets for request latency/error rate, database saturation,
event lag, readiness age, worker backlog, restore time and restore point. The repository does not
claim production SLO, capacity, HA, RTO or RPO values from local hardware.

## Local chaos/recovery matrix

| Fault                        | Required safe behavior                                           | Local evidence                           |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| Control API stopped          | Runtime starts and continues from Runtime PostgreSQL/LKG         | `pnpm verify:v14-recovery`               |
| Control DB restore           | active Node identity/revision/status reconcile before startup    | real Docker `pg_dump`/`pg_restore` drill |
| API restart                  | Profile and durable events reconstruct from PostgreSQL           | Node Control smoke restart               |
| credential rotation          | replacement credential succeeds and prior credential is rejected | Node Control smoke restart               |
| SMPP/MCP outage              | prior allowed LKG/fail-closed policy remains authoritative       | P04/P05 integration                      |
| Telemetry outage             | Task state is unchanged and pending delivery is retained         | P11 integration                          |
| corrupt/new invalid revision | Active/LKG remains unchanged                                     | P02/P03/P08 integration                  |

Every production chaos exercise requires a named owner, approved blast radius, rollback trigger and
evidence retention. The local drills are release qualification, not hidden production guarantees.
