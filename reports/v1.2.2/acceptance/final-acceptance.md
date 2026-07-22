# SDAR v1.2.2 Final Acceptance

Status: **passed**. Draft PR #7 is published and intentionally unmerged.

## Result

G00–G10 implementation/verification and all 49 defined acceptance rows AC-001–AC-078 pass. No required
item is deferred or externally blocked. The clean unified candidate is
`2db399693b2754f17a2ecc78356f3aab19f1297b`; exact real Provider interop used SDAR `325b8d0` and Provider
`8a81b1b` (the later changes are test/evidence only).

## Unified gate

`pnpm install --frozen-lockfile` passed. `pnpm verify` passed in 109,118 ms with 629 unit/contract, 68
real PostgreSQL/Redis integration and 59 E2E tests; 296-source architecture, A2A MUST 74/74, 124 OpenAPI
operations, 21 OSS pins, 286-package/two-service SBOM, clean baseline/migrations, production build,
infrastructure smoke and Server/Console smoke also passed.

## Real Provider and hardening

Real Streamable HTTP POST/SSE passed Discovery, empty Ack, 260 Tasks, Task/Resource Events, durable
admission, 128/128/4 Relation pages, Drain, typed Reset, Continuity rollover, Provider unavailability,
restart and eight reconnects. A separate disposable pgvector container proved real database restart
durability and was deleted with its volume. Concurrency, Redis/dispatch failure, process restart,
no-replay and single-terminal races are covered by the real integration and owning unit/E2E suites.

## Evidence classification

- Real: PostgreSQL/pgvector, Redis/BullMQ, HTTP/A2A/LangGraph, Management API, production bundle/smoke,
  database restart and exact external Provider runtime.
- Simulated: deterministic loopback model decisions and Frozen Mock Provider scenario semantics.
- Unverified acceptance: none. DOCX visual pagination is not a product acceptance item; its complete
  OOXML content was audited and the source was not modified.

## Declaration boundary

- Provider Requirements Contract Frozen: yes, exact V0.5.2/Profile assets.
- Provider Runtime Candidate: exact `8a81b1b` only.
- SDAR Client Contract Passed: yes.
- Real Interop Passed: yes, for the exact candidate pair.
- Profile 1.0 Frozen for arbitrary future Provider runtimes: no.

All failed attempts remain in the attempt ledgers. The Provider repository was not modified. Release is
Draft PR #7 at <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/7>; GitHub reports
`MERGEABLE/CLEAN`, Draft, open and no configured checks. No merge or tag is authorized.
