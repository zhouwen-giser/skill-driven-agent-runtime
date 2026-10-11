# ADR-159: Restore the native remote input source with a guarded increment

Status: Accepted (2026-10-11, isolated local implementation).

Real PostgreSQL W3 regression found that the frozen clean-slate SQL contains the native
remote_task_input_link tables but excludes remote_task from task_input_request.source.
Migration 0103 and the original RemoteTaskInputService/PostgresRemoteTaskInputRepository
already require that source; clean-slate migration selection intentionally does not rerun 0103.
The original standalone activation therefore fails before reaching governed business commands.

Keep the frozen baseline byte-identical. Append 0184_v14_task_business_input_source as an
increment restoring this already defined native source. It changes no table, Task status,
authority, SDK protocol or Workflow runtime. GOWM persists its existing workflow source and
uses its native link projection; this migration is for the owned Runtime schema only.

Rollback refuses to remove the source while retained native remote input records exist.
It never deletes evidence or recategorizes records. An operator can retain the additive
constraint and run the previous reader, subject to the independent unresolved-command fence.
Repository/continuation tests, migration selection and the full isolated gate verify it.

The original continuation claim also applied its terminal-only Binding transition to input_required. Claim input controls under the original active wait/lease and leave awaiting_input unchanged; terminal controls retain the original terminal transition. The real PG regression rejects a second claimant. Governed tasks/update preserves the original frozen protocol revision in its native acknowledgement attempt; missing or foreign revision is contract_invalid, with no legacy fallback or second send. This retains the original 0103 acknowledgement constraint without altering baseline SQL or wire fields.
