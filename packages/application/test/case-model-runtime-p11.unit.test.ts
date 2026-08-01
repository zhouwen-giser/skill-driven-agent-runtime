import { describe, expect, it } from 'vitest';

import {
  CaseRuntimeApplicationError,
  CaseRuntimeService,
  ModelCascadeService,
  ModelRouteRuntimeService,
  ProviderAuthorityModelCascadeInvocationAdapter,
  ProviderRegistryModelProfileReader,
  type ActiveCaseProjection,
  type ActiveModelRouteProjection,
  type CaseModelArtifactReader,
  type CaseRuntimeEvidenceRepository,
  type ModelRouteEvidenceRepository,
} from '../src/compiler/index.js';
import {
  hashModelProfileSnapshot,
  type CaseAdaptationInput,
  type CaseArtifactDefinition,
  type CaseRetrievalInput,
  type ModelProfile,
  type ModelRouteContext,
} from '../../domain/src/index.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-07-30T00:00:00.000Z';
const DEADLINE = '2026-07-30T00:01:00.000Z';

describe('P11 Case Runtime', () => {
  it('ranks only the selected tenant/task Case and preserves a matched failure boundary', async () => {
    const artifacts = artifactReader();
    const evidence = caseEvidence();
    const service = new CaseRuntimeService({
      artifacts,
      bindings: { read: () => Promise.resolve({}) },
      evidence,
      clock: clock(),
    });
    const matches = await service.retrieve(caseRequest(['provider.timeout']));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      caseRef: 'case-1:1',
      failureBoundaryStatus: 'matched',
      applicability: 'require_confirmation',
    });
    expect(evidence.matches).toHaveLength(1);
  });

  it('adapts trusted parameters but always requires P08 validation', async () => {
    const evidence = caseEvidence();
    const service = new CaseRuntimeService({
      artifacts: artifactReader(),
      bindings: {
        read: () =>
          Promise.resolve({
            room: { value: 'office', trust: 'trusted' },
            temperature: { value: 21, trust: 'authoritative' },
            guess: { value: 'unverified', trust: 'candidate' },
          }),
      },
      evidence,
      clock: clock(),
    });
    const result = await service.adapt(adaptationRequest());
    expect(result.parameterMappings).toEqual({ room: 'office', temperature: 21 });
    expect(result.planPatchCandidate).toEqual({
      nodes: [{ capabilityId: 'climate.read', input: { room: 'office', temperature: 21 } }],
    });
    expect(result.unknowns).toEqual(['guess']);
    expect(result.validationRequired).toBe(true);
    expect(evidence.adaptations).toHaveLength(1);
  });

  it('rejects credentials and historical exact instance identifiers', async () => {
    const service = new CaseRuntimeService({
      artifacts: artifactReader(),
      bindings: {
        read: () =>
          Promise.resolve({
            credential_token: { value: 'secret', trust: 'authoritative' },
          }),
      },
      evidence: caseEvidence(),
      clock: clock(),
    });
    await expect(service.adapt(adaptationRequest())).rejects.toBeInstanceOf(
      CaseRuntimeApplicationError,
    );
  });

  it.each(['personal_email', 'personalEmail', 'userId'])(
    'rejects nested trusted PII binding field %s',
    async (piiField) => {
      const service = new CaseRuntimeService({
        artifacts: artifactReader(),
        bindings: {
          read: () =>
            Promise.resolve({
              room: {
                value: { occupant: { [piiField]: 'person@example.test' } },
                trust: 'authoritative',
              },
            }),
        },
        evidence: caseEvidence(),
        clock: clock(),
      });
      await expect(service.adapt(adaptationRequest())).rejects.toMatchObject({
        code: 'CASE_PII_REJECTED',
      });
    },
  );

  it('rejects camelCase credential and historical instance fields', async () => {
    const service = new CaseRuntimeService({
      artifacts: artifactReader(),
      bindings: {
        read: () =>
          Promise.resolve({
            room: {
              value: { apiKey: 'secret', historicalInstanceId: 'instance-7' },
              trust: 'authoritative',
            },
          }),
      },
      evidence: caseEvidence(),
      clock: clock(),
    });
    await expect(service.adapt(adaptationRequest())).rejects.toMatchObject({
      code: 'CASE_CREDENTIAL_OR_HISTORICAL_ID_REJECTED',
    });
  });
});

