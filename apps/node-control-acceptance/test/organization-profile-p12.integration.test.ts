import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../node-control-api/src/runtime.js';
import { applyRuntimeMigrations } from '../../server/src/runtime.js';
import { applyControlMigrations } from '../../../packages/node-control-persistence-postgres/src/index.js';

const runtimeConnectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const controlConnectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const adminToken = 'p12-control-api-token-00000000000000000000000';
const organizationToken = 'p12-organization-token-00000000000000000000';
const runtimeToken = 'p12-runtime-token-00000000000000000000000';
const nodeId = 'node-p12-organization';
const taskId = 'task-p12-organization';
const contextId = 'context-p12-organization';
const controlPool = new Pool({ connectionString: controlConnectionString, max: 2 });
const runtimePool = new Pool({ connectionString: runtimeConnectionString, max: 2 });
let control: NodeControlApiRuntime | undefined;

beforeAll(async () => {
  await Promise.all([applyControlMigrations(controlPool), applyRuntimeMigrations(runtimePool)]);
  await controlPool.query(
    `TRUNCATE sdar_control.node_event_outbox,
              sdar_control.node_profile_command_receipt,
              sdar_control.node_profile_revision,
              sdar_control.control_audit_event,
              sdar_control.management_operation,
              sdar_control.node_profile CASCADE`,
  );
  await controlPool.query(
    `UPDATE sdar_control.node_event_source_cursor
        SET last_sequence=0,updated_at=clock_timestamp()
      WHERE source_name='runtime-cognitive-outbox'`,
  );
  await runtimePool.query(
    `DELETE FROM cognitive_runtime_outbox
      WHERE event_type IN ('node.capability.readiness_changed','node.task.capability_bound')`,
  );
  await runtimePool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES($1,'organization-p12',clock_timestamp(),clock_timestamp())`,
    [contextId],
  );
  await runtimePool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,phase,phase_message,request_text,request_metadata,created_at,updated_at)
     VALUES($1,$2,'organization-p12','executing','executing','P12 organization task','{}'::jsonb,
            clock_timestamp(),clock_timestamp())`,
    [taskId, contextId],
  );
  control = await startNodeControlApi({
    SDAR_CONTROL_DATABASE_URL: controlConnectionString,
    SDAR_CONTROL_RUNTIME_DATABASE_URL: runtimeConnectionString,
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: 0,
    SDAR_CONTROL_API_TOKEN: adminToken,
    SDAR_CONTROL_ORGANIZATION_API_TOKEN: organizationToken,
    SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: runtimeToken,
    SDAR_CONTROL_NODE_ID: nodeId,
    SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
    SDAR_CONTROL_NODE_DISPLAY_NAME: 'P12 Organization Node',
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://127.0.0.1:1',
    SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_NODE_EVENTS_URL: 'http://127.0.0.1:10080/api/v1/events',
    SDAR_CONTROL_A2A_AGENT_CARD_URL: 'http://127.0.0.1:9999/.well-known/agent-card.json',
  });
});

afterAll(async () => {
  await control?.close();
  await runtimePool
    .query('DELETE FROM agent_task WHERE task_id=$1', [taskId])
    .catch(() => undefined);
  await runtimePool
    .query('DELETE FROM conversation_context WHERE context_id=$1', [contextId])
    .catch(() => undefined);
  await Promise.all([controlPool.end(), runtimePool.end()]);
});

