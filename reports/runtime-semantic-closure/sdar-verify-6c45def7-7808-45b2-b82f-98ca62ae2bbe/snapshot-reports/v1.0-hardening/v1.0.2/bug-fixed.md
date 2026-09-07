# v1.0.2 Bug-fixed Review

Date: 2026-07-15

## Findings and fixes

- The legacy `(parent_instance_id,parent_node_id)` primary key overwrote the audit relation when a loop re-entered the same `skill_call`. Forward migration 0054 adds independent `call_id` primary identity and a parent/node history index; repository `save` is append-only and `find` returns the latest call deterministically.
- A schema-valid but extremely large child result could enter parent state. Admission now requires finite acyclic JSON and at most 64,000 serialized characters before output-schema validation and parent return.
- The integration bootstrap replayed old migrations when the shared database was one version behind. It now advances 0053→0054 only, preserving the monotonic ledger invariant.

## Review outcome

- Parent cancellation signal is passed to child execution; canceled/failed children are recorded and propagated.
- Planner persistence failure prevents confirm/execute; relation persistence failure propagates rather than silently losing audit.
- Cycle and depth-eight guards remain active across nested async child execution.
- MCP calls remain under current Tool schema/policy and appear in the normal invocation audit; SDAR does not assume device-state authority.
- Feature tag: `v1.0.2` / `0e3122c7eca5a6eb808108576631a3ab55b89ac9`.
- Bug-fixed commit/tag: reconciled after publication.

Nested confirmation policy will be finalized in v1.0.5. No other known correctness issue blocks v1.0.3 after the final gate and tag are published.

## Rollback

`0054_skill_call_history.down.sql` keeps only the latest relation per parent instance/node before restoring the legacy composite primary key. Older repeated-call audit rows are intentionally lost on rollback; back them up first.
