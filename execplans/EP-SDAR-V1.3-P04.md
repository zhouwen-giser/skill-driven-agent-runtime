# EP-SDAR-V1.3-P04 — Pattern Generalization and Plan Template Candidate Compiler

Status: ACTIVE

Branch: `feature/v1.3-sequential-implementation`

## Purpose / Outcome

Implement P04/G07-G08 so P03 `WorkflowPattern` outputs are fused with v1.2.3 Task Type/Capability/Goal/Outcome facts and optional LLM semantic candidates, generalized into `GeneralizedPattern` (variables/invariants/conditions), then compiled into non-executable `CompiledArtifact` candidates with `status=candidate` and `executable=false`. The product focus is `plan_template` candidates with a complete Skill Goal DAG, parameter schema, completion contract, recovery branches and static validation. No replay, approval, activation, runtime, gateway or Skill/MCP binding is produced.

## Requirements Covered

- AC-P04-001: P00 READY_FULL, P01/P02/P03 Handoff validated.
- AC-P04-002–008: FusedPattern schema, P03 facts not overwritten, GeneralizedPattern variable/invariant separation, required/forbidden conditions, no single-device/globalization, contradiction/counterexample preserved, model output structured/auditable/no-op.
- AC-P04-009–013: Candidate status=candidate, executable=false, stable fingerprint, duplicate rejection, complete lineage.
- AC-P04-014–022: Plan Template Candidate schema, step classification, capability-only binding, no exact Skill/Provider/MCP, criterion coverage, acyclic DAG, bounded optional/parallel/conditional, parameter source/trust, no model-defaulted Goal/Scope/Criterion/Auth.
- AC-P04-023–025: Completion contract template, evidence/artifact requirements, recovery no side-effect replay.
- AC-P04-026–027: Static validator rejects非法 candidate, passed_static != promotion.
- AC-P04-028–030: Candidate persistence reuses P02 authority, worker idempotent/replayable/isolated, Redis recovery.
- AC-P04-031–033: No replay/shadow/promotion, no runtime/gateway, no formal Goal/Plan/Attempt.
- AC-P04-034–038: Full verify, G07/G08 commits+evidence, independent review, Draft PR, P05 Handoff.

## Architecture and Interfaces

- Domain layer (`packages/domain/src/compiler/artifact-candidate-generation.ts`): frozen 1.1 contracts `FusedPattern`, `GeneralizedPattern`, `CandidateStaticValidationResult` with nested value types (`StructuralPattern`, `SemanticPatternCandidate`, `ApplicabilityCandidate`, `GeneralizedVariable`, `Invariant`, `ValidationIssue`), strict factories and schema hashes matching `CONTRACT-LOCK.json`.
- Application layer (`packages/application/src/compiler/`):
  - `pattern-fusion.ts` — `PatternFusionService`: fuses P03 structural pattern + v1.2.3 facts + LLM semantic candidate into `FusedPattern`. Structural facts are never overwritten by LLM output.
  - `pattern-generalization.ts` — `PatternGeneralizationService`: abstracts instance fields into variables/invariants/conditions. No single-device globalization, no user-preference cross-user, no temporary-auth hardening, no one-success universal pattern, no failure-boundary deletion.
  - `candidate-generator.ts` — `ArtifactCandidateGenerator`: unified framework mapping WorkflowPattern → Plan Template Candidate, Condition Pattern → Decision Rule skeleton, etc. Only `plan_template` is fully implemented; others are framework-only.
  - `plan-template-compiler.ts` — `PlanTemplateCompiler`: step classification, capability mapping, Skill Goal DAG, parameter extraction, completion contract, recovery branches.
  - `candidate-static-validator.ts` — `CandidateStaticValidator`: schema/DAG/required/criterion/capability/parameter/replay/bounds/duplicate validation. `passed_static` != promotion.
  - `candidate-fingerprint.ts` — stable fingerprint for duplicate detection.
- Persistence (`packages/persistence-postgres/src/compiler/candidate-generation-repositories.ts`): PostgreSQL repositories for FusedPattern, GeneralizedPattern, candidate validation, generation runs, model invocations, fingerprints. Candidate persistence reuses P02 `ArtifactRepository.saveCandidate`.
- Runtime Redis (`packages/runtime-redis/src/compiler/candidate-generation-workers.ts`): BullMQ wake-only worker for `sdar-compiler-pattern-generalization` and `sdar-compiler-artifact-generation` queues.
- Migration `0127_v13_artifact_candidate_generation`: adds `generalized_pattern`, `artifact_candidate_detail`, `plan_template_candidate_detail`, `candidate_static_validation`, `candidate_generation_run`, `candidate_model_invocation`, `candidate_fingerprint` tables as non-authoritative children with FKs to `compiled_artifact`/`pattern_candidate`.
- Server composition: `apps/server/src/runtime.ts` composes the trigger dispatcher, workers and reconcilers alongside P03.

## Decisions

- D1: P04 reuses P01 `PlanTemplateArtifactDefinition` as the `definition` payload of `CompiledArtifact` candidates. No second definition type.
- D2: `FusedPattern.structuralPattern` is a read-only projection of P03 `WorkflowPattern` fields; it is never mutated by the LLM. `semanticCandidate` is always advisory.
- D3: Candidate `executable` is a domain invariant enforced by the factory (`createCompiledArtifact` with `status='candidate'`); no runtime field is added.
- D4: Static validation `result='passed_static'` is explicitly not a validation pass, approval or promotion signal; it is recorded as evidence only.
- D5: Model invocations are bounded, schema-validated, source-attributed, no-op-on-failure, audited and never persist private chain-of-thought.
- D6: The generation worker is single-concurrency for the generalization queue (`sdar-compiler-pattern-generalization`) to avoid event-loop pressure, matching the P03 mining pattern.

## Progress

- [x] 2026-07-28 Read complete P04 package (CODEX-GOAL-PROMPT, MASTER-GOAL, SCOPE, ACCEPTANCE, IMPLEMENTATION, DOMAIN-CONTRACT, DEPENDENCY, CONTRACT-LOCK, FROZEN-INTERFACE-CONTRACT, EVIDENCE, TEST-PLAN, EXECUTION-POLICY, HANDOFF, START-EXECUTION-CHECKLIST, CONTRACT-ALIGNMENT, PACKAGE-CONSISTENCY-REVIEW).
- [x] 2026-07-28 Read P03 Handoff, P02 artifact-persistence interfaces, P01 domain contracts, migration head (0126), architecture baseline.
- [x] 2026-07-28 Confirm no existing P04 code; P01 `PlanTemplateArtifactDefinition`/`SkillGoalNodeTemplate`/`CompiledArtifact` types already in domain layer.
