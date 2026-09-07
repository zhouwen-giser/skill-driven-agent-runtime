# SDAR v1.4 Final Authority Record

| Fact | Authoritative owner | Non-authoritative consumers |
|---|---|---|
| Goal, Task, Workflow and execution terminal state | Runtime PostgreSQL and existing domain/application controllers | Node Control TaskSummary reads |
| Desired Control configuration and governance revisions | Control PostgreSQL | Runtime authenticated pull/watch |
| Applied Active/LKG and immutable in-flight pins | Runtime PostgreSQL | Control observed acknowledgements |
| Capability readiness and Task Capability Binding | Runtime PostgreSQL | Control bounded GET/event hints |
| Node Profile and organization Node Event cursor | Control PostgreSQL | organization clients via GET/SSE hints |
| Telemetry delivery outbox/status | Runtime PostgreSQL | Control output-only configuration/status reads |
| Queue and wake state | Redis/BullMQ, rebuildable only | workers |
| Secret material | deployment secret manager / encrypted Runtime adapters | APIs expose only SecretRef/status |

No Control adapter can write Runtime business tables. No Runtime adapter can publish Control
governance revisions. SSE and Redis messages are hints, never a substitute for authoritative GET or
PostgreSQL state.
