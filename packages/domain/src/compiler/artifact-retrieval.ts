import type {
  ArtifactApplicability,
  ArtifactDependencySnapshot,
  ArtifactRiskLevel,
  AtomicConditionOperator,
  CapabilityRequirement,
  CompiledArtifact,
  ConditionExpression,
  JsonValue,
  StructuredHint,
} from './contracts.js';

/** Frozen P07/G13-G14 public-data contracts. No runtime or adapter types cross this boundary. */
export const ARTIFACT_RETRIEVAL_CONTRACT_VERSION = '1.1' as const;

export const ARTIFACT_RETRIEVAL_SCHEMA_HASHES = Object.freeze({
  ArtifactIndexEntry: 'dd7bc4378007ad394fa1905aebc529b30f24fc279857ba67605f29036afe9bf0',
  ArtifactMatchScore: '73ddec591cef1fc8e4b4d25d5cf20e7f64523e1ca66a24ca86db32ba8ed18bc5',
  ArtifactMatch: '7334e4ba7c70f3744b81bb14bef308ca5abd32c6b99f7f05bf0d210b2d7267d7',
  ArtifactApplicabilityResult: '0f87d569e3a38dc37526077d92040e1db7c745120c56ec7a79430d369265ec81',
  ParameterBindingResult: '13eaeb0cad67bd18fc3b83d9bf2315d6c72213602260c5f5898c419b4c9891a5',
  DependencyValidationResult: '1a8a8c2c0f3001fdda76864c4029b3bb30193ecf4487e02b361c1ec1d6485470',
  CapabilityReadinessResult: 'd1715f16e6faddabc1967207e4abd5b2c94f6fa92d2c7e51024e747b9d475fa4',
  RuntimeExecutionDecision: '4ad37edc562bf39d27982f23f70d27ee8af1a3dfe3486dfc34725eec62b5b4de',
  FastGatewayPath: 'af5fb1fd8fd79ea3b56580dbc1d073bb9e0ad8dd3b568fba2fecf1bb59f1e24b',
} as const);

export const FAST_GATEWAY_PATHS = Object.freeze([
  'compiled_fast',
  'template_adapt',
  'case_adapt',
  'small_model',
  'cognitive_runtime',
  'human_input',
  'denied',
] as const);

export type FastGatewayPath = (typeof FAST_GATEWAY_PATHS)[number];
export type RetrievalSource = 'exact' | 'structured' | 'semantic' | 'small_model_candidate';
export type ApplicabilityDisposition =
  'eligible' | 'requires_adaptation' | 'fallback' | 'require_confirmation' | 'deny';
export type ParameterBindingSource =
  | 'user_confirmed'
  | 'request'
  | 'world_state'
  | 'runtime_context'
  | 'user_preference'
  | 'small_model_candidate';
export type ParameterBindingTrust = 'authoritative' | 'trusted' | 'candidate';

export interface ArtifactIndexEntry {
  readonly artifactRef: string;
  readonly artifactKey: string;
  readonly artifactVersion: number;
  readonly artifactType: CompiledArtifact['artifactType'];
  readonly tenantId?: string;
  readonly domain: string;
  readonly taskTypeIds: readonly string[];
  readonly riskLevel: ArtifactRiskLevel;
  readonly status: 'active';
  readonly exactPatterns: readonly string[];
  readonly structuredHints: readonly StructuredHint[];
  readonly embeddingRef?: string;
  readonly activePointerVersion: number;
  readonly contentHash: string;
}

export interface ArtifactMatchScore {
  readonly intentScore: number;
  readonly structuredConditionScore: number;
  readonly parameterCoverageScore: number;
  readonly capabilityShapeScore: number;
  readonly environmentSimilarityScore: number;
  readonly validationConfidenceScore: number;
  readonly recentReliabilityScore: number;
  readonly riskPenalty: number;
  readonly totalScore: number;
}

export interface ArtifactMatch {
  readonly artifactRef: string;
  readonly rank: number;
  readonly score: ArtifactMatchScore;
  readonly retrievalSources: readonly RetrievalSource[];
  readonly reasonCodes: readonly string[];
}

