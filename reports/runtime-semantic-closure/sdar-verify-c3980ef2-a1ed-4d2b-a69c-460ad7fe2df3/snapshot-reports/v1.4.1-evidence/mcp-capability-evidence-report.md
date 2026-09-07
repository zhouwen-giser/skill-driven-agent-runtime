# MCP Task and Capability Evidence Report

Phase 7 implements and verifies all 11 `mcp_task.*` and seven `capability.*` Catalog records.

The Runtime source uses a repeatable-read snapshot spanning MCP Invocation, availability,
Remote Task lifecycle, poll/input/cancel, reconciliation, continuation, Capability readiness,
Task Binding/Attempt, Agent Card Exposure and Revision facts. The Control source uses an
authenticated, schema-validated full-state read for exact Capability Definition and
Implementation Binding revisions. Control never writes Runtime PostgreSQL.

The real PostgreSQL vertical proves 18 distinct records, exact references, constrained source
facts, canonical outbox persistence, checkpointing and idempotent replay. It preserves the Task
Handle boundary, non-triggering Observation, persist-before-Continue, resume-not-START,
no-completed-side-effect-replay and cancel uncertainty rules. Task Binding includes Input,
Success Criteria, Evidence Requirement, Constraint, Initial Implementation and Provider Policy
snapshots plus the Binding Hash.

The first real-database attempt exposed a stale database-template constraint. A dedicated database
created from `template0` isolated the test. The next attempt exposed forbidden
`credential_revision` in a raw Source Revision; the mapper now removes all forbidden sensitive
keys before hashing or payload construction. A SQL alias collision that returned only Agent Card
content instead of the full revision row was also repaired. The final focused rerun passes.

The mandatory full gate then exposed three integration-only defects: incomplete Skill Usage
fixtures, an invalid active Agent Card fixture, and Manifest accounting that counted blocking
issues as failed requirements without including them in the expected total. All were repaired
without weakening Domain or PostgreSQL constraints. A PostgreSQL session advisory lease now
serializes projection across concurrently constructed Runtime processes, and Runtime shutdown
awaits the in-flight projection before closing PostgreSQL. The final `pnpm verify` passes all eight
stages in 865,814 ms: 970 Unit, 22 performance, 230 Contract, 161 Integration and 72 E2E tests,
37 migrations, build and every smoke.

Capability Definition remains fail-closed until Phase 9 produces its exact
`node_control.capability_revision` Evidence reference. That is a planned forward dependency, not
a fabricated placeholder: the stable Quality Issue keeps the Episode pending and replay closes it
after the governance record exists.
