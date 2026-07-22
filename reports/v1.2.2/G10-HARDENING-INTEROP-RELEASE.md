# G10 Hardening, Real Provider Interop and Release

Status: implementation and verification **completed**; Draft PR publication pending.

## Passing gates

- Clean candidate `2db399693b2754f17a2ecc78356f3aab19f1297b` passed the unified 109,118 ms
  `pnpm verify`: 629 unit/contract, 68 real integration, 59 E2E, 296-source architecture, A2A MUST
  74/74, 124 OpenAPI operations, baseline/migrations, license/SBOM, production build and both smokes.
- The v1.2.2 Console view regression is included in the 20/20 Console suite.
- Exact SDAR `325b8d0` ↔ Provider `8a81b1b` real Streamable HTTP interop passed Discovery, 260 Tasks,
  Task/Resource Events, 128/128/4 Relation pages, durable admission, Drain, Reset, Continuity,
  unavailability, Provider restart and eight reconnects.
- Capacity/security/container evidence includes ten real Redis contexts, twenty A2A waiters, strict
  protocol/schema/credential boundaries, a 286-package/two-service SBOM, Compose policy/runtime smoke and
  a real isolated pgvector restart audit.

## Evidence boundary

- Real: PostgreSQL/pgvector, Redis/BullMQ, HTTP/A2A/LangGraph, Management API, production bundle/smoke,
  database restart and exact external Provider runtime.
- Simulated: deterministic loopback model decisions and Frozen Mock Provider scenario semantics used by
  focused contracts/E2E.
- Unverified: visual DOCX pagination only; the source DOCX is unchanged and complete OOXML content was
  audited. No v1.2.2 acceptance requirement remains unverified.

## Release policy

Failed attempts are preserved in the interop and unified-gate ledgers. Provider source was not modified.
G10 will close only after the final evidence commit is clean, pushed and represented by an SDAR Draft
PR. Merge and tag are prohibited.
