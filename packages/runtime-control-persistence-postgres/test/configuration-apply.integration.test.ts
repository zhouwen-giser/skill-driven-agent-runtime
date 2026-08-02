import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../../apps/node-control-api/src/runtime.js';
import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { ModelRuntimeService, type ModelTransportAdapter } from '../../application/src/index.js';
import {
  createConfigurationRevision,
  type ConfigurationApplyMode,
  type ConfigurationRevision,
  type JsonValue,
  type LlmProviderDefinition,
  type ModelRouteDefinition,
} from '../../node-control-domain/src/index.js';
import { PostgresModelRuntimeRepository } from '../../persistence-postgres/src/index.js';
import {
  RuntimeConfigurationAgent,
  RuntimeLlmConfigurationApplier,
  type RuntimeConfigurationApplyResult,
  type RuntimeConfigurationSource,
} from '../../runtime-control-application/src/index.js';
import { HttpRuntimeConfigurationSource } from '../../runtime-control-http-client/src/index.js';
import {
  PostgresExistingModelCredentialResolver,
  PostgresRuntimeModelControl,
} from '../../runtime-control-model-adapter/src/index.js';
import { PostgresRuntimeConfigurationStore } from '../src/index.js';

const runtimeConnectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const controlConnectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const apiToken = 'p02-control-api-token-000000000000000000000000';
const runtimeToken = 'p02-runtime-service-token-0000000000000000000';
const target = { targetType: 'runtime_policy', targetId: 'node-p02' } as const;
const runtimePool = new Pool({ connectionString: runtimeConnectionString, max: 4 });
const controlPool = new Pool({ connectionString: controlConnectionString, max: 4 });
let controlApi: NodeControlApiRuntime | undefined;

const OperationSchema = z.looseObject({
  operationId: z.string().min(1),
  status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'canceled']),
});
const RevisionProjectionSchema = z.looseObject({
  configurationId: z.string().min(1),
  revision: z.number().int().positive(),
  status: z.string().min(1),
  checksum: z.string().length(64),
  content: z.unknown(),
  state: z
    .object({
      desired: z.object({ revision: z.number().int().positive(), status: z.string() }),
      observed: z.object({ status: z.string() }),
      convergence: z.object({ status: z.string() }),
    })
    .optional(),
});
const RevisionHintSchema = z.object({
  eventId: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  revision: z.number().int().positive(),
  checksum: z.string().length(64),
});

beforeAll(async () => {
  await applyRuntimeMigrations(runtimePool);
  controlApi = await startNodeControlApi({
    SDAR_CONTROL_DATABASE_URL: controlConnectionString,
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: 0,
    SDAR_CONTROL_API_TOKEN: apiToken,
    SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: runtimeToken,
    SDAR_CONTROL_NODE_ID: 'node-p02',
    SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
    SDAR_CONTROL_NODE_DISPLAY_NAME: 'P02 Integration Node',
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://127.0.0.1:9998',
    SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_NODE_EVENTS_URL: 'http://127.0.0.1:10080/api/v1/events',
    SDAR_CONTROL_A2A_AGENT_CARD_URL: 'http://127.0.0.1:9999/.well-known/agent-card.json',
  });
  await runtimePool.query(
    `TRUNCATE runtime_task_model_route_binding,runtime_model_route_snapshot,
              runtime_model_provider_catalog,runtime_task_configuration_binding,
              runtime_configuration_ack_outbox,runtime_configuration_snapshot CASCADE`,
  );
  await controlPool.query(
    `TRUNCATE sdar_control.mcp_provider_catalog_observation,
              sdar_control.mcp_provider_binding,
              sdar_control.smpp_registry_sync_attempt,
              sdar_control.smpp_provider_candidate,
              sdar_control.smpp_registry_snapshot,
              sdar_control.smpp_registry_source,
              sdar_control.configuration_application,
              sdar_control.configuration_command_receipt,
              sdar_control.configuration_target_state,
              sdar_control.configuration_revision,
              sdar_control.model_route_definition,
              sdar_control.llm_provider_definition,
              sdar_control.management_operation,
              sdar_control.control_audit_event`,
  );
});

