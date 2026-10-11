# ADR-161: Server composition and candidate write boundaries

Status: Accepted; local implementation verified (explicit user-approved plan, 2026-10-11). Git publication pending.

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

The pre-refactor frozen source reproduces the current host performance failure. Following the existing accepted `reports/resource-identity-20260909/performance-isolated.json` practice, the isolated test driver uses a separate owned real PostgreSQL tmpfs data directory and the same pinned Redis for the unchanged relative performance case. Functional, integration, migration and recovery tests keep persistent volumes. Sample design and all three numerical limits are unchanged; the fixture records resolved Compose hash, image IDs, ownership and cleanup, and outer cleanup covers a killed child. This changes only local verification infrastructure, with no production configuration, dependency or schema change.

Full M1–M4 isolated gates pass all 30 stages each. Final fresh frozen install and runtime input `65aa5c85b5c13b3b5ace87ebb8f426365fa6976a61b7adcb0fe0e38764a0dbe5` match runtime commit `870e94b6`; 2650 unit, 552 contract, 270 integration and 77 E2E tests pass. Same frozen local inputs pass eight restricted-role GOWM steps, two formal E2E cases and 26 native boundary scenarios. Case results, unchanged baseline/protocol/dependency checks, original logs and failed attempts are retained in `reports/server-composition-planning-boundaries/20261011-local/`. Site/deployment are NOT_RUN; original project-level upstream gaps remain open.
