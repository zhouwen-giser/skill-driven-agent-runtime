import {
  calculateArtifactMatchScore,
  dependencySnapshotEquals,
  evaluateArtifactApplicability,
  stableRankArtifactMatches,
  type ArtifactApplicabilityResult,
  type ArtifactIndexEntry as RuntimeArtifactIndexEntry,
  type ArtifactMatch,
  type CapabilityReadinessResult,
  type CompiledArtifact,
  type DependencyValidationResult,
  type FastGatewayPath,
  type ParameterBindingResult,
  type ParameterBindingSource,
  type ParameterBindingTrust,
  type ParameterBindingValue,
  type RuntimeExecutionDecision,
} from '../../../domain/src/index.js';
import type { JsonValue } from '../../../domain/src/compiler/contracts.js';

import type { ArtifactFeatureFlags } from './artifact-registry.js';
import type {
  ArtifactIndexEntry,
  ArtifactIndexQuery,
  ArtifactRepository,
} from './artifact-persistence.js';

export const P07_REASON_CODES = Object.freeze([
  'ARTIFACT_EXACT_MATCH',
  'ARTIFACT_STRUCTURED_MATCH',
  'ARTIFACT_SEMANTIC_MATCH',
  'ARTIFACT_NO_MATCH',
  'ARTIFACT_AMBIGUOUS_MATCH',
  'ARTIFACT_NON_ACTIVE',
  'ARTIFACT_TENANT_MISMATCH',
  'REQUIRED_CONDITION_SATISFIED',
  'REQUIRED_CONDITION_MISSING',
  'FORBIDDEN_CONDITION_MATCHED',
  'OUT_OF_DISTRIBUTION',
  'UNCERTAINTY_TOO_HIGH',
  'PARAMETER_REQUIRED_MISSING',
  'PARAMETER_SOURCE_CONFLICT',
  'PARAMETER_CANDIDATE_REJECTED',
  'PARAMETER_CONFIRMATION_REQUIRED',
  'DEPENDENCY_VALID',
  'DEPENDENCY_CATALOG_MISMATCH',
  'DEPENDENCY_POLICY_MISMATCH',
  'DEPENDENCY_SCHEMA_MISMATCH',
  'DEPENDENCY_TASK_TYPE_MISMATCH',
  'CAPABILITY_AVAILABLE',
  'CAPABILITY_GAP',
  'SKILL_CANDIDATE_UNAVAILABLE',
  'PROVIDER_READY',
  'PROVIDER_NOT_READY',
  'POLICY_ALLOW',
  'POLICY_DENY',
  'POLICY_CONFIRMATION_REQUIRED',
  'KILL_SWITCH_ACTIVE',
  'DECISION_ELIGIBLE',
  'DECISION_REQUIRES_ADAPTATION',
  'DECISION_FALLBACK',
  'DECISION_REQUIRE_CONFIRMATION',
  'DECISION_DENY',
] as const);

export type ArtifactPolicyDecision = 'allow' | 'deny' | 'require_confirmation';
export type ProviderReadiness = 'ready' | 'restricted' | 'unavailable' | 'unknown';

export interface ParameterValueCandidate {
  readonly parameterName: string;
  readonly value: JsonValue;
  readonly source: ParameterBindingSource;
  readonly trust: ParameterBindingTrust;
  readonly confidence: number;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly preferenceScope?: string;
  readonly lowRiskPreference?: boolean;
}

export interface ArtifactRetrievalRequest {
  readonly requestId: string;
  readonly taskId: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly domain?: string;
  readonly taskTypeIds: readonly string[];
  readonly artifactTypes?: readonly CompiledArtifact['artifactType'][];
  readonly explicitArtifactRef?: string;
  readonly intentText?: string;
  readonly structuredContext: Readonly<Record<string, JsonValue>>;
  readonly parameterCandidates: readonly ParameterValueCandidate[];
  readonly semanticScores: Readonly<Record<string, number>>;
  readonly semanticThreshold: number;
  readonly ambiguityThreshold: number;
  readonly uncertainty: number;
  readonly outOfDistribution: boolean;
  readonly currentDependencySnapshot: CompiledArtifact['dependencySnapshot'];
  readonly currentValidatorVersion: string;
  readonly currentPromotionPolicyVersion: string;
  readonly knownCapabilityIds: ReadonlySet<string>;
  readonly skillCandidateRefs: Readonly<Record<string, readonly string[]>>;
  readonly providerReadiness: Readonly<Record<string, ProviderReadiness>>;
  readonly policyDecision: ArtifactPolicyDecision;
  readonly policySnapshotHash: string;
  readonly killSwitchActive: boolean;
  readonly matcherSnapshotHash: string;
  readonly createdAt: string;
}

