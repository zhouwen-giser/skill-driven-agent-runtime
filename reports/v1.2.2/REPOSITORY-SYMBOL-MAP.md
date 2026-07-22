# v1.2.2 Repository and Symbol Map

## Runtime composition

| Area | Current path | v1.2.2 role |
| --- | --- | --- |
| One-process composition | `apps/server/src/runtime.ts` | wire planning/scheduler/judges/event client workers |
| A2A boundary | `packages/a2a-adapter` | request/follow-up projection; no terminal business decision |
| Domain | `packages/domain/src` | new User Goal/Skill Goal/outcome/recovery/event-impact contracts |
| Application | `packages/application/src` | new services and ports; reuse Workflow/remote Task authorities |
| Workflow execution | `packages/langgraph-runtime` | sole immutable Workflow runtime |
| MCP protocol | `packages/mcp-adapter` | keep Frozen Tasks, remove Legacy; add Business Events strict client |
| PostgreSQL | `packages/persistence-postgres` | clean baseline repositories/CAS/inbox/cursors/terminal authority |
| Redis/BullMQ | `packages/runtime-redis` | reconstructable dispatch/event processing references |
| Management | `packages/management-api` | actual Goal DAG/judgment/recovery/event projections and actions |
| Console | `apps/console` | operational UI over Management API only |
| Protocol assets | `protocol` | current Frozen MCP Tasks plus new locked Provider Business Events assets |
| Schema | `schemas` | Workflow/Management plus v1.2.2 domain/API contracts |
| Database | `infra/postgres` | guarded v1.2.2 baseline/reset/seed; no historical upgrade |

## Current reusable symbols

- Goal/patch contracts: `Goal`, `GoalExecutionContract`, `GoalPatchService`.
- Workflow authority: `WorkflowPlannerService`, `WorkflowExecutionService`, `WorkflowControllerService`,
  `LangGraphWorkflowExecutor` and immutable Workflow/continuation models.
- Remote Task authority: `RemoteTaskBinding`, polling, readiness, continuation, input and cancellation
  services/repositories.
- Frozen MCP Tasks: `FrozenV1McpClient`, Frozen discovery/lifecycle/notification/evidence validators.
- Skill authority: `SkillVersion`, Skill Registry, exact-version Usage, composition, selection and
  execution evidence.
- Atomic completion: `RuntimeTerminalOutcomeRepository`; it must be narrowed/replaced by the
  UserGoalPlanController terminal port rather than duplicated.
- Observability: Task-rooted Management queries, Runtime Events and Console panels.

## New symbol targets and owners

| Owner | Target symbols |
| --- | --- |
| Domain | `UserGoalCompletionContract`, `UserGoalPlan`, `SkillGoal`, `SkillGoalDependency`, `SkillOutcomeSpecification`, `SkillExecutionContract`, `SkillAttempt`, `TaskGoalOutcome`, `SkillGoalOutcome`, `UserGoalOutcome`, `GoalProgressVector`, `CompletedEffect`, `RecoveryDecision`, `BusinessEventInboxEntry`, `EventImpactAssessment` |
| Application | `UserGoalPlanningService`, `SkillGoalPlanValidator`, `SkillGoalScheduler`, `SkillCompatibilityService`, `TaskGoalJudge`, `SkillGoalJudge`, `UserGoalJudge`, `UserGoalPlanController`, `RecoveryCoordinator`, `BusinessEventSubscriptionService`, `ProviderSubscriptionCoordinator`, `BusinessEventRelationResolver`, `TaskImpactAssessmentService`, `SkillGoalPlanImpactService` |
| PostgreSQL | plan/DAG/coverage/attempt/outcome/effect/budget/recovery repositories; Goal CAS; event subscription/inbox/cursor/continuity/incident repositories |
| MCP adapter | strict Discovery/Listen/Ack/Event/Continuity/Relation DTOs; POST-SSE transport reuse; Frozen Mock |
| Redis | Skill Goal dispatch and Business Event processing queues carrying only durable IDs/versions |

## Boundary tests to extend

- `scripts/check-architecture.mjs`: forbid Legacy product symbols and terminal-port imports outside the
  controller/composition/persistence boundary.
- Domain/Application cannot import MCP SDK, A2A SDK, LangGraph, PostgreSQL, Redis or React types.
- MCP Business Events wire types stay in `packages/mcp-adapter`.
- Only `packages/langgraph-runtime` imports LangGraph runtime types.
- UI contains no static Goal/Event business records and has no direct lifecycle state mutation.
