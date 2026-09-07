# v1.2 Skill Usage Repository Map

| Area | Existing authority | v1.2 additive role | First phase |
| --- | --- | --- | --- |
| `packages/domain/src/skill.ts` | `SkillVersion`, lifecycle, Tool/runtime policy | optional immutable usage snapshot and legacy projection hook | 1 |
| `packages/domain/src/skill-graph.ts` | exact-version graph snapshot, generic depth 8 | usage composition view with independent default 3/hard 5 | 5 |
| `packages/domain/src/skill-selection.ts` | candidate/selection evidence | usage summary, applicability and mode evidence | 3A/4 |
| `packages/application/src/skill-registry.ts` | sole Skill catalog/version service | validate/import/read/diff usage summary | 3A/7 |
| `packages/application/src/skill-selection.ts` | semantic candidates and model choice | deterministic applicability/context/mode gates | 4 |
| `packages/application/src/skill-composition.ts` | sole Skill Graph planner | fixed dependency, slot and failure-policy resolution | 5 |
| `packages/application/src/workflow-planner.ts` | existing plan generation/repair | bounded guidance/template/procedure planning input | 9 |
| `packages/application/src/workflow-validator.ts` | existing DSL/policy validation | v1.2 plan compliance integration | 9 |
| `packages/application/src/skill-call-workflow.ts` | child Workflow and lineage | exact Skill execution stack and shared usage budget | 10 |
| `packages/langgraph-runtime/src/workflow-compiler.ts` | sole runtime and v1.1 continuation | minimal execution-record hooks only; no new runtime | 10–11 |
| v1.1 readiness services | Provider availability/timing authority adapter | read-only Skill Task binding candidate summaries | 8 |
| v1.1 remote Task services | binding/wait/input/cancel/reconcile authority | execution-record references only | 10–13 |
| PostgreSQL repositories/migrations | runtime system of record through 0104 | usage version/import and execution/evidence tables | 7/11 |
| Management API/OpenAPI/Console | trusted-intranet operations surface | real usage package and execution tree projections | 7/11 |
| `skills/` and `schemas/` | reviewed distribution artifacts | move-to/area-patrol packages and package JSON Schema | 2/3B |

No parallel Skill Registry, Workflow Runtime, Provider registry, continuation state machine or telemetry
platform is admitted by this map.
