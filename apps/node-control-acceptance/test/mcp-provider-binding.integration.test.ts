import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../../apps/node-control-api/src/runtime.js';
import { applyRuntimeMigrations } from '../../server/src/runtime.js';
import { createRemoteTaskBinding } from '../../../packages/domain/src/index.js';
import {
  computeSmppSnapshotChecksum,
  smppCandidateIdentity,
  type SmppProviderCandidate,
} from '../../../packages/node-control-domain/src/index.js';
import {
  applyControlMigrations,
  PostgresNodeControlMcpProviderBindingRepository,
} from '../../../packages/node-control-persistence-postgres/src/index.js';
import { PostgresRemoteTaskRepository } from '../../../packages/persistence-postgres/src/index.js';

const runtimeConnectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const controlConnectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const apiToken = 'p05-control-api-token-000000000000000000000000';
const runtimeToken = 'p05-runtime-service-token-0000000000000000000';
const mcpCredential = 'p05-real-provider-secret';
const smppCredential = 'p05-real-registry-secret';
const runtimePool = new Pool({ connectionString: runtimeConnectionString, max: 4 });
const controlPool = new Pool({ connectionString: controlConnectionString, max: 4 });
const repository = new PostgresNodeControlMcpProviderBindingRepository(controlPool);
let provider: FakeRegistryAndMcpProvider;
let providerServer: Server | undefined;
let providerBaseUrl = '';
let controlApi: NodeControlApiRuntime | undefined;
let previousMcpToken: string | undefined;
let previousSmppToken: string | undefined;

beforeAll(async () => {
  await Promise.all([applyRuntimeMigrations(runtimePool), applyControlMigrations(controlPool)]);
  await truncateControl();
  previousMcpToken = process.env['MCP_TEST_TOKEN'];
  previousSmppToken = process.env['SMPP_TEST_TOKEN'];
  process.env['MCP_TEST_TOKEN'] = mcpCredential;
  process.env['SMPP_TEST_TOKEN'] = smppCredential;
  provider = new FakeRegistryAndMcpProvider();
  providerServer = createServer((request, response) => {
    void provider.respond(request, response);
  });
  providerBaseUrl = await listen(providerServer);
  provider.configure(providerBaseUrl);
  controlApi = await startNodeControlApi({
    SDAR_CONTROL_DATABASE_URL: controlConnectionString,
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: 0,
    SDAR_CONTROL_API_TOKEN: apiToken,
    SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: runtimeToken,
    SDAR_CONTROL_NODE_ID: 'node-p05',
    SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
    SDAR_CONTROL_NODE_DISPLAY_NAME: 'P05 Integration Node',
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://127.0.0.1:9998',
    SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_NODE_EVENTS_URL: 'http://127.0.0.1:10080/api/v1/events',
    SDAR_CONTROL_A2A_AGENT_CARD_URL: 'http://127.0.0.1:9999/.well-known/agent-card.json',
    SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST: '127.0.0.1',
  });
  await seedRunningTask();
});

afterAll(async () => {
  await controlApi?.close();
  if (providerServer !== undefined) await close(providerServer);
  await truncateControl();
  await runtimePool.query(
    "DELETE FROM remote_task_observation WHERE binding_id='remote-binding-p05'",
  );
  await runtimePool.query("DELETE FROM remote_task_binding WHERE binding_id='remote-binding-p05'");
  await runtimePool.query("DELETE FROM mcp_invocation WHERE invocation_id='invocation-p05'");
  await runtimePool.query("DELETE FROM mcp_server WHERE server_id='catalog-from-smpp'");
  await runtimePool.query("DELETE FROM workflow_instance WHERE instance_id='instance-p05'");
  await runtimePool.query("DELETE FROM agent_task WHERE task_id='task-p05-running'");
  await runtimePool.query("DELETE FROM workflow_plan_attempt WHERE plan_id='plan-p05'");
  await runtimePool.query("DELETE FROM workflow_plan WHERE plan_id='plan-p05'");
  await runtimePool.query("DELETE FROM goal WHERE goal_id='goal-p05'");
  await runtimePool.query(
    "DELETE FROM conversation_context WHERE context_id='context-p05-running'",
  );
  if (previousMcpToken === undefined) delete process.env['MCP_TEST_TOKEN'];
  else process.env['MCP_TEST_TOKEN'] = previousMcpToken;
  if (previousSmppToken === undefined) delete process.env['SMPP_TEST_TOKEN'];
  else process.env['SMPP_TEST_TOKEN'] = previousSmppToken;
  await Promise.all([runtimePool.end(), controlPool.end()]);
});

