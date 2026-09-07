# v1.1 MCP Tasks Phase 5 — Lifecycle Outcomes

Status: **Phase 5 increment verified**. This report does not claim Phase 6 management/Console completion or final v1.1 release acceptance.

Published Phase commit: `470fdac` (`feat(v1.1): complete task input cancellation and error semantics`).

## Delivered increment

- Provider form-mode `elicitation/create` becomes a bounded `source=remote_task` Task input linked to the exact binding, remote revision, result hash, Workflow instance/node run and control event. Sampling, roots and URL elicitation fail closed.
- A2A follow-up accepts a strict data part or deterministic single-field text compatibility path. The response is checked against the Provider's requested JSON Schema, persisted with a new Task attempt, and sent through exact `tasks/update({taskId,inputResponses})` without Goal formulation or Workflow replanning.
- PostgreSQL remains authoritative across one or multiple input rounds. Update acknowledgement and transport uncertainty are append-only attempts that both re-arm observation; a same revision/hash Provider echo does not create another input control.
- Local Task/Goal cancellation atomically creates a cooperative cancellation request and moves active bindings to `cancel_observing`. Protocol request, acknowledgement, uncertainty and later Provider terminal status are separate axes. BullMQ delivery has one attempt and ambiguous calls are not automatically retried.
- Completed `isError` results map bounded `start_window_missed`, `deadline_reached`, `partial_completion` and `business_failure` evidence into stable structured node errors and the existing LangGraph error-handler path. Malformed declared timing evidence fails closed; local TTL, timers and Provider unreachability never create a business deadline outcome.
- Migration 0103 adds input links/attempts and cancellation requests/attempts with composite identity, context-authority and guarded rollback checks. ADR-094 records the ownership and protocol decisions.

## Reproducible verification

```text
pnpm format:check               PASS
pnpm lint                       PASS
pnpm typecheck                  PASS
pnpm test:unit                  PASS — 66 files / 401 tests
pnpm test:contract              PASS — 8 files / 79 tests
pnpm test:integration           PASS — 7 files / 77 tests
pnpm test:e2e                   PASS — 2 files / 48 tests
pnpm verify:architecture        PASS — 225 TypeScript source files
pnpm verify:management-openapi  PASS — 107 operations
pnpm verify:migrations          PASS — released + isolated V1.1 through 0103
pnpm build                      PASS
pnpm verify                     PASS — 112,673 ms
```

The unified report is `reports/verification/summary.{json,md}`. It also passed the A2A 1.0.1 baseline/TCK evidence, 18 V1 acceptance scenarios, 67 migration pairs, license/SBOM/source gates, infrastructure smoke and Server/Console smoke. It truthfully records `dirty=true` because the gate ran before the Phase commit.

## Evidence classification

**Real local verification:** PostgreSQL input/link/attempt/CAS and two-round lifecycle; parent Task cancellation request creation; cancel acknowledgement followed by Provider terminal observation; Redis/BullMQ one-attempt/no-retry behavior; empty/upgrade/rollback/reapply migrations; full regression integration/E2E/build and both smoke stages.

**Simulated verification:** deterministic Provider input snapshots, `tasks/update`/`tasks/cancel` acknowledgement and network failures; structured Provider business results; LangGraph branch/error-handler behavior. No production Provider was contacted.

**Unverified:** external production MCP Provider interoperability; full Phase 6 loopback acceptance across all 16 AC scenarios; lifecycle management API/Console actions and browser E2E; final demos, tag and release publication.

## Requirement boundary

- Verified in Phase 5: FR-MCPT-008 input control, FR-MCPT-010/011 Provider business-outcome portions, FR-MCPT-012, FR-MCPT-013, AC-MCPT-06/07/08/10/11/12 and the late-lifecycle portion of AC-MCPT-16.
- Still cross-phase partial: FR-MCPT-014 and NFR-MCPT-001–004 require final API/Console/composed/restart acceptance in Phase 6. AC-MCPT-02/04/05/09/14/15 remain partial until the final composed loopback acceptance run.

Architecture decision: `adr/ADR-094-remote-input-and-cooperative-cancellation.md`.
