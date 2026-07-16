# SDAR v1.1 MCP Tasks — Final Traceability

## Result

| Set | Verified | Total | Unverified |
| --- | ---: | ---: | ---: |
| Functional (`FR-MCPT`) | 14 | 14 | 0 |
| Non-functional (`NFR-MCPT`) | 4 | 4 | 0 |
| Acceptance (`AC-MCPT`) | 16 | 16 | 0 |

The detailed authoritative mappings, including exact implementation and test paths, are in `docs/17_TRACEABILITY_MATRIX.md`. Every row below is backed by `reports/v1.1-mcp-tasks/V11-ACCEPTANCE.{md,json}`, `V11-LOCAL-DEMO.{md,json}` and/or `reports/verification/summary.{md,json}`. “Verified” means the requirement passed its declared local evidence; it does not mean an RC was published.

## Functional and non-functional requirements

| ID | Status | Implementation | Principal tests | Command |
| --- | --- | --- | --- | --- |
| FR-MCPT-001 | 已验证 | domain MCP Task model; Tasks contract/transport bridge; HTTP adapter | streamable HTTP and mock-provider contracts | `pnpm test:contract` |
| FR-MCPT-002 | 已验证 | MCP registry immediate/remote union and fail-closed adapter | registry unit; streamable HTTP contract | `pnpm test:unit && pnpm test:contract` |
| FR-MCPT-003 | 已验证 | remote Task state model; PostgreSQL observations; polling reducer | polling unit; Server remote-task integration | `pnpm test:unit && pnpm test:integration` |
| FR-MCPT-004 | 已验证 | durable binding repository; migration 0100 | repository integration; V1.1 migration verifier | `pnpm test:integration && pnpm verify:migrations` |
| FR-MCPT-005 | 已验证 | one-attempt polling service/queue/reconciler | polling unit; BullMQ integration | `pnpm test:unit && pnpm test:integration` |
| FR-MCPT-006 | 已验证 | unreachable backoff/recovery and quarantine | polling unit; Server integration | `pnpm test:unit && pnpm test:integration` |
| FR-MCPT-007 | 已验证 | persisted frontier; continuation service; LangGraph `Command.goto`; migration 0102 | continuation unit; PG continuation; composition integration | `pnpm test:unit && pnpm test:integration` |
| FR-MCPT-008 | 已验证 | terminal controls; input and cancellation dispatch; Server composition | continuation/input/cancel unit; Server lifecycle integration | `pnpm test:unit && pnpm test:integration` |
| FR-MCPT-009 | 已验证 | availability/readiness authority and pre-call resolver; migration 0101 | readiness unit/E2E; Server integration | `pnpm test:unit && pnpm test:e2e && pnpm test:integration` |
| FR-MCPT-010 | 已验证 | timing DSL and Provider business-outcome mapping | business outcome and compiler unit; Provider contract | `pnpm test:unit && pnpm test:contract` |
| FR-MCPT-011 | 已验证 | structured risk, transitive confirmation and exact refresh | readiness E2E; compiler unit; A2A vertical E2E | `pnpm test:unit && pnpm test:e2e` |
| FR-MCPT-012 | 已验证 | bounded remote input, exact update, PG input links/attempts; migration 0103 | input unit; real two-round Server integration | `pnpm test:unit && pnpm test:integration` |
| FR-MCPT-013 | 已验证 | cooperative cancel requests/attempts and one-attempt queue; migration 0103 | cancel unit; Redis and Server integration | `pnpm test:unit && pnpm test:integration` |
| FR-MCPT-014 | 已验证 | lifecycle query, management endpoints/OpenAPI and Task Console actions | management contract; Console unit; Server smoke | `pnpm test:contract && pnpm test:unit && pnpm smoke:server` |
| NFR-MCPT-001 | 已验证 | bounded schemas, stable sanitized errors and management projection | complete unit/contract/static gate | `pnpm verify:bootstrap` |
| NFR-MCPT-002 | 已验证 | same-context serializer, CAS, one-attempt queues and join composition | unit plus real Redis/PostgreSQL composition | `pnpm test:unit && pnpm test:integration` |
| NFR-MCPT-003 | 已验证 | PostgreSQL authority, Redis reconstruction, no Tool replay; migration 0104 | fresh ServerRuntime restart and PG continuation integration | `pnpm test:integration` |
| NFR-MCPT-004 | 已验证 | end-to-end binding/observation/control/readiness/input/cancel/evaluation trace and UI projection | repository, management, Console and A2A vertical tests | `pnpm test:integration && pnpm test:contract && pnpm test:e2e` |