describe('P05 MCP Provider Binding governance', { concurrent: false }, () => {
  it('imports only through real discovery and fails closed for drift, expiry and unsafe origins', async () => {
    await createAndSynchronizeRegistrySource();
    const candidate = await firstCandidate();
    await expect(
      repository.findSelectable('catalog-from-smpp', new Date().toISOString()),
    ).resolves.toBeUndefined();

    const importRequest = {
      bindingId: 'binding-smpp',
      localServerId: 'catalog-from-smpp',
      originType: 'smpp_registry',
      credentialRef: 'secret://env/MCP_TEST_TOKEN',
      smppSourceId: candidate['smppSourceId'],
      externalProviderId: candidate['externalProviderId'],
      externalServerId: candidate['externalServerId'],
      registryRevision: candidate['registryRevision'],
      registryChecksum: candidate['registryChecksum'],
    };
    const imported = await command('/api/v1/mcp-provider-bindings', 'p05-import-smpp', {
      reason: 'Approve exact Registry candidate and discover its authoritative Tool Catalog.',
      payload: importRequest,
    });
    expect(imported).toMatchObject({ status: 'succeeded', result: { status: 'active' } });
    expect(provider.methods()).toEqual(['server/discover', 'tools/list']);
    const firstBinding = await publicGet('/api/v1/mcp-provider-bindings/binding-smpp');
    expect(firstBinding).toMatchObject({
      bindingId: 'binding-smpp',
      originType: 'smpp_registry',
      status: 'active',
      availabilityStatus: 'available',
      revision: 1,
      registryRevision: candidate['registryRevision'],
      registryChecksum: candidate['registryChecksum'],
    });
    expect(JSON.stringify(firstBinding)).not.toContain(mcpCredential);
    await expect(
      repository.findSelectable('catalog-from-smpp', new Date().toISOString()),
    ).resolves.toMatchObject({ bindingId: 'binding-smpp', revision: 1 });

    const callsBeforeReplay = provider.methods().length;
    await expect(
      command('/api/v1/mcp-provider-bindings', 'p05-import-smpp', {
        reason: 'Approve exact Registry candidate and discover its authoritative Tool Catalog.',
        payload: importRequest,
      }),
    ).resolves.toEqual(imported);
    expect(provider.methods()).toHaveLength(callsBeforeReplay);

    const telemetry = await fetch(`${requireControlApi().baseUrl}/api/v1/mcp-provider-bindings`, {
      method: 'POST',
      headers: publicHeaders('p05-reject-telemetry'),
      body: JSON.stringify({
        reason: 'Telemetry is evidence only.',
        payload: {
          bindingId: 'binding-telemetry',
          localServerId: 'telemetry-server',
          originType: 'telemetry',
          credentialRef: 'secret://env/MCP_TEST_TOKEN',
          endpointRef: `${providerBaseUrl}/mcp`,
        },
      }),
    });
    expect(telemetry.status).toBe(400);
    await expect(repository.find('binding-telemetry')).resolves.toBeUndefined();

    const unsafe = await command('/api/v1/mcp-provider-bindings', 'p05-reject-ssrf', {
      reason: 'Prove metadata endpoints cannot be discovered.',
      payload: {
        bindingId: 'binding-unsafe',
        localServerId: 'unsafe-server',
        originType: 'direct',
        credentialRef: 'secret://env/MCP_TEST_TOKEN',
        endpointRef: 'http://169.254.169.254/latest/meta-data',
      },
    });
    expect(unsafe).toMatchObject({ status: 'failed', errorCode: 'MCP_ENDPOINT_NOT_ALLOWED' });
    await expect(repository.find('binding-unsafe')).resolves.toBeUndefined();

    const redirected = await command('/api/v1/mcp-provider-bindings', 'p05-reject-redirect', {
      reason: 'Prove an allowlisted endpoint cannot redirect discovery outside the allowlist.',
      payload: {
        bindingId: 'binding-redirect',
        localServerId: 'redirect-server',
        originType: 'direct',
        credentialRef: 'secret://env/MCP_TEST_TOKEN',
        endpointRef: `${providerBaseUrl}/redirect`,
      },
    });
    expect(redirected).toMatchObject({
      status: 'failed',
      errorCode: 'MCP_PROVIDER_DISCOVERY_FAILED',
    });
    await expect(repository.find('binding-redirect')).resolves.toBeUndefined();

    const concurrent = await Promise.all([
      command('/api/v1/mcp-provider-bindings', 'p05-concurrent-binding-a', {
        reason: 'Serialize the local MCP Server identity.',
        payload: {
          bindingId: 'binding-concurrent-a',
          localServerId: 'catalog-concurrent',
          originType: 'direct',
          credentialRef: 'secret://env/MCP_TEST_TOKEN',
          endpointRef: `${providerBaseUrl}/mcp`,
        },
      }),
      command('/api/v1/mcp-provider-bindings', 'p05-concurrent-binding-b', {
        reason: 'Serialize the local MCP Server identity.',
        payload: {
          bindingId: 'binding-concurrent-b',
          localServerId: 'catalog-concurrent',
          originType: 'direct',
          credentialRef: 'secret://env/MCP_TEST_TOKEN',
          endpointRef: `${providerBaseUrl}/mcp`,
        },
      }),
    ]);
    expect(concurrent.map((operation) => operation['status']).sort()).toEqual([
      'failed',
      'succeeded',
    ]);
    const localBindings = await controlPool.query<{ count: string }>(
      `SELECT count(DISTINCT binding_id)::text AS count
         FROM sdar_control.mcp_provider_binding WHERE local_server_id='catalog-concurrent'`,
    );
    expect(localBindings.rows).toEqual([{ count: '1' }]);

    provider.setCatalog('2.0.0', 'changed-field', 300_000);
    const refreshed = await command(
      '/api/v1/mcp-provider-bindings/binding-smpp/refresh',
      'p05-refresh-drift',
      { reason: 'Refresh the real Catalog and detect immutable schema drift.' },
    );
    expect(refreshed).toMatchObject({
      status: 'succeeded',
      result: { status: 'degraded', resultCode: 'MCP_CATALOG_DRIFT_DETECTED' },
    });
    await expect(
      repository.findSelectable('catalog-from-smpp', new Date().toISOString()),
    ).resolves.toBeUndefined();
    await expect(
      command('/api/v1/mcp-provider-bindings/binding-smpp/refresh', 'p05-refresh-same-drift', {
        reason: 'Repeated observation must not approve a drifted Catalog.',
      }),
    ).resolves.toMatchObject({
      status: 'succeeded',
      result: { status: 'degraded', resultCode: 'MCP_CATALOG_DRIFT_DETECTED' },
    });
    await expect(
      publicGet('/api/v1/mcp-provider-bindings/binding-smpp?revision=1'),
    ).resolves.toMatchObject({ revision: 1, status: 'active' });

    provider.setCatalog('2.0.0', 'changed-field', 5);
    const expiring = await command('/api/v1/mcp-provider-bindings', 'p05-import-expiring', {
      reason: 'Import a short-lived direct Catalog to prove freshness gating.',
      payload: {
        bindingId: 'binding-expiring',
        localServerId: 'catalog-expiring',
        originType: 'direct',
        credentialRef: 'secret://env/MCP_TEST_TOKEN',
        endpointRef: `${providerBaseUrl}/mcp`,
      },
    });
    expect(expiring).toMatchObject({ status: 'succeeded', result: { status: 'active' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(
      repository.findSelectable('catalog-expiring', new Date().toISOString()),
    ).resolves.toBeUndefined();

    const suspended = await command(
      '/api/v1/mcp-provider-bindings/binding-smpp/suspend',
      'p05-suspend-binding',
      { reason: 'Block only future selection.' },
    );
    expect(suspended).toMatchObject({ status: 'succeeded', result: { status: 'suspended' } });
    const removed = await command(
      '/api/v1/mcp-provider-bindings/binding-smpp/remove',
      'p05-remove-binding',
      { reason: 'Remove only future selection while retaining historical revisions.' },
    );
    expect(removed).toMatchObject({ status: 'succeeded', result: { status: 'removed' } });
    await expect(
      command('/api/v1/mcp-provider-bindings/binding-smpp/suspend', 'p05-suspend-binding', {
        reason: 'Block only future selection.',
      }),
    ).resolves.toEqual(suspended);
    await expect(publicGet('/api/v1/mcp-provider-bindings/binding-smpp')).resolves.toMatchObject({
      revision: 5,
      status: 'removed',
    });
    await expect(
      publicGet('/api/v1/mcp-provider-bindings/binding-smpp?revision=1'),
    ).resolves.toMatchObject({ revision: 1, status: 'active' });
    await expectConflict(
      '/api/v1/mcp-provider-bindings/binding-smpp/refresh',
      'p05-refresh-removed',
    );
    await expectConflict(
      '/api/v1/mcp-provider-bindings/binding-smpp/suspend',
      'p05-suspend-removed',
    );
    const task = await runtimePool.query<{ phase: string; request_metadata: unknown }>(
      "SELECT phase,request_metadata FROM agent_task WHERE task_id='task-p05-running'",
    );
    expect(task.rows[0]).toMatchObject({
      phase: 'executing',
      request_metadata: { mcpBindingId: 'binding-smpp', mcpBindingRevision: 1 },
    });
    const remoteTasks = new PostgresRemoteTaskRepository(runtimePool);
    await expect(remoteTasks.findById('remote-binding-p05')).resolves.toMatchObject({
      serverId: 'catalog-from-smpp',
      remoteTaskId: 'provider-task-p05',
      localState: 'polling',
      version: 1,
    });
    const claimedAt = new Date().toISOString();
    await expect(
      remoteTasks.claimPoll({
        bindingId: 'remote-binding-p05',
        expectedVersion: 1,
        claimToken: 'p05-post-removal-control-claim',
        claimedAt,
        expiresAt: new Date(Date.parse(claimedAt) + 30_000).toISOString(),
      }),
    ).resolves.toMatchObject({
      claimed: true,
      binding: { serverId: 'catalog-from-smpp', version: 2 },
    });

    const audit = await controlPool.query<{ payload: string }>(
      `SELECT coalesce(json_agg(event)::text,'[]') AS payload
         FROM sdar_control.control_audit_event event
        WHERE aggregate_type='mcp_provider_binding'`,
    );
    expect(audit.rows[0]?.payload).not.toContain(mcpCredential);
    expect(audit.rows[0]?.payload).not.toContain(smppCredential);
  });
});

async function createAndSynchronizeRegistrySource(): Promise<void> {
  const created = await fetch(`${requireControlApi().baseUrl}/api/v1/smpp-sources`, {
    method: 'POST',
    headers: publicHeaders('p05-create-registry-source'),
    body: JSON.stringify({
      smppSourceId: 'source-p05',
      name: 'P05 Registry',
      registryEndpoint: `${providerBaseUrl}/registry`,
      credentialRef: 'secret://env/SMPP_TEST_TOKEN',
      environment: 'integration',
      syncMode: 'manual',
      snapshotTtlSeconds: 3_600,
      lkgPolicy: 'allow_unexpired',
      status: 'draft',
      revision: 1,
    }),
  });
  expect(created.status).toBe(201);
  await expect(
    command('/api/v1/smpp-sources/source-p05/sync', 'p05-sync-registry-source', {
      reason: 'Load the candidate directory before explicit import.',
    }),
  ).resolves.toMatchObject({ status: 'succeeded' });
}

async function firstCandidate(): Promise<Record<string, unknown>> {
  const response = (await publicGet('/api/v1/mcp-provider-candidates?smppSourceId=source-p05')) as {
    items: readonly Record<string, unknown>[];
  };
  expect(response.items).toHaveLength(1);
  const candidate = response.items[0];
  if (candidate === undefined) throw new Error('P05_CANDIDATE_MISSING');
  return candidate;
}

async function command(
  path: string,
  idempotencyKey: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${requireControlApi().baseUrl}${path}`, {
    method: 'POST',
    headers: publicHeaders(idempotencyKey),
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(202);
  return (await response.json()) as Record<string, unknown>;
}

async function publicGet(path: string): Promise<unknown> {
  const response = await fetch(`${requireControlApi().baseUrl}${path}`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function expectConflict(path: string, idempotencyKey: string): Promise<void> {
  const response = await fetch(`${requireControlApi().baseUrl}${path}`, {
    method: 'POST',
    headers: publicHeaders(idempotencyKey),
    body: JSON.stringify({ reason: 'A terminal Binding state cannot be reactivated.' }),
  });
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ code: 'MCP_PROVIDER_BINDING_CONFLICT' });
}

function publicHeaders(idempotencyKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiToken}`,
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey,
  };
}

async function seedRunningTask(): Promise<void> {
  const timestamp = new Date().toISOString();
  await runtimePool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('context-p05-running','user-p05',$1,$1)
     ON CONFLICT(context_id) DO NOTHING`,
    [timestamp],
  );
  await runtimePool.query(
    `INSERT INTO goal(goal_id,context_id,version,title,description,status,created_at,updated_at)
     VALUES('goal-p05','context-p05-running',1,'P05 Remote Task','Binding retention proof',
            'active',$1,$1)
     ON CONFLICT(goal_id) DO NOTHING`,
    [timestamp],
  );
  await runtimePool.query(
    `INSERT INTO workflow_plan(
       plan_id,goal_id,goal_version,goal_contract_json,definition_json,
       confirmation_status,attempt_count,created_at)
     VALUES('plan-p05','goal-p05',1,
            '{"goalId":"goal-p05","version":1,"title":"P05 Remote Task","description":"Binding retention proof","constraints":[],"successCriteria":[]}'::jsonb,
            '{"workflowDefinitionId":"workflow-p05","version":1}'::jsonb,
            'confirmed',1,$1)
     ON CONFLICT(plan_id) DO NOTHING`,
    [timestamp],
  );
  await runtimePool.query(
    `INSERT INTO workflow_plan_attempt(
       plan_id,attempt,goal_contract_json,candidate_json,validation_errors_json,valid,created_at)
     VALUES('plan-p05',1,
            '{"goalId":"goal-p05","version":1,"title":"P05 Remote Task","description":"Binding retention proof","constraints":[],"successCriteria":[]}'::jsonb,
            '{}'::jsonb,'[]'::jsonb,true,$1)
     ON CONFLICT(plan_id,attempt) DO NOTHING`,
    [timestamp],
  );
  await runtimePool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,phase,phase_message,request_text,request_metadata,
       goal_id,goal_version,plan_id,created_at,updated_at)
     VALUES('task-p05-running','context-p05-running','user-p05','executing','Executing.',
            'Retain original MCP Binding while Control changes future selection.',
            '{"mcpBindingId":"binding-smpp","mcpBindingRevision":1}'::jsonb,
            'goal-p05',1,'plan-p05',$1,$1)
     ON CONFLICT(task_id) DO UPDATE SET phase='executing',request_metadata=EXCLUDED.request_metadata,
       updated_at=EXCLUDED.updated_at`,
    [timestamp],
  );
  await runtimePool.query(
    `INSERT INTO workflow_instance(
       instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
       status,input_json,errors_json,started_at)
     VALUES('instance-p05','plan-p05','workflow-p05',1,'goal-p05',1,'running',
            '{}'::jsonb,'{}'::jsonb,$1)
     ON CONFLICT(instance_id) DO NOTHING`,
    [timestamp],
  );
  await runtimePool.query(
    `INSERT INTO mcp_server(
       server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,
       created_at,updated_at)
     VALUES('catalog-from-smpp','P05 Runtime Provider','http://127.0.0.1:1',
            'streamable_http','enabled',1,'encrypted-p05-test-placeholder',$1,$1)
     ON CONFLICT(server_id) DO NOTHING`,
    [timestamp],
  );
  await runtimePool.query(
    `INSERT INTO mcp_invocation(
       invocation_id,task_id,context_id,server_id,tool_name,arguments_json,result_json,
       status,started_at,completed_at,duration_ms,execution_mode,simulation_id)
     VALUES('invocation-p05','task-p05-running','context-p05-running','catalog-from-smpp',
            'move_to','{}'::jsonb,'{"kind":"remote_task"}'::jsonb,'succeeded',$1,$1,0,
            'live',NULL)
     ON CONFLICT(invocation_id) DO NOTHING`,
    [timestamp],
  );
  const remoteTasks = new PostgresRemoteTaskRepository(runtimePool);
  await remoteTasks.admit(
    createRemoteTaskBinding({
      bindingId: 'remote-binding-p05',
      serverId: 'catalog-from-smpp',
      operationName: 'move_to',
      remoteTaskId: 'provider-task-p05',
      agentTaskId: 'task-p05-running',
      contextId: 'context-p05-running',
      goalId: 'goal-p05',
      goalVersion: 1,
      workflowPlanId: 'plan-p05',
      workflowDefinitionId: 'workflow-p05',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'instance-p05',
      workflowNodeId: 'remote-node-p05',
      workflowNodeRunId: 'remote-node-p05:1',
      mcpInvocationId: 'invocation-p05',
      protocolStatus: 'working',
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'tasks-schema-revision-1',
      protocolContract: {
        mode: 'frozen_v1',
        protocolVersion: '2026-07-28',
        baselineSha256: 'a'.repeat(64),
      },
      taskBehavior: 'server_directed',
      runtimeRevision: '1',
      providerSubstate: 'running',
      remoteRevision: 'provider-revision-p05',
      executionContext: { mode: 'live' },
      credentialRevision: 'credential-revision-p05',
      sessionRevision: 'session-revision-p05',
      lastProviderUpdatedAt: timestamp,
      pollIntervalMs: 100,
      createdAt: timestamp,
    }),
    'remote-binding-p05-admitted',
  );
}

async function truncateControl(): Promise<void> {
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
              sdar_control.control_audit_event,
              sdar_control.management_operation,
              sdar_control.node_profile`,
  );
}

class FakeRegistryAndMcpProvider {
  #baseUrl = '';
  #version = '1.0.0';
  #schemaProperty = 'destination';
  #ttlMs = 300_000;
  readonly #methods: string[] = [];

  configure(baseUrl: string): void {
    this.#baseUrl = baseUrl;
  }

  setCatalog(version: string, schemaProperty: string, ttlMs: number): void {
    this.#version = version;
    this.#schemaProperty = schemaProperty;
    this.#ttlMs = ttlMs;
  }

  methods(): readonly string[] {
    return [...this.#methods];
  }

  async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url === '/registry' && request.method === 'GET') {
      this.respondRegistry(request, response);
      return;
    }
    if (request.url === '/mcp' && request.method === 'POST') {
      await this.respondMcp(request, response);
      return;
    }
    if (request.url === '/redirect' && request.method === 'POST') {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
      return;
    }
    response.writeHead(404).end();
  }

  private respondRegistry(request: IncomingMessage, response: ServerResponse): void {
    if (request.headers.authorization !== `Bearer ${smppCredential}`) {
      response.writeHead(401).end();
      return;
    }
    const generatedAt = new Date(Date.now() - 1_000).toISOString();
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const raw = {
      externalProviderId: 'provider-p05',
      externalServerId: 'server-p05',
      serverEndpoint: `${this.#baseUrl}/mcp`,
      catalogRevision: 'directory-hint-only',
      labels: { environment: 'integration' },
    };
    const candidate = candidateFromRaw('source-p05', raw);
    const checksum = computeSmppSnapshotChecksum({
      smppSourceId: 'source-p05',
      revision: 1,
      generatedAt,
      expiresAt,
      candidates: [candidate],
    });
    response.writeHead(200, { 'content-type': 'application/json', etag: '"source-p05-1"' }).end(
      JSON.stringify({
        revision: 1,
        checksum,
        generatedAt,
        expiresAt,
        providers: [raw],
      }),
    );
  }

  private async respondMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${mcpCredential}`) {
      response.writeHead(401).end();
      return;
    }
    const body = JSON.parse(await readBody(request)) as { id: string | number; method: string };
    this.#methods.push(body.method);
    const result =
      body.method === 'server/discover'
        ? {
            resultType: 'complete',
            supportedVersions: ['2026-07-28'],
            capabilities: {
              extensions: {
                'io.modelcontextprotocol/tasks': {},
                'io.sdar/taskExecution': { profileVersion: '1.0', taskNotifications: true },
              },
            },
            _meta: {
              'io.modelcontextprotocol/serverInfo': {
                name: 'P05 Real Provider',
                version: this.#version,
              },
            },
            ttlMs: this.#ttlMs,
          }
        : {
            tools: [
              {
                name: 'move_to',
                inputSchema: {
                  type: 'object',
                  properties: { [this.#schemaProperty]: { type: 'string' } },
                  required: [this.#schemaProperty],
                },
                outputSchema: { type: 'object' },
                _meta: {
                  'io.sdar/taskExecution': {
                    profileVersion: '1.0',
                    taskBehavior: 'task_required',
                    availability: 'dynamic',
                    supportsScheduling: true,
                    supportsMaxElapsed: true,
                    supportsObservations: true,
                    supportsInputRequired: true,
                    idempotency: 'client_request_key',
                  },
                },
              },
            ],
          };
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  }
}

interface RawProvider {
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly serverEndpoint: string;
  readonly catalogRevision: string;
  readonly labels: Readonly<Record<string, string>>;
}

function candidateFromRaw(sourceId: string, provider: RawProvider): SmppProviderCandidate {
  return {
    smppSourceId: sourceId,
    externalProviderId: provider.externalProviderId,
    externalServerId: provider.externalServerId,
    compositeIdentity: smppCandidateIdentity(
      sourceId,
      provider.externalProviderId,
      provider.externalServerId,
    ),
    serverEndpoint: provider.serverEndpoint,
    catalogRevision: provider.catalogRevision,
    labels: provider.labels,
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('P05_PROVIDER_ADDRESS_INVALID'));
        return;
      }
      resolve(`http://127.0.0.1:${String(address.port)}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function requireControlApi(): NodeControlApiRuntime {
  if (controlApi === undefined) throw new Error('P05_CONTROL_API_NOT_STARTED');
  return controlApi;
}
