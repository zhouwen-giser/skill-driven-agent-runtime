# ADR-079: Complete Goal Execution Contract Propagation

## Status

Accepted on 2026-07-16.

## Context

The runtime persisted Goal identity on plans, but Skill retrieval and selection used only the Goal description, child planning inherited only an ID/version pair, and planning callers embedded different subsets of Goal fields in ad hoc instructions. A constraint or success-criterion change could therefore be invisible to one stage even while the generated Workflow claimed the new Goal version. Model invocation audit captured those inconsistent requests rather than one reproducible execution contract.

The complete contract must remain owned by the Goal domain, must not become a transport or SDK model, and must preserve immutable Workflow planning and the single LangGraph execution runtime.

## Decision

- The Goal domain owns `GoalExecutionContract`: `goalId`, `version`, `title`, `description`, `constraints` and `successCriteria`. `createGoalExecutionContract` and `snapshotGoalExecutionContract` copy and freeze the list fields; asynchronous decision boundaries snapshot before their first `await` rather than relying only on TypeScript `readonly`.
- Formal and Temporary Skill selection receive the complete contract. Semantic retrieval includes every contract field, and the fixed Skill-selection model request contains the same snapshot.
- A Skill candidate snapshot contains capabilities, bounded input/output schema summaries, Tool policy, Workflow guidance summary, complete runtime policy, quality metrics, active matching MCP dependency warnings and semantic score. The selection and any replacement plan persist the exact Goal contract.
- Workflow planning requires a Goal contract in addition to the identity fields and rejects any mismatch before model invocation. The planner adds the snapshot to every structured request and stores it on every plan and plan attempt. This makes model invocation audit and PostgreSQL planning evidence agree without parsing caller-specific prose.
- Natural-language/admin revisions, control replans, input continuations and child Skill plans inherit the source/current authoritative contract. Goal Patch alone changes the snapshot, using the proposed new Goal version before the old plan is invalidated.
- Goal evaluation uses the same domain snapshot, including the title. Execution continues to bind the immutable Goal identity from the validated Workflow definition; it does not introduce mutable Goal reads inside LangGraph.
- Management selection and planning require the complete contract because their low-level surfaces can operate before a Goal is registered. When the Goal already exists, the composition root requires it to remain active and compares the submitted snapshot with the authoritative current Goal before any embedding/model call.
- Goal Patch requires its source plan to match the active Goal's complete current contract before model deliberation. Admin revision copies its source snapshot, matching model-planned revision semantics.
- Migration 0061 backfills historical snapshots from Goal Patch before/after evidence or the current Goal row. Records that predate all recoverable Goal evidence receive an explicit legacy description solely for readable historical compatibility; no new planning or replacement operation may treat a legacy/stale selection as current authority.

## Consequences

Constraint and success-criterion changes now affect retrieval and every model planning decision, and the exact contract is reproducible from selection, replacement, plan, attempt and invocation audit evidence. A new plan cannot claim one Goal version while presenting another version's semantic content.

The candidate payload is larger but remains bounded to schema summaries and Workflow guidance text. PostgreSQL stores intentional immutable JSON snapshots; SDK and transport types still stop at adapters, and LangGraph remains the only executor.
