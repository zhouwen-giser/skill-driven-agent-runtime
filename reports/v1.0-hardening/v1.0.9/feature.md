# v1.0.9 Feature Review

Date: 2026-07-16

## Outcome

The Skill Graph now supplies bounded, exact-version composition evidence to initial Workflow planning. The model retains the final composition decision, but every `skill_call` must be admitted by persisted graph authority or an explicit internal capability-gap flow.

## Runtime evidence

- ADR-080 preserves Skill-domain ownership, immutable Workflow instances and the sole LangGraph runtime.
- Initial Task and child planning compute a fresh context; continuation and revision paths inherit it; Skill replacement recomputes it.
- Non-alternative traversal is depth/size bounded and rejects unavailable versions, schema mismatches and cycles.
- Plan and attempt audit retain complete Skill/relation snapshots, allowlists and decision summaries through migration 0062.
- Real A2A/Model/MCP E2E proves an admitted composable child enters the plan, remains independently confirmable and executes through the existing child Workflow runtime.

Feature commit/tag: `8f7bba9` / `v1.0.9` (published and remotely verified).