describe('P11 Model Route and Cascade', () => {
  it('rejects unknown readiness, capability and classification before deterministic ranking', async () => {
    const ready = profile('ready-a', 'ready', 2, 2);
    const cheaper = profile('ready-b', 'ready', 2, 1);
    const unknown = profile('unknown', 'unknown', 9, 0);
    const profiles = [unknown, ready, cheaper];
    const evidence = routeEvidence();
    const service = new ModelRouteRuntimeService({
      artifacts: artifactReader(),
      profiles: { listCurrent: () => Promise.resolve(profiles) },
      evidence,
      clock: clock(),
    });
    const decision = await service.evaluate(routeContext(profiles));
    expect(decision.selectedProfileRefs).toEqual(['ready-b', 'ready-a']);
    expect(decision.selectedProfileRefs).not.toContain('unknown');
    expect(evidence.decisions).toHaveLength(1);
  });

  it('fails closed when the provider profile snapshot is stale', async () => {
    const service = new ModelRouteRuntimeService({
      artifacts: artifactReader(),
      profiles: {
        listCurrent: () => Promise.resolve([profile('ready-a', 'ready', 1, 1)]),
      },
      evidence: routeEvidence(),
      clock: clock(),
    });
    await expect(
      service.evaluate({
        ...routeContext([]),
        providerProfileSnapshotHash: HASH,
      }),
    ).rejects.toThrow(/MODEL_ROUTE_PROFILE_STALE/u);
  });

  it('scopes equal route decisions to the request and tenant evidence identity', async () => {
    const profiles = [profile('ready-a', 'ready', 1, 1)];
    const evidence = routeEvidence();
    const service = new ModelRouteRuntimeService({
      artifacts: artifactReader(),
      profiles: { listCurrent: () => Promise.resolve(profiles) },
      evidence,
      clock: clock(),
    });
    const first = await service.evaluate(routeContext(profiles));
    const second = await service.evaluate({
      ...routeContext(profiles),
      requestRef: 'request-2',
    });

    expect(first.decisionHash).toBe(second.decisionHash);
    const references = evidence.decisions.map(
      (item) => (item as { routeDecisionRef: string }).routeDecisionRef,
    );
    expect(references).toHaveLength(2);
    expect(new Set(references).size).toBe(2);
    expect(references).toEqual([
      expect.stringMatching(/^model-route-decision:[0-9a-f]{24}$/u),
      expect.stringMatching(/^model-route-decision:[0-9a-f]{24}$/u),
    ]);
  });

  it('serially escalates only after validation failure and accepts the next bounded output', async () => {
    const profiles = [profile('small', 'ready', 1, 1), profile('medium', 'ready', 2, 2)];
    const evidence = routeEvidence();
    const decision = {
      route: 'local_small' as const,
      reasonCodes: ['MODEL_ROUTE_SELECTED'],
      budget: { maxTokens: 100, maxLatencyMs: 500, maxCostUnits: 10 },
      fallbackRoutes: ['cloud_medium' as const],
      selectedProfileRefs: ['small', 'medium'],
      decisionHash: `sha256:${'b'.repeat(64)}`,
    };
    const callOrder: string[] = [];
    const cascade = new ModelCascadeService({
      profiles: { listCurrent: () => Promise.resolve(profiles) },
      invocations: {
        invoke: ({ profile: selected }) => {
          callOrder.push(selected.profileId);
          return Promise.resolve({
            outputRef: `output:${selected.profileId}`,
            output: { accepted: selected.profileId === 'medium' },
            inputTokens: 10,
            outputTokens: 5,
            costUnits: 1,
          });
        },
      },
      validator: {
        validate: ({ output }) =>
          Promise.resolve({
            accepted: isJsonRecord(output) && output['accepted'] === true,
            reasonCode: 'SCHEMA_INVALID',
          }),
      },
      current: { verify: () => Promise.resolve(true) },
      evidence,
      clock: clock(),
    });
    const run = await cascade.run({
      context: routeContext(profiles),
      decision,
      artifactRef: 'route-1:1',
      artifactHash: HASH,
      signal: new AbortController().signal,
    });
    expect(callOrder).toEqual(['small', 'medium']);
    expect(run.status).toBe('completed');
    expect(run.selectedOutputRef).toBe('output:medium');
    expect(run.totalCostUnits).toBe(2);
    expect(evidence.cascades).toHaveLength(1);
  });

  it('discards a late/stale result and never attempts a later step', async () => {
    const profiles = [profile('small', 'ready', 1, 1), profile('medium', 'ready', 2, 2)];
    let checks = 0;
    let invocations = 0;
    const cascade = new ModelCascadeService({
      profiles: { listCurrent: () => Promise.resolve(profiles) },
      invocations: {
        invoke: () => {
          invocations += 1;
          return Promise.resolve({
            outputRef: 'output:late',
            output: { accepted: true },
            inputTokens: 1,
            outputTokens: 1,
            costUnits: 1,
          });
        },
      },
      validator: { validate: () => Promise.resolve({ accepted: true }) },
      current: {
        verify: () => {
          checks += 1;
          return Promise.resolve(checks === 1);
        },
      },
      evidence: routeEvidence(),
      clock: clock(),
    });
    const run = await cascade.run({
      context: routeContext(profiles),
      decision: {
        route: 'local_small',
        reasonCodes: ['MODEL_ROUTE_SELECTED'],
        budget: { maxTokens: 10, maxLatencyMs: 500, maxCostUnits: 10 },
        fallbackRoutes: [],
        selectedProfileRefs: ['small', 'medium'],
        decisionHash: `sha256:${'b'.repeat(64)}`,
      },
      artifactRef: 'route-1:1',
      artifactHash: HASH,
      signal: new AbortController().signal,
    });
    expect(invocations).toBe(1);
    expect(run.status).toBe('failed');
    expect(run.selectedOutputRef).toBeUndefined();
  });

  it('projects profiles from provider/readiness authority without credentials', async () => {
    const reader = new ProviderRegistryModelProfileReader({
      repository: {
        listProviders: () =>
          Promise.resolve([
            {
              providerId: 'provider-1',
              name: 'Provider',
              kind: 'local',
              apiStyle: 'openai_chat_completions',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'model-1',
              enabled: true,
              timeoutMs: 1_000,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ]),
      },
      metadata: {
        read: () =>
          Promise.resolve({
            modelVersion: '1',
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
            profileVersion: 1,
          }),
      },
      readiness: {
        read: () =>
          Promise.resolve({
            readiness: 'unknown',
            health: 0,
            capacityAvailable: true,
            remainingInvocations: 10,
            observedAt: NOW,
          }),
      },
    });
    const profiles = await reader.listCurrent('tenant-1');
    expect(profiles[0]).toMatchObject({ readiness: 'unknown', providerId: 'provider-1' });
    expect(profiles[0]).not.toHaveProperty('encryptedCredential');
    expect(profiles[0]).not.toHaveProperty('credential');
  });

  it('uses existing provider and credential authority and records measured invocation usage', async () => {
    const invocations: unknown[] = [];
    const adapter = new ProviderAuthorityModelCascadeInvocationAdapter({
      repository: {
        findProvider: () =>
          Promise.resolve({
            configuration: {
              providerId: 'provider-small',
              name: 'Provider',
              kind: 'local',
              apiStyle: 'openai_chat_completions',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'model-small',
              enabled: true,
              timeoutMs: 1_000,
              createdAt: NOW,
              updatedAt: NOW,
            },
            encryptedCredential: 'encrypted',
          }),
        saveInvocation: (record) => {
          invocations.push(record);
          return Promise.resolve();
        },
      },
      transport: {
        generateStructured: ({ credentialHeaders }) => {
          expect(credentialHeaders).toEqual({ Authorization: 'Bearer secret' });
          return Promise.resolve({
            rawResponse: { id: 'response-1' },
            structuredResult: { accepted: true },
            inputTokens: 10,
            outputTokens: 5,
          });
        },
        embed: () => Promise.resolve({ rawResponse: {}, vector: [0.1] }),
      },
      cipher: {
        encrypt: () => 'encrypted',
        decrypt: () => ({ Authorization: 'Bearer secret' }),
      },
      requests: {
        read: () =>
          Promise.resolve({
            instruction: 'Return a structured answer.',
            responseSchema: { type: 'object' },
            correctionErrors: [],
            taskId: 'task-1',
          }),
      },
      clock: { now: () => NOW },
      ids: { nextInvocationId: () => 'invocation-1' },
    });
    const result = await adapter.invoke({
      profile: profile('small', 'ready', 1, 2),
      requestRef: 'request-1',
      outputSchemaRef: 'schema:answer:v1',
      signal: new AbortController().signal,
      timeoutMs: 1_000,
    });
    expect(result).toMatchObject({
      outputRef: 'model-output:invocation-1',
      inputTokens: 10,
      outputTokens: 5,
      costUnits: 0.03,
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).not.toHaveProperty('credential');
  });

  it('actively aborts a provider invocation when its bounded step timeout expires', async () => {
    let observedSignal: AbortSignal | undefined;
    const adapter = new ProviderAuthorityModelCascadeInvocationAdapter({
      repository: {
        findProvider: () =>
          Promise.resolve({
            configuration: {
              providerId: 'provider-small',
              name: 'Provider',
              kind: 'local',
              apiStyle: 'openai_chat_completions',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'model-small',
              enabled: true,
              timeoutMs: 1_000,
              createdAt: NOW,
              updatedAt: NOW,
            },
            encryptedCredential: 'encrypted',
          }),
        saveInvocation: () => Promise.resolve(),
      },
      transport: {
        generateStructured: ({ signal }) => {
          observedSignal = signal;
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                reject(new Error(String(signal.reason)));
              },
              { once: true },
            );
          });
        },
        embed: () => Promise.resolve({ rawResponse: {}, vector: [0.1] }),
      },
      cipher: {
        encrypt: () => 'encrypted',
        decrypt: () => ({ Authorization: 'Bearer secret' }),
      },
      requests: {
        read: () =>
          Promise.resolve({
            instruction: 'Return a structured answer.',
            responseSchema: { type: 'object' },
            correctionErrors: [],
          }),
      },
      clock: { now: () => NOW },
      ids: { nextInvocationId: () => 'invocation-timeout' },
    });

    await expect(
      adapter.invoke({
        profile: profile('small', 'ready', 1, 2),
        requestRef: 'request-timeout',
        outputSchemaRef: 'schema:answer:v1',
        signal: new AbortController().signal,
        timeoutMs: 5,
      }),
    ).rejects.toThrow('MODEL_CASCADE_STEP_TIMEOUT');
    expect(observedSignal?.aborted).toBe(true);
  });
});

