# v1.0.8 Implementation

Date: 2026-07-16

`GoalExecutionContract` is now the immutable Goal-domain snapshot used by Skill retrieval, fixed-stage selection, replacement, Temporary Skill resolution, top-level/replan/child Workflow planning and Goal Evaluation. Content equality checks protect registered management calls, repair confirmation inheritance, execution and WorkflowControl from same-version drift.

Skill candidate snapshots contain capabilities, bounded input/output schema summaries, Tool policy, Workflow guidance summary, runtime policy, quality metrics, active matching MCP dependency warnings and semantic score. Selection, replacement, Workflow plan and every plan attempt persist the exact governing contract. Model planning requests and invocation audit therefore reproduce the same snapshot.

Migration 0061 backfills and constrains the four evidence stores. Goal Patch supplies the proposed new contract before invalidating the old version; ordinary revisions and child plans preserve their source authority. Management OpenAPI requires a complete contract, while the composition root additionally checks registered Goals against PostgreSQL authority.

Feature commit/tag: reconciled after publication / `v1.0.8`.