export interface ArtifactApplicabilityResult {
  readonly artifactRef: string;
  readonly applicable: boolean;
  readonly confidence: number;
  readonly satisfiedConditionIds: readonly string[];
  readonly missingConditionIds: readonly string[];
  readonly violatedConditionIds: readonly string[];
  readonly uncertainConditionIds: readonly string[];
  readonly outOfDistribution: boolean;
  readonly disposition: ApplicabilityDisposition;
  readonly reasonCodes: readonly string[];
}

export interface ParameterBindingValue {
  readonly value: JsonValue;
  readonly source: ParameterBindingSource;
  readonly trust: ParameterBindingTrust;
  readonly confidence: number;
}

export interface ParameterBindingResult {
  readonly artifactRef: string;
  readonly bindings: Readonly<Record<string, ParameterBindingValue>>;
  readonly missingRequiredParameters: readonly string[];
  readonly rejectedCandidateBindings: readonly string[];
  readonly requiresConfirmation: readonly string[];
}

export interface DependencyValidationResult {
  readonly artifactRef: string;
  readonly valid: boolean;
  readonly mismatches: readonly string[];
  readonly snapshotHash: string;
  readonly reasonCodes: readonly string[];
}

export interface CapabilityReadinessResult {
  readonly artifactRef: string;
  readonly requiredCapabilities: readonly CapabilityRequirement[];
  readonly skillCandidateRefs: readonly string[];
  readonly providerReadiness: Readonly<
    Record<string, 'ready' | 'restricted' | 'unavailable' | 'unknown'>
  >;
  readonly valid: boolean;
  readonly reasonCodes: readonly string[];
}

export interface RuntimeExecutionDecision {
  readonly decisionId: string;
  readonly requestId: string;
  readonly path: FastGatewayPath;
  readonly selectedArtifactRef?: string;
  readonly parameterBindings: Readonly<Record<string, ParameterBindingValue>>;
  readonly missingParameters: readonly string[];
  readonly requiredConfirmations: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly matcherSnapshotHash: string;
  readonly policySnapshotHash: string;
  readonly createdAt: string;
}

export interface ArtifactConditionEvaluation {
  readonly passed: boolean;
  readonly uncertain: boolean;
}

export interface ArtifactApplicabilityContext {
  readonly values: Readonly<Record<string, JsonValue>>;
  readonly environmentClass?: string;
  readonly uncertainty: number;
  readonly outOfDistribution: boolean;
}

/**
 * Deterministic restricted condition interpreter. It accepts only the P01
 * expression AST and never evaluates generated source or regular expressions.
 */
export function evaluateArtifactCondition(
  expression: ConditionExpression,
  values: Readonly<Record<string, JsonValue>>,
): ArtifactConditionEvaluation {
  if (expression.type === 'all') {
    const children = expression.children.map((child) => evaluateArtifactCondition(child, values));
    return Object.freeze({
      passed: children.every((child) => child.passed),
      uncertain: children.some((child) => child.uncertain),
    });
  }
  if (expression.type === 'any') {
    const children = expression.children.map((child) => evaluateArtifactCondition(child, values));
    return Object.freeze({
      passed: children.some((child) => child.passed),
      uncertain: children.every((child) => child.uncertain),
    });
  }
  if (expression.type === 'not') {
    const child = evaluateArtifactCondition(expression.child, values);
    return Object.freeze({ passed: !child.passed, uncertain: child.uncertain });
  }
  const atomic = expression as Extract<ConditionExpression, { readonly type: 'atomic' }>;
  const actual = lookupConditionField(values, atomic.field);
  if (actual === undefined) return Object.freeze({ passed: false, uncertain: true });
  return Object.freeze({
    passed: compareCondition(actual, atomic.operator, atomic.value),
    uncertain: false,
  });
}