function artifactReader(): CaseModelArtifactReader {
  const activeCase: ActiveCaseProjection = {
    caseRef: 'case-1:1',
    tenantId: 'tenant-1',
    taskTypeId: 'inspect-device',
    artifactHash: HASH,
    activePointerVersion: 3,
    definition: caseDefinition(),
  };
  const route: ActiveModelRouteProjection = {
    artifactRef: 'route-1:1',
    tenantId: 'tenant-1',
    artifactHash: HASH,
    activePointerVersion: 2,
    definition: {
      conditions: [
        { type: 'atomic', field: 'operationType', operator: 'eq', value: 'structured_generation' },
      ],
      route: 'local_small',
      budget: { maxTokens: 100, maxLatencyMs: 1_000, maxCostUnits: 10 },
      fallbackRoutes: ['cloud_medium'],
    },
  };
  return {
    listActiveCases: ({ tenantId, taskTypeId }) =>
      Promise.resolve(
        tenantId === 'tenant-1' && taskTypeId === 'inspect-device' ? [activeCase] : [],
      ),
    findActiveCase: (caseRef) =>
      Promise.resolve(caseRef === activeCase.caseRef ? activeCase : undefined),
    findActiveModelRoute: () => Promise.resolve(route),
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
      failureTypes: ['provider.timeout'],
      capabilityState: ['climate.read'],
      constraints: [],
      riskLevel: 'low',
    },
    solutionPattern: {
      planPatchTemplate: {
        nodes: [
          {
            capabilityId: 'climate.read',
            input: { room: '{{room}}', temperature: '{{temperature}}' },
          },
        ],
      },
      decisionSuggestions: [],
    },
    adaptationRules: [],
    applicability: { contextRequirements: [], minimumSimilarity: 0.7 },
    failureBoundaries: [
      {
        condition: {
          type: 'atomic',
          field: 'failureTypes',
          operator: 'contains',
          value: 'provider.timeout',
        },
        action: 'require_confirmation',
        reasonCode: 'KNOWN_PROVIDER_TIMEOUT',
      },
    ],
    priorOutcomeSummary: { successRate: 0.9, sampleCount: 20, limitations: ['home only'] },
  };
}

