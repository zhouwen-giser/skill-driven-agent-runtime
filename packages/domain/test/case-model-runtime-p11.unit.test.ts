import { describe, expect, it } from 'vitest';

import {
  CASE_MODEL_RUNTIME_CONTRACT_VERSION,
  CASE_MODEL_RUNTIME_SCHEMA_HASHES,
  CaseModelRuntimeDomainError,
  caseSimilarity,
  createCaseRetrievalInput,
  createModelCascadeRun,
  createModelProfile,
  createModelRouteContext,
  createModelRouteDecision,
  hashModelProfileSnapshot,
  type CaseArtifactDefinition,
  type CaseRetrievalInput,
  type ModelProfile,
  type ModelRouteContext,
} from '../src/index.js';

const HASH = `sha256:${'a'.repeat(64)}`;

describe('P11 Case and Model Route Domain', () => {
  it('publishes the exact frozen V1.1 schema hashes', () => {
    expect(CASE_MODEL_RUNTIME_CONTRACT_VERSION).toBe('1.1');
    expect(CASE_MODEL_RUNTIME_SCHEMA_HASHES).toEqual({
      CaseRetrievalInput: '161342c806b7f58254efac7d076d3193da80982d9c0bea22998c91e71cd3b1de',
      CaseMatch: '135dbfad26d68afa26201c43cf69816a80be23d4a550c28062a755ff6cfb084f',
      CaseAdaptationInput: '0c81b6bcabb43c588175a33d2621c431463a2547a6040efdfe39883e3a427929',
      CaseAdaptationResult: 'b2cd17de0f8a9bd09948981f29c368a1bc0ae18fedf4c9caf4d422e26ed2a72d',
      CaseRuntime: 'a2cb1f3f4c0a18abf03d3fb1a552b1f480e11e8a2ac5d3f1aa98c849dd96a387',
      ModelProfile: '03bc8f277534a5a1529d186697f7afa61eb27342a2f6ca6da85e5521d2af70bd',
      ModelRouteContext: '346e0917e77a181b332581bfdb94943742dc0dfec035938e50ba3ac225b93aa2',
      ModelRouteDecision: '9785cd514c16f49982012f3943441defe246c33dfcf3429a3504885187b7d1fd',
      ModelCascadeRun: '160a4e179dc1911f4b56557361bb0c688ea79d6c7f0964646fe70309959591df',
      ModelRouteRuntime: '386a10226570efe3572177718a9bca0f826cf6abc95ac91b63279a5993ae3dae',
    });
  });

  it('freezes Case retrieval facts and rejects non-canonical deadlines', () => {
    const value = createCaseRetrievalInput(caseInput());
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.problemFingerprint)).toBe(true);
    expect(() =>
      createCaseRetrievalInput({ ...caseInput(), deadlineAt: '2026-07-30T00:01:00Z' }),
    ).toThrow(CaseModelRuntimeDomainError);
  });

  it('computes structural Case similarity without treating historical success as applicability', () => {
    expect(caseSimilarity(caseInput(), caseDefinition())).toBe(1);
    expect(
      caseSimilarity(
        {
          ...caseInput(),
          problemFingerprint: {
            ...caseInput().problemFingerprint,
            goalFeatureHash: `sha256:${'b'.repeat(64)}`,
            entityClasses: ['different'],
          },
        },
        {
          ...caseDefinition(),
          priorOutcomeSummary: { successRate: 1, sampleCount: 10_000, limitations: [] },
        },
      ),
    ).toBeLessThan(0.6);
  });

  it('creates secret-free profiles and stable profile snapshots', () => {
    const first = createModelProfile(profile());
    expect(first).not.toHaveProperty('credential');
    expect(hashModelProfileSnapshot([first])).toBe(hashModelProfileSnapshot([profile()]));
    expect(hashModelProfileSnapshot([first])).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('rejects invalid provider capacity', () => {
    expect(() =>
      createModelProfile({
        ...profile(),
        rateCapacity: { ...profile().rateCapacity, remainingInvocations: -1 },
      }),
    ).toThrow(/remainingInvocations/u);
  });

  it('canonicalizes deterministic Model Route decisions and detects forged hashes', () => {
    const decision = createModelRouteDecision({
      route: 'local_small',
      reasonCodes: ['MODEL_ROUTE_SELECTED'],
      budget: { maxTokens: 100, maxLatencyMs: 500, maxCostUnits: 2 },
      fallbackRoutes: ['cloud_medium'],
      selectedProfileRefs: ['profile-b', 'profile-a'],
    });
    expect(decision.selectedProfileRefs).toEqual(['profile-b', 'profile-a']);
    expect(decision.decisionHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(() => createModelRouteDecision({ ...decision, decisionHash: HASH })).toThrow(
      /decisionHash/u,
    );
  });

  it('bounds route budgets and terminal cascade evidence', () => {
    expect(() =>
      createModelRouteContext({
        ...routeContext(),
        budget: { ...routeContext().budget, maxInvocations: 0 },
      }),
    ).toThrow(/budget/u);
    expect(() =>
      createModelCascadeRun({
        cascadeRunId: 'run-1',
        routeDecisionRef: 'decision-1',
        status: 'completed',
        stepRefs: [],
        totalCostUnits: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      }),
    ).toThrow(/completedAt/u);
  });
});

function caseInput(): CaseRetrievalInput {
  return {
    runtimeRequestRef: 'gateway-request-1',
    goalContextRef: 'goal-context-1',
    taskTypeId: 'inspect-device',
    problemFingerprint: {
      goalFeatureHash: HASH,
      entityClasses: ['climate-device'],
      environmentClasses: ['home'],
      capabilityState: ['climate.read'],
      failureTypes: [],
    },
    tenantId: 'tenant-1',
    deadlineAt: '2026-07-30T00:01:00.000Z',
    runtimeSnapshotHash: HASH,
  };
}

function caseDefinition(): CaseArtifactDefinition {
  return {
    problemFingerprint: {
      taskTypeId: 'inspect-device',
      goalFeatureHash: HASH,
      entityClasses: ['climate-device'],
      environmentClasses: ['home'],
      eventTypes: ['provider.read'],
      failureTypes: [],
      capabilityState: ['climate.read'],
      constraints: [],
      riskLevel: 'low',
    },
    solutionPattern: {
      planPatchTemplate: { nodes: [{ capabilityId: 'climate.read' }] },
      decisionSuggestions: [],
    },
    adaptationRules: [],
    applicability: { contextRequirements: [], minimumSimilarity: 0.8 },
    failureBoundaries: [],
    priorOutcomeSummary: { successRate: 0.9, sampleCount: 10, limitations: ['home only'] },
  };
}

function profile(): ModelProfile {
  return {
    profileId: 'profile-small',
    providerId: 'provider-1',
    modelId: 'model-small',
    modelVersion: '2026-07',
    capabilityTags: ['structured_output', 'route:local_small'],
    qualityTier: 1,
    latencyTier: 1,
    costTier: 1,
    contextWindow: 8_192,
    modalities: ['text'],
    structuredOutputSupport: true,
    toolCallingSupport: false,
    dataResidency: ['cn'],
    dataClassificationAllowance: ['internal'],
    rateCapacity: {
      available: true,
      remainingInvocations: 10,
      observedAt: '2026-07-30T00:00:00.000Z',
    },
    readiness: 'ready',
    health: 1,
    profileVersion: 1,
  };
}

function routeContext(): ModelRouteContext {
  return {
    requestRef: 'request-1',
    tenantId: 'tenant-1',
    taskTypeId: 'inspect-device',
    operationType: 'structured_generation',
    riskLevel: 'low',
    dataClassification: 'internal',
    requiredCapabilities: ['structured_output'],
    outputSchemaRef: 'schema:answer:v1',
    deadlineAt: '2026-07-30T00:01:00.000Z',
    budget: {
      maxCostUnits: 3,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxInvocations: 2,
    },
    policySnapshotHash: HASH,
    providerProfileSnapshotHash: hashModelProfileSnapshot([profile()]),
  };
}
