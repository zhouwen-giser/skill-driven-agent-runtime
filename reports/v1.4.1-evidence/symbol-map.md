# Phase 0 Symbol Map

## Current export symbols

| Symbol | Path | Current role | v1.4.1 disposition |
|---|---|---|---|
| `TelemetryExportConfiguration` | `packages/node-control-domain/src/telemetry-export.ts` | runtime-event export config | replaced by typed evidence configuration |
| `NodeControlTelemetryExportService` | `packages/node-control-application/src/telemetry-export-service.ts` | Control revision/publish/apply orchestration | retained conceptually under evidence naming and contract |
| `RuntimeTelemetryExportService` | `packages/runtime-control-application/src/telemetry-export-service.ts` | captures and sends runtime-event summaries | replaced by canonical evidence export service |
| `PostgresRuntimeTelemetryExportStore` | `packages/runtime-control-persistence-postgres/src/telemetry-export-store.ts` | old config/state/outbox access | retired by Strategy B migration |
| `HttpTelemetryExportTransport` | `packages/telemetry-export-adapter/src/http-telemetry-export-transport.ts` | old HTTP batch/ACK | replaced by evidence adapter and header |

## Runtime evidence source symbols

| Symbol | Path | Evidence responsibility |
|---|---|---|
| `PostgresUserGoalRuntimeRepository` | `packages/persistence-postgres/src/user-goal-runtime-repository.ts` | Goal Contract, Plan, Skill Goal/Attempt/Execution Contract, progress, recovery, effects, outcome |
| `SkillExecutionRecord` / `SkillExecutionEvent` / `SkillExecutionReference` | `packages/domain/src/skill-execution.ts` | complete Skill usage/execution tree |
| `TaskCapabilityBinding` / `TaskCapabilityExecutionAttempt` | `packages/domain/src/task-capability.ts` | immutable capability binding and attempt evidence |
| `ExperienceTraceNormalizer` | `packages/application/src/compiler/experience-normalizer.ts` | ExperienceTrace/Activity normalization |
| `DeterministicProcessMiner` | `packages/application/src/compiler/process-miner.ts` | ProcessVariant and WorkflowPattern derivation |
| `PatternFusionService` / `PatternGeneralizationService` | `packages/application/src/compiler/pattern-generalization.ts` | fused/generalized compiler evidence |

## Control evidence source symbols

| Symbol | Path | Evidence responsibility |
|---|---|---|
| `NODE_EVENT_TYPES` / `NodeEventEnvelope` | `packages/node-control-domain/src/node-event.ts` | 20 frozen Control event types and safe envelope |
| `NodeControlEventService` | `packages/node-control-application/src/node-event-service.ts` | authenticated Control event read boundary |
| `PostgresNodeControlEventRepository` | `packages/node-control-persistence-postgres/src/node-event-repository.ts` | durable Node Event authority/read cursor |
| `PostgresNodeControlConfigurationRepository` | `packages/node-control-persistence-postgres/src/configuration-repository.ts` | configuration revision/apply/LKG sources |
| `PostgresNodeCapabilityRepository` | `packages/node-control-persistence-postgres/src/node-capability-repository.ts` | capability definitions and bindings |

## Planned evidence symbols

The exact public names will be frozen in Phase 2, but ownership is fixed: Domain owns canonical
record/catalog/policy types; Application owns writer/projector/export/manifest services; PostgreSQL
adapters own outbox/checkpoint/DLQ/manifest repositories; HTTP adapter owns wire delivery only.
