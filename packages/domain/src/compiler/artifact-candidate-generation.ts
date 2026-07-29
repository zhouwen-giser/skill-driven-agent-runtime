import type { WorkflowPattern } from './experience-compilation.js';
import type { ConditionExpression, JsonValue } from './contracts.js';

export const ARTIFACT_CANDIDATE_GENERATION_CONTRACT_VERSION = '1.2' as const;
export const PATTERN_FUSION_VERSION = 'sdar-pattern-fusion/1.2' as const;
export const PATTERN_GENERALIZER_VERSION = 'sdar-pattern-generalizer/1.2' as const;
export const CANDIDATE_GENERATOR_VERSION = 'sdar-candidate-generator/1.2' as const;
export const PLAN_TEMPLATE_COMPILER_VERSION = 'sdar-plan-template-compiler/1.2' as const;
export const CANDIDATE_STATIC_VALIDATOR_VERSION = 'sdar-candidate-static-validator/1.2' as const;

export const ARTIFACT_CANDIDATE_GENERATION_SCHEMA_HASHES = Object.freeze({
  FusedPattern: '1b7ff0b11f3dfea8d54c6eab9850d98983f096cc70c3cf6fe42a731990c5ec11',
  GeneralizedPattern: 'f8fef3280ed65cbd34a836ee1c0785dd1ddd747ef7cd1bd7cb93dc1a1523790a',
  CandidateStaticValidationResult:
    '1dfc155aafc2490dfb33e20efaaea8389f926923a627a6a20e7f2c482cef7edd',
} as const);

// ---------------------------------------------------------------------------
// FusedPattern nested types
// ---------------------------------------------------------------------------

export type StructuralPattern = WorkflowPattern;

export interface SemanticParameterCandidate {
  readonly parameterName: string;
  readonly suggestedSchema: JsonValue;
  readonly sourceField?: string;
  readonly domainClass?: string;
  readonly allowedSources?: readonly (
    'user_confirmed' | 'request' | 'world_state' | 'runtime_context' | 'small_model_candidate'
  )[];
  readonly trustLevel?: 'authoritative' | 'trusted' | 'candidate';
  readonly required?: boolean;
  readonly defaultPolicy?: 'none' | 'low_risk_only';
  readonly confidence: number;
}

export interface SemanticCapabilityMapping {
  readonly sourceActivity: string;
  readonly capabilityId: string;
  readonly confidence: number;
  readonly ambiguity: string;
}

export interface SemanticPatternCandidate {
  readonly activityNames: Readonly<Record<string, string>>;
  readonly parameterCandidates: readonly SemanticParameterCandidate[];
  readonly capabilityMappings: readonly SemanticCapabilityMapping[];
  readonly negativeExamples: readonly string[];
  readonly explanation: string;
  readonly modelInvocationRef?: string;
}

export interface ApplicabilityCandidate {
  readonly domain: string;
  readonly taskTypeId: string;
  readonly environmentClasses: readonly string[];
  readonly deviceClasses: readonly string[];
  readonly tenantScope: 'single' | 'multi';
  readonly userScope: 'single' | 'multi';
}

export interface PatternScopeEvidence {
  readonly tenantCount: number;
  readonly userCount: number;
  readonly deviceClassCount: number;
  readonly environmentClassCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly hasTemporaryAuthorization: boolean;
  readonly hasFailureBoundary: boolean;
}

// ---------------------------------------------------------------------------
// FusedPattern
// ---------------------------------------------------------------------------

export interface FusedPattern {
  readonly fusedPatternId: string;
  readonly sourceWorkflowPatternRef: string;
  readonly sourceProcessPatternRef: string;
  readonly sourceTraceRefs: readonly string[];
  readonly structuralPattern: StructuralPattern;
  readonly semanticCandidate: SemanticPatternCandidate;
  readonly applicabilityCandidate: ApplicabilityCandidate;
  readonly scopeEvidence: PatternScopeEvidence;
  readonly supportRefs: readonly string[];
  readonly contradictionRefs: readonly string[];
  readonly confidence: number;
  readonly fusionVersion: string;
  readonly contentHash: string;
}

// ---------------------------------------------------------------------------
// GeneralizedPattern nested types
// ---------------------------------------------------------------------------

