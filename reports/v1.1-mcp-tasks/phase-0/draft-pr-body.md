## What changed

This Draft PR is the long-lived integration surface for the ordered SDAR v1.1 MCP Tasks Phase 0–6 upgrade.

Phase 0 currently includes:

- the frozen source task package and design input;
- EP-09 with hardening checkpoints and evidence rules;
- ADR-085 through ADR-089 for adapter isolation, Provider authority, availability/time semantics, external-wait continuation and migration ordering;
- canonical v1.1 functional, non-functional and acceptance requirements;
- the `io.sdar/taskExecution` Provider extension contract;
- exact official MCP Tasks extension commit/schema/license Intake;
- clean baseline, repository/symbol maps, hardening overlap and traceability evidence;
- portable SBOM and monotonic released-migration baseline repairs discovered during clean verification.

Runtime implementation will be added in the package-mandated Phase 1–5 commits. Final Phase 6 cannot be marked ready until `v1.0.13-bug-fixed` is published, merged and the complete acceptance gate passes.

## Why

The current runtime supports synchronous MCP Tool calls only. It has no domain-owned remote Task binding, official extension client boundary, durable polling/reconciliation, availability/time guard, external-wait continuation, remote input/cancellation mapping, or management projection. The upgrade must add these capabilities while preserving LangGraph.js as the only Workflow Runtime and PostgreSQL as the system of record.

## Impact and constraints

- This PR remains Draft throughout parallel hardening integration.
- SDK/wire types stay inside `packages/mcp-adapter`.
- The official SDK 1.29.0 legacy experimental Tasks API is not used as the v1.1 contract.
- No new default DSL node or second execution runtime is introduced.
- No Provider resource/preemption authority is copied into SDAR.
- `0100+` migrations cannot enter a supported persistent database before the complete v1.0.13 migration chain.

## Validation

- `pnpm install --frozen-lockfile` — passed.
- Clean `pnpm verify` — passed in 119768 ms.
- Unit — 50 files / 218 tests passed.
- Contract — 7 files / 58 tests passed.
- Real PostgreSQL/Redis integration — 42 tests passed.
- Real local E2E — 42 tests passed.
- Phase 0 `pnpm verify:bootstrap` — 57 files / 276 unit+contract tests passed, plus architecture, A2A, OpenAPI, source pin, Compose, Apache-2.0, SBOM, backend build and Console build gates.

## Current status

Phase 0 design freeze is complete after this Draft PR is created. MCP Tasks functional requirements and AC-MCPT-01–16 remain explicitly unverified until their implementation phases and final acceptance reports complete.