function caseRequest(failureTypes: readonly string[]): CaseRetrievalInput {
  return {
    runtimeRequestRef: 'gateway-1',
    goalContextRef: 'goal-1',
    taskTypeId: 'inspect-device',
    problemFingerprint: {
      goalFeatureHash: HASH,
      entityClasses: ['climate-device'],
      environmentClasses: ['home'],
      capabilityState: ['climate.read'],
      failureTypes,
    },
    tenantId: 'tenant-1',
    deadlineAt: DEADLINE,
    runtimeSnapshotHash: HASH,
  };
}

function adaptationRequest(): CaseAdaptationInput {
  return {
    caseRef: 'case-1:1',
    goalContextRef: 'goal-1',
    parameterBindingRef: 'binding-1',
    policyDecisionRef: 'policy-1',
    deadlineAt: DEADLINE,
    runtimeSnapshotHash: HASH,
  };
}

function profile(
  profileId: string,
  readiness: ModelProfile['readiness'],
  qualityTier: number,
  costTier: number,
): ModelProfile {
  return {
    profileId,
    providerId: `provider-${profileId}`,
    modelId: `model-${profileId}`,
    modelVersion: '1',
    capabilityTags: ['structured_output', 'route:local_small'],
    qualityTier,
    latencyTier: 1,
    costTier,
    contextWindow: 8_192,
    modalities: ['text'],
    structuredOutputSupport: true,
    toolCallingSupport: false,
    dataResidency: ['cn'],
    dataClassificationAllowance: ['internal'],
    rateCapacity: { available: true, remainingInvocations: 10, observedAt: NOW },
    readiness,
    health: 1,
    profileVersion: 1,
  };
}