export interface GeneralizedVariable {
  readonly variableName: string;
  readonly sourceField: string;
  readonly domainClass: string;
  readonly schema: JsonValue;
  readonly allowedSources: readonly (
    'user_confirmed' | 'request' | 'world_state' | 'runtime_context' | 'small_model_candidate'
  )[];
  readonly trustLevel: 'authoritative' | 'trusted' | 'candidate';
  readonly required: boolean;
}

export interface Invariant {
  readonly invariantId: string;
  readonly description: string;
  readonly condition: ConditionExpression;
}

export interface ApplicabilityPredicate {
  readonly field: string;
  readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';
  readonly value?: JsonValue;
}

export interface GeneralizedFailureBoundary {
  readonly triggerActivityKey: string;
  readonly resumeActivityKey?: string;
  readonly activitySequence: readonly string[];
  readonly requiredCapabilityRefs: readonly string[];
}

// ---------------------------------------------------------------------------
// GeneralizedPattern
// ---------------------------------------------------------------------------

export interface GeneralizedPattern {
  readonly generalizedPatternId: string;
  readonly domain: string;
  readonly taskTypeId: string;
  readonly variables: readonly GeneralizedVariable[];
  readonly invariants: readonly Invariant[];
  readonly requiredConditions: readonly ConditionExpression[];
  readonly forbiddenConditions: readonly ConditionExpression[];
  readonly applicabilityPredicates: readonly ApplicabilityPredicate[];
  readonly failureBoundaries: readonly GeneralizedFailureBoundary[];
  readonly retainedExampleRefs: readonly string[];
  readonly counterexampleRefs: readonly string[];
  readonly sourceFusedPatternRef: string;
  readonly generalizerVersion: string;
  readonly contentHash: string;
}