## Acceptance scenarios

| ID | Status | Principal evidence | Classification | Command |
| --- | --- | --- | --- | --- |
| AC-MCPT-01 | 已验证 | sync success/business error with no Binding | HTTP real local; Provider simulated | `pnpm test:contract` |
| AC-MCPT-02 | 已验证 | negotiation, handle, confirmed admission and durable Binding | HTTP/A2A/LangGraph/PG real local; Provider simulated | `pnpm test:contract && pnpm test:e2e` |
| AC-MCPT-03 | 已验证 | undeclared capability and `require_task` fail closed | guard/HTTP real local; Provider simulated | `pnpm test:contract && pnpm test:e2e` |
| AC-MCPT-04 | 已验证 | working→completed→fresh continuation→A2A result | PG/Redis/A2A/LangGraph real local; Provider simulated | `pnpm test:integration && pnpm test:e2e` |
| AC-MCPT-05 | 已验证 | pause/resume remains observation-only | runtime unit; Provider states simulated | `pnpm test:contract && pnpm test:unit` |
| AC-MCPT-06 | 已验证 | one/two input rounds on same Task with no replanning | PG/Redis lifecycle real local; Provider/model simulated | `pnpm test:integration` |
| AC-MCPT-07 | 已验证 | cancel request/ack/observation/terminal separation | PG/Redis lifecycle real local; Provider simulated | `pnpm test:integration` |
| AC-MCPT-08 | 已验证 | cancel unreachability → uncertain, no retry/fake terminal | deterministic fault simulation | `pnpm test:unit` |
| AC-MCPT-09 | 已验证 | restricted risk, confirmation, refresh, admission | A2A/LangGraph/PG real local; model/Provider simulated | `pnpm test:unit && pnpm test:e2e` |
| AC-MCPT-10 | 已验证 | immediate rejection enters typed error handler, no Binding | LangGraph path real local; Provider simulated | `pnpm test:contract && pnpm test:unit` |
| AC-MCPT-11 | 已验证 | Provider-declared start-window miss | deterministic Provider business semantics | `pnpm test:contract && pnpm test:unit` |
| AC-MCPT-12 | 已验证 | Provider-declared deadline and malformed/unreachable guards | deterministic Provider business semantics | `pnpm test:contract && pnpm test:unit` |
| AC-MCPT-13 | 已验证 | outage/backoff/recovery without synthetic terminal | PG/Redis real local; fault/Provider simulated | `pnpm test:contract && pnpm test:integration` |
| AC-MCPT-14 | 已验证 | process/Redis restart reconstructs queued wait, no Tool replay | ServerRuntime/PG/Redis real local; Provider simulated | `pnpm test:integration` |
| AC-MCPT-15 | 已验证 | parallel independent waits/join-once and child-first completion | PG/Redis/LangGraph composition real local; result simulated | `pnpm test:integration && pnpm test:unit` |
| AC-MCPT-16 | 已验证 | Goal Patch invalidation, fresh confirmation, late audit-only event | PG/A2A/Goal lifecycle real local; model/Provider simulated | `pnpm test:integration && pnpm test:e2e` |

## Release provenance boundary

The evidence set has zero unverified MCPT requirement rows. Acceptance reports record merged commit `df8b6e0` with `dirty=false`, the unified gate records evidence commit `13194b8` with `dirty=false`, and exact RC commit `38356ea` passes isolated frozen install, unified verification and local demo. Ready PR #4 and `v1.1.0-rc.1` are published. External production Provider interoperability, DOCX page rendering, protected merge and stable release remain explicitly outside this RC evidence.
