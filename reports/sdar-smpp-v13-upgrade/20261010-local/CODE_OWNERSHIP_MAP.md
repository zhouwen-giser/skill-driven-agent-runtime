# Verified ownership and reuse map

| Responsibility | Actual owner/caller | Transaction or boundary | Regression |
| --- | --- | --- | --- |
| Frozen wire and parts | mcp-adapter/SmppTaskBusinessClient; server Runtime Frozen read port | Bounded network read, per-page/hash verification | smpp-task-business-client.contract.test.ts; frozen-v1-http.contract.test.ts |
| Read authorization | application/McpRegistryService.#businessReadTarget / #assertRemoteTaskReadAuthority | Frozen Provider/source/catalog/credential/protocol check before transport | mcp-registry.unit.test.ts |
| Remote identity | domain/RemoteTaskBinding; PostgresRemoteTaskRepository; Runtime admission | Existing immutable admission and optional Provider execution link | remote-task integration and admission recovery tests |
| Input activation | RemoteTaskInputService; PostgresRemoteTaskInputRepository.activate | Control + binding + waiting instance + Task input link atomic | remote-task-input.unit/integration tests |
| Answer persistence | TaskService.followUp -> existing task response/attempt -> PlanPreparationProcessor -> submitAnswer | Answer durable before worker; no single-sender claim yet in submitAnswer | remote-task-input.unit.test.ts; plan-preparation-processor.unit.test.ts |
| Control confirmation | GovernedControlInvocationAuthorizer; PostgresGovernedControlAuthorityRepository | Real scope checks and one-time confirmation consumption | governed-control-authority.unit.test.ts |
| Event intake | BusinessEventSubscriptionService -> PostgresUserGoalRuntimeRepository.admitBusinessEvent | Inbox and admitted cursor atomic | business-events.unit.test.ts; user-goal-runtime integration tests |
| Event consumption | BusinessEventIngressWorker -> TaskImpactAssessmentService -> markBusinessEventProcessed | Current projection/processed boundary is separate; GREATEST may skip holes | business-events.unit.test.ts; GOWM business-event cases |
| Shared storage | ADR-153; device scope SQL and GOWM pool | Owner installs schema; Runtime performs read-only startup validation | gowm-storage-postgres.mts; gowm-runtime-execution.mts |
| Skill/outcome | skill-execution-recording, result-processing-service, outcome-judges | Existing output/schema/evidence paths | skill execution / outcome unit and Server integration |
| Recovery | remote-task-polling, admission-recovery, continuation; ContextSerialExecutor | Only persisted admitted waits; no START replay | continuation/composition PostgreSQL tests |

Confirmed gaps: business Context has no persistent read model or formal Skill consumption yet;
Registry reads do not themselves bind the first execution; Artifact reads need exact execution
checks against that durable link; W2 must add projection consumption atomically and repair cursor
holes; W3 must add immutable business intent, real permission consumption and a single sender.
Do not add a second SSE per task, event bus, authority copy or workflow runtime.
