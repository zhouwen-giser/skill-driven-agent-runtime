# v1.1 MCP Tasks Phase 3 — Availability and Timing

Status: **Phase 3 increment verified after hardening convergence**. This report does not claim Phase 4–6 or final v1.1 acceptance.

Published Phase commit: `b205d5da74ba612d48632575cce767e0836a00ba` (`feat(v1.1): validate task availability and time windows`).

## Intended increment

- Domain-owned Task execution timing, operation availability, readiness, structured risk decisions and deterministic admission guards remain isolated from MCP wire types.
- Planning records append-only availability/readiness evidence before confirmation; execution refreshes availability with the resolved, frozen arguments immediately before `tools/call`.
- Restricted or increased-risk execution cannot weaken the existing transitive Skill confirmation decision. Unknown, disabled, stale, contradictory or invalid capability/contract results fail closed.
- Forecast windows are not reservations. SDAR does not lock Provider resources, run Provider business timers or fabricate `start_window_missed`/`deadline_reached` outcomes.
- Migration 0101 extends the supported v1.0.13/0064 → 0100 path, and generic MCP Tool execution semantics from migration 0063 remain authoritative alongside V1.1 `taskExecution` metadata.
- Management API and Console expose sanitized, read-only readiness evidence. Remote lifecycle actions remain Phase 4–6 scope.

Architecture decisions: `adr/ADR-087-mcp-task-time-and-availability.md` and `adr/ADR-092-domain-owned-task-readiness-guard.md`.

## Reproducible verification

The following commands were reproduced after merging `v1.0.13-bug-fixed` at `4007b38`. The unified machine report is `reports/verification/summary.{json,md}`.

```text
pnpm format:check               PASS
pnpm lint                       PASS
pnpm typecheck                  PASS
pnpm test:unit                  PASS — 59 files / 328 tests
pnpm test:contract              PASS — 8 files / 79 tests
pnpm test:integration           PASS — 4 files / 68 tests
pnpm test:e2e                   PASS — 2 files / 48 tests
pnpm verify:management-openapi  PASS — 107 operations
pnpm build                      PASS
pnpm verify:migrations          PASS — released + isolated V1.1 paths
pnpm verify                     PASS — 166,576 ms
```

The pre-convergence focused results recorded in `execplans/EP-09-v1.1-mcp-tasks.md` are historical development evidence only. They do not satisfy this post-hardening gate until reproduced against the merged branch.

## Evidence classification

**Real local verification:** PostgreSQL/pgvector migration and repository round-trips, Redis/BullMQ integration, management/OpenAPI contracts, production builds, infrastructure smoke and Server/Console smoke. The PostgreSQL coexistence regression stores and reads both 0063 generic Tool semantics and 0101 `taskExecution` metadata, while the default profile does not expose the V1.1 field.

**Simulated Provider behavior:** deterministic loopback availability responses, structured model decisions and fixed clocks exercise available/restricted/disabled/unknown, scheduling windows, confirmation and stale/risk-increase branches. No external production Provider was contacted.

**Unverified:** Phase 4 external-wait continuation, Phase 5 input/cancellation and business-result lifecycle, Phase 6 management/final acceptance, and any external production Provider interoperability.

## Evidence boundary

- Verified scope: FR-MCPT-009, the Phase 3 portions of FR-MCPT-010/011, NFR-MCPT-001/004, AC-MCPT-03 and the readiness/confirmation portion of AC-MCPT-09.
- Unverified scope: Phase 4 external-wait continuation, Phase 5 input/cancellation and Provider business outcomes, Phase 6 final acceptance, external production Provider interoperability.
- The machine summary truthfully records `dirty=true` because verification ran before the Phase commit; this report records the subsequently pushed publication SHA.
