import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  ArtifactRetrievalService,
  ArtifactRegistryService,
  InMemoryArtifactActiveIndexProjection,
  InMemoryArtifactRetrievalCache,
  artifactRetrievalCacheKey,
  type ArtifactMatchAuditInput,
  type ArtifactMatchAuditRepository,
  type ArtifactFeatureFlags,
  type ArtifactRevalidationSignalPort,
  type ArtifactRetrievalRequest,
  type ArtifactRepository,
  type ArtifactValidationDependencyPort,
  type RuntimeCandidateDecisionRepository,
} from '../src/index.js';
import {
  createCompiledArtifact,
  evaluateArtifactApplicability,
  stableRankArtifactMatches,
  type CompiledArtifact,
  type RuntimeExecutionDecision,
} from '../../domain/src/index.js';

let artifact: CompiledArtifact;

beforeAll(async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as { artifacts: CompiledArtifact[] };
  const source = fixture.artifacts[1];
  if (source === undefined) throw new Error('P07 fixture plan artifact missing.');
  artifact = createCompiledArtifact(
    { ...source, status: 'active' },
    { validationPassed: true, approvalRecorded: true },
  );
});

describe('P07 Artifact retrieval and applicability', () => {
  it('returns only the active tenant-scoped artifact, persists its audit and never executes it', async () => {
    const audit = new AuditRecorder();
    const revalidation = new SignalRecorder();
    const repository: ArtifactRepository = {
      findActiveIndex: () =>
        Promise.resolve(
          Object.freeze([
            Object.freeze({
              artifactId: artifact.artifactId,
              artifactKey: artifact.artifactKey,
              artifactVersion: artifact.version,
              artifactType: artifact.artifactType,
              tenantId: 'tenant-a',
              domain: artifact.scope.domain,
              taskTypeIds: artifact.scope.taskTypeIds,
              riskLevel: artifact.riskLevel,
              contentHash: artifact.contentHash,
              dependencySnapshot: artifact.dependencySnapshot,
              pointerLockVersion: 9,
              activatedAt: '2026-07-29T00:00:00.000Z',
            }),
          ]),
        ),
      getDefinition: (ref) =>
        Promise.resolve(
          ref.artifactId === artifact.artifactId && ref.version === artifact.version
            ? artifact
            : undefined,
        ),
      saveCandidate: () => Promise.resolve(),
      activate: () => Promise.resolve(),
      deprecate: () => Promise.resolve(),
    };
    const service = new ArtifactRetrievalService({
      repository,
      audit,
      decisionAudit: new DecisionRecorder(),
      revalidation,
      validationDependencies: { load: matchingValidationDependencies },
      authorization: { isAuthorized: () => Promise.resolve(true) },
      featureFlags: activeFeatureFlags,
      nextDecisionId: () => 'decision-1',
      nextMatchId: () => 'match-1',
      nextTriggerId: () => 'trigger-1',
    });

    const result = await service.retrieve(request());

    expect(result.decision).toMatchObject({
      decisionId: 'decision-1',
      path: 'compiled_fast',
      selectedArtifactRef: `${artifact.artifactId}:${String(artifact.version)}`,
    });
    expect(result.index).toEqual([
      expect.objectContaining({ status: 'active', activePointerVersion: 9 }),
    ]);
    expect(result.parameterBinding?.bindings).toMatchObject({
      deviceId: { source: 'user_confirmed', trust: 'authoritative' },
    });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      decision: 'compiled_fast',
      artifactId: artifact.artifactId,
    });
    expect(revalidation.entries).toEqual([]);
  });

  it('does not let a high score override dependency, readiness or policy gates', async () => {
    const audit = new AuditRecorder();
    const revalidation = new SignalRecorder();
    const service = serviceFor(artifact, audit, revalidation);
    const dependencyMismatch = await service.retrieve({
      ...request(),
      currentDependencySnapshot: {
        ...artifact.dependencySnapshot,
        capabilityCatalogHash: `sha256:${'f'.repeat(64)}`,
      },
    });
    expect(dependencyMismatch.decision.path).toBe('cognitive_runtime');
    expect(revalidation.entries).toHaveLength(1);

    const policyDeny = await service.retrieve({ ...request(), policyDecision: 'deny' });
    expect(policyDeny.decision.path).toBe('denied');
    expect(policyDeny.decision.reasonCodes).toContain('POLICY_DENY');

    const staleValidator = await serviceFor(
      artifact,
      new AuditRecorder(),
      new SignalRecorder(),
      true,
      activeFeatureFlags(),
      {
        load: () =>
          Promise.resolve({
            validatorVersion: 'artifact-static-validator/0.9',
            promotionPolicyVersion: 'artifact-promotion-policy/0.9',
          }),
      },
    ).retrieve(request());
    expect(staleValidator.decision.path).toBe('cognitive_runtime');
    expect(staleValidator.dependencyValidation?.mismatches).toEqual(
      expect.arrayContaining([
        'DEPENDENCY_VALIDATOR_MISMATCH',
        'DEPENDENCY_PROMOTION_POLICY_MISMATCH',
      ]),
    );
  });

  it('fails closed when the deployment authorization port rejects an otherwise matching Artifact', async () => {
    const result = await serviceFor(
      artifact,
      new AuditRecorder(),
      new SignalRecorder(),
      false,
    ).retrieve(request());
    expect(result.matches).toEqual([]);
    expect(result.decision).toMatchObject({ path: 'cognitive_runtime' });
    expect(result.decision.reasonCodes).toContain('ARTIFACT_NO_MATCH');
  });

  it('fails closed for a tenant-scoped Artifact when tenant context is absent', async () => {
    const scoped = createCompiledArtifact(
      { ...artifact, scope: { ...artifact.scope, tenantId: 'tenant-a' } },
      { validationPassed: true, approvalRecorded: true },
    );
    const { tenantId, ...withoutTenant } = request();
    expect(tenantId).toBe('tenant-a');
    const result = await serviceFor(scoped, new AuditRecorder(), new SignalRecorder()).retrieve(
      withoutTenant,
    );
    expect(result.matches).toEqual([]);
    expect(result.decision).toMatchObject({ path: 'cognitive_runtime' });
  });

  it('hard-gates tenant, Artifact type, and global Artifact mode before a score can select', async () => {
    const templateDisabled = await serviceFor(
      artifact,
      new AuditRecorder(),
      new SignalRecorder(),
      true,
      { ...activeFeatureFlags(), templateEnabled: false },
    ).retrieve(request());
    expect(templateDisabled.matches).toEqual([]);
    expect(templateDisabled.decision.path).toBe('cognitive_runtime');

    const tenantDisabled = await serviceFor(
      artifact,
      new AuditRecorder(),
      new SignalRecorder(),
      true,
      { ...activeFeatureFlags(), tenantAllowlist: new Set(['tenant-b']) },
    ).retrieve(request());
    expect(tenantDisabled.matches).toEqual([]);

    const globallyDisabled = await serviceFor(
      artifact,
      new AuditRecorder(),
      new SignalRecorder(),
      true,
      { ...activeFeatureFlags(), artifactMode: 'off' },
    ).retrieve(request());
    expect(globallyDisabled.decision.reasonCodes).toEqual(
      expect.arrayContaining(['KILL_SWITCH_ACTIVE', 'DECISION_FALLBACK']),
    );
  });

  it('loads an immutable definition only after the Level-0 active index narrows candidates', async () => {
    let definitionsRead = 0;
    const matching = indexEntry(artifact);
    const nonMatching = {
      ...matching,
      artifactId: 'artifact.other.1',
      artifactKey: 'other',
      taskTypeIds: ['task_type.other'],
    } as const;
    const repository: ArtifactRepository = {
      findActiveIndex: () => Promise.reject(new Error('P07_L0_READER_REQUIRED')),
      getDefinition: (ref) => {
        definitionsRead += 1;
        return Promise.resolve(ref.artifactId === artifact.artifactId ? artifact : undefined);
      },
      saveCandidate: () => Promise.resolve(),
      activate: () => Promise.resolve(),
      deprecate: () => Promise.resolve(),
    };
    const service = new ArtifactRetrievalService({
      repository,
      activeIndex: { queryActiveIndex: () => Promise.resolve([nonMatching, matching]) },
      audit: new AuditRecorder(),
      decisionAudit: new DecisionRecorder(),
      revalidation: new SignalRecorder(),
      validationDependencies: { load: matchingValidationDependencies },
      authorization: { isAuthorized: () => Promise.resolve(true) },
      featureFlags: activeFeatureFlags,
      nextDecisionId: () => 'p07-l0-decision',
      nextMatchId: () => 'p07-l0-match',
      nextTriggerId: () => 'p07-l0-trigger',
    });
    await expect(service.retrieve(request())).resolves.toMatchObject({
      decision: { selectedArtifactRef: `${artifact.artifactId}:${String(artifact.version)}` },
    });
    expect(definitionsRead).toBe(1);
  });

  it('rebuilds the disposable P02 Level-0 projection after dependency invalidation without trusting it for status', async () => {
    let indexReads = 0;
    const repository: ArtifactRepository = {
      findActiveIndex: () => {
        indexReads += 1;
        return Promise.resolve([indexEntry(artifact)]);
      },
      getDefinition: () => Promise.resolve(artifact),
      saveCandidate: () => Promise.resolve(),
      activate: () => Promise.resolve(),
      deprecate: () => Promise.resolve(),
    };
    const registry = new ArtifactRegistryService({
      repository,
      projection: new InMemoryArtifactActiveIndexProjection(),
    });
    const service = new ArtifactRetrievalService({
      repository,
      activeIndex: registry,
      audit: new AuditRecorder(),
      decisionAudit: new DecisionRecorder(),
      revalidation: new SignalRecorder(),
      validationDependencies: { load: matchingValidationDependencies },
      authorization: { isAuthorized: () => Promise.resolve(true) },
      featureFlags: activeFeatureFlags,
      nextDecisionId: () => 'p07-cache-decision',
      nextMatchId: () => 'p07-cache-match',
      nextTriggerId: () => 'p07-cache-trigger',
    });
    await service.retrieve(request());
    await service.retrieve({ ...request(), requestId: 'request-2' });
    expect(indexReads).toBe(1);
    await registry.invalidateDependency('capability.inspect@2');
    await service.retrieve({ ...request(), requestId: 'request-3' });
    expect(indexReads).toBe(2);
  });

  it('rejects model defaults for sensitive parameters and returns a confirmation path for uncertainty', async () => {
    if (!('parameterBindings' in artifact.definition))
      throw new Error('P07 plan fixture required.');
    const parameter = artifact.definition.parameterBindings[0];
    if (parameter === undefined) throw new Error('P07 plan fixture parameter missing.');
    const sensitive = createCompiledArtifact(
      {
        ...artifact,
        definition: {
          ...artifact.definition,
          parameterBindings: [
            {
              ...parameter,
              parameterName: 'authorization',
              allowedSources: 'small_model_candidate',
            },
          ],
        },
      },
      { validationPassed: true, approvalRecorded: true },
    );
    const result = await serviceFor(sensitive, new AuditRecorder(), new SignalRecorder()).retrieve({
      ...request(),
      parameterCandidates: [
        {
          parameterName: 'authorization',
          value: 'assumed',
          source: 'small_model_candidate',
          trust: 'candidate',
          confidence: 0.99,
        },
      ],
      uncertainty: 0.5,
    });
    expect(result.decision.path).toBe('human_input');
    expect(result.decision.reasonCodes).toEqual(
      expect.arrayContaining(['PARAMETER_CANDIDATE_REJECTED', 'PARAMETER_REQUIRED_MISSING']),
    );
  });

  it('accepts only a tenant- and user-scoped low-risk preference when the template permits it', async () => {
    if (!('parameterBindings' in artifact.definition))
      throw new Error('P07 plan fixture required.');
    const parameter = artifact.definition.parameterBindings[0];
    if (parameter === undefined) throw new Error('P07 plan fixture parameter missing.');
    const preferenceArtifact = createCompiledArtifact(
      {
        ...artifact,
        definition: {
          ...artifact.definition,
          parameterBindings: [
            {
              ...parameter,
              allowedSources: 'request',
              defaultPolicy: 'low_risk_only',
            },
          ],
        },
      },
      { validationPassed: true, approvalRecorded: true },
    );
    const accepted = await serviceFor(
      preferenceArtifact,
      new AuditRecorder(),
      new SignalRecorder(),
    ).retrieve({
      ...request(),
      parameterCandidates: [
        {
          parameterName: 'deviceId',
          value: 'device-preference-a',
          source: 'user_preference',
          trust: 'trusted',
          confidence: 0.8,
          tenantId: 'tenant-a',
          userId: 'user-a',
          preferenceScope: 'operations',
          lowRiskPreference: true,
        },
      ],
    });
    expect(accepted.parameterBinding?.bindings['deviceId']).toMatchObject({
      source: 'user_preference',
      trust: 'trusted',
    });

    const rejected = await serviceFor(
      preferenceArtifact,
      new AuditRecorder(),
      new SignalRecorder(),
    ).retrieve({
      ...request(),
      parameterCandidates: [
        {
          parameterName: 'deviceId',
          value: 'device-preference-b',
          source: 'user_preference',
          trust: 'trusted',
          confidence: 0.8,
          tenantId: 'tenant-a',
          userId: 'another-user',
          preferenceScope: 'operations',
          lowRiskPreference: true,
        },
      ],
    });
    expect(rejected.decision.path).toBe('human_input');
    expect(rejected.decision.reasonCodes).toContain('PARAMETER_CANDIDATE_REJECTED');
  });

  it('keeps tie-break ordering deterministic and cache keys include every invalidation authority', async () => {
    const ranked = stableRankArtifactMatches([
      {
        artifactKey: 'z',
        artifactVersion: 1,
        artifactRef: 'z:1',
        retrievalSources: ['exact'],
        reasonCodes: [],
        score: score(0.5),
      },
      {
        artifactKey: 'a',
        artifactVersion: 2,
        artifactRef: 'a:2',
        retrievalSources: ['exact'],
        reasonCodes: [],
        score: score(0.5),
      },
    ]);
    expect(ranked.map((item) => item.artifactRef)).toEqual(['a:2', 'z:1']);
    const key = artifactRetrievalCacheKey({
      artifactRef: 'a:2',
      activePointerVersion: 9,
      tenantId: 'tenant-a',
      catalogHash: 'catalog',
      policyHash: 'policy',
      schemaVersion: '1.1',
    });
    expect(key).toContain('tenant-a');
    expect(key).toContain('catalog');
    const cache = new InMemoryArtifactRetrievalCache();
    await cache.put(key, {
      decisionId: 'd',
      requestId: 'r',
      path: 'compiled_fast',
      parameterBindings: {},
      missingParameters: [],
      requiredConfirmations: [],
      reasonCodes: [],
      matcherSnapshotHash: 'matcher',
      policySnapshotHash: 'policy',
      createdAt: '2026-07-29T00:00:00.000Z',
    });
    await expect(cache.clear()).resolves.toBeUndefined();
  });

  it('interprets forbidden conditions fail-closed without using score', () => {
    const result = evaluateArtifactApplicability(
      {
        ...artifact,
        applicability: {
          ...artifact.applicability,
          forbiddenConditions: [
            { type: 'atomic', field: 'request.blocked', operator: 'eq', value: true },
          ],
        },
      },
      { values: { 'request.blocked': true }, uncertainty: 0, outOfDistribution: false },
    );
    expect(result).toMatchObject({ applicable: false, disposition: 'fallback' });
    expect(result.reasonCodes).toContain('FORBIDDEN_CONDITION_MATCHED');
  });
});

