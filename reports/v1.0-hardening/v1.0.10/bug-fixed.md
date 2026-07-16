# v1.0.10 Bug-fixed Audit

Date: 2026-07-16

The feature commit `f8ae410` and annotated `v1.0.10` are published and remotely verified.

The audit found and fixed three terminal-authority gaps:

- Goal Patch bulk SQL could rewrite an older same-Goal capability-gap Task to `invalidated`;
- a stale Worker could append a WorkflowControl Round after the Control reached capability gap;
- a corrupt database row or in-memory projection could expose terminal A2A failed state without its required error code/evidence.

The repaired boundaries preserve every Task terminal phase during Goal Patch, lock and recheck non-terminal Control authority before Round insertion, require structured PostgreSQL/A2A evidence, and reject blank domain evidence fields.

Bug-fixed publication: pending / `v1.0.10-bug-fixed`.
