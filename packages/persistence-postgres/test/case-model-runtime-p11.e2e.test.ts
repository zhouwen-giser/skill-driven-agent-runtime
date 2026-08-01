import { randomBytes } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { Aes256GcmSecretCipher } from '../../crypto-adapter/src/index.js';
import {
  FastGatewayService,
  ModelCascadeService,
  ModelRouteGatewayArtifactAdapter,
  ModelRouteRuntimeService,
  P02GatewayArtifactFeedbackAdapter,
  ProviderAuthorityModelCascadeInvocationAdapter,
  ProviderRegistryModelProfileReader,
  TypeKeyedGatewayArtifactAdapterRegistry,
} from '../../application/src/index.js';
import {
  hashModelProfileSnapshot,
  type ModelProfile,
  type ModelRouteContext,
  type RuntimeRequestContext,
} from '../../domain/src/index.js';
import {
  PostgresCaseModelRuntimeRepository,
  PostgresFastGatewayRepository,
  PostgresModelRuntimeRepository,
  PostgresRuleUsageRepository,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  process.env['SDAR_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 4 });
const HASH = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-07-30T00:00:00.000Z';
const DEADLINE = '2099-07-30T00:01:00.000Z';

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE model_cascade_step,model_cascade_run,model_route_decision,
       case_runtime_adaptation,case_runtime_match,fast_gateway_feedback,
       fast_gateway_decision,fast_gateway_request,model_invocation,
       stage_model_route,model_provider,cognitive_runtime_outbox CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('P11 Gateway to Provider Authority vertical path', () => {
  it('routes one active model_route through encrypted credentials, validation and durable evidence', async () => {
    const modelRepository = new PostgresModelRuntimeRepository(pool);
    const cipher = new Aes256GcmSecretCipher(randomBytes(32).toString('base64'));
    await modelRepository.saveProvider({
      configuration: {
        providerId: 'provider-1',
        name: 'Local provider',
        kind: 'local',
        apiStyle: 'openai_chat_completions',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'model-1',
        enabled: true,
        timeoutMs: 1_000,
        createdAt: NOW,
        updatedAt: NOW,
      },
      encryptedCredential: cipher.encrypt({ Authorization: 'Bearer provider-secret' }),
    });
    const profileReader = new ProviderRegistryModelProfileReader({
      repository: modelRepository,
      metadata: {
        read: () =>
          Promise.resolve({
            modelVersion: '1',
            capabilityTags: ['structured_output', 'route:local_small'],
            qualityTier: 1,
            latencyTier: 1,
            costTier: 2,
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
            readiness: 'ready',
            health: 1,
            capacityAvailable: true,
            remainingInvocations: 5,
            observedAt: NOW,
          }),
      },
    });
    const profiles = await profileReader.listCurrent('tenant-1');
    const routeContext = modelRouteContext(profiles);
    const evidence = new PostgresCaseModelRuntimeRepository(pool);
    const artifact = {
      artifactRef: 'model-route-1:1',
      tenantId: 'tenant-1',
      artifactHash: HASH,
      activePointerVersion: 1,
      definition: {
        conditions: [
          {
            type: 'atomic' as const,
            field: 'operationType',
            operator: 'eq' as const,
            value: 'structured_generation',
          },
        ],
        route: 'local_small' as const,
        budget: { maxTokens: 100, maxLatencyMs: 1_000, maxCostUnits: 2 },
        fallbackRoutes: ['cloud_medium' as const],
      },
    };
    const artifacts = {
      listActiveCases: () => Promise.resolve([]),
      findActiveCase: () => Promise.resolve(undefined),
      findActiveModelRoute: () => Promise.resolve(artifact),
    };
    const routeRuntime = new ModelRouteRuntimeService({
      artifacts,
      profiles: profileReader,
      evidence,
      clock: clock(),
    });
    const invocation = new ProviderAuthorityModelCascadeInvocationAdapter({
      repository: modelRepository,
      cipher,
      requests: {
        read: () =>
          Promise.resolve({
            instruction: 'Return a structured device status.',
            responseSchema: {
              type: 'object',
              required: ['status'],
              properties: { status: { type: 'string' } },
            },
            correctionErrors: [],
          }),
      },
      transport: {
        generateStructured: ({ credentialHeaders }) => {
          expect(credentialHeaders).toEqual({ Authorization: 'Bearer provider-secret' });
          return Promise.resolve({
            rawResponse: { id: 'response-1' },
            structuredResult: { status: 'online' },
            inputTokens: 12,
            outputTokens: 4,
          });
        },
        embed: () => Promise.resolve({ rawResponse: {}, vector: [0.1] }),
      },
      clock: { now: () => NOW },
      ids: { nextInvocationId: () => 'invocation-p11-1' },
    });
    const cascade = new ModelCascadeService({
      profiles: profileReader,
      invocations: invocation,
      validator: {
        validate: ({ output }) =>
          Promise.resolve({
            accepted:
              typeof output === 'object' &&
              output !== null &&
              !Array.isArray(output) &&
              'status' in output,
          }),
      },
      current: {
        verify: ({ artifactHash, providerProfileSnapshotHash }) =>
          Promise.resolve(
            artifactHash === HASH &&
              providerProfileSnapshotHash === hashModelProfileSnapshot(profiles),
          ),
      },
      evidence,
      clock: clock(),
    });
    const adapter = new ModelRouteGatewayArtifactAdapter({
      runtime: routeRuntime,
      cascade,
      requests: {
        create: () =>
          Promise.resolve({
            routeContext,
            artifactRef: artifact.artifactRef,
            artifactHash: artifact.artifactHash,
          }),
      },
    });
    const gateway = new FastGatewayService({
      precheck: {
        authenticate: () => Promise.resolve(true),
        authorizeTenant: () => Promise.resolve(true),
        authorizeRequest: () => Promise.resolve(true),
        readRuntimeState: () =>
          Promise.resolve({
            featureEnabled: true,
            killSwitchActive: false,
            policyDecision: 'allow',
            runtimeSnapshotHash: HASH,
          }),
      },
      retrieval: {
        retrieve: () =>
          Promise.resolve({
            index: [
              {
                artifactRef: artifact.artifactRef,
                artifactKey: 'model-route-1',
                artifactVersion: 1,
                artifactType: 'model_route',
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
              decisionId: 'retrieval-decision-1',
              requestId: 'request-1',
              path: 'small_model',
              selectedArtifactRef: artifact.artifactRef,
              parameterBindings: {},
              missingParameters: [],
              requiredConfirmations: [],
              reasonCodes: ['ARTIFACT_SELECTED'],
              matcherSnapshotHash: HASH,
              policySnapshotHash: HASH,
              createdAt: NOW,
            },
          }),
      },
      rule: {
        evaluate: () => Promise.resolve({ disposition: 'fallback', resultRef: 'not-used' }),
      },
      template: {
        instantiate: () => Promise.resolve({ disposition: 'fallback', resultRef: 'not-used' }),
      },
      adapters: new TypeKeyedGatewayArtifactAdapterRegistry([
        { artifactType: 'model_route', adapter },
      ]),
      fallback: {
        start: () => Promise.resolve({ fallbackRef: 'cognitive-fallback-1' }),
      },
      cancellation: { isCancelled: () => Promise.resolve(false) },
      persistence: new PostgresFastGatewayRepository(pool),
      drift: { signal: () => Promise.resolve() },
      artifactFeedback: new P02GatewayArtifactFeedbackAdapter(
        new PostgresRuleUsageRepository(pool),
      ),
      clock: clock(),
      ids: { nextGatewayDecisionId: () => 'gateway-decision-p11-1' },
    });

    const result = await gateway.evaluateDetailed(gatewayContext());
    const runtimeEvidence = await evidence.findRuntimeEvidenceByRequest('request-1');
    const debugCounts = await pool.query(
      `SELECT
         (SELECT count(*)::integer FROM model_invocation) AS invocations,
         (SELECT count(*)::integer FROM model_route_decision) AS decisions,
         (SELECT count(*)::integer FROM model_cascade_run) AS runs`,
    );
    expect(
      result.decision.path,
      JSON.stringify({ result, runtimeEvidence, debugCounts: debugCounts.rows }),
    ).toBe('small_model');
    expect(result.record.fallbackRef).toBeUndefined();
    expect(runtimeEvidence).toMatchObject({
      requestRef: 'request-1',
      modelRoute: {
        artifactRef: 'model-route-1:1',
        decision: { selectedProfileRefs: ['provider-1:model-1:1'] },
        cascades: [{ run: { status: 'completed' } }],
      },
    });
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM model_invocation
             WHERE invocation_id='invocation-p11-1') AS invocations,
           (SELECT count(*)::integer FROM model_route_decision) AS decisions,
           (SELECT count(*)::integer FROM model_cascade_run) AS runs,
           (SELECT count(*)::integer FROM cognitive_runtime_outbox
             WHERE event_type IN ('model_route.selected','gateway.route_selected')) AS outbox`,
      ),
    ).resolves.toMatchObject({
      rows: [{ invocations: 1, decisions: 1, runs: 1, outbox: 2 }],
    });
    const serialized = JSON.stringify(await evidence.findRuntimeEvidenceByRequest('request-1'));
    expect(serialized).not.toContain('provider-secret');
    expect(serialized).not.toContain('Authorization');
  });
});

function modelRouteContext(profiles: readonly ModelProfile[]): ModelRouteContext {
  return {
    requestRef: 'request-1',
    tenantId: 'tenant-1',
    taskTypeId: 'inspect-device',
    operationType: 'structured_generation',
    riskLevel: 'low',
    dataClassification: 'internal',
    requiredCapabilities: ['structured_output', 'residency:cn'],
    outputSchemaRef: 'schema:device-status:v1',
    deadlineAt: DEADLINE,
    budget: {
      maxCostUnits: 1,
      maxInputTokens: 50,
      maxOutputTokens: 50,
      maxInvocations: 1,
    },
    policySnapshotHash: HASH,
    providerProfileSnapshotHash: hashModelProfileSnapshot(profiles),
  };
}

function gatewayContext(): RuntimeRequestContext {
  return {
    requestId: 'request-1',
    taskId: 'task-1',
    contextId: 'context-1',
    rawText: 'inspect device status',
    normalizedText: 'inspect device status',
    actor: {
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      authenticationRef: 'auth-1',
      authorizationRefs: ['device.read'],
    },
    extractedFeatures: { taskTypeId: 'inspect-device' },
    worldStateRef: 'world-1',
    capabilitySummaryRef: 'capability-1',
    policySnapshotRef: 'policy-1',
    deadlineAt: DEADLINE,
    cancellationRef: 'cancel-1',
    idempotencyKey: 'idempotency-p11-1',
    createdAt: NOW,
  };
}

function clock(): Readonly<{ now(): string; nowMs(): number }> {
  return { now: () => NOW, nowMs: () => Date.parse(NOW) };
}
