import type {
  ActivityPattern,
  DependencyPattern,
  PatternQuality,
  RecoveryPattern,
} from './experience-compilation.js';
import type { ConditionExpression, JsonValue } from './contracts.js';

export const ARTIFACT_CANDIDATE_GENERATION_CONTRACT_VERSION = '1.1' as const;
export const PATTERN_FUSION_VERSION = 'sdar-pattern-fusion/1.1' as const;
export const PATTERN_GENERALIZER_VERSION = 'sdar-pattern-generalizer/1.1' as const;
export const CANDIDATE_GENERATOR_VERSION = 'sdar-candidate-generator/1.1' as const;
export const PLAN_TEMPLATE_COMPILER_VERSION = 'sdar-plan-template-compiler/1.1' as const;
export const CANDIDATE_STATIC_VALIDATOR_VERSION = 'sdar-candidate-static-validator/1.1' as const;

export const ARTIFACT_CANDIDATE_GENERATION_SCHEMA_HASHES = Object.freeze({
  FusedPattern: 'df1216e93f02a3ec0cc24d96547d5db3436500789818ec8bcee3847fcbd9d24e',
  GeneralizedPattern: '96f2c70c36985897ebbc700b540048314cad2e2597777e7b9b64118e227a08bd',
  CandidateStaticValidationResult:
    '3365fa7c49f249c3ea0935d87781da8d90253d6683bba97075beff1276278aba',
} as const);

// ---------------------------------------------------------------------------
// FusedPattern nested types
// ---------------------------------------------------------------------------

export interface StructuralPattern {
  readonly taskTypeId: string;
  readonly activityPatterns: readonly ActivityPattern[];
  readonly dependencyPatterns: readonly DependencyPattern[];
  readonly recoveryPatterns: readonly RecoveryPattern[];
  readonly quality: PatternQuality;
}

export interface SemanticParameterCandidate {
  readonly parameterName: string;
  readonly suggestedSchema: JsonValue;
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
  readonly range?: Readonly<{ readonly min: number; readonly max: number }>;
  readonly enumValues?: readonly string[];
  readonly required: boolean;
}

export interface Invariant {
  readonly invariantId: string;
  readonly description: string;
  readonly condition: ConditionExpression;
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
  readonly dagValid: boolean;
  readonly requiredCriteriaCovered: boolean;
  readonly capabilityShapeValid: boolean;
  readonly parameterPolicyValid: boolean;
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
  if (typeof input.dagValid !== 'boolean') throw new Error('STATIC_VALIDATION_DAG_VALID_INVALID');
  if (typeof input.requiredCriteriaCovered !== 'boolean')
    throw new Error('STATIC_VALIDATION_CRITERIA_COVERED_INVALID');
  if (typeof input.capabilityShapeValid !== 'boolean')
    throw new Error('STATIC_VALIDATION_CAPABILITY_SHAPE_INVALID');
  if (typeof input.parameterPolicyValid !== 'boolean')
    throw new Error('STATIC_VALIDATION_PARAMETER_POLICY_INVALID');
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