export interface ArtifactMatchAuditInput {
  readonly matchId: string;
  readonly requestId: string;
  readonly taskId: string;
  readonly artifactId: string;
  readonly score: ArtifactMatch['score'];
  readonly applicability: ArtifactApplicabilityResult;
  readonly decision: RuntimeExecutionDecision['path'];
  readonly reasonCodes: readonly string[];
  readonly policySnapshotHash: string;
  readonly createdAt: string;
}

/** P02's canonical `artifact_match_log` is the P07 retrieval audit authority. */
export interface ArtifactMatchAuditRepository {
  append(input: ArtifactMatchAuditInput): Promise<void>;
}

/** Non-authoritative child audit linked to the P02 canonical match log. */
export interface RuntimeCandidateDecisionRepository {
  append(
    input: Readonly<{
      decision: RuntimeExecutionDecision;
      matchId?: string;
    }>,
  ): Promise<void>;
}

/** P07 requests a durable P06 revalidation signal but has no status-write capability. */
export interface ArtifactRevalidationSignalPort {
  signal(
    input: Readonly<{
      triggerId: string;
      artifactId: string;
      artifactVersion: number;
      artifactRef: string;
      sourceRefs: readonly string[];
      createdAt: string;
    }>,
  ): Promise<void>;
}

/** Immutable P04/P05/P06 evidence used for active-Artifact revalidation. */
export interface ArtifactValidationDependencyPort {
  load(
    input: Readonly<{ artifactId: string; artifactVersion: number }>,
  ): Promise<Readonly<{ validatorVersion?: string; promotionPolicyVersion?: string }>>;
}

/** P02's rebuildable Level-0 active-index projection. It is never an authority. */
export interface ArtifactActiveIndexReader {
  queryActiveIndex(query: ArtifactIndexQuery): Promise<readonly ArtifactIndexEntry[]>;
}

/** Deployment-owned authorization; request or model input never grants Artifact access. */
export interface ArtifactSelectionAuthorizationPort {
  isAuthorized(
    input: Readonly<{
      requestId: string;
      tenantId?: string;
      artifactRef: string;
      artifact: CompiledArtifact;
    }>,
  ): Promise<boolean>;
}

export interface ArtifactRetrievalResult {
  readonly index: readonly RuntimeArtifactIndexEntry[];
  readonly matches: readonly ArtifactMatch[];
  readonly decision: RuntimeExecutionDecision;
  readonly applicability?: ArtifactApplicabilityResult;
  readonly parameterBinding?: ParameterBindingResult;
  readonly dependencyValidation?: DependencyValidationResult;
  readonly capabilityReadiness?: CapabilityReadinessResult;
}

interface EvaluatedCandidate {
  readonly index: RuntimeArtifactIndexEntry;
  readonly artifact: CompiledArtifact;
  readonly match: ArtifactMatch;
  readonly applicability: ArtifactApplicabilityResult;
  readonly parameterBinding: ParameterBindingResult;
  readonly dependencyValidation: DependencyValidationResult;
  readonly capabilityReadiness: CapabilityReadinessResult;
  readonly path: FastGatewayPath;
  readonly reasonCodes: readonly string[];
}

/**
 * P07 is an internal selection service. It is deliberately not an HTTP entry
 * point and it returns a decision only; it never instantiates a template or
 * invokes a Skill/MCP/Provider.
 */