function serviceFor(
  definition: CompiledArtifact,
  audit: AuditRecorder,
  revalidation: SignalRecorder,
  authorized = true,
  featureFlags = activeFeatureFlags(),
  validationDependencies: ArtifactValidationDependencyPort = {
    load: matchingValidationDependencies,
  },
): ArtifactRetrievalService {
  const repository: ArtifactRepository = {
    findActiveIndex: () => Promise.resolve([indexEntry(definition)]),
    getDefinition: () => Promise.resolve(definition),
    saveCandidate: () => Promise.resolve(),
    activate: () => Promise.resolve(),
    deprecate: () => Promise.resolve(),
  };
  return new ArtifactRetrievalService({
    repository,
    audit,
    decisionAudit: new DecisionRecorder(),
    revalidation,
    validationDependencies,
    authorization: { isAuthorized: () => Promise.resolve(authorized) },
    featureFlags: () => featureFlags,
    nextDecisionId: () => 'decision',
    nextMatchId: () => `match-${String(audit.entries.length + 1)}`,
    nextTriggerId: () => `trigger-${String(revalidation.entries.length + 1)}`,
  });
}

function activeFeatureFlags(): ArtifactFeatureFlags {
  return {
    artifactMode: 'active' as const,
    templateEnabled: true,
    ruleEnabled: true,
    fastGatewayEnabled: true,
    caseEnabled: true,
    modelCascadeEnabled: true,
    tenantAllowlist: new Set<string>(),
  };
}

