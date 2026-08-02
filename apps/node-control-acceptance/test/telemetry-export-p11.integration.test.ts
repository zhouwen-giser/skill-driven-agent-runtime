import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../node-control-api/src/runtime.js';
import { startServerRuntime, type ServerRuntimeHandle } from '../../server/src/runtime.js';
import { applyControlMigrations } from '../../../packages/node-control-persistence-postgres/src/index.js';

const runtimeConnectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const controlConnectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const redisPort = Number(process.env['SDAR_REDIS_PORT'] ?? '56379');
const apiToken = 'p11-control-api-token-00000000000000000000000';
const runtimeToken = 'p11-runtime-service-token-0000000000000000000';
const credential = 'p11-ingestion-credential';
const exportId = `export-p11-${randomUUID()}`;
const factType = `p11.telemetry.fact.${randomUUID()}`;
const runtimePool = new Pool({ connectionString: runtimeConnectionString, max: 2 });
const controlPool = new Pool({ connectionString: controlConnectionString, max: 2 });
let runtime: ServerRuntimeHandle | undefined;
let control: NodeControlApiRuntime | undefined;
let ingestion: Server | undefined;
let ingestionUrl: string;
let receivedRecords = 0;
const previousCredential = process.env['P11_TELEMETRY_TOKEN'];

beforeAll(async () => {
  process.env['P11_TELEMETRY_TOKEN'] = credential;
  await applyControlMigrations(controlPool);
  ingestion = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${credential}`) {
      response.statusCode = 401;
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        probe?: boolean;
        records?: readonly { sequence: number }[];
      };
      if (body.probe === true) {
        response.statusCode = 204;
        response.end();
        return;
      }
      const records = body.records ?? [];
      receivedRecords += records.length;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ lastAcknowledgedSequence: records.at(-1)?.sequence ?? 0 }));
    });
  });
  await listen(ingestion);
  ingestionUrl = address(ingestion);
  const node = await controlPool.query<{ node_id: string }>(
    'SELECT node_id FROM sdar_control.node_profile LIMIT 1',
  );
  const nodeId = node.rows[0]?.node_id ?? 'node-p11';
  runtime = await startServerRuntime({
    postgresUrl: runtimeConnectionString,
    redis: { host: '127.0.0.1', port: redisPort },
    masterKeyBase64: randomBytes(32).toString('base64'),
    applyMigrations: true,
    a2aHost: '127.0.0.1',
    a2aPort: 0,
    managementHost: '127.0.0.1',
    managementPort: 0,
    runtimeControlServiceToken: runtimeToken,
    queueName: `p11-telemetry-${randomUUID()}`,
  });
  control = await startNodeControlApi({
    SDAR_CONTROL_DATABASE_URL: controlConnectionString,
    SDAR_CONTROL_RUNTIME_DATABASE_URL: runtimeConnectionString,
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: 0,
    SDAR_CONTROL_API_TOKEN: apiToken,
    SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: runtimeToken,
    SDAR_CONTROL_NODE_ID: nodeId,
    SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
    SDAR_CONTROL_NODE_DISPLAY_NAME: 'P11 Integration Node',
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: runtime.management.baseUrl,
    SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_NODE_EVENTS_URL: 'http://127.0.0.1:10080/api/v1/events',
    SDAR_CONTROL_A2A_AGENT_CARD_URL: runtime.a2a.baseUrl,
  });
});

afterAll(async () => {
  await control?.close();
  await runtime?.close();
  if (ingestion?.listening === true) await close(ingestion);
  await Promise.all([runtimePool.end(), controlPool.end()]);
  if (previousCredential === undefined) delete process.env['P11_TELEMETRY_TOKEN'];
  else process.env['P11_TELEMETRY_TOKEN'] = previousCredential;
});

describe('P11 Node Control -> Runtime -> Telemetry endpoint', { concurrent: false }, () => {
  it('publishes, applies, delivers, ACKs and isolates endpoint outage from Task state', async () => {
    if (control === undefined) throw new Error('P11_CONTROL_NOT_STARTED');
    const revisionResult = await controlPool.query<{ next_revision: string }>(
      `SELECT (COALESCE(max(revision),0)+1)::text AS next_revision
       FROM sdar_control.configuration_revision WHERE target_type='telemetry_link'`,
    );
    const revisionRow = revisionResult.rows[0];
    if (revisionRow === undefined) throw new Error('P11_REVISION_UNAVAILABLE');
    const revision = Number(revisionRow.next_revision);
    const definition = {
      exportId,
      endpointRef: `${ingestionUrl}/ingest`,
      sourceId: 'runtime-p11',
      credentialRef: 'env:P11_TELEMETRY_TOKEN',
      recordFamilies: [factType],
      batchPolicy: { maxRecords: 10 },
      retryPolicy: { maxDelaySeconds: 300 },
      outboxPolicy: { maxPendingRecords: 100 },
      status: 'draft',
      revision,
      applyMode: 'hot_reload',
    };
    const created = await command('/api/v1/telemetry-export/revisions', definition, {
      idempotencyKey: `p11-create-${randomUUID()}`,
    });
    expect(created.response.status, JSON.stringify(created.body)).toBe(201);
    const validated = await command(
      `/api/v1/telemetry-export/revisions/${String(revision)}/validate`,
      { reason: 'Validate exact P11 output configuration.', expectedRevision: revision },
      {
        idempotencyKey: `p11-validate-${randomUUID()}`,
        etag: requiredResponseHeader(created.response, 'etag'),
      },
    );
    expect(validated.response.status, JSON.stringify(validated.body)).toBe(200);
    const published = await command(
      `/api/v1/telemetry-export/revisions/${String(revision)}/publish`,
      { reason: 'Publish exact P11 output configuration.', expectedRevision: revision },
      {
        idempotencyKey: `p11-publish-${randomUUID()}`,
        etag: requiredResponseHeader(validated.response, 'etag'),
      },
    );
    expect(published.response.status, JSON.stringify(published.body)).toBe(202);
    expect(published.body).toMatchObject({ status: 'succeeded' });
    const testKey = `p11-test-${randomUUID()}`;
    const tested = await command(
      '/api/v1/telemetry-export/test',
      { reason: 'Probe the active P11 ingestion endpoint.' },
      { idempotencyKey: testKey },
    );
    expect(tested.response.status, JSON.stringify(tested.body)).toBe(202);
    expect(tested.body).toMatchObject({
      operationType: 'telemetry-export.test',
      status: 'succeeded',
    });
    const testReplay = await command(
      '/api/v1/telemetry-export/test',
      { reason: 'Probe the active P11 ingestion endpoint.' },
      { idempotencyKey: testKey },
    );
    expect(testReplay.body).toEqual(tested.body);

    const firstTask = await insertRuntimeFact('first');
    await waitFor(() => receivedRecords >= 1);
    let delivered: unknown;
    await waitFor(async () => {
      delivered = await publicGet('/api/v1/telemetry-export/status');
      const status = delivered as { status?: string; pendingRecords?: number };
      return status.status === 'healthy' && status.pendingRecords === 0;
    });
    expect(delivered).toMatchObject({
      exportId,
      status: 'healthy',
      pendingRecords: 0,
    });

    if (ingestion === undefined) throw new Error('P11_INGESTION_NOT_STARTED');
    await close(ingestion);
    const outageTask = await insertRuntimeFact('outage');
    await waitFor(async () => {
      const status = (await publicGet('/api/v1/telemetry-export/status')) as {
        status?: string;
        pendingRecords?: number;
      };
      return status.status === 'degraded' && (status.pendingRecords ?? 0) >= 1;
    });
    await expect(
      runtimePool.query<{ phase: string }>(
        `SELECT phase FROM agent_task WHERE task_id=ANY($1::text[]) ORDER BY task_id`,
        [[firstTask, outageTask]],
      ),
    ).resolves.toMatchObject({ rows: [{ phase: 'completed' }, { phase: 'completed' }] });
    const authority = await runtimePool.query<{
      active: number;
      lkg: number;
      pending: number;
      last_error_code: string | null;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM runtime_telemetry_export_configuration WHERE is_active) AS active,
         (SELECT count(*)::integer FROM runtime_telemetry_export_configuration WHERE is_lkg) AS lkg,
         (SELECT count(*)::integer FROM runtime_telemetry_export_outbox
           WHERE export_id=$1 AND acknowledged_at IS NULL) AS pending,
         (SELECT last_error_code FROM runtime_telemetry_export_state WHERE singleton) AS last_error_code`,
      [exportId],
    );
    expect(authority.rows).toEqual([
      {
        active: 1,
        lkg: 1,
        pending: 1,
        last_error_code: 'TELEMETRY_ENDPOINT_UNAVAILABLE',
      },
    ]);
    const controlAudit = await controlPool.query<{ operations: number; audits: number }>(
      `SELECT
         (SELECT count(*)::integer FROM sdar_control.management_operation
           WHERE target_id=$1 AND operation_type='telemetry-export.test') AS operations,
         (SELECT count(*)::integer FROM sdar_control.control_audit_event
           WHERE aggregate_id=$1 || ':' || $2::text AND action='telemetry-export.test') AS audits`,
      [exportId, revision],
    );
    expect(controlAudit.rows).toEqual([{ operations: 1, audits: 1 }]);
  });
});