export class ArtifactRetrievalService {
  readonly #repository: ArtifactRepository;
  readonly #activeIndex: ArtifactActiveIndexReader;
  readonly #audit: ArtifactMatchAuditRepository;
  readonly #decisionAudit: RuntimeCandidateDecisionRepository;
  readonly #revalidation: ArtifactRevalidationSignalPort;
  readonly #validationDependencies: ArtifactValidationDependencyPort;
  readonly #authorization: ArtifactSelectionAuthorizationPort;
  readonly #featureFlags: () => ArtifactFeatureFlags;
  readonly #nextDecisionId: () => string;
  readonly #nextMatchId: () => string;
  readonly #nextTriggerId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: ArtifactRepository;
      activeIndex?: ArtifactActiveIndexReader;
      audit: ArtifactMatchAuditRepository;
      decisionAudit: RuntimeCandidateDecisionRepository;
      revalidation: ArtifactRevalidationSignalPort;
      validationDependencies: ArtifactValidationDependencyPort;
      authorization: ArtifactSelectionAuthorizationPort;
      featureFlags(): ArtifactFeatureFlags;
      nextDecisionId(): string;
      nextMatchId(): string;
      nextTriggerId(): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#activeIndex =
      dependencies.activeIndex ??
      Object.freeze({
        queryActiveIndex: (query: ArtifactIndexQuery) => this.#repository.findActiveIndex(query),
      });
    this.#audit = dependencies.audit;
    this.#decisionAudit = dependencies.decisionAudit;
    this.#revalidation = dependencies.revalidation;
    this.#validationDependencies = dependencies.validationDependencies;
    this.#authorization = dependencies.authorization;
    this.#featureFlags = dependencies.featureFlags;
    this.#nextDecisionId = dependencies.nextDecisionId;
    this.#nextMatchId = dependencies.nextMatchId;
    this.#nextTriggerId = dependencies.nextTriggerId;
  }

  async retrieve(input: ArtifactRetrievalRequest): Promise<ArtifactRetrievalResult> {
    const flags = this.#featureFlags();
    if (!isRequestFeatureEnabled(flags, input)) {
      return this.#recordNoMatchDecision(input, flags.artifactMode === 'off');
    }
    const levelZero = await this.#activeIndex.queryActiveIndex({
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
      ...(input.domain === undefined ? {} : { domain: input.domain }),
      ...(input.artifactTypes === undefined ? {} : { artifactTypes: input.artifactTypes }),
      limit: 500,
    });
    const evaluated: EvaluatedCandidate[] = [];
    for (const entry of levelZero) {
      // Level-0 must reject a non-matching projection before an authoritative
      // Level-1 definition is read. This prevents a full-definition fan-out.
      if (!matchesLevelZero(entry, input, flags)) continue;
      const candidate = await this.#loadAndEvaluate(entry, input, flags);
      if (candidate !== undefined) evaluated.push(candidate);
    }
    const matches = stableRankArtifactMatches(
      evaluated.map((candidate) => ({
        artifactKey: candidate.index.artifactKey,
        artifactVersion: candidate.index.artifactVersion,
        artifactRef: candidate.index.artifactRef,
        score: candidate.match.score,
        retrievalSources: candidate.match.retrievalSources,
        reasonCodes: candidate.match.reasonCodes,
      })),
    );
    const byRef = new Map(matches.map((match) => [match.artifactRef, match]));
    const ranked = evaluated
      .map((candidate) => ({
        ...candidate,
        match: byRef.get(candidate.match.artifactRef) ?? candidate.match,
      }))
      .sort((left, right) => left.match.rank - right.match.rank);
    const eligible = ranked.filter(
      (candidate) => candidate.path === 'compiled_fast' || candidate.path === 'template_adapt',
    );
    const ambiguous = isAmbiguous(eligible, input.ambiguityThreshold);
    const selected = ambiguous
      ? undefined
      : (eligible[0] ?? ranked.find((candidate) => candidate.path === 'human_input'));
    const fallback = ranked[0];
    const decision = this.#decision(input, selected, fallback, ambiguous);

    const auditRecords = await Promise.all(
      ranked.map(async (candidate) => {
        const decisionPath = ambiguous
          ? decision.path
          : candidate === selected
            ? decision.path
            : candidate.path;
        const matchId = this.#nextMatchId();
        await this.#audit.append({
          matchId,
          requestId: input.requestId,
          taskId: input.taskId,
          artifactId: candidate.artifact.artifactId,
          score: candidate.match.score,
          applicability: candidate.applicability,
          decision: decisionPath,
          reasonCodes: candidate.reasonCodes,
          policySnapshotHash: input.policySnapshotHash,
          createdAt: input.createdAt,
        });
        return Object.freeze({ candidate, matchId });
      }),
    );
    const decisionTarget = selected ?? fallback;
    const decisionMatchId = auditRecords.find(
      (record) => record.candidate === decisionTarget,
    )?.matchId;
    await this.#decisionAudit.append({
      decision,
      ...(decisionMatchId === undefined ? {} : { matchId: decisionMatchId }),
    });
    return Object.freeze({
      index: Object.freeze(ranked.map((candidate) => candidate.index)),
      matches,
      decision,
      ...(decisionTarget === undefined
        ? {}
        : {
            applicability: decisionTarget.applicability,
            parameterBinding: decisionTarget.parameterBinding,
            dependencyValidation: decisionTarget.dependencyValidation,
            capabilityReadiness: decisionTarget.capabilityReadiness,
          }),
    });
  }

  async #loadAndEvaluate(
    entry: ArtifactIndexEntry,
    input: ArtifactRetrievalRequest,
    flags: ArtifactFeatureFlags,
  ): Promise<EvaluatedCandidate | undefined> {
    // The P02 query has already joined the active pointer. Rechecking the
    // immutable definition rejects a stale projection rather than trusting it.
    const artifact = await this.#repository.getDefinition({
      artifactId: entry.artifactId,
      version: entry.artifactVersion,
    });
    if (artifact?.status !== 'active') return undefined;
    if (artifact.scope.tenantId !== undefined && artifact.scope.tenantId !== input.tenantId) {
      return undefined;
    }
    if (!isArtifactFeatureEnabled(artifact, flags)) return undefined;
    const artifactRef = `${artifact.artifactId}:${String(artifact.version)}`;
    if (
      !(await this.#authorization.isAuthorized({
        requestId: input.requestId,
        ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
        artifactRef,
        artifact,
      }))
    ) {
      return undefined;
    }
    if (input.domain !== undefined && artifact.scope.domain !== input.domain) return undefined;
    if (
      input.taskTypeIds.length > 0 &&
      !artifact.scope.taskTypeIds.some((taskTypeId) => input.taskTypeIds.includes(taskTypeId))
    ) {
      return undefined;
    }
    const index = toRuntimeIndex(entry);
    const retrievalSources = retrievalSourcesFor(index, artifact, input);
    if (retrievalSources.length === 0) return undefined;
    const parameterBinding = bindParameters(artifact, input);
    const environmentClass = stringValue(input.structuredContext['environmentClass']);
    const applicability = evaluateArtifactApplicability(artifact, {
      values: input.structuredContext,
      ...(environmentClass === undefined ? {} : { environmentClass }),
      uncertainty: input.uncertainty,
      outOfDistribution: input.outOfDistribution,
    });
    const dependencyValidation = await validateDependencies(
      artifact,
      input,
      this.#validationDependencies,
    );
    const capabilityReadiness = validateCapabilityReadiness(artifact, input);
    if (!dependencyValidation.valid) {
      await this.#revalidation.signal({
        triggerId: this.#nextTriggerId(),
        artifactId: artifact.artifactId,
        artifactVersion: artifact.version,
        artifactRef: index.artifactRef,
        sourceRefs: dependencyValidation.reasonCodes,
        createdAt: input.createdAt,
      });
    }
    const score = calculateArtifactMatchScore({
      intentScore: retrievalSources.includes('exact') ? 1 : semanticScore(index.artifactRef, input),
      structuredConditionScore: retrievalSources.includes('structured') ? 1 : 0,
      parameterCoverageScore: parameterCoverage(parameterBinding),
      capabilityShapeScore: capabilityReadiness.valid ? 1 : 0,
      environmentSimilarityScore: applicability.outOfDistribution ? 0 : 1,
      validationConfidenceScore: 1,
      // Historical success never substitutes for a current readiness gate.
      recentReliabilityScore: 0,
      riskPenalty: riskPenalty(artifact.riskLevel),
    });
    const match = Object.freeze({
      artifactRef: index.artifactRef,
      rank: 0,
      score,
      retrievalSources: Object.freeze(retrievalSources),
      reasonCodes: Object.freeze(
        [...retrievalReasonCodes(retrievalSources), ...applicability.reasonCodes].sort(),
      ),
    });
    const computedPath = decisionPath({
      artifact,
      applicability,
      parameterBinding,
      dependencyValidation,
      capabilityReadiness,
      policyDecision: input.policyDecision,
      killSwitchActive: input.killSwitchActive,
    });
    const path =
      computedPath === 'compiled_fast' &&
      (!flags.fastGatewayEnabled || flags.artifactMode !== 'active')
        ? 'cognitive_runtime'
        : computedPath;
    const reasonCodes = Object.freeze(
      [
        ...match.reasonCodes,
        ...parameterReasonCodes(parameterBinding),
        ...dependencyValidation.reasonCodes,
        ...capabilityReadiness.reasonCodes,
        ...policyReasonCodes(input.policyDecision),
        ...(input.killSwitchActive ? ['KILL_SWITCH_ACTIVE'] : []),
        ...decisionReasonCodes(path),
      ].sort(),
    );
    return Object.freeze({
      index,
      artifact,
      match,
      applicability,
      parameterBinding,
      dependencyValidation,
      capabilityReadiness,
      path,
      reasonCodes,
    });
  }

  #decision(
    input: ArtifactRetrievalRequest,
    selected: EvaluatedCandidate | undefined,
    fallback: EvaluatedCandidate | undefined,
    ambiguous: boolean,
  ): RuntimeExecutionDecision {
    const path: FastGatewayPath = ambiguous
      ? 'human_input'
      : (selected?.path ??
        fallback?.path ??
        (input.policyDecision === 'deny' ? 'denied' : 'cognitive_runtime'));
    const target = selected ?? fallback;
    return Object.freeze({
      decisionId: this.#nextDecisionId(),
      requestId: input.requestId,
      path,
      ...(selected === undefined ? {} : { selectedArtifactRef: selected.index.artifactRef }),
      parameterBindings: selected?.parameterBinding.bindings ?? Object.freeze({}),
      missingParameters: selected?.parameterBinding.missingRequiredParameters ?? Object.freeze([]),
      requiredConfirmations: Object.freeze([
        ...(ambiguous ? ['ARTIFACT_AMBIGUOUS_MATCH'] : []),
        ...(selected?.parameterBinding.requiresConfirmation ?? []),
        ...(target?.path === 'human_input' ? ['POLICY_CONFIRMATION_REQUIRED'] : []),
      ]),
      reasonCodes: Object.freeze(
        [
          ...(ambiguous ? ['ARTIFACT_AMBIGUOUS_MATCH', 'DECISION_REQUIRE_CONFIRMATION'] : []),
          ...(target?.reasonCodes ?? ['ARTIFACT_NO_MATCH', 'DECISION_FALLBACK']),
        ].sort(),
      ),
      matcherSnapshotHash: input.matcherSnapshotHash,
      policySnapshotHash: input.policySnapshotHash,
      createdAt: input.createdAt,
    });
  }

  async #recordNoMatchDecision(
    input: ArtifactRetrievalRequest,
    killSwitchActive: boolean,
  ): Promise<ArtifactRetrievalResult> {
    const decision = Object.freeze({
      decisionId: this.#nextDecisionId(),
      requestId: input.requestId,
      path: 'cognitive_runtime' as const,
      parameterBindings: Object.freeze({}),
      missingParameters: Object.freeze([]),
      requiredConfirmations: Object.freeze([]),
      reasonCodes: Object.freeze(
        killSwitchActive
          ? ['ARTIFACT_NO_MATCH', 'DECISION_FALLBACK', 'KILL_SWITCH_ACTIVE']
          : ['ARTIFACT_NO_MATCH', 'DECISION_FALLBACK'],
      ),
      matcherSnapshotHash: input.matcherSnapshotHash,
      policySnapshotHash: input.policySnapshotHash,
      createdAt: input.createdAt,
    });
    await this.#decisionAudit.append({ decision });
    return Object.freeze({ index: Object.freeze([]), matches: Object.freeze([]), decision });
  }
}