export function evaluateArtifactApplicability(
  artifact: Pick<CompiledArtifact, 'artifactId' | 'version' | 'applicability' | 'riskLevel'>,
  context: ArtifactApplicabilityContext,
): ArtifactApplicabilityResult {
  const artifactRef = `${artifact.artifactId}:${String(artifact.version)}`;
  const satisfied: string[] = [];
  const missing: string[] = [];
  const violated: string[] = [];
  const uncertain: string[] = [];

  artifact.applicability.requiredConditions.forEach((condition, index) => {
    const evaluation = evaluateArtifactCondition(condition, context.values);
    if (evaluation.passed) satisfied.push(`required:${String(index)}`);
    else if (evaluation.uncertain) uncertain.push(`required:${String(index)}`);
    else missing.push(`required:${String(index)}`);
  });
  artifact.applicability.forbiddenConditions.forEach((condition, index) => {
    const evaluation = evaluateArtifactCondition(condition, context.values);
    if (evaluation.passed) violated.push(`forbidden:${String(index)}`);
    else if (evaluation.uncertain) uncertain.push(`forbidden:${String(index)}`);
  });
  const environmentExcluded =
    context.environmentClass !== undefined &&
    artifact.applicability.excludedEnvironmentClasses.includes(context.environmentClass);
  const environmentMissing =
    artifact.applicability.allowedEnvironmentClasses.length > 0 &&
    (context.environmentClass === undefined ||
      !artifact.applicability.allowedEnvironmentClasses.includes(context.environmentClass));
  if (environmentExcluded) violated.push('environment:excluded');
  if (environmentMissing) missing.push('environment:allowed');
  const exceedsUncertainty = context.uncertainty > artifact.applicability.maximumUncertainty;
  if (exceedsUncertainty) uncertain.push('uncertainty:maximum');
  const isOutOfDistribution = context.outOfDistribution || environmentMissing;

  const reasonCodes = [
    ...(satisfied.length > 0 ? ['REQUIRED_CONDITION_SATISFIED'] : []),
    ...(missing.length > 0 ? ['REQUIRED_CONDITION_MISSING'] : []),
    ...(violated.length > 0 ? ['FORBIDDEN_CONDITION_MATCHED'] : []),
    ...(uncertain.length > 0 ? ['UNCERTAINTY_TOO_HIGH'] : []),
    ...(isOutOfDistribution ? ['OUT_OF_DISTRIBUTION'] : []),
  ];
  const disposition = dispositionForApplicability({
    policy: artifact.applicability,
    violated: violated.length > 0,
    missing: missing.length > 0,
    uncertain: uncertain.length > 0,
    outOfDistribution: isOutOfDistribution,
    riskLevel: artifact.riskLevel,
  });
  const applicable = disposition === 'eligible' || disposition === 'requires_adaptation';
  const totalChecks = Math.max(
    1,
    satisfied.length + missing.length + violated.length + uncertain.length,
  );
  return Object.freeze({
    artifactRef,
    applicable,
    confidence: clamp((satisfied.length + 1) / (totalChecks + 1)),
    satisfiedConditionIds: Object.freeze(satisfied),
    missingConditionIds: Object.freeze(missing),
    violatedConditionIds: Object.freeze(violated),
    uncertainConditionIds: Object.freeze(uncertain),
    outOfDistribution: isOutOfDistribution,
    disposition,
    reasonCodes: Object.freeze(reasonCodes),
  });
}

export function calculateArtifactMatchScore(
  components: Omit<ArtifactMatchScore, 'totalScore'>,
): ArtifactMatchScore {
  const normalized = {
    intentScore: clamp(components.intentScore),
    structuredConditionScore: clamp(components.structuredConditionScore),
    parameterCoverageScore: clamp(components.parameterCoverageScore),
    capabilityShapeScore: clamp(components.capabilityShapeScore),
    environmentSimilarityScore: clamp(components.environmentSimilarityScore),
    validationConfidenceScore: clamp(components.validationConfidenceScore),
    recentReliabilityScore: clamp(components.recentReliabilityScore),
    riskPenalty: clamp(components.riskPenalty),
  };
  const totalScore = clamp(
    normalized.intentScore * 0.24 +
      normalized.structuredConditionScore * 0.16 +
      normalized.parameterCoverageScore * 0.1 +
      normalized.capabilityShapeScore * 0.12 +
      normalized.environmentSimilarityScore * 0.12 +
      normalized.validationConfidenceScore * 0.16 +
      normalized.recentReliabilityScore * 0.1 -
      normalized.riskPenalty * 0.2,
  );
  return Object.freeze({ ...normalized, totalScore });
}

