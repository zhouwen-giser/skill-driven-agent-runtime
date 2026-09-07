# v1.0.2 Implementation

Date: 2026-07-15

## Outcome

`skill_call` executes a real independently planned child Workflow. The service loads the current enabled Skill version, validates the v1.0.1-resolved input, loads current MCP Tool planning metadata, invokes the normal bounded Workflow Planner, revalidates, confirms under the current parent-covered policy, and executes through the sole LangGraph runtime.

The real result is checked against the actual Skill output schema. Failed, canceled and invalid-output children are recorded and propagated without a fallback response. Parent cancellation reaches child execution, and async ancestry rejects cycles or more than eight nested Skill calls.

ADR-073 records the design and supersedes ADR-042's LLM-only child template. No migration is required for the feature increment; the existing child relation persists plan, instance and actual Skill version.

Nested confirmation policy will be finalized in v1.0.5.
