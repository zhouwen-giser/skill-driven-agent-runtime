# Phase 0 Symbol Map

## Phase 4 export symbols

| Symbol | Path | Current role | v1.4.1 disposition |
|---|---|---|---|
| `ManagedEvidenceExportConfiguration` | `packages/domain/src/evidence/evidence-contracts.ts` | strict Evidence configuration and policy | active Domain contract |
| `NodeControlEvidenceExportService` | `packages/node-control-application/src/evidence-export-service.ts` | Control revision/publish/apply orchestration | active Control application |
| `RuntimeEvidenceExportService` | `packages/runtime-control-application/src/evidence-export-service.ts` | fenced canonical batch and ACK orchestration | active Runtime application |
| `PostgresRuntimeEvidenceExportStore` | `packages/runtime-control-persistence-postgres/src/evidence-export-store.ts` | PostgreSQL pending/lease/send/ACK/retry/DLQ/status | active persistence adapter |
| `HttpEvidenceExportTransport` | `packages/evidence-export-adapter/src/http-evidence-export-transport.ts` | bounded secure Evidence HTTP batch/ACK | active external adapter |

## Runtime evidence source symbols

| Symbol | Path | Evidence responsibility |
|---|---|---|
| `PostgresUserGoalRuntimeRepository` | `packages/persistence-postgres/src/user-goal-runtime-repository.ts` | Goal Contract, Plan, Skill Goal/Attempt/Execution Contract, progress, recovery, effects, outcome |
| `SkillExecutionRecord` / `SkillExecutionEvent` / `SkillExecutionReference` | `packages/domain/src/skill-execution.ts` | complete Skill usage/execution tree |
| `TaskCapabilityBinding` / `TaskCapabilityExecutionAttempt` | `packages/domain/src/task-capability.ts` | immutable capability binding and attempt evidence |
| `ExperienceTraceNormalizer` | `packages/application/src/compiler/experience-normalizer.ts` | ExperienceTrace/Activity normalization |
| `DeterministicProcessMiner` | `packages/application/src/compiler/process-miner.ts` | ProcessVariant and WorkflowPattern derivation |
| `PatternFusionService` / `PatternGeneralizationService` | `packages/application/src/compiler/pattern-generalization.ts` | fused/generalized compiler evidence |
| `RuntimeCoreEvidenceProjector` | `packages/runtime-control-application/src/runtime-core-evidence-projector.ts` | all 18 Runtime records, Quality Issues, checkpoint and draft manifest |
| `createSkillExecutionEvidenceRecordId` | `packages/runtime-control-application/src/runtime-core-evidence-projector.ts` | stable cross-family Skill Execution reference identity |
| `PostgresRuntimeCoreEvidenceSource` | `packages/runtime-control-persistence-postgres/src/runtime-core-evidence-source.ts` | repeatable-read Runtime source snapshot and pending terminal Task scan |
| `SkillEvidenceProjector` | `packages/runtime-control-application/src/skill-evidence-projector.ts` | all 16 Skill records, exact cross-family references, Quality Issues and checkpoint |
| `PostgresSkillEvidenceSource` | `packages/runtime-control-persistence-postgres/src/skill-evidence-source.ts` | repeatable-read Skill tree snapshot after Runtime checkpoint |
| `skillExecutionEvidenceRevision` | `packages/runtime-control-application/src/runtime-core-evidence-projector.ts` | one immutable revision input shared by Runtime future refs and emitted Skill Execution |

## Control evidence source symbols

| Symbol | Path | Evidence responsibility |
|---|---|---|
| `NODE_EVENT_TYPES` / `NodeEventEnvelope` | `packages/node-control-domain/src/node-event.ts` | 20 frozen Control event types and safe envelope |
| `NodeControlEventService` | `packages/node-control-application/src/node-event-service.ts` | authenticated Control event read boundary |
| `PostgresNodeControlEventRepository` | `packages/node-control-persistence-postgres/src/node-event-repository.ts` | durable Node Event authority/read cursor |
| `PostgresNodeControlConfigurationRepository` | `packages/node-control-persistence-postgres/src/configuration-repository.ts` | configuration revision/apply/LKG sources |
| `PostgresNodeCapabilityRepository` | `packages/node-control-persistence-postgres/src/node-capability-repository.ts` | capability definitions and bindings |

## Remaining planned evidence symbols

Domain and export names are frozen. Phases 5-10 add source-family projector and manifest services;
PostgreSQL remains outbox/checkpoint/DLQ/manifest authority and the HTTP adapter remains wire-only.
