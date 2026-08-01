import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../../apps/node-control-api/src/runtime.js';
import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createConfigurationRevision,
  type ConfigurationApplyMode,
  type JsonValue,
} from '../../node-control-domain/src/index.js';
import {
  RuntimeConfigurationAgent,
  type RuntimeConfigurationApplyResult,
  type RuntimeConfigurationSource,
} from '../../runtime-control-application/src/index.js';
import { HttpRuntimeConfigurationSource } from '../../runtime-control-http-client/src/index.js';
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
    'TRUNCATE runtime_task_configuration_binding, runtime_configuration_ack_outbox, runtime_configuration_snapshot',
  );
  await controlPool.query(
    `TRUNCATE sdar_control.configuration_application,
              sdar_control.configuration_command_receipt,
              sdar_control.configuration_target_state,
              sdar_control.configuration_revision,
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
