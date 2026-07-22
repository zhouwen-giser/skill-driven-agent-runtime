# Requirements and Goal Traceability

| Goal | Requirement/Design scope | Acceptance IDs | Main artifacts |
|---|---|---|---|
| G00 | 需求冻结、ADR 与 Domain Skeleton | AC-G00-01, AC-G00-02, AC-G00-03, AC-G00-04, AC-G00-05 | `docs/execplans/EP-SDAR-V1.2.3.md; docs/adr/ADR-V123-*.md; packages/domain/src/cognitive/index.ts` |
| G01 | Runtime Capability Summary Builder | AC-G01-01, AC-G01-02, AC-G01-03, AC-G01-04, AC-G01-05, AC-G01-06 | `packages/domain/src/cognitive/capability.ts; packages/application/src/cognitive/capability-summary-builder.ts; packages/application/src/cognitive/capability-index-builder.ts` |
| G02 | Public Capability Card 与 A2A Projection | AC-G02-01, AC-G02-02, AC-G02-03, AC-G02-04, AC-G02-05, AC-G02-06 | `packages/domain/src/cognitive/capability-card.ts; packages/application/src/cognitive/capability-card-publisher.ts; packages/a2a-adapter/src/capability-card-projection.ts` |
| G03 | Generic Task Understanding | AC-G03-01, AC-G03-02, AC-G03-03, AC-G03-04, AC-G03-05, AC-G03-06 | `packages/domain/src/cognitive/task-understanding.ts; packages/application/src/cognitive/cognitive-entry-router.ts; packages/application/src/cognitive/generic-task-understanding-service.ts` |
| G04 | Interactive Goal Session | AC-G04-01, AC-G04-02, AC-G04-03, AC-G04-04, AC-G04-05, AC-G04-06 | `packages/domain/src/cognitive/interactive-goal.ts; packages/application/src/cognitive/missing-dimension-question-service.ts; packages/application/src/cognitive/interactive-goal-session-service.ts` |
| G05 | Interactive Planning Session 与 Plan Patch Compiler | AC-G05-01, AC-G05-02, AC-G05-03, AC-G05-04, AC-G05-05, AC-G05-06, AC-G05-07 | `packages/domain/src/cognitive/interactive-planning.ts; packages/application/src/cognitive/interactive-planning-session-service.ts; packages/application/src/cognitive/interactive-plan-patch-service.ts` |
| G06 | Planning Correction Facts 与 Interaction Episode | AC-G06-01, AC-G06-02, AC-G06-03, AC-G06-04, AC-G06-05, AC-G06-06 | `packages/domain/src/cognitive/planning-correction.ts; packages/application/src/cognitive/planning-correction-service.ts; packages/application/src/cognitive/planning-interaction-episode-builder.ts` |
| G07 | Experience Outbox、Job 与 Goal Episode | AC-G07-01, AC-G07-02, AC-G07-03, AC-G07-04, AC-G07-05, AC-G07-06, AC-G07-07 | `packages/domain/src/cognitive/experience.ts; packages/application/src/cognitive/goal-experience-episode-builder.ts; packages/application/src/cognitive/experience-job-service.ts` |
| G08 | Experience Observer 与 Typed Extractors | AC-G08-01, AC-G08-02, AC-G08-03, AC-G08-04, AC-G08-05, AC-G08-06, AC-G08-07 | `packages/domain/src/cognitive/observation.ts; packages/application/src/cognitive/experience-observer-service.ts; packages/application/src/cognitive/experience-extractor-pipeline.ts` |
| G09 | Experience Reflector、Identity 与 Knowledge Curator | AC-G09-01, AC-G09-02, AC-G09-03, AC-G09-04, AC-G09-05, AC-G09-06, AC-G09-07 | `packages/domain/src/cognitive/knowledge-delta.ts; packages/application/src/cognitive/experience-reflector-service.ts; packages/application/src/cognitive/knowledge-identity-service.ts` |
| G10 | Task Type Induction | AC-G10-01, AC-G10-02, AC-G10-03, AC-G10-04, AC-G10-05, AC-G10-06 | `packages/domain/src/cognitive/task-type.ts; packages/application/src/cognitive/task-type-induction-service.ts; packages/application/src/cognitive/task-type-fingerprint.ts` |
| G11 | Capability Pattern Induction 与 Gap Candidate | AC-G11-01, AC-G11-02, AC-G11-03, AC-G11-04, AC-G11-05, AC-G11-06 | `packages/domain/src/cognitive/capability-pattern.ts; packages/application/src/cognitive/capability-pattern-induction-service.ts; packages/application/src/cognitive/capability-gap-service.ts` |
| G12 | Knowledge Promotion Framework | AC-G12-01, AC-G12-02, AC-G12-03, AC-G12-04, AC-G12-05, AC-G12-06, AC-G12-07 | `packages/domain/src/cognitive/promotion.ts; packages/application/src/cognitive/knowledge-promotion-service.ts; packages/application/src/cognitive/promotion-targets/*.ts` |
| G13 | Planning Knowledge Retrieval 与 Progressive Disclosure | AC-G13-01, AC-G13-02, AC-G13-03, AC-G13-04, AC-G13-05, AC-G13-06, AC-G13-07 | `packages/domain/src/cognitive/knowledge-usage.ts; packages/application/src/cognitive/planning-knowledge-retriever.ts; packages/application/src/cognitive/rrf-ranker.ts` |
| G14 | Experience-enriched Planning 与 Fallback | AC-G14-01, AC-G14-02, AC-G14-03, AC-G14-04, AC-G14-05, AC-G14-06 | `packages/application/src/cognitive/experience-enriched-planner.ts; packages/application/src/cognitive/planning-experience-context-builder.ts; packages/persistence-postgres/src/cognitive/experience-usage-repository.ts` |
| G15 | Management API、Console 与 A2A 全面集成 | AC-G15-01, AC-G15-02, AC-G15-03, AC-G15-04, AC-G15-05, AC-G15-06 | `packages/management-api/src/cognitive/*.ts; packages/a2a-adapter/src/cognitive-interaction-router.ts; apps/console/src/**/task-understanding/**` |
| G16 | Evaluation、Replay 与 Shadow Harness | AC-G16-01, AC-G16-02, AC-G16-03, AC-G16-04, AC-G16-05, AC-G16-06, AC-G16-07 | `tests/replay/cognitive/**; packages/application/src/cognitive/shadow-planning-service.ts; scripts/run-cognitive-replay.mjs` |
| G17 | Hardening、灰度与 Release | AC-G17-01, AC-G17-02, AC-G17-03, AC-G17-04, AC-G17-05, AC-G17-06, AC-G17-07, AC-G17-08, AC-G17-09 | `scripts/verify-v123.mjs; scripts/reset-v123-database.mjs; scripts/check-v123-acceptance.mjs` |

## Source-derived constraints

- Upgrade Requirements V0.1 is the normative requirement input.
- Overall Design V1.0 defines runtime planes, state machines, tables, queues, APIs and authority.
- Detailed Implementation Plan V1.0 defines G00～G17 scope and estimates.
- Open-source Reuse Assessment V1.0 defines allowed reuse and license constraints.
- If implementation discovers conflict between source documents, Frozen Decisions and the latest approved ADR govern; record the conflict rather than silently choosing.