function toRuntimeIndex(entry: ArtifactIndexEntry): RuntimeArtifactIndexEntry {
  return Object.freeze({
    artifactRef: `${entry.artifactId}:${String(entry.artifactVersion)}`,
    artifactKey: entry.artifactKey,
    artifactVersion: entry.artifactVersion,
    artifactType: entry.artifactType,
    ...(entry.tenantId === undefined ? {} : { tenantId: entry.tenantId }),
    domain: entry.domain,
    taskTypeIds: Object.freeze([...(entry.taskTypeIds ?? [])]),
    riskLevel: entry.riskLevel,
    status: 'active',
    exactPatterns: Object.freeze([...(entry.exactPatterns ?? [])]),
    structuredHints: Object.freeze([...(entry.structuredHints ?? [])]),
    ...(entry.embeddingRef === undefined ? {} : { embeddingRef: entry.embeddingRef }),
    activePointerVersion: entry.pointerLockVersion,
    contentHash: entry.contentHash,
  });
}

function isRequestFeatureEnabled(
  flags: ArtifactFeatureFlags,
  input: Pick<ArtifactRetrievalRequest, 'tenantId'>,
): boolean {
  if (flags.artifactMode === 'off') return false;
  return (
    flags.tenantAllowlist.size === 0 ||
    (input.tenantId !== undefined && flags.tenantAllowlist.has(input.tenantId))
  );
}

