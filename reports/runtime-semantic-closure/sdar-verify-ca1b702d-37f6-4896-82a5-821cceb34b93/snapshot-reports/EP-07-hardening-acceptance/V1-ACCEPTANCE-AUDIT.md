# V1 Acceptance Scenario Audit

Date: 2026-07-13

## Verdict

All 18 baseline acceptance scenarios pass through the current full gate and the cited composed evidence. The gate executed 54 files/242 unit+contract tests, 2 files/36 real PostgreSQL/Redis integration tests, 1 file/41 real PostgreSQL/Redis/Mock Model/Mock MCP E2E tests, infrastructure smoke, and Server/production-Console-bundle smoke. Machine evidence is in `V1-ACCEPTANCE-AUDIT.json` and `reports/verification/summary.json`.

Deterministic Model Provider, embedding, evaluation, and evolution semantics are classified as simulated. PostgreSQL, pgvector, Redis, BullMQ, A2A SDK/HTTP, management HTTP, LangGraph, Mock MCP transport, production React bundle, persistence, and runtime state transitions are real local executions. No vendor-hosted model or production system is claimed.

## Scenario map

| Scenario | Result | Primary reproducible evidence |
| --- | --- | --- |
| AC-01 Basic task loop | Passed | unconfirmed-plan block → real MCP LangGraph execution → schema-validated text/data result |
| AC-02 Auto confirmation | Passed | opted-in Skill synchronous/asynchronous parity; Goal Patch forces fresh confirmation |
| AC-03 Plan modification | Passed | A2A natural-language revision and administrator DAG revision/validation/execution |
| AC-04 Multi-round Goal | Passed | active Goal reuse, achieved Goal successor, related/unrelated Goal persistence |
| AC-05 Goal Patch invalidation | Passed | old Plan/instance/results invalidated, compensation risk recorded, new confirmation required |
| AC-06 Skill composition | Passed | independent LangGraph child Workflow uses and records current SkillVersion |
| AC-07 Capability gap | Passed | persisted waiting gap and confirmed task-scoped Temporary Skill execution |
| AC-08 Outer replanning | Passed | adjust-plan round outside LangGraph, achieved successor round, terminal budget branches |
| AC-09 Tool exception | Passed | fixed structured decision stage plus bounded retry/change/alternate/Skill/terminate options |
| AC-10 Pause/resume/cancel | Passed | node-boundary pause, human interrupt, no replay, wait timeout, long-pause replan branch |
| AC-11 Queue/failure | Passed | context serialization, queued-job restart retention, interrupted-work failure, attempts=1 |
| AC-12 Skill registration | Passed | model-authored valid Schemas persist; invalid output fails closed/corrects within bound |
| AC-13 Skill evolution | Passed | thresholded experiences, simulation/supplemental tests, failed draft preservation, publication |
| AC-14 Manual correction | Passed | failed draft correction, immutable diff/actor/history, revalidation and publication |
| AC-15 Prompt evolution | Passed | candidate inactive before publication; new calls link only to published version |
| AC-16 Memory/retrieval | Passed | source-linked archive, pgvector/stage retrieval, superseded/invalid lifecycle |
| AC-17 Management Console | Passed | real production bundle/API navigation plus complete management contracts and composed E2E |
| AC-18 A2A streaming | Passed | status stream, disconnect continuation, polling/resubscribe, official TCK baseline |

## Commands

- `pnpm verify`
- `pnpm verify:acceptance`

No acceptance behavior remains unverified. External vendor semantic quality remains outside the local Mock-based V1 acceptance claim.