function routeContext(profiles: readonly ModelProfile[]): ModelRouteContext {
  return {
    requestRef: 'request-1',
    tenantId: 'tenant-1',
    taskTypeId: 'inspect-device',
    operationType: 'structured_generation',
    riskLevel: 'low',
    dataClassification: 'internal',
    requiredCapabilities: ['structured_output'],
    outputSchemaRef: 'schema:answer:v1',
    deadlineAt: DEADLINE,
    budget: {
      maxCostUnits: 10,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxInvocations: 4,
    },
    policySnapshotHash: HASH,
    providerProfileSnapshotHash: hashModelProfileSnapshot(profiles),
  };
}

function clock(): Readonly<{ now(): string; nowMs(): number }> {
  return { now: () => NOW, nowMs: () => Date.parse(NOW) };
}

function caseEvidence(): CaseRuntimeEvidenceRepository & {
  matches: unknown[];
  adaptations: unknown[];
} {
  const matches: unknown[] = [];
  const adaptations: unknown[] = [];
  return {
    matches,
    adaptations,
    saveMatch: (input) => {
      matches.push(input);
      return Promise.resolve();
    },
    saveAdaptation: (input) => {
      adaptations.push(input);
      return Promise.resolve();
    },
  };
}

function routeEvidence(): ModelRouteEvidenceRepository & {
  decisions: unknown[];
  cascades: unknown[];
} {
  const decisions: unknown[] = [];
  const cascades: unknown[] = [];
  return {
    decisions,
    cascades,
    saveDecision: (input) => {
      decisions.push(input);
      return Promise.resolve();
    },
    saveCascade: (input) => {
      cascades.push(input);
      return Promise.resolve();
    },
  };
}

function isJsonRecord(
  value: unknown,
): value is Readonly<Record<string, string | number | boolean | null>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
