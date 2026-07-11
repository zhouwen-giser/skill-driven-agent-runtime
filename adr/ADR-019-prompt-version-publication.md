# ADR-019: Prompt version authority and publication gate

## Status

Accepted on 2026-07-12.

## Decision

- Prompt and immutable PromptVersion records are PostgreSQL-authoritative and scoped to a fixed ModelStage.
- Content must include `{{instruction}}`; no code default Prompt is used when a stage lacks an enabled version.
- `auto_candidate` can only create an inactive candidate. Administrator publication copies candidate content into a new enabled version and changes the current pointer.
- Disable and rollback also create immutable new versions. Rollback never rewinds or mutates history.
- Model Runtime resolves the current enabled PromptVersion before transport, renders it, and records the actual prompt ID/version in every structured invocation.
- Effect summaries aggregate successes, failures, duration, and Token usage from invocation audit records.

## Consequences

Candidate optimization cannot silently change production behavior and AC-15 is reproducible. Failure/evaluation-driven automatic candidate generation remains an EP-05 integration and is not claimed by this increment.
