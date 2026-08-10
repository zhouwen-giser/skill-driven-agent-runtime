# Frozen Decisions D-01 through D-32

These decisions are copied semantically from the accepted task package and are binding for all
remaining phases.

| ID | Frozen decision |
|---|---|
| D-01 | v1.4.1 is a clean-slate evidence export; old Telemetry data compatibility is not retained. |
| D-02 | The sole formal external contract is `sdar.evidence/v1`. |
| D-03 | Business Domain/Application flow may not call a generic telemetry emit/record API. |
| D-04 | Repositories, authority services, Runtime hooks, and source projectors generate evidence automatically. |
| D-05 | Runtime PostgreSQL retains Task, Goal, Plan, Workflow, Skill, MCP Task, Experience, Artifact, and Runtime evidence authority. |
| D-06 | Control PostgreSQL retains Control configuration, desired/observed, operation, audit, and Node Event authority. |
| D-07 | Runtime owns unified delivery state, outbox, ACK, DLQ, manifest, and export service. |
| D-08 | Control facts project through durable events/audit/controlled reads, never a cross-database transaction. |
| D-09 | Redis/BullMQ is not evidence authority. |
| D-10 | The external sink cannot mutate Runtime or Control state. |
| D-11 | No second workflow runtime; LangGraph remains the only workflow runtime. |
| D-12 | ClickHouse, OTel Collector, marts, and a formal evaluator are outside this task. |
| D-13 | `deliveryGuarantee` and `evaluationRole` are independent dimensions. |
| D-14 | Transactional evidence commits in the same PostgreSQL transaction as its authoritative fact. |
| D-15 | Durable projection uses persisted source cursors and idempotent mappers. |
| D-16 | Buffered evidence cannot be the only evidence for a hard gate. |
| D-17 | Every formal record has stable `recordId`, `payloadHash`, and independent `schemaVersion`. |
| D-18 | Same ID/hash is an idempotent duplicate; same ID/different hash is a critical conflict. |
| D-19 | Export is at least once with contiguous sequence ACK. |
| D-20 | Required evidence cannot be excluded or sampled. |
| D-21 | Large payloads use ArtifactRef and are not unbounded inline content. |
| D-22 | Hidden reasoning, credentials, tokens, secrets, and Authorization are prohibited in payloads. |
| D-23 | ToolCall and Remote Task lifecycle evidence remain separate. |
| D-24 | Remote Task Observation and Control Event remain separate. |
| D-25 | Cancel request does not imply Provider cancellation. |
| D-26 | Remote Task completion does not imply Goal achievement; Receipt and Verification remain explicit. |
| D-27 | Skill degraded is not full completion and must include missing effects/reason. |
| D-28 | Node Control is a governance/configuration plane and cannot invent physical command/feedback facts. |
| D-29 | Terminal episodes produce a manifest with complete/degraded/incomplete status. |
| D-30 | ClickHouse work cannot begin before 100% required source coverage and passing E2E. |
| D-31 | Schema versions evolve independently from application versions. |
| D-32 | Mappers and LLMs may not guess fields absent from an authoritative source. |
