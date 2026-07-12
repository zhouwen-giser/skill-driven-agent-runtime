# EP-05 Acceptance Audit

Date: 2026-07-13

## Scope and authoritative review

Audited independently against `source/Agent通用模板Server需求规格说明书_V1.0.docx`, `docs/01_REQUIREMENTS_BASELINE.md`, `docs/16_DEFINITION_OF_DONE.md`, and `docs/17_TRACEABILITY_MATRIX.md`.

The source DOCX was re-read structurally with the bundled document runtime: 226 paragraphs, 38 tables, and one section. Source table 19 contains FR-EVAL-001–005 exactly as represented by the baseline; source tables 12 and 18 contain FR-EVO-001–010 and FR-MEM-001–006. DOCX visual rendering could not run because LibreOffice/soffice is unavailable; no document layout claim is made or needed for this source-content audit.

## Requirement result

- FR-EVO-001–010: verified with domain/application/PostgreSQL paths, unit/integration/contract/E2E evidence, ADR-046–054, and ten requirement reports.
- FR-MEM-001–006: verified with real PostgreSQL/pgvector storage/retrieval, lifecycle/retention evidence, stage-specific model context, and six requirement reports plus the global-memory foundation report.
- FR-EVAL-001–005: verified with five-component Task reports, implicit feedback, report-linked influence, filtered analytics, warning-only behavior, explicit administrator controls, ADR-060–063/053, and five requirement reports.
- Related FR-SKL-015 and FR-LLM-007 gaps owned by EP-05: verified through all-pass Skill publication and inactive automatic Prompt candidate generation.

## Acceptance scenarios exercised

- AC-13 Skill automatic evolution: real PostgreSQL/Redis, LangGraph execution, loopback MCP/Model, thresholded induction, historical/supplemental simulation, failed-draft preservation, and all-pass publication are covered by the 40-test E2E suite.
- AC-14 administrator correction: failed candidate correction, actor/diff persistence, full revalidation, correction Experience, and publication are covered by the same E2E suite.
- AC-15 Prompt evolution: automatic candidate remains inactive; administrator publication changes only subsequent invocation linkage.
- AC-16 Memory and retrieval: raw evidence remains in PostgreSQL, refined memory is globally/stage retrievable, and superseded/invalid lifecycle is preserved.
- AC-17 full console is not an EP-05 completion claim. Its management APIs expose real memory/evaluation/evolution data; the React console and project-wide human/machine AC bundle remain EP-06/07 work.

## Gate

- `pnpm verify`: format, lint, strict typecheck, 152 unit tests, 46 contract tests, architecture boundaries, source pins, Compose validation, SBOM/licenses, and production build passed.
- `pnpm test:integration`: 31/31 passed against real PostgreSQL/pgvector and Redis startup.
- `pnpm test:e2e`: 40/40 passed against real PostgreSQL/Redis with loopback MCP/Model services.
- `pnpm smoke:server`: built Server, dynamic Agent Card, and trusted-intranet management API were reachable.

No skipped/only tests, weakened assertions, new `any`, dynamic source execution, leaked credentials, or unpinned sources were found in the EP-05 completion diff.

## Classification

- Real: PostgreSQL/pgvector, Redis/BullMQ, LangGraph runtime, migrations through `0049`, management/A2A HTTP, Agent Card changes, memory/evaluation/evolution persistence, filters, lifecycle gates, and local smoke.
- Simulated external semantics: deterministic loopback LLM decisions and safe loopback MCP behavior; all application, adapter, persistence, and runtime paths are real.
- Unverified for project release: production-model semantic quality/calibration, external third-party MCP behavior, rendered source-DOCX layout, React Console, and complete project-wide machine-readable AC reporting.

## Decision

EP-05 is accepted and complete. The overall V1 release is not accepted; EP-06 and EP-07 plus remaining traceability gaps must be completed before the Goal can be marked complete.