function isArtifactFeatureEnabled(
  artifact: Pick<CompiledArtifact, 'artifactType'>,
  flags: ArtifactFeatureFlags,
): boolean {
  switch (artifact.artifactType) {
    case 'plan_template':
      return flags.templateEnabled;
    case 'decision_rule':
      return flags.ruleEnabled;
    case 'case_template':
      return flags.caseEnabled;
    case 'model_route':
      return flags.modelCascadeEnabled;
    case 'intent_route':
      return true;
  }
}

function matchesLevelZero(
  entry: ArtifactIndexEntry,
  input: ArtifactRetrievalRequest,
  flags: ArtifactFeatureFlags,
): boolean {
  if (entry.tenantId !== undefined && entry.tenantId !== input.tenantId) return false;
  if (!isArtifactFeatureEnabled(entry, flags)) return false;
  if (input.domain !== undefined && entry.domain !== input.domain) return false;
  if (input.artifactTypes !== undefined && !input.artifactTypes.includes(entry.artifactType)) {
    return false;
  }
  const ref = `${entry.artifactId}:${String(entry.artifactVersion)}`;
  if (input.explicitArtifactRef === ref) return true;
  if ((entry.taskTypeIds ?? []).some((taskTypeId) => input.taskTypeIds.includes(taskTypeId))) {
    return true;
  }
  const intent = input.intentText?.trim().toLocaleLowerCase();
  if (
    intent !== undefined &&
    (entry.exactPatterns ?? []).some((pattern) => intent.includes(pattern.toLocaleLowerCase()))
  ) {
    return true;
  }
  if (
    (entry.structuredHints ?? []).some((hint) =>
      structuredHintMatches(hint, input.structuredContext),
    )
  ) {
    return true;
  }
  return entry.embeddingRef !== undefined && semanticScore(ref, input) >= input.semanticThreshold;
}

