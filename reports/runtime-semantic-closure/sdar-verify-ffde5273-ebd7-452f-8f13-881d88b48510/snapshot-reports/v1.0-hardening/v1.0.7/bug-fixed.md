# v1.0.7 Bug-fixed Review

Date: 2026-07-16

## Findings and fixes

- Execution selected the latest matching resolution rather than the exact record used during planning. AgentTask now stores the plan-bound resolution ID, and migration 0060 enforces the complete Task/Goal/Skill identity with a composite foreign key.
- A newer record could therefore drift the confirmed plan's initial input. Regression evidence creates a newer valid record and proves execution still reads the older plan-bound value.
- Model output could retain an unresolved field even after authoritative metadata supplied it. Reconciliation now drops only unresolved markers whose top-level field is actually present after the priority overlay.
- Root JSON Schema errors had no field name and could become a failed record. They now use `$`, while required-property errors recover the concrete property name.
- Goal Patch persisted invalidation before patched-Goal input resolution. Resolution now preflights first; unresolved or failed resolution leaves Goal, Task, source plan and Patch history unchanged.
- Skill replacement or Goal Patch can change input authority. Both clear the old Task binding, and PostgreSQL rejects cross-Task or cross-version evidence.

## Review outcome

Planning and execution share one exact immutable input version, priority conflicts are deterministic at the system boundary, invalid input remains resumable, and Goal Patch cannot expose a partial input-resolution state.

Feature commit/tag: `9bf6ba3` / `v1.0.7`.

Bug-fixed commit/tag: reconciled after publication.
