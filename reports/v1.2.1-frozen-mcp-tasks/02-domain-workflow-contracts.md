# SDAR v1.2.1 Phase 2 Domain and Workflow Contracts

Status: **PASSED WITH BASELINE HOST LIMITATION**

Domain now owns the Frozen protocol mode, task-execution profile, immutable protocol-contract snapshot,
task-behavior result matrix, canonical decimal `runtimeRevision`, `taskId + runtimeRevision` dedupe key,
Frozen Availability request projection and Provider Evidence Item without `requirementId`.

Workflow execution is an explicit discriminated union. Historical `mode: allow_task/require_task` remains
readable as Legacy. Frozen plans require `protocolMode: frozen_v1`, contain only invocation controls
(`availabilityCheck`, `timing`, `reservationRef`) and reject a mixed Legacy `mode`. The Legacy SDK Bridge
fails closed if handed a Frozen execution object.

## Verification

| Command | Result |
| --- | --- |
| `pnpm test:unit` | passed: 75 files, 471 tests |
| focused Workflow unit tests | passed: 2 files, 17 tests |
| focused Workflow JSON Schema contract | passed: 1 file, 3 tests |
| `pnpm test:contract` | 112/113 passed; unchanged Windows symlink fixture setup failed with `EPERM` |
| `pnpm format:check` | passed after formatting |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm verify:architecture` | passed across 260 TypeScript source files |

This phase does not claim Frozen HTTP, persistence, lifecycle, notification, Evidence matching or Provider
interoperability. Those remain owned by Phases 3–12.
