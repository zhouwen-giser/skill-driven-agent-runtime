import { describe, expect, it, vi } from 'vitest';

import {
  CaseGatewayArtifactAdapter,
  ModelRouteGatewayArtifactAdapter,
  TypeKeyedGatewayArtifactAdapterRegistry,
  type ArtifactRetrievalResult,
} from '../src/compiler/index.js';
import {
  CASE_MODEL_RUNTIME_SCHEMA_HASHES,
  type CaseAdaptationResult,
  type ModelRouteContext,
  type RuntimeRequestContext,
  type UserGoalPlanCandidate,
} from '../../domain/src/index.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-07-30T00:00:00.000Z';
const DEADLINE = '2026-07-30T00:01:00.000Z';

describe('P11 frozen adapters and consumed ports', () => {
  it('registers one adapter per Artifact type and rejects duplicate ownership', () => {
    const adapter = {
      execute: () => Promise.resolve({ disposition: 'fallback' as const, resultRef: 'fallback-1' }),
    };
    const registry = new TypeKeyedGatewayArtifactAdapterRegistry([
      { artifactType: 'case_template', adapter },
      { artifactType: 'model_route', adapter },
    ]);
    expect(registry.find('case_template')).toBe(adapter);
    expect(registry.find('decision_rule')).toBeUndefined();
    expect(
      () =>
        new TypeKeyedGatewayArtifactAdapterRegistry([
          { artifactType: 'case_template', adapter },
          { artifactType: 'case_template', adapter },
        ]),
    ).toThrow(/GATEWAY_ADAPTER_DUPLICATE/u);
  });

  it('submits a safe Case candidate only through the frozen P08 handoff port', async () => {
    const submit = vi.fn(() =>
      Promise.resolve({
        handoffId: 'handoff-1',
        planCandidateRef: 'candidate-1',
        disposition: 'requires_confirmation' as const,
        formalPlanningSessionRef: 'planning-session-1',
        reasonCodes: ['CONFIRMATION_REQUIRED'],
        completedAt: NOW,
      }),
    );
    const adaptation: CaseAdaptationResult = {
      caseRef: 'case-1:1',
      parameterMappings: { room: 'office' },
      planPatchCandidate: { nodes: [{ capabilityId: 'climate.read' }] },
      confidence: 0.9,
      unknowns: [],
      validationRequired: true,
    };
    const adapter = new CaseGatewayArtifactAdapter({
      runtime: {
        retrieve: () =>
          Promise.resolve([
            {
              caseRef: 'case-1:1',
              score: 0.9,
              applicability: 'eligible',
              failureBoundaryStatus: 'clear',
              reasonCodes: ['CASE_ACTIVE_MATCH'],
            },
          ]),
        adapt: () => Promise.resolve(adaptation),
      },
      requests: {
        create: () =>
          Promise.resolve({
            retrievalInput: {
              runtimeRequestRef: 'gateway-1',
              goalContextRef: 'goal-1',
              taskTypeId: 'inspect-device',
              problemFingerprint: {
                goalFeatureHash: HASH,
                entityClasses: ['climate-device'],
                environmentClasses: ['home'],
                capabilityState: ['climate.read'],
                failureTypes: [],
              },
              tenantId: 'tenant-1',
              deadlineAt: DEADLINE,
              runtimeSnapshotHash: HASH,
            },
            adaptationInput: {
              caseRef: 'case-1:1',
              goalContextRef: 'goal-1',
              parameterBindingRef: 'binding-1',
              policyDecisionRef: 'policy-1',
              deadlineAt: DEADLINE,
              runtimeSnapshotHash: HASH,
            },
            toPlanCandidate: () => Promise.resolve(candidate()),
          }),
      },
      current: { verify: () => Promise.resolve(true) },
      handoff: { submit },
    });
    const outcome = await adapter.execute(
      context(),
      retrieval('case_template', 'case_adapt', 'case-1:1'),
      activeExecution(),
    );
    expect(outcome).toMatchObject({
      disposition: 'requires_confirmation',
      formalHandoffRef: 'handoff-1',
      interactionRef: 'planning-session-1',
    });
    expect(submit).toHaveBeenCalledOnce();
  });

  it('discards a Case candidate before P08 when current Goal/Policy/Case facts changed', async () => {
    const submit = vi.fn();
    const adapter = new CaseGatewayArtifactAdapter({
      runtime: {
        retrieve: () =>
          Promise.resolve([
            {
              caseRef: 'case-1:1',
              score: 1,
              applicability: 'eligible',
              failureBoundaryStatus: 'clear',
              reasonCodes: [],
            },
          ]),
        adapt: () =>
          Promise.resolve({
            caseRef: 'case-1:1',
            parameterMappings: {},
            planPatchCandidate: {},
            confidence: 1,
            unknowns: [],
            validationRequired: true,
          }),
      },
      requests: {
        create: () =>
          Promise.resolve({
            retrievalInput: {
              runtimeRequestRef: 'gateway-1',
              goalContextRef: 'goal-1',
              taskTypeId: 'inspect-device',
              problemFingerprint: {
                goalFeatureHash: HASH,
                entityClasses: [],
                environmentClasses: [],
                capabilityState: [],
                failureTypes: [],
              },
              tenantId: 'tenant-1',
              deadlineAt: DEADLINE,
              runtimeSnapshotHash: HASH,
            },
            adaptationInput: {
              caseRef: 'case-1:1',
              goalContextRef: 'goal-1',
              parameterBindingRef: 'binding-1',
              policyDecisionRef: 'policy-1',
              deadlineAt: DEADLINE,
              runtimeSnapshotHash: HASH,
            },
            toPlanCandidate: () => Promise.resolve(candidate()),
          }),
      },
      current: { verify: () => Promise.resolve(false) },
      handoff: { submit },
    });
    await expect(
      adapter.execute(
        context(),
        retrieval('case_template', 'case_adapt', 'case-1:1'),
        activeExecution(),
      ),
    ).resolves.toMatchObject({ disposition: 'discarded_stale' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('maps a bounded Model Cascade output back to the existing small_model Gateway path', async () => {
    const routeContext: ModelRouteContext = {
      requestRef: 'request-1',
      tenantId: 'tenant-1',
      operationType: 'structured_generation',
      riskLevel: 'low',
      dataClassification: 'internal',
      requiredCapabilities: ['structured_output'],
      outputSchemaRef: 'schema:answer:v1',
      deadlineAt: DEADLINE,
      budget: { maxCostUnits: 1, maxInvocations: 1 },
      policySnapshotHash: HASH,
      providerProfileSnapshotHash: HASH,
    };
    const decision = {
      route: 'local_small' as const,
      reasonCodes: ['MODEL_ROUTE_SELECTED'],
      budget: { maxTokens: 100, maxLatencyMs: 500, maxCostUnits: 1 },
      fallbackRoutes: [],
      selectedProfileRefs: ['profile-1'],
      decisionHash: `sha256:${'b'.repeat(64)}`,
    };
    const cascade = {
      run: vi.fn(() =>
        Promise.resolve({
          cascadeRunId: 'cascade-1',
          routeDecisionRef: 'route-decision-1',
          status: 'completed' as const,
          stepRefs: ['step-1'],
          selectedOutputRef: 'output-1',
          totalCostUnits: 0.1,
          totalInputTokens: 10,
          totalOutputTokens: 5,
          completedAt: NOW,
        }),
      ),
    };
    const adapter = new ModelRouteGatewayArtifactAdapter({
      runtime: { evaluate: () => Promise.resolve(decision) },
      cascade,
      requests: {
        create: () =>
          Promise.resolve({
            routeContext,
            artifactRef: 'route-1:1',
            artifactHash: HASH,
          }),
      },
    });
    await expect(
      adapter.execute(
        context(),
        retrieval('model_route', 'small_model', 'route-1:1'),
        activeExecution(),
      ),
    ).resolves.toEqual({ disposition: 'completed', resultRef: 'output-1' });
    expect(cascade.run).toHaveBeenCalledOnce();
  });

  it('keeps all ten produced schema hashes exact and secret-free', () => {
    expect(Object.keys(CASE_MODEL_RUNTIME_SCHEMA_HASHES)).toHaveLength(10);
    expect(JSON.stringify(CASE_MODEL_RUNTIME_SCHEMA_HASHES)).not.toMatch(
      /credential|secret|prompt/iu,
    );
  });
});

function context(): RuntimeRequestContext {
  return {
    requestId: 'request-1',
    taskId: 'task-1',
    contextId: 'context-1',
    rawText: 'inspect device',
    normalizedText: 'inspect device',
    actor: {
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      authenticationRef: 'auth-1',
      authorizationRefs: ['read'],
    },
    extractedFeatures: {},
    worldStateRef: 'world-1',
    capabilitySummaryRef: 'capability-1',
    policySnapshotRef: 'policy-1',
    deadlineAt: DEADLINE,
    cancellationRef: 'cancel-1',
    idempotencyKey: 'idempotency-1',
    createdAt: NOW,
  };
}

function retrieval(
  artifactType: 'case_template' | 'model_route',
  path: 'case_adapt' | 'small_model',
  artifactRef: string,
): ArtifactRetrievalResult {
  return {
    index: [
      {
        artifactRef,
        artifactKey: artifactRef,
        artifactVersion: 1,
        artifactType,
        tenantId: 'tenant-1',
        domain: 'device',
        taskTypeIds: ['inspect-device'],
        riskLevel: 'low',
        status: 'active',
        exactPatterns: [],
        structuredHints: [],
        activePointerVersion: 1,
        contentHash: HASH,
      },
    ],
    matches: [],
    decision: {
      decisionId: 'decision-1',
      requestId: 'request-1',
      path,
      selectedArtifactRef: artifactRef,
      parameterBindings: {},
      missingParameters: [],
      requiredConfirmations: [],
      reasonCodes: [],
      matcherSnapshotHash: HASH,
      policySnapshotHash: HASH,
      createdAt: NOW,
    },
  };
}

function activeExecution() {
  return {
    signal: new AbortController().signal,
    deadlineAt: DEADLINE,
    budgetMs: 1_000,
    mayCommitFormalAuthority: () => true,
  };
}

function candidate(): UserGoalPlanCandidate {
  return {
    candidateId: 'candidate-1',
    goalContractRef: 'goal-1',
    goalVersion: 1,
    sourceArtifactRef: 'case-1',
    sourceArtifactVersion: 1,
    sourceArtifactHash: HASH,
    parameterBindings: {},
    skillGoalGraph: { nodes: [], dependencies: [], parallelGroups: {} },
    completionContract: {
      title: 'Inspect',
      description: 'Inspect device',
      requiredCriterionRefs: [],
      evidenceRequirementRefs: [],
      artifactRequirementRefs: [],
    },
    recoveryBranches: [],
    criterionCoverage: {
      requiredCriterionRefs: [],
      coveredCriterionRefs: [],
      missingCriterionRefs: [],
    },
    adaptationRefs: ['case-adaptation-1'],
    runtimeSnapshotHash: HASH,
    contentHash: HASH,
  };
}