describe('P12 organization Profile and Node Event vertical', { concurrent: false }, () => {
  it('publishes a durable Profile revision and recovers authoritative state after an SSE hint', async () => {
    if (control === undefined) throw new Error('P12_CONTROL_NOT_STARTED');
    const initial = await get('/api/v1/node', adminToken);
    expect(initial.response.status).toBe(200);
    expect(initial.body).toMatchObject({ nodeId, status: 'active', revision: 1 });
    const firstEvent = await controlPool.query<{ event_id: string }>(
      'SELECT event_id FROM sdar_control.node_event_outbox ORDER BY sequence LIMIT 1',
    );
    const firstEventId = firstEvent.rows[0]?.event_id;
    if (firstEventId === undefined) throw new Error('P12_BOOTSTRAP_EVENT_MISSING');

    const draftBody = {
      nodeId,
      nodeType: 'sdar-runtime',
      displayName: 'P12 Published Organization Node',
      description: 'Stable organization-facing single-node projection.',
      environment: 'integration',
      labels: { profile: 'organization' },
      authorityScopes: ['local'],
      runtimeEndpointRef: 'http://127.0.0.1:1',
      status: 'draft',
      revision: 2,
    } as const;
    const initialEtag = requiredEtag(initial.response);
    const draft = await fetch(`${control.baseUrl}/api/v1/node/draft`, {
      method: 'PUT',
      headers: commandHeaders(adminToken, 'p12-draft', initialEtag),
      body: JSON.stringify(draftBody),
    });
    expect(draft.status, await draft.text()).toBe(200);
    const draftEtag = requiredEtag(draft);
    const validated = await command('/api/v1/node/draft/validate', draftEtag, {
      reason: 'Validate P12 organization Profile.',
      expectedRevision: 2,
    });
    expect(validated.status, await validated.text()).toBe(200);
    const published = await command('/api/v1/node/draft/publish', draftEtag, {
      reason: 'Publish P12 organization Profile.',
      expectedRevision: 2,
    });
    expect(published.status).toBe(202);
    await expect(published.json()).resolves.toMatchObject({
      operationType: 'node.profile.publish',
      status: 'succeeded',
    });
    const draftReplay = await fetch(`${control.baseUrl}/api/v1/node/draft`, {
      method: 'PUT',
      headers: commandHeaders(adminToken, 'p12-draft', initialEtag),
      body: JSON.stringify(draftBody),
    });
    expect(draftReplay.status).toBe(200);
    await expect(draftReplay.json()).resolves.toMatchObject({ status: 'draft', revision: 2 });
    await runtimePool.query(
      `INSERT INTO cognitive_runtime_outbox(
         event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
         correlation,payload,occurred_at)
       VALUES($1,'node.capability.readiness_changed','capability_readiness',$2,9,
              $3::jsonb,$4::jsonb,clock_timestamp())`,
      [
        `event-p12-readiness-${randomUUID()}`,
        'capability.p12:1',
        JSON.stringify({ correlationId: 'corr-p12-readiness' }),
        JSON.stringify({ source: 'runtime-authority' }),
      ],
    );

    const controller = new AbortController();
    const stream = await fetch(`${control.baseUrl}/api/v1/events`, {
      headers: {
        authorization: `Bearer ${organizationToken}`,
        'last-event-id': firstEventId,
      },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    const reader = stream.body?.getReader();
    if (reader === undefined) throw new Error('P12_EVENT_STREAM_MISSING');
    const chunkResult = await reader.read();
    const chunkValue: unknown = chunkResult.value;
    if (!(chunkValue instanceof Uint8Array)) throw new Error('P12_EVENT_CHUNK_MISSING');
    const chunk = new TextDecoder().decode(chunkValue);
    expect(chunk).toMatch(/event: node\.(?:management_operation\.completed|profile\.changed)/u);
    expect(chunk).toContain('"aggregateRevision":2');
    expect(chunk).toContain('event: node.capability.readiness_changed');
    expect(chunk).toContain('"changeCode":"READINESS_CHANGED"');
    controller.abort();
    await reader.cancel().catch(() => undefined);

    const organizationProfile = await get('/api/v1/node', organizationToken);
    expect(organizationProfile.response.status).toBe(200);
    expect(organizationProfile.body).toMatchObject({
      displayName: 'P12 Published Organization Node',
      status: 'active',
      revision: 2,
    });
    expect(organizationProfile.body).not.toHaveProperty('runtimeDatabaseUrl');
    expect(organizationProfile.body).not.toHaveProperty('langGraph');
    const health = await get('/api/v1/node/health', organizationToken);
    expect(health.body).toMatchObject({
      nodeId,
      status: 'degraded',
      components: expect.arrayContaining([
        expect.objectContaining({
          component: 'runtime_control',
          reasonCode: 'RUNTIME_CONTROL_REACHABILITY_NOT_PROBED',
        }),
      ]),
    });
    const tasks = await get('/api/v1/tasks', organizationToken);
    expect(tasks.response.status).toBe(200);
    expect(tasks.body).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ taskId, phase: 'executing' })]),
    });
    const task = await get(`/api/v1/tasks/${taskId}`, organizationToken);
    expect(task.body).toMatchObject({ taskId, contextId, phase: 'executing' });
    expect(task.body).not.toHaveProperty('requestText');
    expect(task.body).not.toHaveProperty('userId');
    const forbidden = await get('/api/v1/audit-events', organizationToken);
    expect(forbidden.response.status).toBe(403);
  });
});

async function command(path: string, etag: string, body: unknown): Promise<Response> {
  if (control === undefined) throw new Error('P12_CONTROL_NOT_STARTED');
  return fetch(`${control.baseUrl}${path}`, {
    method: 'POST',
    headers: commandHeaders(adminToken, `p12-${randomUUID()}`, etag),
    body: JSON.stringify(body),
  });
}

async function get(
  path: string,
  token: string,
): Promise<Readonly<{ response: Response; body: Record<string, unknown> }>> {
  if (control === undefined) throw new Error('P12_CONTROL_NOT_STARTED');
  const response = await fetch(`${control.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return Object.freeze({ response, body: (await response.json()) as Record<string, unknown> });
}

function commandHeaders(token: string, idempotencyKey: string, etag: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey,
    'if-match': etag,
  };
}

function requiredEtag(response: Response): string {
  const value = response.headers.get('etag');
  if (value === null || value === '') throw new Error('P12_ETAG_MISSING');
  return value;
}