function retrievalSourcesFor(
  index: RuntimeArtifactIndexEntry,
  artifact: CompiledArtifact,
  input: ArtifactRetrievalRequest,
): readonly ('exact' | 'structured' | 'semantic')[] {
  const sources: ('exact' | 'structured' | 'semantic')[] = [];
  const ref = index.artifactRef;
  const definition = artifact.definition;
  if (input.explicitArtifactRef === ref) sources.push('exact');
  if (artifact.scope.taskTypeIds.some((taskTypeId) => input.taskTypeIds.includes(taskTypeId))) {
    // Task type is a frozen structured identifier and therefore an exact
    // narrowing signal, never an execution authorization.
    sources.push('exact');
  }
  if ('exactPatterns' in definition && input.intentText !== undefined) {
    const normalizedIntent = input.intentText.trim();
    if (
      definition.exactPatterns.some((pattern) => {
        const expected = pattern.flags.includes('case_insensitive')
          ? pattern.pattern.toLocaleLowerCase()
          : pattern.pattern;
        const actual = pattern.flags.includes('case_insensitive')
          ? normalizedIntent.toLocaleLowerCase()
          : normalizedIntent;
        return pattern.flags.includes('whole_input')
          ? actual === expected
          : actual.includes(expected);
      })
    ) {
      sources.push('exact');
    }
  }
  if (
    'structuredHints' in definition &&
    definition.structuredHints.some((hint) => structuredHintMatches(hint, input.structuredContext))
  ) {
    sources.push('structured');
  }
  if (semanticScore(ref, input) >= input.semanticThreshold) sources.push('semantic');
  return Object.freeze([...new Set(sources)]);
}

function bindParameters(
  artifact: CompiledArtifact,
  input: ArtifactRetrievalRequest,
): ParameterBindingResult {
  const artifactRef = `${artifact.artifactId}:${String(artifact.version)}`;
  if (!('parameterBindings' in artifact.definition)) {
    return Object.freeze({
      artifactRef,
      bindings: Object.freeze({}),
      missingRequiredParameters: Object.freeze([]),
      rejectedCandidateBindings: Object.freeze([]),
      requiresConfirmation: Object.freeze([]),
    });
  }
  const bindings: Record<string, ParameterBindingValue> = {};
  const missing: string[] = [];
  const rejected: string[] = [];
  const confirmation: string[] = [];
  for (const parameter of artifact.definition.parameterBindings) {
    const matching = input.parameterCandidates
      .filter((candidate) => candidate.parameterName === parameter.parameterName)
      .sort((left, right) => sourcePriority(left.source) - sourcePriority(right.source));
    const accepted = matching.filter((candidate) => {
      if (candidate.source === 'user_preference') {
        const scoped =
          artifact.riskLevel === 'low' &&
          parameter.defaultPolicy === 'low_risk_only' &&
          candidate.lowRiskPreference === true &&
          candidate.tenantId === input.tenantId &&
          candidate.userId === input.userId &&
          candidate.preferenceScope === artifact.scope.domain;
        if (!scoped) rejected.push(parameter.parameterName);
        return scoped;
      }
      const allowed = parameter.allowedSources === candidate.source;
      const sensitive =
        isSensitiveParameter(parameter.parameterName) || artifact.riskLevel === 'critical';
      const permitted = !sensitive || candidate.trust !== 'candidate';
      if (!allowed || !permitted) rejected.push(parameter.parameterName);
      return allowed && permitted;
    });
    const selected = accepted[0];
    if (selected === undefined) {
      if (parameter.required) missing.push(parameter.parameterName);
      continue;
    }
    const conflict = accepted
      .slice(1)
      .some((candidate) => canonical(candidate.value) !== canonical(selected.value));
    if (conflict && selected.trust !== 'authoritative') confirmation.push(parameter.parameterName);
    bindings[parameter.parameterName] = Object.freeze({
      value: selected.value,
      source: selected.source,
      trust: selected.trust,
      confidence: clamp(selected.confidence),
    });
  }
  return Object.freeze({
    artifactRef,
    bindings: Object.freeze(bindings),
    missingRequiredParameters: Object.freeze(unique(missing)),
    rejectedCandidateBindings: Object.freeze(unique(rejected)),
    requiresConfirmation: Object.freeze(unique(confirmation)),
  });
}

