import { createHash } from 'node:crypto';

import {
  PATTERN_FUSION_VERSION,
  PATTERN_GENERALIZER_VERSION,
  createFusedPattern,
  createGeneralizedPattern,
  type ApplicabilityCandidate,
  type FusedPattern,
  type GeneralizedPattern,
  type GeneralizedFailureBoundary,
  type GeneralizedVariable,
  type Invariant,
  type PatternScopeEvidence,
  type SemanticPatternCandidate,
  type StructuralPattern,
} from '../../../domain/src/index.js';
import type { DiscoveredProcessPattern, WorkflowPattern } from '../../../domain/src/index.js';

// ---------------------------------------------------------------------------
// Model port (LLM boundary)
// ---------------------------------------------------------------------------

export interface SemanticModelPort {
  readonly modelId: string;
  readonly promptHash: string;
  suggestSemanticCandidates(
    input: Readonly<{
      readonly workflowPattern: WorkflowPattern;
      readonly discoveredPattern: DiscoveredProcessPattern;
      readonly taskTypeId: string;
    }>,
  ): Promise<SemanticPatternCandidate>;
}

export class NoOpSemanticModel implements SemanticModelPort {
  readonly modelId = 'sdar-no-op-semantic-model/1.2';
  readonly promptHash = '0000000000000000000000000000000000000000000000000000000000000000';

