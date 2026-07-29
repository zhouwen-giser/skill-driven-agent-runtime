# ADR-119: Pattern Generalization and Plan Template Candidate Compiler

Status: Accepted (2026-07-28)

## Context

P04 (G07+G08) must fuse P03's structural WorkflowPattern facts with optional LLM semantic
candidates, generalize them into variables/invariants/conditions, and compile evidence-only
Plan Template candidates with `status=candidate`. The candidate must never be executable, must
carry a stable duplicate-detection fingerprint, and must pass static validation that is explicitly
not a promotion signal.

Key tensions:
- LLM semantic suggestions are useful for naming/abstraction but must never overwrite P03
  statistical facts (support, contradiction, ordering).
- Generalization risks overfitting to a single device, user, or transient environment.
- The domain layer must remain free of Node.js runtime dependencies (enforced by
  `check-artifact-architecture.mjs`).

## Decision

1. **Structural fact immutability**: `PatternFusionService` reads P03 structural facts
   (activityPatterns, dependencyPatterns, recoveryPatterns, quality) as read-only projections.
   The `SemanticModelPort` interface allows LLM to suggest activity names, parameter candidates,
   capability mappings, and negative examples only. A `NoOpSemanticModel` default provides a
   zero-LLM path. Contradiction evidence is retained, never averaged.

2. **Anti-overfitting rules** (enforced in `PatternGeneralizationService`):
   - No single-device globalization (requires ≥2 distinct device classes or explicit operator flag)
   - No cross-user preference hardening (user-scoped observations stay advisory)
   - No temporary-auth hardening (transient auth tokens are not invariants)
   - No one-success universal pattern (requires failure evidence or explicit boundary)
   - No failure-boundary deletion (recovery triggers and failure activities are retained)

3. **Candidate fingerprint**: 7-input SHA-256 over (artifactType, domain, taskTypeId,
   generalizedDefinitionHash, applicabilityHash, requiredCapabilityShapeHash, generatorVersion).
   Duplicate fingerprints are rejected by the static validator.

4. **Static validation ≠ promotion**: `CandidateStaticValidator` runs 8 checks (schema, DAG,
   criteria coverage, capability shape, parameter policy, replay safety, bounds, duplicate).
   `passed_static` is a recorded evidence state, not a validation pass, approval, or promotion.

5. **Domain layer purity**: Hash computation (`createHash` from `node:crypto`) is moved from the
   domain layer to the application layer. Domain factories accept `contentHash` as a required
   input field; the application layer computes it before calling the factory. This satisfies the
   `ARCH_ARTIFACT_DOMAIN_IMPORT_FORBIDDEN` architecture gate.

6. **Persistence**: P04 adds 5 non-authoritative child tables (generalized_pattern,
   candidate_fingerprint, candidate_static_validation, candidate_generation_run,
   candidate_model_invocation) via migration 0127. Candidate artifacts themselves are persisted
   through the existing P02 `ArtifactRepository.saveCandidate` to maintain single-authority
   consistency.

## Consequences

- P04 candidates are evidence-only; no replay, approval, activation, gateway, or runtime is
  implemented.
- The wake-only BullMQ worker does not emit events at runtime; `compiler.artifact_candidate_created`
  is declared in the contract but not emitted by the current worker.
- P05 can consume the 3 produced contracts (FusedPattern, GeneralizedPattern,
  CandidateStaticValidationResult) to build replay datasets and execute validation without
  redefining the candidate contract.