async function validateDependencies(
  artifact: CompiledArtifact,
  input: ArtifactRetrievalRequest,
  evidence: ArtifactValidationDependencyPort,
): Promise<DependencyValidationResult> {
  const artifactRef = `${artifact.artifactId}:${String(artifact.version)}`;
  const mismatches = [
    ...dependencySnapshotEquals(artifact.dependencySnapshot, input.currentDependencySnapshot),
  ];
  const versions = await evidence.load({
    artifactId: artifact.artifactId,
    artifactVersion: artifact.version,
  });
  if (versions.validatorVersion !== input.currentValidatorVersion) {
    mismatches.push('DEPENDENCY_VALIDATOR_MISMATCH');
  }
  if (versions.promotionPolicyVersion !== input.currentPromotionPolicyVersion) {
    mismatches.push('DEPENDENCY_PROMOTION_POLICY_MISMATCH');
  }
  const reasonCodes = unique([
    ...mismatches.filter(
      (value) =>
        value !== 'DEPENDENCY_VALIDATOR_MISMATCH' &&
        value !== 'DEPENDENCY_PROMOTION_POLICY_MISMATCH',
    ),
    ...(mismatches.includes('DEPENDENCY_VALIDATOR_MISMATCH') ? ['DEPENDENCY_SCHEMA_MISMATCH'] : []),
    ...(mismatches.includes('DEPENDENCY_PROMOTION_POLICY_MISMATCH')
      ? ['DEPENDENCY_POLICY_MISMATCH']
      : []),
  ]);
  return Object.freeze({
    artifactRef,
    valid: mismatches.length === 0,
    mismatches: Object.freeze(mismatches),
    snapshotHash: artifact.dependencySnapshot.capabilityCatalogHash,
    reasonCodes: Object.freeze(mismatches.length === 0 ? ['DEPENDENCY_VALID'] : reasonCodes),
  });
}

function validateCapabilityReadiness(
  artifact: CompiledArtifact,
  input: ArtifactRetrievalRequest,
): CapabilityReadinessResult {
  const artifactRef = `${artifact.artifactId}:${String(artifact.version)}`;
  const reasonCodes: string[] = [];
  const refs: string[] = [];
  const readiness: Record<string, ProviderReadiness> = {};
  let valid = true;
  for (const capability of artifact.requiredCapabilities) {
    if (!input.knownCapabilityIds.has(capability.capabilityId)) {
      valid = false;
      reasonCodes.push('CAPABILITY_GAP');
      continue;
    }
    const candidates = input.skillCandidateRefs[capability.capabilityId] ?? [];
    if (candidates.length === 0) {
      valid = false;
      reasonCodes.push('SKILL_CANDIDATE_UNAVAILABLE');
      continue;
    }
    refs.push(...candidates);
    const state = input.providerReadiness[capability.capabilityId] ?? 'unknown';
    readiness[capability.capabilityId] = state;
    if (state !== 'ready') {
      valid = false;
      reasonCodes.push('PROVIDER_NOT_READY');
    }
  }
  if (artifact.requiredCapabilities.length === 0 || valid) reasonCodes.push('CAPABILITY_AVAILABLE');
  if (Object.values(readiness).every((state) => state === 'ready'))
    reasonCodes.push('PROVIDER_READY');
  return Object.freeze({
    artifactRef,
    requiredCapabilities: Object.freeze([...artifact.requiredCapabilities]),
    skillCandidateRefs: Object.freeze(unique(refs)),
    providerReadiness: Object.freeze(readiness),
    valid,
    reasonCodes: Object.freeze(unique(reasonCodes)),
  });
}