  suggestSemanticCandidates(): Promise<SemanticPatternCandidate> {
    return Promise.resolve(
      Object.freeze({
        activityNames: {},
        parameterCandidates: [],
        capabilityMappings: [],
        negativeExamples: [],
        explanation: 'no-op semantic model: no LLM invoked',
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Pattern Fusion
// ---------------------------------------------------------------------------

export interface PatternFusionInput {
  readonly workflowPattern: WorkflowPattern;
  readonly discoveredPattern: DiscoveredProcessPattern;
  readonly domain: string;
  readonly tenantId: string;
  readonly environmentClasses: readonly string[];
  readonly deviceClasses: readonly string[];
  readonly tenantScope: 'single' | 'multi';
  readonly userScope: 'single' | 'multi';
  readonly scopeEvidence: PatternScopeEvidence;
  readonly model?: SemanticModelPort;
}

export class PatternFusionService {
  async fuse(input: PatternFusionInput): Promise<FusedPattern> {
    const { workflowPattern, discoveredPattern } = input;
    const structuralPattern: StructuralPattern = workflowPattern;

    const model = input.model ?? new NoOpSemanticModel();
    const semanticCandidate = await model.suggestSemanticCandidates({
      workflowPattern,
      discoveredPattern,
      taskTypeId: workflowPattern.taskTypeId,
    });

    const applicabilityCandidate: ApplicabilityCandidate = Object.freeze({
      domain: input.domain,
      taskTypeId: workflowPattern.taskTypeId,
      environmentClasses: input.environmentClasses,
      deviceClasses: input.deviceClasses,
      tenantScope: input.tenantScope,
      userScope: input.userScope,
    });

    const confidence = computeConfidence(workflowPattern.quality);

    const fusedPatternId = stableId(
      'fused-pattern',
      [
        workflowPattern.workflowPatternId,
        discoveredPattern.patternId,
        input.domain,
        PATTERN_FUSION_VERSION,
      ].join(':'),
    );

    const envelope: Omit<FusedPattern, 'contentHash'> = {
      fusedPatternId,
      sourceWorkflowPatternRef: workflowPattern.workflowPatternId,
      sourceProcessPatternRef: discoveredPattern.patternId,
      sourceTraceRefs: workflowPattern.sourceTraceRefs,
      structuralPattern,
      semanticCandidate,
      applicabilityCandidate,
      scopeEvidence: input.scopeEvidence,
      supportRefs: discoveredPattern.supportRefs,
      contradictionRefs: discoveredPattern.contradictionRefs,
      confidence,
      fusionVersion: PATTERN_FUSION_VERSION,
    };

    return createFusedPattern({
      ...envelope,
      contentHash: fusedPatternContentHash(envelope),
    });
  }
}

function computeConfidence(quality: WorkflowPattern['quality']): number {
  const supportWeight = quality.supportRate;
  const successWeight = quality.successRate;
  const coverageWeight = quality.traceCoverage;
  const contradictionPenalty = quality.contradictionRate;
  const raw =
    supportWeight * 0.3 + successWeight * 0.3 + coverageWeight * 0.3 - contradictionPenalty * 0.1;
  return Math.max(0, Math.min(1, raw));
}

// ---------------------------------------------------------------------------
// Pattern Generalization
// ---------------------------------------------------------------------------

export interface GeneralizationInput {
  readonly fusedPattern: FusedPattern;
  readonly knownTaskTypeCapabilities: readonly string[];
}

export class PatternGeneralizationService {
  generalize(input: GeneralizationInput): GeneralizedPattern {
    const { fusedPattern } = input;
    const { structuralPattern } = fusedPattern;
    assertGeneralizationSafety(fusedPattern);
    assertCapabilityAlignment(fusedPattern, input.knownTaskTypeCapabilities);
    const variables = extractVariables(fusedPattern.semanticCandidate);
    const invariants = extractInvariants(structuralPattern, fusedPattern.contradictionRefs);
    const requiredConditions = extractRequiredConditions(fusedPattern);
    const forbiddenConditions = extractForbiddenConditions(fusedPattern);
    const applicabilityPredicates = extractApplicabilityPredicates(fusedPattern);
    const failureBoundaries = extractFailureBoundaries(structuralPattern);

    const generalizedPatternId = stableId(
      'generalized-pattern',
      [fusedPattern.fusedPatternId, PATTERN_GENERALIZER_VERSION].join(':'),
    );

    const envelope: Omit<GeneralizedPattern, 'contentHash'> = {
      generalizedPatternId,
      domain: fusedPattern.applicabilityCandidate.domain,
      taskTypeId: structuralPattern.taskTypeId,
      variables,
      invariants,
      requiredConditions,
      forbiddenConditions,
      applicabilityPredicates,
      failureBoundaries,
      retainedExampleRefs: fusedPattern.supportRefs,
      counterexampleRefs: fusedPattern.contradictionRefs,
      sourceFusedPatternRef: fusedPattern.fusedPatternId,
      generalizerVersion: PATTERN_GENERALIZER_VERSION,
    };

    return createGeneralizedPattern({
      ...envelope,
      contentHash: generalizedPatternContentHash(envelope),
    });
  }
}

function extractVariables(semantic: SemanticPatternCandidate): readonly GeneralizedVariable[] {
  return Object.freeze(
    semantic.parameterCandidates.map((candidate) => {
      const allowedSources = candidate.allowedSources ?? (['request'] as const);
      const trustLevel = candidate.trustLevel ?? 'candidate';
      if (allowedSources.length === 0) {
        throw new Error(`GENERALIZATION_PARAMETER_SOURCE_MISSING:${candidate.parameterName}`);
      }
      if (trustLevel === 'authoritative' && allowedSources.includes('small_model_candidate')) {
        throw new Error(`GENERALIZATION_PARAMETER_TRUST_INVALID:${candidate.parameterName}`);
      }
      const defaultPolicy = candidate.defaultPolicy ?? 'none';
      const schema = isRecord(candidate.suggestedSchema)
        ? Object.freeze({
            ...candidate.suggestedSchema,
            'x-sdar-defaultPolicy': defaultPolicy,
          })
        : Object.freeze({
            const: candidate.suggestedSchema,
            'x-sdar-defaultPolicy': defaultPolicy,
          });
      return Object.freeze({
        variableName: candidate.parameterName,
        sourceField: candidate.sourceField ?? `request.${candidate.parameterName}`,
        domainClass: candidate.domainClass ?? 'request_parameter',
        schema,
        allowedSources: Object.freeze([...allowedSources]),
        trustLevel,
        required: candidate.required ?? false,
      });
    }),
  );
}

function extractInvariants(
  pattern: StructuralPattern,
  contradictionRefs: readonly string[],
): readonly Invariant[] {
  const invariants: Invariant[] = [];
  for (const dep of pattern.dependencyPatterns) {
    if (dep.relation === 'direct_follows' || dep.relation === 'precedes') {
      invariants.push({
        invariantId: `invariant_order_${dep.predecessorActivityKey}_${dep.successorActivityKey}`,
        description: `${dep.predecessorActivityKey} must precede ${dep.successorActivityKey}`,
        condition: {
          type: 'atomic' as const,
          field: `order.${dep.predecessorActivityKey}.${dep.successorActivityKey}`,
          operator: 'eq' as const,
          value: true,
        },
      });
    }
  }
  if (contradictionRefs.length > 0) {
    invariants.push({
      invariantId: 'invariant_contradiction_preserved',
      description: 'Contradiction evidence must be retained and not averaged',
      condition: {
        type: 'atomic' as const,
        field: 'contradiction.retained',
        operator: 'eq' as const,
        value: true,
      },
    });
  }
  return Object.freeze(invariants);
}

function extractRequiredConditions(fusedPattern: FusedPattern): readonly Invariant['condition'][] {
  return Object.freeze(
    fusedPattern.structuralPattern.activityPatterns
      .filter((a) => a.required)
      .map((a) => ({
        type: 'atomic' as const,
        field: `activity.${a.activityKey}.present`,
        operator: 'eq' as const,
        value: true,
      })),
  );
}

function extractApplicabilityPredicates(
  fusedPattern: FusedPattern,
): GeneralizedPattern['applicabilityPredicates'] {
  const predicates: GeneralizedPattern['applicabilityPredicates'][number][] = [];
  if (fusedPattern.applicabilityCandidate.environmentClasses.length > 0) {
    predicates.push({
      field: 'environment.class',
      operator: 'in',
      value: [...fusedPattern.applicabilityCandidate.environmentClasses],
    });
  }
  if (fusedPattern.applicabilityCandidate.deviceClasses.length > 0) {
    predicates.push({
      field: 'device.class',
      operator: 'in',
      value: [...fusedPattern.applicabilityCandidate.deviceClasses],
    });
  }
  return Object.freeze(predicates);
}

function extractFailureBoundaries(
  structuralPattern: StructuralPattern,
): readonly GeneralizedFailureBoundary[] {
  return Object.freeze(
    structuralPattern.recoveryPatterns.map((recovery) =>
      Object.freeze({
        triggerActivityKey: recovery.triggerActivityKey,
        ...(recovery.resumeActivityKey === undefined
          ? {}
          : { resumeActivityKey: recovery.resumeActivityKey }),
        activitySequence: recovery.activitySequence,
        requiredCapabilityRefs: recovery.requiredCapabilityRefs,
      }),
    ),
  );
}

function assertGeneralizationSafety(fusedPattern: FusedPattern): void {
  const scope = fusedPattern.scopeEvidence;
  if (fusedPattern.applicabilityCandidate.deviceClasses.length > 0 && scope.deviceClassCount < 2) {
    throw new Error('GENERALIZATION_SINGLE_DEVICE_REJECTED');
  }
  if (
    fusedPattern.applicabilityCandidate.environmentClasses.length > 0 &&
    scope.environmentClassCount < 2
  ) {
    throw new Error('GENERALIZATION_SINGLE_ENVIRONMENT_REJECTED');
  }
  if (fusedPattern.applicabilityCandidate.userScope === 'multi' && scope.userCount < 2) {
    throw new Error('GENERALIZATION_SINGLE_USER_PREFERENCE_REJECTED');
  }
  if (scope.hasTemporaryAuthorization) {
    throw new Error('GENERALIZATION_TEMPORARY_AUTHORIZATION_REJECTED');
  }
  if (scope.successCount === 1 && scope.failureCount === 0 && !scope.hasFailureBoundary) {
    throw new Error('GENERALIZATION_SINGLE_SUCCESS_REJECTED');
  }
  if (scope.hasFailureBoundary && fusedPattern.structuralPattern.recoveryPatterns.length === 0) {
    throw new Error('GENERALIZATION_FAILURE_BOUNDARY_LOST');
  }
}

function assertCapabilityAlignment(
  fusedPattern: FusedPattern,
  knownTaskTypeCapabilities: readonly string[],
): void {
  const catalog = new Set(knownTaskTypeCapabilities);
  const required = new Set([
    ...fusedPattern.structuralPattern.activityPatterns.flatMap(
      (activity) => activity.capabilityRefs,
    ),
    ...fusedPattern.semanticCandidate.capabilityMappings.map((mapping) => mapping.capabilityId),
    ...fusedPattern.structuralPattern.recoveryPatterns.flatMap(
      (recovery) => recovery.requiredCapabilityRefs,
    ),
  ]);
  const missing = [...required].filter((capabilityId) => !catalog.has(capabilityId)).sort();
  if (missing.length > 0) {
    throw new Error(`GENERALIZATION_CAPABILITY_CATALOG_MISMATCH:${missing.join(',')}`);
  }
}

function extractForbiddenConditions(fusedPattern: FusedPattern): readonly Invariant['condition'][] {
  void fusedPattern;
  // Contradiction references are evidence/lineage, not runtime context fields.
  // Runtime applicability may only contain predicates the gateway can evaluate.
  return Object.freeze([]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)}`;
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fusedPatternContentHash(input: Readonly<Omit<FusedPattern, 'contentHash'>>): string {
  return digest(
    canonicalJson({
      fusedPatternId: input.fusedPatternId,
      sourceWorkflowPatternRef: input.sourceWorkflowPatternRef,
      sourceProcessPatternRef: input.sourceProcessPatternRef,
      sourceTraceRefs: [...input.sourceTraceRefs].sort(),
      structuralPattern: input.structuralPattern,
      semanticCandidate: input.semanticCandidate,
      applicabilityCandidate: input.applicabilityCandidate,
      scopeEvidence: input.scopeEvidence,
      supportRefs: [...input.supportRefs].sort(),
      contradictionRefs: [...input.contradictionRefs].sort(),
      confidence: input.confidence,
      fusionVersion: input.fusionVersion,
    }),
  );
}

function generalizedPatternContentHash(
  input: Readonly<Omit<GeneralizedPattern, 'contentHash'>>,
): string {
  return digest(
    canonicalJson({
      generalizedPatternId: input.generalizedPatternId,
      domain: input.domain,
      taskTypeId: input.taskTypeId,
      variables: input.variables,
      invariants: input.invariants,
      requiredConditions: input.requiredConditions,
      forbiddenConditions: input.forbiddenConditions,
      applicabilityPredicates: input.applicabilityPredicates,
      failureBoundaries: input.failureBoundaries,
      retainedExampleRefs: [...input.retainedExampleRefs].sort(),
      counterexampleRefs: [...input.counterexampleRefs].sort(),
      sourceFusedPatternRef: input.sourceFusedPatternRef,
      generalizerVersion: input.generalizerVersion,
    }),
  );
}
