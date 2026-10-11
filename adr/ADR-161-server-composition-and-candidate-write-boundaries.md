# ADR-161: Server composition and candidate write boundaries

Status: Accepted for implementation (explicit user-approved plan, 2026-10-11). Verification pending.

## Context

The server composition root mixes infrastructure, generic application assembly and UGV/SMPP policies. Planning objects expose formal repository writers to candidate-only consumers. This complicates authority review without adding a second runtime or changing behavior.

## Decision

Use explicit typed composition stages, narrow fail-closed late-bound callback ports and owned lifecycle cleanup. Keep the existing server entry exports and public API contracts. Isolate UGV policy implementations outside generic Domain/Application; retain generic idempotent confirmation ports in Application and wire transport through existing adapters.

User Goal and Workflow candidate generators produce immutable data, with only read authority, model/validation and append-only planning audit capabilities. They cannot persist formal plans, supersede plans, bind Tasks, consume confirmations, dispatch Workflow nodes or write terminal states. Formal commit services retain persistence, CAS, idempotence, failure records and confirmation inheritance. Existing Task/Workflow/User Goal services retain execution and terminal authority.

No schema, dependencies, frozen contract, Task semantics, recovery permissions, confirmation policy or default safety gates change. Profile policy does not create an alternative Task/Goal writer or remote state machine. Revisions continue to create immutable new plans outside running graphs.

GOWM planning attempts require a native planning root. Candidate-only PostgreSQL auditing therefore returns a deferral fact without a database write; the candidate carries ordered immutable attempt/readiness audits. The formal commit service creates the root and persists those audits before finalizing the plan. Ordinary append-only attempt auditing remains available during generation. Readiness evaluation returns planning evidence without the persistence writer. Discarded or late candidates never create GOWM execution roots. This uses the existing schema and device ownership checks.

TaskBusiness operation support is an explicit application port supplied by the internal UGV profile. Existing callers retain a frozen contract-data lookup default; enumerated public operation names remain immutable Domain compatibility data. The generic command/terminal services contain no UGV operation-name branches and retain all confirmation, binding and lifecycle checks.

## Verification

Negative architecture fixtures, candidate/commit regressions, existing ordinary/UGV/SMPP/GOWM contract and E2E paths, full isolated milestone gates and a final frozen install plus restricted-role GOWM run. Exact run identities are recorded in the ExecPlan and traceability matrix when actually run.