function matchingValidationDependencies() {
  return Promise.resolve({
    validatorVersion: 'artifact-static-validator/1.1',
    promotionPolicyVersion: 'artifact-promotion-policy/1.1',
  });
}

function indexEntry(value: CompiledArtifact) {
  return {
    artifactId: value.artifactId,
    artifactKey: value.artifactKey,
    artifactVersion: value.version,
    artifactType: value.artifactType,
    tenantId: 'tenant-a',
    domain: value.scope.domain,
    taskTypeIds: value.scope.taskTypeIds,
    riskLevel: value.riskLevel,
    contentHash: value.contentHash,
    dependencySnapshot: value.dependencySnapshot,
    pointerLockVersion: 1,
    activatedAt: '2026-07-29T00:00:00.000Z',
  } as const;
}

function request(): ArtifactRetrievalRequest {
  return {
    requestId: 'request-1',
    taskId: 'task-1',
    tenantId: 'tenant-a',
    userId: 'user-a',
    domain: 'operations',
    taskTypeIds: ['task_type.inspect'],
    intentText: 'inspect device',
    structuredContext: { environmentClass: 'trusted_intranet' },
    parameterCandidates: [
      {
        parameterName: 'deviceId',
        value: 'device-1',
        source: 'user_confirmed',
        trust: 'authoritative',
        confidence: 1,
      },
    ],
    semanticScores: {},
    semanticThreshold: 0.8,
    ambiguityThreshold: 0.01,
    uncertainty: 0,
    outOfDistribution: false,
    currentDependencySnapshot: artifact.dependencySnapshot,
    currentValidatorVersion: 'artifact-static-validator/1.1',
    currentPromotionPolicyVersion: 'artifact-promotion-policy/1.1',
    knownCapabilityIds: new Set(['capability.inspect']),
    skillCandidateRefs: { 'capability.inspect': ['skill.inspect:1'] },
    providerReadiness: { 'capability.inspect': 'ready' },
    policyDecision: 'allow',
    policySnapshotHash: `sha256:${'c'.repeat(64)}`,
    killSwitchActive: false,
    matcherSnapshotHash: `sha256:${'d'.repeat(64)}`,
    createdAt: '2026-07-29T00:00:00.000Z',
  };
}

function score(totalScore: number) {
  return {
    intentScore: totalScore,
    structuredConditionScore: 0,
    parameterCoverageScore: 0,
    capabilityShapeScore: 0,
    environmentSimilarityScore: 0,
    validationConfidenceScore: 0,
    recentReliabilityScore: 0,
    riskPenalty: 0,
    totalScore,
  } as const;
}

class AuditRecorder implements ArtifactMatchAuditRepository {
  readonly entries: ArtifactMatchAuditInput[] = [];
  append(input: ArtifactMatchAuditInput): Promise<void> {
    this.entries.push(input);
    return Promise.resolve();
  }
}

class SignalRecorder implements ArtifactRevalidationSignalPort {
  readonly entries: { artifactRef: string }[] = [];
  signal(input: { artifactRef: string }): Promise<void> {
    this.entries.push(input);
    return Promise.resolve();
  }
}

class DecisionRecorder implements RuntimeCandidateDecisionRepository {
  readonly entries: string[] = [];

  append(input: Readonly<{ decision: RuntimeExecutionDecision; matchId?: string }>): Promise<void> {
    this.entries.push(input.decision.decisionId);
    return Promise.resolve();
  }
}
