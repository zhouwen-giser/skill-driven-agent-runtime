# R0 Gap Audit

Status: implementation required.

The current Runtime already persists a pre-dispatch `remote_task_admission_intent`, records the MCP
invocation and Provider receipt atomically, materializes exactly one `RemoteTaskBinding`, and resumes
the immutable Workflow through the existing PostgreSQL continuation frontier. These authorities are
reused unchanged.

Observed gaps against the task package:

1. The logical invocation has no explicit content-derived identity/hash separate from the physical
   invocation row.
2. A transport exception marks the intent `uncertain`, but `listRecoverable()` excludes uncertain
   intents, so startup cannot reconcile the original Provider Task.
3. The Frozen application port has only normal `call` and `get`; it has no reconciliation-only method
   with the four frozen outcomes.
4. Runtime persistence has no companion Task→Provider external execution relation and no optional
   Device Mission relation.
5. Canonical Evidence covers current MCP Task lifecycle records but not the new logical invocation,
   exact reconcile attempt and Provider execution companion relation.

Safety conclusions:

- No second Task or Workflow runtime is needed.
- No Provider private database, Telemetry or ClickHouse read is permitted or necessary.
- `not_found`, `conflict` and `unavailable` must remain blocked and must never trigger a normal
  `tools/call` dispatch.
- Provider completion remains an input to existing verification; it cannot directly mark Goal success.