// ---------------------------------------------------------------------------
// CandidateStaticValidationResult
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface CandidateStaticValidationResult {
  readonly artifactRef: string;
  readonly schemaValid: boolean;
  readonly activityIdentityValid: boolean;
  readonly dagValid: boolean;
  readonly parallelSemanticsValid: boolean;
  readonly requiredCriteriaCovered: boolean;
  readonly capabilityShapeValid: boolean;
  readonly capabilityCatalogAligned: boolean;
  readonly parameterPolicyValid: boolean;
  readonly parameterSchemaAligned: boolean;
  readonly applicabilityEvaluable: boolean;
  readonly lineageComplete: boolean;
  readonly recoverySemanticsValid: boolean;
  readonly sideEffectReplaySafe: boolean;
  readonly boundsValid: boolean;
  readonly duplicateFingerprint?: string;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  readonly validatorVersion: string;
  readonly result: 'passed_static' | 'failed_static';
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function createFusedPattern(input: FusedPattern): FusedPattern {
  assertNonEmptyString(input.fusedPatternId, 'fusedPatternId');
  assertNonEmptyString(input.sourceWorkflowPatternRef, 'sourceWorkflowPatternRef');
  assertNonEmptyString(input.sourceProcessPatternRef, 'sourceProcessPatternRef');
  assertStringArray(input.sourceTraceRefs, 'sourceTraceRefs');
  assertStringArray(input.supportRefs, 'supportRefs');
  assertStringArray(input.contradictionRefs, 'contradictionRefs');
  if (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1)
    throw new Error('FUSED_PATTERN_CONFIDENCE_INVALID');
  assertNonEmptyString(input.fusionVersion, 'fusionVersion');
  assertNonEmptyString(input.contentHash, 'contentHash');
  for (const field of [
    'tenantCount',
    'userCount',
    'deviceClassCount',
    'environmentClassCount',
    'successCount',
    'failureCount',
  ] as const) {
    if (!Number.isSafeInteger(input.scopeEvidence[field]) || input.scopeEvidence[field] < 0) {
      throw new Error(`FUSED_PATTERN_SCOPE_EVIDENCE_INVALID:${field}`);
    }
  }
  if (input.scopeEvidence.tenantCount < 1) throw new Error('FUSED_PATTERN_TENANT_COUNT_INVALID');
  return Object.freeze({ ...input });
}

export function createGeneralizedPattern(input: GeneralizedPattern): GeneralizedPattern {
  assertNonEmptyString(input.generalizedPatternId, 'generalizedPatternId');
  assertNonEmptyString(input.domain, 'domain');
  assertNonEmptyString(input.taskTypeId, 'taskTypeId');
  if (!Array.isArray(input.variables)) throw new Error('GENERALIZED_PATTERN_VARIABLES_MISSING');
  if (!Array.isArray(input.invariants)) throw new Error('GENERALIZED_PATTERN_INVARIANTS_MISSING');
  if (!Array.isArray(input.requiredConditions))
    throw new Error('GENERALIZED_PATTERN_REQUIRED_CONDITIONS_MISSING');
  if (!Array.isArray(input.forbiddenConditions))
    throw new Error('GENERALIZED_PATTERN_FORBIDDEN_CONDITIONS_MISSING');
  if (!Array.isArray(input.applicabilityPredicates))
    throw new Error('GENERALIZED_PATTERN_APPLICABILITY_MISSING');
  if (!Array.isArray(input.failureBoundaries))
    throw new Error('GENERALIZED_PATTERN_FAILURE_BOUNDARIES_MISSING');
  assertStringArray(input.retainedExampleRefs, 'retainedExampleRefs');
  assertStringArray(input.counterexampleRefs, 'counterexampleRefs');
  assertNonEmptyString(input.sourceFusedPatternRef, 'sourceFusedPatternRef');
  assertNonEmptyString(input.generalizerVersion, 'generalizerVersion');
  assertNonEmptyString(input.contentHash, 'contentHash');
  return Object.freeze({ ...input });
}

export function createCandidateStaticValidationResult(
  input: CandidateStaticValidationResult,
): CandidateStaticValidationResult {
  assertNonEmptyString(input.artifactRef, 'artifactRef');
  if (typeof input.schemaValid !== 'boolean')
    throw new Error('STATIC_VALIDATION_SCHEMA_VALID_INVALID');
  if (typeof input.activityIdentityValid !== 'boolean')
    throw new Error('STATIC_VALIDATION_ACTIVITY_IDENTITY_INVALID');
  if (typeof input.dagValid !== 'boolean') throw new Error('STATIC_VALIDATION_DAG_VALID_INVALID');
  if (typeof input.parallelSemanticsValid !== 'boolean')
    throw new Error('STATIC_VALIDATION_PARALLEL_SEMANTICS_INVALID');
  if (typeof input.requiredCriteriaCovered !== 'boolean')
    throw new Error('STATIC_VALIDATION_CRITERIA_COVERED_INVALID');
  if (typeof input.capabilityShapeValid !== 'boolean')
    throw new Error('STATIC_VALIDATION_CAPABILITY_SHAPE_INVALID');
  if (typeof input.capabilityCatalogAligned !== 'boolean')
    throw new Error('STATIC_VALIDATION_CAPABILITY_CATALOG_INVALID');
  if (typeof input.parameterPolicyValid !== 'boolean')
    throw new Error('STATIC_VALIDATION_PARAMETER_POLICY_INVALID');
  if (typeof input.parameterSchemaAligned !== 'boolean')
    throw new Error('STATIC_VALIDATION_PARAMETER_SCHEMA_INVALID');
  if (typeof input.applicabilityEvaluable !== 'boolean')
    throw new Error('STATIC_VALIDATION_APPLICABILITY_INVALID');
  if (typeof input.lineageComplete !== 'boolean')
    throw new Error('STATIC_VALIDATION_LINEAGE_INVALID');
  if (typeof input.recoverySemanticsValid !== 'boolean')
    throw new Error('STATIC_VALIDATION_RECOVERY_INVALID');
  if (typeof input.sideEffectReplaySafe !== 'boolean')
    throw new Error('STATIC_VALIDATION_REPLAY_SAFE_INVALID');
  if (typeof input.boundsValid !== 'boolean') throw new Error('STATIC_VALIDATION_BOUNDS_INVALID');
  if (!Array.isArray(input.errors)) throw new Error('STATIC_VALIDATION_ERRORS_MISSING');
  if (!Array.isArray(input.warnings)) throw new Error('STATIC_VALIDATION_WARNINGS_MISSING');
  assertNonEmptyString(input.validatorVersion, 'validatorVersion');
  return Object.freeze({ ...input });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`FIELD_INVALID:${field}`);
}

function assertStringArray(value: unknown, field: string): void {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    throw new Error(`FIELD_INVALID:${field}`);
}
