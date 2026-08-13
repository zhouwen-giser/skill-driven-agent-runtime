# Phase P05 Report

## Source lock

- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Baseline: `origin/main` at `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Repair branch: `fix/sdar-breakpoint-repair`
- P05 candidate: `d74de7f`
- Physical device writes: `0`

## Breakpoint

`BP-SDAR-005` - Remote/In-flight Recovery.

Disposition: `FIXED`.

The phase closes remote creation/admission uncertainty, durable external-wait recovery, hierarchy
callback re-entry, failed Redis wake reconstruction, terminal CapabilityAttempt closure, and stale
Provider polling authority. PostgreSQL remains authoritative and Redis remains wake-only. The exit
criterion `REMOTE_IN_FLIGHT_RECOVERY_PASSED` is asserted for the implemented recovery semantics.

## Implemented recovery semantics

- Before `tools/call`, SDAR persists a frozen admission intent and marks dispatching with the exact
  invocation identity. A Provider response is committed in one PostgreSQL transaction with the MCP
  invocation, remote receipt, and recoverable Workflow continuation checkpoint.
- A restart with a durable receipt materializes the same binding and continuation idempotently. A
  dispatch with no durable receipt becomes explicit
  `REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN`; it is never replayed.
- External-wait activation is checkpointed before the admission journal is sealed. Single waits are
  exactly recoverable, parallel waits require the merged final graph snapshot, and nested hierarchy
  re-entry recognizes already committed parent/root progress without repeating graph execution.
- Remote completed/failed/canceled terminal commits close the exact latest CapabilityAttempt in the
  same PostgreSQL transaction. Continuation outcome uncertainty fails the local Task and attempt
  instead of leaving `executing` or `waiting_external` stranded.
- Cancellation is durably `uncertain` before outbound delivery. Only a still-requested cancellation
  may have a failed Redis wake rebuilt; a claimed or uncertain side effect is never resent.
- Failed poll/continuation/cancel BullMQ jobs are reconstructed only after PostgreSQL confirms the
  current work item. Queue workers still use `attempts: 1`; Redis never becomes outcome authority.
- Every new remote Task freezes Runtime catalog identity plus Provider Binding
  `originType`, `externalServerId`, and SMPP source lineage before transport. Before each
  `tasks/get`, SDAR rechecks the current endpoint, server, catalog checksum, operation count, remote
  Provider identity, and unexpired Binding. Drift produces explicit uncertainty with zero Provider
  transport. Ordinary readiness/revision refresh remains allowed when those identities are stable.
- Missing, malformed, or unknown-version legacy authority snapshots fail closed; they are never
  silently upgraded or materialized.
- TTL is checked before another Provider read. Frozen protocol/schema/authority loss closes the
  local recovery path explicitly rather than retrying indefinitely.

## Validation

| Gate | Result | Evidence |
| --- | --- | --- |
| Current TypeScript gate | PASS | `pnpm typecheck`, exit `0` at `d74de7f` |
| Current authority/recovery focused tests | PASS | 6 files / 123 tests |
| Authority parsing and admission-store focused tests | PASS | 3 files / 69 tests |
| Current PostgreSQL governed dispatch/recovery chain | PASS | 1 file / 2 tests; exact one loopback `tools/call`, receipt reconstruction, duplicate materialization fence, explicit dispatch uncertainty |
| PostgreSQL terminal lineage | PASS | Repository phase gate 78/78; achieved, failed, and canceled CapabilityAttempt closure is atomic and idempotent |
| PostgreSQL authority snapshot round-trip | PASS | JSONB round-trip, reordered-key duplicate convergence, and missing-snapshot constraint rejection |
| Redis failed-wake recovery | PASS | 3 files / 7 tests against isolated Redis; poll, continuation, and still-requested cancel wakes were consumed by a new worker; `attempts: 1` |
| Migrations | PASS | 53 additive migrations through `0160_v14_remote_task_authority_snapshot` |
| Targeted ESLint, Prettier, and `git diff --check` | PASS | Phase-owned files |
| Real SMPP/physical recovery | NOT RUN | Deterministic loopback Providers only; `physicalDeviceWrites=0` |
| Monolithic Runtime A close -> Runtime B terminal drill | NOT RUN | The same boundaries are exercised by real PostgreSQL, real Redis, process reconstruction, Provider-call-count, continuation, and terminal-lineage gates; no additional production gap was found in two independent reviews |

## Authority and side-effect impact

An uncertain external creation or cancellation is never replayed merely to make progress. Provider
polling cannot cross a changed Runtime, catalog, SMPP source, or external Server identity. Recovery
either reconstructs from a durable receipt or terminates explicitly. This phase does not modify
SMPP, the Console, or any external repository.

## Status

`REMOTE_IN_FLIGHT_RECOVERY_PASSED`
