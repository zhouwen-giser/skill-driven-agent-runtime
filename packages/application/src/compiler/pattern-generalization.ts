import { createHash } from 'node:crypto';

import {
  PATTERN_FUSION_VERSION,
  PATTERN_GENERALIZER_VERSION,
  createFusedPattern,
  createGeneralizedPattern,
  type ApplicabilityCandidate,
  type FusedPattern,
  type GeneralizedPattern,
  type GeneralizedVariable,
  type Invariant,
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
  readonly modelId = 'sdar-no-op-semantic-model/1.1';
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
  readonly model?: SemanticModelPort;
}

export class PatternFusionService {
  async fuse(input: PatternFusionInput): Promise<FusedPattern> {
    const { workflowPattern, discoveredPattern } = input;
    const structuralPattern: StructuralPattern = Object.freeze({
      taskTypeId: workflowPattern.taskTypeId,
      activityPatterns: workflowPattern.activityPatterns,
      dependencyPatterns: workflowPattern.dependencyPatterns,
      recoveryPatterns: workflowPattern.recoveryPatterns,
      quality: workflowPattern.quality,
    });

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
      [workflowPattern.workflowPatternId, discoveredPattern.patternId, PATTERN_FUSION_VERSION].join(
        ':',
      ),
    );

    const envelope: Omit<FusedPattern, 'contentHash'> = {
      fusedPatternId,
      sourceWorkflowPatternRef: workflowPattern.workflowPatternId,
      sourceProcessPatternRef: discoveredPattern.patternId,
      sourceTraceRefs: workflowPattern.sourceTraceRefs,
      structuralPattern,
      semanticCandidate,
      applicabilityCandidate,
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
  const supportWeight = quality.support;
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
    const variables = extractVariables(structuralPattern);
    const invariants = extractInvariants(structuralPattern, fusedPattern.contradictionRefs);
    const requiredConditions = extractRequiredConditions(fusedPattern);
    const forbiddenConditions = extractForbiddenConditions(fusedPattern);

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

function extractVariables(pattern: StructuralPattern): readonly GeneralizedVariable[] {
  const variables: GeneralizedVariable[] = [];
  for (const activity of pattern.activityPatterns) {
    variables.push({
      variableName: `activity_${activity.activity}`,
      sourceField: `activity:${activity.activity}`,
      domainClass: 'activity_reference',
      required: activity.required,
    });
  }
  return Object.freeze(variables);
}

function extractInvariants(
  pattern: StructuralPattern,
  contradictionRefs: readonly string[],
): readonly Invariant[] {
  const invariants: Invariant[] = [];
  for (const dep of pattern.dependencyPatterns) {
    if (dep.relation === 'direct_follows' || dep.relation === 'precedes') {
      invariants.push({
        invariantId: `invariant_order_${dep.predecessorActivity}_${dep.successorActivity}`,
        description: `${dep.predecessorActivity} must precede ${dep.successorActivity}`,
        condition: {
          type: 'atomic' as const,
          field: `order.${dep.predecessorActivity}.${dep.successorActivity}`,
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
        field: `activity.${a.activity}.present`,
        operator: 'eq' as const,
        value: true,
      })),
  );
}

function extractForbiddenConditions(fusedPattern: FusedPattern): readonly Invariant['condition'][] {
  return Object.freeze(
    fusedPattern.contradictionRefs.map((ref) => ({
      type: 'atomic' as const,
      field: `contradiction.${ref}`,
      operator: 'neq' as const,
      value: false,
    })),
  );
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
      retainedExampleRefs: [...input.retainedExampleRefs].sort(),
      counterexampleRefs: [...input.counterexampleRefs].sort(),
      sourceFusedPatternRef: input.sourceFusedPatternRef,
      generalizerVersion: input.generalizerVersion,
    }),
  );
}