afterAll(async () => {
  await controlApi?.close();
  await Promise.all([runtimePool.end(), controlPool.end()]);
});

describe('P02 Configuration Revision apply, Ack and LKG', { concurrent: false }, () => {
  it('keeps Control and Runtime authorities separate across publish, apply and recovery', async () => {
    const baseUrl = requireControlApi().baseUrl;
    const first = draft(1, { mode: 'conservative', credentialRef: 'secret://runtime/p02' });
    const created = await publicCommand('/api/v1/configuration-revisions', {
      method: 'POST',
      idempotencyKey: 'create-runtime-policy-revision-1',
      body: first,
    });
    expect(created.status).toBe(201);
    const draftEtag = requiredEtag(created);

    const replay = await publicCommand('/api/v1/configuration-revisions', {
      method: 'POST',
      idempotencyKey: 'create-runtime-policy-revision-1',
      body: first,
    });
    expect(replay.status).toBe(201);
    const reused = await publicCommand('/api/v1/configuration-revisions', {
      method: 'POST',
      idempotencyKey: 'create-runtime-policy-revision-1',
      body: { ...first, createdBy: 'different-operator' },
    });
    expect(reused.status).toBe(409);
    await expect(json(reused)).resolves.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    const validated = await publicCommand(
      '/api/v1/configuration-revisions/runtime-policy-node-p02/1/validate',
      {
        method: 'POST',
        idempotencyKey: 'validate-runtime-policy-revision-1',
        ifMatch: draftEtag,
        body: { reason: 'P02 integration validation.', expectedRevision: 1 },
      },
    );
    expect(validated.status).toBe(200);
    const validatedEtag = requiredEtag(validated);

    const publishPath = '/api/v1/configuration-revisions/runtime-policy-node-p02/1/publish';
    const publications = await Promise.all([
      publicCommand(publishPath, {
        method: 'POST',
        idempotencyKey: 'publish-runtime-policy-revision-1-a',
        ifMatch: validatedEtag,
        body: { reason: 'Publish P02 revision one.', expectedRevision: 1 },
      }),
      publicCommand(publishPath, {
        method: 'POST',
        idempotencyKey: 'publish-runtime-policy-revision-1-b',
        ifMatch: validatedEtag,
        body: { reason: 'Publish P02 revision one.', expectedRevision: 1 },
      }),
    ]);
    expect(publications.map(({ status }) => status).sort()).toEqual([202, 412]);
    const acceptedPublication = publications.find(({ status }) => status === 202);
    if (acceptedPublication === undefined) throw new Error('P02_PUBLICATION_MISSING');
    const firstOperation = OperationSchema.parse(await json(acceptedPublication));
    expect(firstOperation.status).toBe('running');

    const published = await getRevision(1);
    expect(published).toMatchObject({
      status: 'published',
      state: {
        desired: { revision: 1, status: 'published' },
        observed: { status: 'unavailable' },
        convergence: { status: 'pending' },
      },
    });

    const source = new HttpRuntimeConfigurationSource({ baseUrl, serviceToken: runtimeToken });
    await expect(source.bootstrap()).resolves.toMatchObject({
      runtimeContractVersion: '1.0.0',
      activeConfigurationRefs: [],
    });
    const store = new PostgresRuntimeConfigurationStore(runtimePool);
    let applyStatus: RuntimeConfigurationApplyResult['status'] = 'applied';
    const agent = new RuntimeConfigurationAgent({
      runtimeInstanceId: 'runtime-p02-a',
      runtimeVersion: '1.4.0',
      source,
      store,
      applier: {
        apply: () =>
          Promise.resolve({
            status: applyStatus,
            ...(applyStatus === 'applied' ? {} : { reasonCode: 'P02_TEST_PARTIAL_APPLY' }),
          }),
      },
      clock: { now: () => '2026-08-02T03:00:00.000Z' },
    });
    await expect(agent.synchronize(target)).resolves.toMatchObject({
      source: 'control',
      status: 'applied',
      active: { revision: 1 },
      acknowledgementPending: false,
    });
    await expect(getRevision(1)).resolves.toMatchObject({
      status: 'applied',
      state: {
        observed: { status: 'applied' },
        convergence: { status: 'converged' },
      },
    });
    await expect(getOperation(firstOperation.operationId)).resolves.toMatchObject({
      status: 'succeeded',
    });

    const runningTask = await agent.pinTask('task-running-before-revision-2', target);
    expect(runningTask.revision).toBe(1);
    const watchController = new AbortController();
    const watchResponse = await fetch(`${baseUrl}/internal/v1/revisions/watch`, {
      headers: { authorization: `Bearer ${runtimeToken}`, accept: 'text/event-stream' },
      signal: watchController.signal,
    });
    expect(watchResponse.status).toBe(200);
    if (watchResponse.body === null) throw new Error('P02_WATCH_BODY_MISSING');
    const watchReader = watchResponse.body.getReader();
    await publishSequentialRevision(2, { mode: 'balanced' });
    await expect(readRevisionHint(watchReader)).resolves.toMatchObject({
      eventId: 'runtime_policy:node-p02:2',
      revision: 2,
    });
    await watchReader.cancel();
    watchController.abort();
    await expect(agent.synchronize(target)).resolves.toMatchObject({ active: { revision: 2 } });
    await expect(agent.pinTask('task-running-before-revision-2', target)).resolves.toEqual(
      runningTask,
    );
    await expect(agent.pinTask('task-created-after-revision-2', target)).resolves.toMatchObject({
      revision: 2,
    });

    const recoveredStore = new PostgresRuntimeConfigurationStore(runtimePool);
    const unavailableSource: RuntimeConfigurationSource = {
      latest: () => Promise.reject(new Error('CONTROL_OUTAGE')),
      acknowledge: () => Promise.reject(new Error('CONTROL_OUTAGE')),
    };
    const recoveredAgent = new RuntimeConfigurationAgent({
      runtimeInstanceId: 'runtime-p02-restarted',
      runtimeVersion: '1.4.0',
      source: unavailableSource,
      store: recoveredStore,
      applier: { apply: () => Promise.resolve({ status: 'applied' }) },
      clock: { now: () => '2026-08-02T03:01:00.000Z' },
    });
    await expect(recoveredAgent.synchronize(target)).resolves.toMatchObject({
      source: 'lkg',
      status: 'unavailable',
      active: { revision: 2 },
    });

    await publishSequentialRevision(3, { mode: 'aggressive' });
    applyStatus = 'partially_applied';
    await expect(agent.synchronize(target)).resolves.toMatchObject({
      source: 'lkg',
      status: 'partially_applied',
      active: { revision: 2 },
    });
    await expect(recoveredStore.findLkg(target)).resolves.toMatchObject({ revision: 2 });
    await expect(getRevision(3)).resolves.toMatchObject({
      status: 'partially_applied',
      state: { convergence: { status: 'degraded' } },
    });

    await publishSequentialRevision(4, { mode: 'unsafe' });
    const corruptingSource: RuntimeConfigurationSource = {
      async latest(targetValue, currentRevision) {
        const latest = await source.latest(targetValue, currentRevision);
        if (latest === undefined) return undefined;
        return Object.freeze({ ...latest, content: { forged: true } });
      },
      acknowledge: (acknowledgement) => source.acknowledge(acknowledgement),
    };
    const corruptingAgent = new RuntimeConfigurationAgent({
      runtimeInstanceId: 'runtime-p02-a',
      runtimeVersion: '1.4.0',
      source: corruptingSource,
      store: recoveredStore,
      applier: { apply: () => Promise.resolve({ status: 'applied' }) },
      clock: { now: () => '2026-08-02T03:02:00.000Z' },
    });
    await expect(corruptingAgent.synchronize(target)).resolves.toMatchObject({
      source: 'lkg',
      status: 'rejected',
      active: { revision: 2 },
    });
    await expect(recoveredStore.findLkg(target)).resolves.toMatchObject({ revision: 2 });
    await expect(getRevision(4)).resolves.toMatchObject({
      status: 'rejected',
      state: { convergence: { status: 'rejected' } },
    });

    const sourceRevision = await fetch(
      `${baseUrl}/api/v1/configuration-revisions/runtime-policy-node-p02/1`,
      { headers: publicHeaders() },
    );
    const rollback = await publicCommand(
      '/api/v1/configuration-revisions/runtime-policy-node-p02/1/rollback',
      {
        method: 'POST',
        idempotencyKey: 'rollback-runtime-policy-to-revision-1',
        ifMatch: requiredEtag(sourceRevision),
        body: { reason: 'Restore the first known-good content.', expectedRevision: 1 },
      },
    );
    expect(rollback.status).toBe(202);
    await expect(getRevision(5)).resolves.toMatchObject({
      status: 'published',
      checksum: first.checksum,
      content: first.content,
    });
  });

  it('applies secret-ref Provider and scoped Route revisions with fallback and stable old Task bindings', async () => {
    await seedRuntimeModelAuthority();
    const baseUrl = requireControlApi().baseUrl;
    const source = new HttpRuntimeConfigurationSource({ baseUrl, serviceToken: runtimeToken });
    const modelControl = new PostgresRuntimeModelControl(
      runtimePool,
      new PostgresExistingModelCredentialResolver(runtimePool),
      () => '2026-08-02T04:20:00.000Z',
    );
    const agent = new RuntimeConfigurationAgent({
      runtimeInstanceId: 'runtime-p03-model-control',
      runtimeVersion: '1.4.0',
      source,
      store: new PostgresRuntimeConfigurationStore(runtimePool),
      applier: new RuntimeLlmConfigurationApplier(modelControl),
      clock: { now: () => '2026-08-02T04:20:00.000Z' },
    });

    const primary = providerDefinition(
      'provider-primary',
      'runtime-model-provider://bootstrap-primary',
      'model-a',
    );
    const fallback = providerDefinition(
      'provider-fallback',
      'runtime-model-provider://bootstrap-fallback',
      'model-b',
    );
    for (const [index, provider] of [primary, fallback].entries()) {
      const created = await publicCommand('/api/v1/llm-providers', {
        method: 'POST',
        idempotencyKey: `p03-create-provider-${String(index)}`,
        body: provider,
      });
      expect(created.status).toBe(201);
      expect(JSON.stringify(await json(created))).not.toContain('credential-value');
      const validated = await publicCommand(
        `/api/v1/llm-providers/${provider.providerId}/validate`,
        {
          method: 'POST',
          idempotencyKey: `p03-validate-provider-${String(index)}`,
          body: { reason: 'Validate static Provider catalog and policy.' },
        },
      );
      expect(validated.status).toBe(202);
      const publishedProvider = await publishP03Definition(
        providerTarget(provider),
        provider,
        'reconnect_required',
      );
      await expect(agent.synchronize(providerTarget(provider))).resolves.toMatchObject({
        status: 'applied',
      });
      await expect(
        modelControl.applyProvider(provider, {
          configurationId: publishedProvider.configurationId,
          revision: publishedProvider.revision,
          checksum: publishedProvider.checksum,
        }),
      ).resolves.toMatchObject({ providerId: provider.providerId });
      const observed = await fetch(`${baseUrl}/api/v1/llm-providers/${provider.providerId}`, {
        headers: publicHeaders(),
      });
      await expect(json(observed)).resolves.toMatchObject({
        status: 'active',
        secretStatus: 'available',
      });
    }

    const routeV1 = routeDefinition(
      1,
      'provider-primary',
      'model-a',
      'provider-fallback',
      'model-b',
    );
    const unavailableRoute = await publicCommand('/api/v1/model-routes', {
      method: 'POST',
      idempotencyKey: 'p03-create-unavailable-route',
      body: {
        ...routeV1,
        routeId: 'planning-route-unavailable',
        primary: { providerId: 'provider-missing', modelId: 'model-missing' },
      },
    });
    expect(unavailableRoute.status).toBe(422);
    await expect(json(unavailableRoute)).resolves.toMatchObject({
      code: 'MODEL_ROUTE_PROVIDER_UNAVAILABLE',
    });
    const createdRoute = await publicCommand('/api/v1/model-routes', {
      method: 'POST',
      idempotencyKey: 'p03-create-planning-route-v1',
      body: routeV1,
    });
    expect(createdRoute.status).toBe(201);
    const conflict = await publicCommand('/api/v1/model-routes', {
      method: 'POST',
      idempotencyKey: 'p03-create-conflicting-route',
      body: { ...routeV1, routeId: 'planning-route-conflict' },
    });
    expect(conflict.status).toBe(409);
    await expect(json(conflict)).resolves.toMatchObject({ code: 'MODEL_ROUTE_CONFLICT' });

    const publishedRouteV1 = await publishP03Definition(routeTarget(), routeV1, 'new_task_only');
    await expect(agent.synchronize(routeTarget())).resolves.toMatchObject({ status: 'applied' });
    await expect(
      modelControl.applyRoute(routeV1, {
        configurationId: publishedRouteV1.configurationId,
        revision: publishedRouteV1.revision,
        checksum: publishedRouteV1.checksum,
      }),
    ).resolves.toMatchObject({ routeId: routeV1.routeId });
    await seedWorkflowPlanningPrompt();
    await seedModelInvocationTasks();
    const transport = new P03FallbackTransport('provider-primary');
    let invocation = 0;
    const modelRuntime = new ModelRuntimeService({
      repository: new PostgresModelRuntimeRepository(runtimePool),
      transport,
      cipher: {
        encrypt: (value) => JSON.stringify(value),
        decrypt: (value) => JSON.parse(value) as Readonly<Record<string, string>>,
      },
      clock: { now: () => '2026-08-02T04:21:00.000Z' },
      ids: { nextInvocationId: () => `p03-invocation-${String(++invocation)}` },
      controlledRoutes: modelControl,
    });
    await expect(invokePlanning(modelRuntime, 'task-p03-before-route-v2')).resolves.toEqual({
      provider: 'provider-fallback',
    });
    expect(transport.providerIds).toEqual(['provider-primary', 'provider-fallback']);

    const routeV2 = routeDefinition(
      2,
      'provider-fallback',
      'model-b',
      'provider-primary',
      'model-a',
    );
    const createdRouteV2 = await publicCommand('/api/v1/model-routes', {
      method: 'POST',
      idempotencyKey: 'p03-create-planning-route-v2',
      body: routeV2,
    });
    expect(createdRouteV2.status).toBe(201);
    await publishP03Definition(routeTarget(), routeV2, 'new_task_only');
    await expect(agent.synchronize(routeTarget())).resolves.toMatchObject({ status: 'applied' });

    transport.providerIds.length = 0;
    await expect(invokePlanning(modelRuntime, 'task-p03-before-route-v2')).resolves.toEqual({
      provider: 'provider-fallback',
    });
    expect(transport.providerIds).toEqual(['provider-primary', 'provider-fallback']);
    transport.providerIds.length = 0;
    await expect(invokePlanning(modelRuntime, 'task-p03-after-route-v2')).resolves.toEqual({
      provider: 'provider-fallback',
    });
    expect(transport.providerIds).toEqual(['provider-fallback']);

    const evidence = await runtimePool.query<{
      bindings: number;
      failures: number;
      leaked_errors: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM runtime_task_model_route_binding) AS bindings,
         (SELECT count(*)::integer FROM model_invocation WHERE invocation_id LIKE 'p03-invocation-%' AND status='failed') AS failures,
         (SELECT count(*)::integer FROM model_invocation WHERE invocation_id LIKE 'p03-invocation-%' AND error_message LIKE '%credential-value%') AS leaked_errors`,
    );
    expect(evidence.rows[0]).toEqual({ bindings: 2, failures: 2, leaked_errors: 0 });
    const routeProjection = await fetch(`${baseUrl}/api/v1/model-routes/planning-route`, {
      headers: publicHeaders(),
    });
    await expect(json(routeProjection)).resolves.toMatchObject({ revision: 2, status: 'active' });
  });
});

async function publishSequentialRevision(
  revisionNumber: number,
  content: JsonValue,
): Promise<void> {
  const candidate = draft(revisionNumber, content);
  const created = await publicCommand('/api/v1/configuration-revisions', {
    method: 'POST',
    idempotencyKey: `create-runtime-policy-revision-${String(revisionNumber)}`,
    body: candidate,
  });
  expect(created.status).toBe(201);
  const validated = await publicCommand(
    `/api/v1/configuration-revisions/runtime-policy-node-p02/${String(revisionNumber)}/validate`,
    {
      method: 'POST',
      idempotencyKey: `validate-runtime-policy-revision-${String(revisionNumber)}`,
      ifMatch: requiredEtag(created),
      body: {
        reason: `Validate revision ${String(revisionNumber)}.`,
        expectedRevision: revisionNumber,
      },
    },
  );
  expect(validated.status).toBe(200);
  const published = await publicCommand(
    `/api/v1/configuration-revisions/runtime-policy-node-p02/${String(revisionNumber)}/publish`,
    {
      method: 'POST',
      idempotencyKey: `publish-runtime-policy-revision-${String(revisionNumber)}`,
      ifMatch: requiredEtag(validated),
      body: {
        reason: `Publish revision ${String(revisionNumber)}.`,
        expectedRevision: revisionNumber,
      },
    },
  );
  expect(published.status).toBe(202);
}

function draft(
  revisionNumber: number,
  content: JsonValue,
  applyMode: ConfigurationApplyMode = 'new_task_only',
) {
  return createConfigurationRevision(
    {
      configurationId: 'runtime-policy-node-p02',
      targetType: target.targetType,
      targetId: target.targetId,
      revision: revisionNumber,
      applyMode,
      content,
      createdBy: 'operator-p02',
    },
    `2026-08-02T02:${String(revisionNumber).padStart(2, '0')}:00.000Z`,
  );
}

async function getRevision(revisionNumber: number) {
  const response = await fetch(
    `${requireControlApi().baseUrl}/api/v1/configuration-revisions/runtime-policy-node-p02/${String(revisionNumber)}`,
    { headers: publicHeaders() },
  );
  expect(response.status).toBe(200);
  return RevisionProjectionSchema.parse(await json(response));
}

async function getOperation(operationId: string) {
  const response = await fetch(
    `${requireControlApi().baseUrl}/api/v1/management-operations/${operationId}`,
    { headers: publicHeaders() },
  );
  expect(response.status).toBe(200);
  return OperationSchema.parse(await json(response));
}

function publicCommand(
  path: string,
  input: Readonly<{
    method: 'POST';
    idempotencyKey: string;
    ifMatch?: string;
    body: unknown;
  }>,
): Promise<Response> {
  return fetch(`${requireControlApi().baseUrl}${path}`, {
    method: input.method,
    headers: {
      ...publicHeaders(),
      'content-type': 'application/json',
      'idempotency-key': input.idempotencyKey,
      ...(input.ifMatch === undefined ? {} : { 'if-match': input.ifMatch }),
    },
    body: JSON.stringify(input.body),
  });
}

function publicHeaders(): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${apiToken}` };
}

function requiredEtag(response: Response): string {
  const value = response.headers.get('etag');
  if (value === null) throw new Error('P02_ETAG_MISSING');
  return value;
}

function json(response: Response): Promise<unknown> {
  return response.json();
}

function requireControlApi(): NodeControlApiRuntime {
  if (controlApi === undefined) throw new Error('P02_CONTROL_API_NOT_STARTED');
  return controlApi;
}

async function readRevisionHint(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('P02_WATCH_ENDED_BEFORE_HINT');
    buffer += decoder.decode(chunk.value, { stream: true });
    for (const event of buffer.split('\n\n')) {
      const data = event
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (data !== undefined && data !== '')
        return RevisionHintSchema.parse(JSON.parse(data) as unknown);
    }
  }
}

function providerDefinition(
  providerId: string,
  credentialRef: string,
  modelId: string,
): LlmProviderDefinition {
  return {
    providerId,
    providerType: 'openai_compatible',
    baseUrl: `https://${providerId}.example.test/v1`,
    credentialRef,
    models: [
      {
        modelId,
        capabilities: ['structured_output', 'tool_calling', 'embedding'],
        contextWindow: 32_768,
        enabled: true,
      },
    ],
    healthPolicy: {
      timeoutMs: 10_000,
      retryAttempts: 1,
      failureThreshold: 3,
      recoverySeconds: 30,
    },
    rateLimitPolicy: {
      requestsPerMinute: 60,
      tokensPerMinute: 100_000,
      maxConcurrent: 4,
    },
    status: 'draft',
    secretStatus: 'unknown',
    revision: 1,
  };
}

function routeDefinition(
  revision: number,
  primaryProviderId: string,
  primaryModelId: string,
  fallbackProviderId: string,
  fallbackModelId: string,
): ModelRouteDefinition {
  return {
    routeId: 'planning-route',
    stage: 'planning',
    primary: { providerId: primaryProviderId, modelId: primaryModelId },
    fallbacks: [{ providerId: fallbackProviderId, modelId: fallbackModelId }],
    budgetPolicy: {
      selector: { scope: 'task', key: 'inspection' },
      timeoutMs: 10_000,
      maxAttempts: 2,
      maxInputTokens: 20_000,
      maxOutputTokens: 4_000,
      maxCostUsd: 2,
      fallbackOn: ['upstream_error', 'timeout', 'unavailable'],
    },
    status: 'draft',
    revision,
  };
}

function providerTarget(provider: LlmProviderDefinition) {
  return { targetType: 'llm_provider' as const, targetId: provider.providerId };
}

function routeTarget() {
  return { targetType: 'model_route' as const, targetId: 'planning-route' };
}

async function publishP03Definition(
  targetValue: Readonly<{
    targetType: 'llm_provider' | 'model_route';
    targetId: string;
  }>,
  definition: LlmProviderDefinition | ModelRouteDefinition,
  applyMode: ConfigurationApplyMode,
): Promise<ConfigurationRevision> {
  const configurationId = `p03-${targetValue.targetType}-${targetValue.targetId}`;
  const revision = createConfigurationRevision(
    {
      configurationId,
      targetType: targetValue.targetType,
      targetId: targetValue.targetId,
      revision: definition.revision,
      applyMode,
      content: JSON.parse(JSON.stringify(definition)) as JsonValue,
      createdBy: 'operator-p03',
    },
    `2026-08-02T04:${String(definition.revision).padStart(2, '0')}:00.000Z`,
  );
  const created = await publicCommand('/api/v1/configuration-revisions', {
    method: 'POST',
    idempotencyKey: `p03-create-config-${targetValue.targetId}-${String(definition.revision)}`,
    body: revision,
  });
  expect(created.status).toBe(201);
  const validated = await publicCommand(
    `/api/v1/configuration-revisions/${configurationId}/${String(definition.revision)}/validate`,
    {
      method: 'POST',
      idempotencyKey: `p03-validate-config-${targetValue.targetId}-${String(definition.revision)}`,
      ifMatch: requiredEtag(created),
      body: {
        reason: 'Validate P03 controlled model definition.',
        expectedRevision: definition.revision,
      },
    },
  );
  expect(validated.status).toBe(200);
  const published = await publicCommand(
    `/api/v1/configuration-revisions/${configurationId}/${String(definition.revision)}/publish`,
    {
      method: 'POST',
      idempotencyKey: `p03-publish-config-${targetValue.targetId}-${String(definition.revision)}`,
      ifMatch: requiredEtag(validated),
      body: {
        reason: 'Publish P03 controlled model definition.',
        expectedRevision: definition.revision,
      },
    },
  );
  expect(published.status).toBe(202);
  return revision;
}

async function seedRuntimeModelAuthority(): Promise<void> {
  const timestamp = '2026-08-02T04:00:00.000Z';
  for (const providerId of ['bootstrap-primary', 'bootstrap-fallback']) {
    await runtimePool.query(
      `INSERT INTO model_provider(
         provider_id,name,kind,api_style,base_url,model,enabled,timeout_ms,
         encrypted_credential,created_at,updated_at)
       VALUES($1,$1,'openai_compatible','openai_chat_completions',$2,'bootstrap-model',true,10000,$3,$4,$4)
       ON CONFLICT(provider_id) DO UPDATE SET encrypted_credential=EXCLUDED.encrypted_credential,
         enabled=true,updated_at=EXCLUDED.updated_at`,
      [
        providerId,
        `https://${providerId}.example.test/v1`,
        JSON.stringify({ Authorization: 'fixture-header-value' }),
        timestamp,
      ],
    );
  }
}

async function seedWorkflowPlanningPrompt(): Promise<void> {
  const timestamp = '2026-08-02T04:00:00.000Z';
  await runtimePool.query(
    `INSERT INTO prompt(prompt_id,stage,current_version,created_at,updated_at)
     VALUES('p03-workflow-planning','workflow_planning',NULL,$1,$1)
     ON CONFLICT(prompt_id) DO UPDATE SET updated_at=EXCLUDED.updated_at`,
    [timestamp],
  );
  await runtimePool.query(
    `INSERT INTO prompt_version(prompt_id,stage,version,previous_version,content,status,source,created_at)
     VALUES('p03-workflow-planning','workflow_planning',1,NULL,'System policy. {{instruction}}','enabled','admin',$1)
     ON CONFLICT(prompt_id,version) DO NOTHING`,
    [timestamp],
  );
  await runtimePool.query(
    `UPDATE prompt SET current_version=1,updated_at=$1 WHERE prompt_id='p03-workflow-planning'`,
    [timestamp],
  );
}

async function seedModelInvocationTasks(): Promise<void> {
  const timestamp = '2026-08-02T04:00:00.000Z';
  for (const taskId of ['task-p03-before-route-v2', 'task-p03-after-route-v2']) {
    const contextId = `context-${taskId}`;
    await runtimePool.query(
      `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
       VALUES($1,'user-p03',$2,$2)
       ON CONFLICT(context_id) DO NOTHING`,
      [contextId, timestamp],
    );
    await runtimePool.query(
      `INSERT INTO agent_task(
         task_id,context_id,user_id,phase,phase_message,request_text,request_metadata,
         created_at,updated_at)
       VALUES($1,$2,'user-p03','planning','Planning.','Create a bounded plan.',$3::jsonb,$4,$4)
       ON CONFLICT(task_id) DO NOTHING`,
      [taskId, contextId, JSON.stringify({ taskType: 'inspection' }), timestamp],
    );
  }
}

function invokePlanning(modelRuntime: ModelRuntimeService, taskId: string): Promise<unknown> {
  return modelRuntime.generateStructured({
    stage: 'workflow_planning',
    instruction: 'Create a bounded plan.',
    responseSchema: { type: 'object' },
    correctionErrors: [],
    taskId,
    routeContext: { taskType: 'inspection' },
  });
}

class P03FallbackTransport implements ModelTransportAdapter {
  readonly providerIds: string[] = [];
  readonly #failedProviderId: string;

  constructor(failedProviderId: string) {
    this.#failedProviderId = failedProviderId;
  }

  generateStructured(input: Parameters<ModelTransportAdapter['generateStructured']>[0]) {
    this.providerIds.push(input.configuration.providerId);
    if (input.configuration.providerId === this.#failedProviderId)
      return Promise.reject(
        Object.assign(new Error('upstream credential-value must be redacted'), {
          code: 'UPSTREAM_FAILED',
        }),
      );
    return Promise.resolve({
      rawResponse: { status: 'ok' },
      structuredResult: { provider: input.configuration.providerId },
      inputTokens: 10,
      outputTokens: 5,
    });
  }

  embed(input: Parameters<ModelTransportAdapter['embed']>[0]) {
    this.providerIds.push(input.configuration.providerId);
    return Promise.resolve({ rawResponse: { status: 'ok' }, vector: [1, 0], inputTokens: 2 });
  }
}
