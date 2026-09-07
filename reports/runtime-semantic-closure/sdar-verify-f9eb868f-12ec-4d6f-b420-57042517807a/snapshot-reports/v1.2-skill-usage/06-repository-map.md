# SDAR v1.2 Phase 6 Repository Map

Generated 2026-07-17 from `origin/main` `667146a3639eefdfed9b89c2417c08e1ac50e9a9` and the Phase 5
publication branch. Main is already an ancestor; no merge commit is required or permitted.

| Area | Current authority | V1.2 status at Phase 6 | Next owner phase |
| --- | --- | --- | --- |
| `packages/domain/src/skill.ts` | exact `SkillVersion`, schemas, Tool/runtime policy and lifecycle | additive immutable usage snapshot is implemented | 7 persists through same Registry |
| `packages/domain/src/skill-usage.ts` | native/legacy usage, normative/adaptive, modes, bindings and composition declarations | implemented and frozen by ADR-097/099 | 7 persistence/API |
| `packages/domain/src/skill-applicability.ts` | structured context, readiness projection, applicability and mode decisions | implemented; readiness mock remains test-only | 8 V1.1 adapter |
| `packages/domain/src/skill-usage-composition.ts` | exact immutable plan, three IRs and failure projection | implemented and frozen by ADR-098/100 | 9 planning compliance |
| `packages/application/src/skill-registry.ts` | sole catalog/version publication service | usage reads/diff/catalog are additive | 7 import persistence |
| `packages/application/src/skill-selection.ts` | semantic retrieval and final model selection | deterministic usage gates extend existing chain | 8 readiness candidates |
| `packages/application/src/skill-composition.ts` | sole Skill Graph composition planner | fixed/slot exact resolution implemented | 9 plan input |
| `packages/application/src/ports.ts` | V1.1 MCP Task readiness/continuation ports plus mock Skill readiness projection | no copied Provider state; mapping frozen by ADR-102 | 8 real adapter |
| `packages/application/src/mcp-task-readiness.ts` | final V1.1 planning/pre-invocation readiness authority | unchanged and reused | 8/10 adapter and pre-call guard |
| `packages/domain/src/workflow-continuation.ts` and V1.1 remote Task modules | persisted frontier, binding, input, cancellation and Provider terminal authority | unchanged and reused | 10 execution wiring |
| `packages/application/src/workflow-planner.ts` / validator | sole plan generation and DSL policy authority | unchanged | 9 three-mode compliance |
| `packages/langgraph-runtime/src/workflow-compiler.ts` | sole Workflow runtime/compiler | unchanged; no procedure runtime added | 10 minimal IR compilation |
| PostgreSQL migrations/repositories | system of record through 0104 | 0105 usage/import and 0106 execution record allocated | 7 and 11 |
| Management API/OpenAPI/Console | trusted-intranet operational product | unchanged in Phase 6 | 7/11 additive surfaces |
| `schemas/` and `skills/` | reviewed import artifacts | package contract/examples implemented; never live authority | 7 import API |

The map admits no parallel Skill Registry, capability graph, Provider registry, remote Task state machine,
Workflow runtime, queue/retry path or telemetry platform.