async function command(
  path: string,
  body: unknown,
  headers: Readonly<{ idempotencyKey: string; etag?: string }>,
): Promise<Readonly<{ response: Response; body: Record<string, unknown> }>> {
  if (control === undefined) throw new Error('P11_CONTROL_NOT_STARTED');
  const response = await fetch(`${control.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
      'idempotency-key': headers.idempotencyKey,
      ...(headers.etag === undefined ? {} : { 'if-match': headers.etag }),
    },
    body: JSON.stringify(body),
  });
  return Object.freeze({ response, body: (await response.json()) as Record<string, unknown> });
}

async function publicGet(path: string): Promise<unknown> {
  if (control === undefined) throw new Error('P11_CONTROL_NOT_STARTED');
  const response = await fetch(`${control.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function insertRuntimeFact(suffix: string): Promise<string> {
  const id = randomUUID();
  const contextId = `context-p11-${id}`;
  const taskId = `task-p11-${suffix}-${id}`;
  const occurredAt = new Date().toISOString();
  await runtimePool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES ($1,'user-p11',$2,$2)`,
    [contextId, occurredAt],
  );
  await runtimePool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,phase,phase_message,request_text,request_metadata,created_at,updated_at)
     VALUES ($1,$2,'user-p11','completed','completed','P11 request','{}'::jsonb,$3,$3)`,
    [taskId, contextId, occurredAt],
  );
  await runtimePool.query(
    `INSERT INTO runtime_event(
       event_id,task_id,context_id,event_type,event_timestamp,summary,created_at)
     VALUES ($1,$2,$3,$4,$5,'P11 real Runtime telemetry fact',$5)`,
    [`event-p11-${id}`, taskId, contextId, factType, occurredAt],
  );
  return taskId;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('P11_WAIT_TIMEOUT');
}

function requiredResponseHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (value === null || value === '') throw new Error(`P11_${name.toUpperCase()}_MISSING`);
  return value;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function address(server: Server): string {
  const value = server.address();
  if (value === null || typeof value === 'string') throw new Error('P11_ADDRESS_INVALID');
  return `http://127.0.0.1:${String(value.port)}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