function decisionPath(
  input: Readonly<{
    artifact: CompiledArtifact;
    applicability: ArtifactApplicabilityResult;
    parameterBinding: ParameterBindingResult;
    dependencyValidation: DependencyValidationResult;
    capabilityReadiness: CapabilityReadinessResult;
    policyDecision: ArtifactPolicyDecision;
    killSwitchActive: boolean;
  }>,
): FastGatewayPath {
  if (
    input.killSwitchActive ||
    input.policyDecision === 'deny' ||
    input.applicability.disposition === 'deny'
  )
    return 'denied';
  if (
    input.policyDecision === 'require_confirmation' ||
    input.parameterBinding.requiresConfirmation.length > 0
  )
    return 'human_input';
  if (!input.dependencyValidation.valid) return 'cognitive_runtime';
  if (!input.capabilityReadiness.valid) {
    return Object.values(input.capabilityReadiness.providerReadiness).includes('restricted')
      ? 'human_input'
      : 'cognitive_runtime';
  }
  if (input.parameterBinding.missingRequiredParameters.length > 0) {
    return input.artifact.riskLevel === 'low' &&
      !input.parameterBinding.missingRequiredParameters.some(isSensitiveParameter)
      ? 'template_adapt'
      : 'human_input';
  }
  if (input.applicability.disposition === 'fallback') return 'cognitive_runtime';
  if (input.applicability.disposition === 'require_confirmation') return 'human_input';
  if (input.applicability.disposition === 'requires_adaptation') return 'template_adapt';
  return 'compiled_fast';
}

function parameterCoverage(binding: ParameterBindingResult): number {
  const denominator =
    binding.missingRequiredParameters.length + Object.keys(binding.bindings).length;
  return denominator === 0 ? 1 : Object.keys(binding.bindings).length / denominator;
}

function structuredHintMatches(
  hint: Readonly<{ field: string; operator: 'eq' | 'in' | 'exists'; value?: JsonValue }>,
  values: Readonly<Record<string, JsonValue>>,
): boolean {
  const actual = values[hint.field];
  if (hint.operator === 'exists') return actual !== undefined;
  if (actual === undefined) return false;
  if (hint.operator === 'eq') return canonical(actual) === canonical(hint.value);
  return (
    isJsonArray(hint.value) && hint.value.some((value) => canonical(value) === canonical(actual))
  );
}

function semanticScore(ref: string, input: ArtifactRetrievalRequest): number {
  return clamp(input.semanticScores[ref] ?? 0);
}

function riskPenalty(risk: CompiledArtifact['riskLevel']): number {
  return ({ low: 0, medium: 0.2, high: 0.5, critical: 1 } as const)[risk];
}

function isAmbiguous(candidates: readonly EvaluatedCandidate[], threshold: number): boolean {
  if (candidates.length < 2) return false;
  const first = candidates[0];
  const second = candidates[1];
  return (
    first !== undefined &&
    second !== undefined &&
    Math.abs(first.match.score.totalScore - second.match.score.totalScore) <= threshold
  );
}

function retrievalReasonCodes(sources: readonly string[]): readonly string[] {
  return sources.flatMap((source) =>
    source === 'exact'
      ? ['ARTIFACT_EXACT_MATCH']
      : source === 'structured'
        ? ['ARTIFACT_STRUCTURED_MATCH']
        : ['ARTIFACT_SEMANTIC_MATCH'],
  );
}

function parameterReasonCodes(binding: ParameterBindingResult): readonly string[] {
  return [
    ...(binding.missingRequiredParameters.length > 0 ? ['PARAMETER_REQUIRED_MISSING'] : []),
    ...(binding.rejectedCandidateBindings.length > 0 ? ['PARAMETER_CANDIDATE_REJECTED'] : []),
    ...(binding.requiresConfirmation.length > 0
      ? ['PARAMETER_SOURCE_CONFLICT', 'PARAMETER_CONFIRMATION_REQUIRED']
      : []),
  ];
}

function policyReasonCodes(decision: ArtifactPolicyDecision): readonly string[] {
  return [
    decision === 'allow'
      ? 'POLICY_ALLOW'
      : decision === 'deny'
        ? 'POLICY_DENY'
        : 'POLICY_CONFIRMATION_REQUIRED',
  ];
}

function decisionReasonCodes(path: FastGatewayPath): readonly string[] {
  return [
    path === 'compiled_fast'
      ? 'DECISION_ELIGIBLE'
      : path === 'template_adapt'
        ? 'DECISION_REQUIRES_ADAPTATION'
        : path === 'human_input'
          ? 'DECISION_REQUIRE_CONFIRMATION'
          : path === 'denied'
            ? 'DECISION_DENY'
            : 'DECISION_FALLBACK',
  ];
}

function sourcePriority(source: ParameterBindingSource): number {
  return [
    'user_confirmed',
    'request',
    'world_state',
    'runtime_context',
    'user_preference',
    'small_model_candidate',
  ].indexOf(source);
}

function isSensitiveParameter(name: string): boolean {
  return /goal|target|scope|criterion|authorization|safety|threshold|device|area|permission/iu.test(
    name,
  );
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function canonical(value: JsonValue | undefined): string {
  return JSON.stringify(value);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}