export function stableRankArtifactMatches(
  entries: readonly Readonly<{
    artifactKey: string;
    artifactVersion: number;
    artifactRef: string;
    score: ArtifactMatchScore;
    retrievalSources: readonly RetrievalSource[];
    reasonCodes: readonly string[];
  }>[],
): readonly ArtifactMatch[] {
  const ordered = [...entries].sort((left, right) => {
    const score = right.score.totalScore - left.score.totalScore;
    if (score !== 0) return score;
    const key = left.artifactKey.localeCompare(right.artifactKey);
    if (key !== 0) return key;
    const version = right.artifactVersion - left.artifactVersion;
    if (version !== 0) return version;
    return left.artifactRef.localeCompare(right.artifactRef);
  });
  return Object.freeze(
    ordered.map((entry, index) =>
      Object.freeze({
        artifactRef: entry.artifactRef,
        rank: index + 1,
        score: entry.score,
        retrievalSources: Object.freeze([...entry.retrievalSources]),
        reasonCodes: Object.freeze([...entry.reasonCodes]),
      }),
    ),
  );
}

export function dependencySnapshotEquals(
  expected: ArtifactDependencySnapshot,
  current: ArtifactDependencySnapshot,
): readonly string[] {
  const mismatches = [
    ...(expected.capabilityCatalogHash === current.capabilityCatalogHash
      ? []
      : ['DEPENDENCY_CATALOG_MISMATCH']),
    ...(sameStringSet(expected.policyVersionRefs, current.policyVersionRefs)
      ? []
      : ['DEPENDENCY_POLICY_MISMATCH']),
    ...(sameStringSet(expected.taskTypeVersionRefs, current.taskTypeVersionRefs)
      ? []
      : ['DEPENDENCY_TASK_TYPE_MISMATCH']),
    ...(sameStringSet(expected.schemaVersionRefs, current.schemaVersionRefs)
      ? []
      : ['DEPENDENCY_SCHEMA_MISMATCH']),
    ...(expected.compilerVersion === current.compilerVersion
      ? []
      : ['DEPENDENCY_COMPILER_MISMATCH']),
    ...(sameStringSet(expected.requiredSkillVersionRefs, current.requiredSkillVersionRefs)
      ? []
      : ['DEPENDENCY_SKILL_VERSION_MISMATCH']),
  ];
  return Object.freeze(mismatches);
}

function dispositionForApplicability(
  input: Readonly<{
    policy: ArtifactApplicability;
    violated: boolean;
    missing: boolean;
    uncertain: boolean;
    outOfDistribution: boolean;
    riskLevel: ArtifactRiskLevel;
  }>,
): ApplicabilityDisposition {
  if (input.violated) return input.riskLevel === 'critical' ? 'deny' : 'fallback';
  if (input.outOfDistribution || input.uncertain) {
    if (input.policy.outOfDistributionPolicy === 'deny') return 'deny';
    return input.policy.outOfDistributionPolicy === 'require_confirmation'
      ? 'require_confirmation'
      : 'fallback';
  }
  if (input.missing)
    return input.riskLevel === 'low' ? 'requires_adaptation' : 'require_confirmation';
  return 'eligible';
}

function lookupConditionField(
  values: Readonly<Record<string, JsonValue>>,
  field: string,
): JsonValue | undefined {
  const direct = values[field];
  if (direct !== undefined) return direct;
  let current: JsonValue | undefined = values;
  for (const segment of field.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Readonly<Record<string, JsonValue>>)[segment];
    if (current === undefined) return undefined;
  }
  return current;
}

function compareCondition(
  actual: JsonValue,
  operator: AtomicConditionOperator,
  expected: JsonValue | undefined,
): boolean {
  if (operator === 'exists') return true;
  if (operator === 'eq') return canonicalValue(actual) === canonicalValue(expected);
  if (operator === 'neq') return canonicalValue(actual) !== canonicalValue(expected);
  if (operator === 'contains') {
    if (typeof actual === 'string' && typeof expected === 'string')
      return actual.includes(expected);
    return (
      isJsonArray(actual) &&
      actual.some((value) => canonicalValue(value) === canonicalValue(expected))
    );
  }
  if (operator === 'in') {
    return (
      isJsonArray(expected) &&
      expected.some((value) => canonicalValue(value) === canonicalValue(actual))
    );
  }
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  if (operator === 'gt') return actual > expected;
  if (operator === 'gte') return actual >= expected;
  if (operator === 'lt') return actual < expected;
  return actual <= expected;
}

function canonicalValue(value: JsonValue | undefined): string {
  return JSON.stringify(value);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}
