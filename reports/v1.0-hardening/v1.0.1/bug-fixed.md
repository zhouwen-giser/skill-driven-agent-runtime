# v1.0.1 Bug-fixed Review

Date: 2026-07-15

## Findings and fixes

- Recursive template resolution and detached cloning had no explicit depth bound. Both paths now reject values deeper than 64 with `WORKFLOW_BINDING_DEPTH_EXCEEDED`, including cyclic adapter values once the bound is reached.
- An unset optional `result` root previously surfaced as invalid JSON data rather than a missing reference. The root is now absent until a result exists, producing `WORKFLOW_BINDING_REFERENCE_MISSING`.
- Dot-joined paths were ambiguous for legal node IDs containing dots. Missing-reference messages now retain the readable dotted path and include the exact JSON path array.

## Review outcome

- Business errors are not swallowed; they propagate unless an explicit immutable `error_handler` route handles them.
- MCP and Skill Schema failures occur before their external side effect or child plan persistence.
- No persistence, transaction, Task terminal-state, credential, Worker, AbortSignal, or MCP authority boundary changed.
- Parallel outputs remain keyed by validator-enforced unique node IDs; loop updates intentionally replace only their own node output.
- Feature tag: `v1.0.1` / `34c48a825fed614be0f1b52b3b1715d2d41f323c`.
- Bug-fixed tag/commit: populated by the tagged commit and reconciled in the next traceability update.

Known limits remain finite JSON, explicit path segments and maximum depth 64. The increment may proceed to v1.0.2 after the bug-fixed gate, commit, tag and push pass.
