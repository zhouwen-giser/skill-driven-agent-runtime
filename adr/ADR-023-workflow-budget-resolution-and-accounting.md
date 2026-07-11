# ADR-023: Workflow budget resolution and accounted cost

## Status

Accepted on 2026-07-12.

## Decision

- Workflow budget limits and usage are domain-owned records. PostgreSQL stores the resolved immutable limit snapshot, actual usage, selected current Skill versions, and any budget termination reason on each Workflow instance.
- The server supplies complete system defaults. Each current enabled Skill may override individual fields. For a composed Workflow, each Skill first inherits missing system fields and the runtime then takes the minimum effective value for every field. This conservative merge prevents one Skill from widening another Skill's boundary.
- The LangGraph runtime owns an instance-local, concurrency-safe meter. Parallel branches share the same meter, so reservations occur synchronously before any LLM/MCP call and cannot race past a count or cost limit.
- `maxLlmCalls` counts `llm` and the current production `skill_call` implementation, because it makes one model invocation. `maxMcpCalls` counts `mcp_tool`. Confirmed subworkflows receive their own resolved/default instance budget and the parent reserves its configured subworkflow cost.
- Duration is checked before every node and after every external call. External ports receive an AbortSignal combining caller cancellation with the remaining Workflow deadline. A transport that ignores cancellation still cannot complete the Workflow successfully after the deadline.
- Cost is an explicit system-configured accounted unit per LLM, MCP, Skill, and subworkflow call. V1 does not infer vendor billing from token counts because provider/tool price metadata is not in the requirement baseline. Reservations happen before calls; a call that would exceed `maxCost` is not sent.
- Budget exhaustion is fail-closed, cannot be intercepted by a DSL error handler, and produces a stable error plus one of `duration_exhausted`, `llm_calls_exhausted`, `mcp_calls_exhausted`, or `cost_exhausted`.
- `maxReplans` is resolved and persisted in this increment but enforcement belongs to the outer replan controller required by FR-WF-008. FR-WF-009 remains developing until that controller proves `replans_exhausted` behavior.

## Consequences

- No LangGraph or provider SDK types enter Domain/Application layers.
- System defaults apply even without a selected Skill; direct management execution may additionally name primary Skills, while every `skill_call` reference is resolved automatically.
- Current Skill versions and effective limits are fixed before execution. Later Skill edits cannot change a running instance.
- Accounted cost is deterministic and testable, but it is not a claim of exact external currency billing. Provider-specific pricing can later feed the same meter through a reviewed extension without changing budget semantics.
