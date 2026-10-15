import assert from 'node:assert/strict';
import process from 'node:process';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { z } from 'zod';
import { FrozenV1RuntimeLifecycleAdapter } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/packages/mcp-adapter/src/frozen-v1-runtime-lifecycle.js';
import { startServerRuntime, type ServerRuntimeHandle } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/server/src/runtime.js';
import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/node-control-api/src/runtime.js';
import { parseNodeControlApiEnvironment } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/node-control-api/src/environment.js';
import { ConfiguredTrustedIntranetGovernedControlIdentity } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/server/src/governed-control-management-identity.js';
import { ugvAgentProfileTaskUnderstandingConfiguration } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/server/src/ugv-agent-profile.js';
import { HttpNodeControlCapabilityEvidenceReader } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/packages/runtime-control-http-client/src/index.js';
import {
  computeSmppSnapshotChecksum,
  smppCandidateIdentity,
} from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/packages/node-control-domain/src/index.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/server/test-support/postgres.js';
import {
  createA2ATestSendMessageBody,
  cancelA2ATestTaskAtUrl,
} from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/packages/a2a-adapter/test-support/client.js';
import { bootstrapUgvSmppSource } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/node-control-acceptance/src/ugv-smpp-source-bootstrap-driver.js';
import { materializeUgvSmppProvider } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/node-control-acceptance/src/ugv-smpp-provider-materialization-driver.js';
import { governUgvSmppCapabilities } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/node-control-acceptance/src/ugv-smpp-capability-governance-driver.js';
import { governUgvAreaPatrol } from '/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/apps/node-control-acceptance/src/ugv-area-patrol-governance-driver.js';

const sourceRoot = process.env['SMPP_INSPECTION_SOURCE_ROOT'];
const caseFilter = process.env['INSPECTION_JOINT_CASE'];
if (caseFilter && !['patrol-cancel', 'patrol-failed'].includes(caseFilter))
  throw Error('UNKNOWN_DEBUG_CASE');
const configurationFile = process.env['SMPP_INSPECTION_TEST_CONFIG_FILE'];
if (!sourceRoot || !configurationFile) throw Error('OWNED_INSPECTION_SOURCE_AND_CONFIG_REQUIRED');
const config = z
  .object({
    owner: z.literal('inspection-area-v1'),
    databaseUrl: z.url(),
    brokerUrl: z.string(),
    broker: z.string().regex(/^[a-f0-9]{64}$/),
    redisPort: z.number().int().positive(),
  })
  .parse(JSON.parse(await readFile(configurationFile, 'utf8')));
const adminUrl = new URL(config.databaseUrl);
if (adminUrl.hostname !== '127.0.0.1' || adminUrl.pathname !== '/inspection_test')
  throw Error('OWNED_LOOPBACK_INSPECTION_DATABASE_REQUIRED');
const suffix = randomUUID().replaceAll('-', ''),
  runId = 'uap-p3-b02-inspection-joint-' + suffix;
const databaseName = 'sdar_inspection_' + suffix,
  controlDatabaseName = 'sdar_inspection_control_' + suffix;
const postgresUrl = isolatedDatabaseUrl(config.databaseUrl, databaseName),
  controlUrl = isolatedDatabaseUrl(config.databaseUrl, controlDatabaseName);
const temp = await mkdtemp(join(tmpdir(), 'inspection-governance-'));
const token = randomBytes(32).toString('hex'),
  serviceToken = randomBytes(32).toString('hex');
const previousSimulationAck = process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'],
  previousSimulationId = process.env['UGV_SIMULATION_RUN_ID'];
process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'] = 'YES';
process.env['UGV_SIMULATION_RUN_ID'] = runId;
let runtime: ServerRuntimeHandle | undefined,
  control: NodeControlApiRuntime | undefined,
  pool: Pool | undefined,
  fixture: ChildProcess | undefined;
let registry: ReturnType<typeof createServer> | undefined;
let model: ReturnType<typeof createServer> | undefined;
let modelRequests = 0;
let stderr = '';
const ipc = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
async function fixtureCommand(action: string, mode?: string) {
  if (!fixture?.connected) throw Error('OWNED_FIXTURE_UNAVAILABLE');
  const id = randomUUID();
  const result = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      ipc.delete(id);
      reject(Error('OWNED_FIXTURE_COMMAND_TIMEOUT:' + action));
    }, 30000);
    ipc.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
  fixture.send({ id, action, mode });
  return result;
}
async function freePort() {
  const socket = createNetServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw Error('PORT_REQUIRED');
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 30000,
): Promise<T> {
  const deadline = Date.now() + ms;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (done(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('JOINT_WAIT_TIMEOUT:' + JSON.stringify(last) + ':' + stderr.slice(-1500));
}
const object = z.record(z.string(), z.unknown());
async function json(url: string, body?: unknown) {
  const response = await fetch(url, {
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw Error('JOINT_HTTP_FAILED:' + String(response.status) + ':' + JSON.stringify(value));
  return value;
}
async function a2a(message: Record<string, unknown>) {
  if (!runtime) throw Error('RUNTIME_REQUIRED');
  const response = await fetch(runtime.a2a.baseUrl + '/a2a/v1/message:send', {
    method: 'POST',
    headers: { 'A2A-Version': '1.0', 'content-type': 'application/json' },
    body: JSON.stringify(
      createA2ATestSendMessageBody({
        message: {
          messageId: randomUUID(),
          role: 'ROLE_USER',
          parts: [
            {
              text: 'Execute this exact admitted region and retain its honest report.',
              mediaType: 'text/plain',
            },
          ],
          ...message,
        },
        configuration: { returnImmediately: true },
      }),
    ),
  });
  const body: unknown = await response.json();
  if (!response.ok) throw Error('JOINT_A2A_FAILED:' + JSON.stringify(body));
  return object.parse(object.parse(body)['task']);
}
async function task(id: string) {
  if (!pool) throw Error('PG_REQUIRED');
  const rows = await pool.query<{
    task_id: string;
    context_id: string;
    phase: string;
    phase_message: string;
    plan_id: string | null;
    output_structured: unknown;
    error_code: string | null;
    selected_skill_id: string | null;
  }>(
    'SELECT task_id,context_id,phase,phase_message,plan_id,output_structured,error_code,selected_skill_id FROM agent_task WHERE task_id=$1',
    [id],
  );
  const row = rows.rows[0];
  if (!row) throw Error('TASK_REQUIRED');
  return row;
}
const evidence: unknown[] = [];
const originalFetch = globalThis.fetch;
const originalLifecycleGet = FrozenV1RuntimeLifecycleAdapter.prototype.get;
const mcpReadFailures: unknown[] = [];
const taskPollBodies = new Map<string, unknown>();
try {
  FrozenV1RuntimeLifecycleAdapter.prototype.get = async function (input) {
    try {
      return await originalLifecycleGet.call(this, input);
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          event: 'inspection_joint.lifecycle_read_failed',
          code:
            typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
          summary: error instanceof Error ? error.message : 'Unknown lifecycle failure',
          task: taskPollBodies.get(input.remoteTaskId),
        }) + '\n',
      );
      throw error;
    }
  };
  fixture = spawn(process.execPath, ['--import', 'tsx', 'scripts/inspection/provider-harness.ts'], {
    cwd: sourceRoot,
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  fixture.stderr?.on('data', (data) => {
    stderr += String(data);
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('SMPP_FIXTURE_TIMEOUT:' + stderr)), 30000);
    fixture?.once('exit', () => {
      clearTimeout(timer);
      reject(Error('SMPP_FIXTURE_EXIT:' + stderr));
    });
    fixture?.on('message', (value: unknown) => {
      const message = object.parse(value);
      if (message['kind'] === 'ready') {
        clearTimeout(timer);
        resolve(z.url().parse(message['endpoint']));
      }
      if (typeof message['id'] === 'string') {
        const waiter = ipc.get(message['id']);
        if (waiter) {
          ipc.delete(message['id']);
          if (typeof message['error'] === 'string') waiter.reject(Error(message['error']));
          else waiter.resolve(message['result']);
        }
      }
    });
  });
  globalThis.fetch = async (url, options) => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const method = new Headers(options?.headers).get('mcp-method');
    const started = Date.now();
    let response;
    try {
      response = await originalFetch(url, options);
    } catch (error) {
      if (target === endpoint)
        process.stderr.write(
          JSON.stringify({
            event: 'inspection_joint.mcp_transport_failed',
            method,
            elapsedMs: Date.now() - started,
            summary: error instanceof Error ? error.message : 'Unknown fetch failure',
          }) + '\n',
        );
      throw error;
    }
    if (target === endpoint && method === 'tasks/get' && response.ok) {
      const body = object.safeParse(
        await response
          .clone()
          .json()
          .catch(() => undefined),
      ).data;
      const observed = object.safeParse(body?.['result']).data;
      if (typeof observed?.['taskId'] === 'string')
        taskPollBodies.set(observed['taskId'], observed);
      process.stderr.write(
        JSON.stringify({
          event: 'inspection_joint.task_poll',
          elapsedMs: Date.now() - started,
          status: object.safeParse(body?.['result']).data?.['status'],
        }) + '\n',
      );
    }
    if (target === endpoint && method?.toLowerCase().includes('availability') && response.ok) {
      const body = (await response
        .clone()
        .json()
        .catch(() => undefined)) as unknown;
      process.stderr.write(
        JSON.stringify({ event: 'inspection_joint.availability', method, result: body }) + '\n',
      );
      if (JSON.stringify(body).includes('UGV_EXTERNAL_CHASSIS_TRACK_BUSY')) {
        const state = await originalFetch(endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/call',
            'x-sdar-execution-mode': 'simulation',
            'x-sdar-simulation-id': runId,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'inspection-state-diagnostic',
            method: 'tools/call',
            params: {
              name: 'vehicle_get_state',
              arguments: { resourceId: 'vehicle:ugv1', include: ['chassis', 'health'] },
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': {
                  name: 'inspection-diagnostic',
                  version: '1.0',
                },
                'io.modelcontextprotocol/clientCapabilities': {
                  extensions: { 'io.modelcontextprotocol/tasks': {} },
                },
              },
            },
          }),
        });
        process.stderr.write(
          JSON.stringify({ event: 'inspection_joint.busy_snapshot', result: await state.json() }) +
            '\n',
        );
      }
    }
    if (target === endpoint && response.status >= 400) {
      const body = object.safeParse(
        await response
          .clone()
          .json()
          .catch(() => undefined),
      ).data;
      const failure = { method, status: response.status, error: body?.['error'] };
      mcpReadFailures.push(failure);
      process.stderr.write(
        JSON.stringify({ event: 'inspection_joint.mcp_read_denied', ...failure }) + '\n',
      );
    }
    if (target === endpoint && method === 'tools/call') {
      const callBody =
        typeof options?.body === 'string'
          ? object.safeParse(JSON.parse(options.body)).data
          : undefined;
      const params = object.safeParse(callBody?.['params']).data;
      process.stderr.write(
        JSON.stringify({
          event: 'inspection_joint.tool_response',
          tool: params?.['name'],
          result: await response
            .clone()
            .json()
            .catch(() => undefined),
        }) + '\n',
      );
    }
    return response;
  };
  await createIsolatedRuntimeDatabase(config.databaseUrl, databaseName, { template: 'template0' });
  const admin = new Pool({ connectionString: config.databaseUrl });
  try {
    await admin.query(`CREATE DATABASE ${controlDatabaseName} TEMPLATE template0`);
  } finally {
    await admin.end();
  }
  const controlPort = await freePort(),
    controlBase = 'http://127.0.0.1:' + String(controlPort);
  model = createServer((_request, response) => {
    modelRequests++;
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'INSPECTION_TEST_MODEL_GENERATION_FORBIDDEN' } }));
  });
  await new Promise<void>((resolve) => model?.listen(0, '127.0.0.1', resolve));
  const modelAddress = model.address();
  if (!modelAddress || typeof modelAddress === 'string') throw Error('MODEL_FIXTURE_REQUIRED');
  const reader = new HttpNodeControlCapabilityEvidenceReader({
    baseUrl: controlBase,
    serviceToken,
    bindingServiceToken: serviceToken,
    unsafeTestOpen: true,
  });
  runtime = await startServerRuntime({
    postgresUrl,
    modelBootstrap: {
      providerId: 'inspection-guard-model',
      name: 'Inspection no-generation guard',
      kind: 'local',
      apiStyle: 'openai_chat_completions',
      baseUrl: 'http://127.0.0.1:' + String(modelAddress.port),
      model: 'inspection-guard',
      enabled: true,
      timeoutMs: 1000,
      credentialHeaders: {},
    },
    redis: { host: '127.0.0.1', port: config.redisPort },
    masterKeyBase64: randomBytes(32).toString('base64'),
    applyMigrations: true,
    evidenceEnvironment: 'integration',
    a2aPort: 0,
    managementPort: 0,
    runtimeControlServiceToken: serviceToken,
    disableDeviceWeapons: true,
    ugvAgentProfileSkillScope: 'profile_reviewed',
    capabilityAuthorityReader: reader,
    currentMcpProviderBindingAuthorityReader: reader,
    governedControlPrincipalResolver: new ConfiguredTrustedIntranetGovernedControlIdentity({
      actorId: 'inspection-isolated-human',
      permissions: ['physical_control.confirm'],
    }),
    taskUnderstanding: ugvAgentProfileTaskUnderstandingConfiguration(),
    queueName: runId,
    frozenMcpTasks: {
      isolationAcknowledged: true,
      queueName: runId + '-remote',
      reconcileIntervalMs: 50,
      polling: {
        minimumPollIntervalMs: 100,
        maximumPollIntervalMs: 100,
        providerFailureBackoffBaseMs: 100,
        providerFailureBackoffMaximumMs: 100,
      },
    },
    businessEvents: { enabled: true, reconnectDelayMs: 100, processingIntervalMs: 100 },
    ugvMovePositionPolicy: { toleranceM: 2, minimumDisplacementM: 0.5, maxFinalStateAgeMs: 3000 },
    a2aWaitTimeoutMs: 5000,
    a2aSafetyPollIntervalMs: 100,
  });
  pool = new Pool({ connectionString: postgresUrl, max: 4 });
  control = await startNodeControlApi(
    parseNodeControlApiEnvironment({
      NODE_ENV: 'test',
      SDAR_CONTROL_DATABASE_URL: controlUrl,
      SDAR_CONTROL_RUNTIME_DATABASE_URL: postgresUrl,
      SDAR_CONTROL_API_PORT: String(controlPort),
      SDAR_CONTROL_API_TOKEN: token,
      SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: serviceToken,
      SDAR_CONTROL_NODE_ID: 'inspection-node',
      SDAR_CONTROL_NODE_DISPLAY_NAME: 'Inspection isolated node',
      SDAR_CONTROL_ENVIRONMENT: 'integration',
      SDAR_CONTROL_RUNTIME_ENDPOINT_REF: runtime.management.baseUrl,
      SDAR_CONTROL_PUBLIC_URL: controlBase,
      SDAR_CONTROL_NODE_EVENTS_URL: controlBase + '/api/v1/events',
      SDAR_CONTROL_A2A_AGENT_CARD_URL: runtime.a2a.baseUrl + '/.well-known/agent-card.json',
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
    }),
  );
  const sourceId = 'inspection-smpp',
    providerId = 'isr.vehicle.ugv.ugv1',
    externalServerId = 'inspection-smpp-mcp';
  const providers = [
    {
      externalProviderId: providerId,
      externalServerId,
      serverEndpoint: endpoint,
      catalogRevision: '1',
      labels: { environment: 'integration', protocolMode: 'frozen_v1' as const },
    },
  ];
  const snapshot = {
    smppSourceId: sourceId,
    revision: 1,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    candidates: providers.map((p) => ({
      smppSourceId: sourceId,
      ...p,
      compositeIdentity: smppCandidateIdentity(sourceId, p.externalProviderId, p.externalServerId),
    })),
  };
  const checksum = computeSmppSnapshotChecksum(snapshot);
  registry = createServer((request, response) => {
    const notModified = request.headers['if-none-match'] === '"' + checksum + '"';
    response.writeHead(notModified ? 304 : 200, {
      'content-type': 'application/json',
      etag: '"' + checksum + '"',
      'x-smpp-native-revision': '1',
      'x-smpp-native-checksum': checksum,
      'x-smpp-projection-contract': 'sdar-registry-v1',
    });
    response.end(
      notModified
        ? undefined
        : JSON.stringify({
            revision: 1,
            checksum,
            generatedAt: snapshot.generatedAt,
            expiresAt: snapshot.expiresAt,
            providers,
          }),
    );
  });
  await new Promise<void>((resolve) => registry?.listen(0, '127.0.0.1', resolve));
  const address = registry.address();
  if (!address || typeof address === 'string') throw Error('REGISTRY_REQUIRED');
  const shared = {
    nodeControlBaseUrl: controlBase,
    nodeControlBearerToken: token,
    runtimeManagementBaseUrl: runtime.management.baseUrl,
    runId,
    developmentComposeNetwork: false,
  };
  process.stdout.write('Native source, Provider and Capability publication\n');
  const capturedResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'inspection-catalog-capture',
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'inspection-contract', version: '1.0' },
          'io.modelcontextprotocol/clientCapabilities': {
            extensions: { 'io.modelcontextprotocol/tasks': {} },
          },
        },
      },
    }),
  });
  const captured = object.parse(await capturedResponse.json());
  await writeFile(
    'reports/inspection-area-v1/CONTRACT_OBSERVED.json',
    JSON.stringify(captured, null, 2) + '\n',
  );
  evidence.push(
    await bootstrapUgvSmppSource({
      nodeControlBaseUrl: controlBase,
      nodeControlAdminToken: token,
      smppSourceId: sourceId,
      smppEnvironment: 'integration',
      registryEndpoint: `http://127.0.0.1:${String(address.port)}/api/v1/registry/integration/consumers/sdar/v1/sources/${sourceId}/latest`,
      registryCredentialRef: 'unauthenticated://none',
      syncMode: 'manual',
      snapshotTtlSeconds: 3600,
      lkgPolicy: 'deny_when_unavailable',
      externalProviderId: providerId,
      externalServerId,
      runId,
    }),
  );
  evidence.push(
    await materializeUgvSmppProvider({
      ...shared,
      smppSourceId: sourceId,
      externalProviderId: providerId,
      externalServerId,
      localServerId: 'inspection-provider',
      bindingId: 'inspection-provider-binding',
      providerDisplayName: 'Inspection isolated SMPP',
      runtimeCredentialRef: 'unauthenticated://none',
      catalogProfile: 'ugv-inspect-v1-14',
    }),
  );
  const governance = {
    ...shared,
    initialPointSkillPackageRoot: join(process.cwd(), 'skills/embodied.move_to'),
    packageWorkspaceRoot: join(temp, 'packages'),
    excludeDeviceWeapons: true,
    bindingId: 'inspection-provider-binding',
    resourceId: 'vehicle:ugv1',
    activateNavigateControl: true,
    navigateControlMode: 'coordinate_point' as const,
    runtimeExecutionContext: { mode: 'simulation' as const, simulationId: runId },
  };
  evidence.push(await governUgvSmppCapabilities(governance));
  const patrolGovernance = {
    ...governance,
    initialPatrolPackageRoot: join(process.cwd(), 'skills/embodied.area_patrol'),
    patrolPackageRoot: join(process.cwd(), 'skills/embodied.area_patrol.v2'),
  };
  const publication = await governUgvAreaPatrol(patrolGovernance);
  evidence.push(publication);
  const repeated = await governUgvAreaPatrol({
    ...patrolGovernance,
    runId: runId + '-idempotence',
  });
  assert.deepEqual(repeated, publication);
  evidence.push({ case: 'patrol-publication-idempotence', result: repeated });
  const exposures = z
    .object({ items: z.array(object) })
    .loose()
    .parse(await json(controlBase + '/api/v1/a2a-exposures?pageSize=100')).items;
  const exposure = (capabilityId: string) => {
    const found = exposures
      .filter((e) => e['capabilityId'] === capabilityId && e['status'] === 'published')
      .sort((a, b) => Number(b['version']) - Number(a['version']))[0];
    if (!found) throw Error('PUBLISHED_EXPOSURE_REQUIRED');
    return found;
  };
  const area = {
    boundary: [
      { x: 116, y: 39 },
      { x: 117, y: 39 },
      { x: 117, y: 40 },
      { x: 116, y: 40 },
    ],
  };
  async function submit(capabilityId: string) {
    const published = exposure(capabilityId);
    const input = {
      resourceId: 'vehicle:ugv1',
      area,
      timeWindow: {
        earliestStart: new Date().toISOString(),
        deadline: new Date(Date.now() + 300000).toISOString(),
      },
      ...(capabilityId === 'embodied.area_patrol'
        ? { target: { x: 116.5, y: 39.5, frame: 'WGS84' } }
        : {}),
    };
    const requestId = randomUUID();
    const submitted = await a2a({
      parts: [
        {
          text: 'Execute this exact admitted region and retain its honest report.',
          mediaType: 'text/plain',
        },
        { data: input, mediaType: 'application/json' },
      ],
      metadata: {
        idempotency_key: requestId,
        'io.sdar/requestedCapability': {
          exposureId: published['exposureId'],
          versionConstraint: String(published['version']),
          requestId,
        },
        structured_input: input,
      },
    });
    return z.string().parse(submitted['id']);
  }
  async function confirm(id: string) {
    const current = await task(id);
    await a2a({
      taskId: id,
      contextId: current.context_id,
      metadata: { sdar_action: 'confirm_plan' },
    });
  }
  for (const mode of ['full', 'findings', 'missing', 'partial']) {
    if (caseFilter) continue;
    process.stdout.write('Formal inspection case: ' + mode + '\n');
    await fixtureCommand('reset');
    const id = await submit('embodied.inspect_area');
    await until(
      () => task(id),
      (t) => t.phase === 'awaiting_plan_confirmation' || t.phase === 'failed',
    );
    assert.equal(
      (await task(id)).phase,
      'awaiting_plan_confirmation',
      JSON.stringify(await task(id)),
    );
    assert.deepEqual(await fixtureCommand('probe'), []);
    await confirm(id);
    await until(
      () => fixtureCommand('probe'),
      (v) =>
        Array.isArray(v) &&
        v.length === 1 &&
        ['STARTING', 'RUNNING'].includes(String(object.parse(v[0])['state'])) &&
        typeof object.parse(v[0])['missionId'] === 'string',
    );
    await fixtureCommand('observe', mode);
    const terminal = await until(
      () => task(id),
      (t) => ['completed', 'failed'].includes(t.phase),
      90000,
    );
    assert.equal(terminal.phase, 'completed');
    const report = object.parse(terminal.output_structured);
    assert.equal(
      report['status'],
      ['missing', 'partial'].includes(mode) ? 'degraded' : 'completed',
    );
    evidence.push({ case: 'inspection-' + mode, task: terminal });
  }
  for (const mode of ['full', 'missing', 'failed', 'cancel']) {
    if (caseFilter && caseFilter !== 'patrol-' + mode) continue;
    process.stdout.write('Formal patrol case: ' + mode + '\n');
    await fixtureCommand('reset');
    const id = await submit('embodied.area_patrol');
    await until(
      () => task(id),
      (t) => t.phase === 'awaiting_plan_confirmation' || t.phase === 'failed',
    );
    assert.equal(
      (await task(id)).phase,
      'awaiting_plan_confirmation',
      JSON.stringify(await task(id)),
    );
    await confirm(id);
    let observed = 0;
    const observedTaskIds = new Set<string>();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const current = await task(id);
      if (['completed', 'failed', 'canceled'].includes(current.phase)) break;
      if (current.phase === 'awaiting_plan_confirmation') await confirm(id);
      const active = await fixtureCommand('probe');
      if (
        Array.isArray(active) &&
        active.length &&
        ['STARTING', 'RUNNING'].includes(String(object.parse(active[0])['state'])) &&
        typeof object.parse(active[0])['missionId'] === 'string' &&
        typeof object.parse(active[0])['taskId'] === 'string' &&
        !observedTaskIds.has(String(object.parse(active[0])['taskId']))
      ) {
        if (
          mode === 'cancel' &&
          object.parse(active[0])['operationName'] === 'vehicle_inspect_area'
        ) {
          // The Provider's admission ACK can precede native continuation activation.
          // Cancel an admitted, durably waiting child through the public A2A path.
          await until(
            async () => {
              const q = await pool?.query(
                "SELECT count(*)::int AS count FROM workflow_instance wi JOIN agent_task ct ON ct.plan_id=wi.plan_id WHERE ct.request_metadata->'io.sdar/governedChildTask'->>'parentTaskId'=$1 AND ct.selected_skill_id='embodied.inspect_area' AND wi.status='waiting_external'",
                [id],
              );
              return q?.rows[0]?.count === 1;
            },
            (ready) => ready,
          );
          await cancelA2ATestTaskAtUrl(runtime.a2a.baseUrl, id);
          await fixtureCommand('observe', 'cancel');
          break;
        }
        if (
          mode === 'failed' &&
          object.parse(active[0])['operationName'] === 'vehicle_inspect_area'
        ) {
          const run = object.parse(active[0]);
          const exec = promisify(execFile);
          const owner = await exec('docker', [
            'inspect',
            '--format',
            '{{index .Config.Labels "codex.owner"}}',
            config.broker,
          ]);
          assert.equal(owner.stdout.trim(), 'inspection-area-v1');
          const publishOwned = async (
            topic: string,
            payload: Readonly<Record<string, unknown>>,
          ) => {
            const time = Date.now();
            await exec('docker', [
              'exec',
              config.broker,
              'mosquitto_pub',
              '-q',
              '1',
              '-h',
              '127.0.0.1',
              '-t',
              topic,
              '-m',
              JSON.stringify({
                ...payload,
                header: {
                  stamp: { sec: Math.floor(time / 1000), nanosec: (time % 1000) * 1000000 },
                },
              }),
            ]);
          };
          await publishOwned('/ugv/area_recon/status', {
            entity_id: 'ugv1',
            mission_id: run['missionId'],
            status: 5,
            scan_mode: 1,
            online: true,
            camera_fault: false,
            out_of_range: false,
            progress: 0,
            coverage: 0,
            coverage_incomplete: true,
            lock: { stage: 1, target_id: 0 },
            attack_ready: false,
          });
          await until(
            () => fixtureCommand('probe'),
            (value) =>
              Array.isArray(value) && value.some((v) => object.parse(v)['state'] === 'RUNNING'),
          );
          const stamp = Date.now();
          await exec('docker', [
            'exec',
            config.broker,
            'mosquitto_pub',
            '-q',
            '1',
            '-h',
            '127.0.0.1',
            '-t',
            '/ugv/area_recon/targets',
            '-m',
            JSON.stringify({
              entity_id: 'ugv1',
              mission_id: run['missionId'],
              header: {
                stamp: { sec: Math.floor(stamp / 1000), nanosec: (stamp % 1000) * 1000000 },
              },
              targets: [
                {
                  target_id: 7,
                  type: 1,
                  capture_time_us: stamp * 1000,
                  position: { longitude: 116.5, latitude: 39.5 },
                },
              ],
            }),
          ]);
          await until(
            async () => {
              const method = 'io.sdar/taskBusiness/context/get';
              const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  accept: 'application/json, text/event-stream',
                  'content-type': 'application/json',
                  'mcp-protocol-version': '2026-07-28',
                  'mcp-method': method,
                  'mcp-name': String(run['taskId']),
                  'x-sdar-execution-mode': 'simulation',
                  'x-sdar-simulation-id': runId,
                },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: randomUUID(),
                  method,
                  params: {
                    taskId: run['taskId'],
                    maxPageBytes: 16384,
                    _meta: {
                      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                      'io.modelcontextprotocol/clientInfo': {
                        name: 'inspection-failed-observation',
                        version: '1.0',
                      },
                      'io.modelcontextprotocol/clientCapabilities': {
                        extensions: {
                          'io.modelcontextprotocol/tasks': {},
                          'io.sdar/taskBusiness': { profileVersion: '1.0-rc2' },
                        },
                      },
                    },
                  },
                }),
              });
              const responseBody = object.parse(await response.json());
              const result = object.safeParse(responseBody['result']);
              const snapshot = object.safeParse(
                result.success ? result.data['snapshot'] : undefined,
              );
              const context = object.safeParse(
                snapshot.success ? snapshot.data['context'] : undefined,
              );
              const refs = context.success ? context.data['artifactRefs'] : undefined;
              return (
                Array.isArray(refs) &&
                refs.some((ref) => String(object.parse(ref)['id']).startsWith('target-'))
              );
            },
            (ready) => ready,
          );
        }
        await fixtureCommand('observe', mode === 'cancel' ? 'full' : mode);
        observedTaskIds.add(String(object.parse(active[0])['taskId']));
        observed++;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const terminal = await until(
      () => task(id),
      (t) => ['completed', 'failed', 'canceled'].includes(t.phase),
    );
    assert.equal(terminal.phase, mode === 'cancel' ? 'canceled' : 'completed');
    if (mode !== 'cancel') {
      const report = object.parse(terminal.output_structured);
      assert.equal(
        report['status'],
        mode === 'missing' ? 'degraded' : mode === 'failed' ? 'failed' : 'completed',
      );
      assert.equal(observed, 2);
      if (mode === 'failed') {
        assert(
          Array.isArray(report['inspectionReports']) && report['inspectionReports'].length === 1,
        );
        assert(Array.isArray(report['anomalies']) && report['anomalies'].length === 1);
      }
    } else {
      const report = object.parse(terminal.output_structured);
      assert.equal(report['status'], 'cancelled');
      assert.deepEqual(report['missingSubregions'], ['subregion-1']);
      assert(Array.isArray(report['trajectory']) && report['trajectory'].length >= 2);
    }
    const children = await pool.query(
      "SELECT task_id,phase,plan_id,selected_skill_id,selected_skill_version,output_structured FROM agent_task WHERE request_metadata->'io.sdar/governedChildTask'->>'parentTaskId'=$1 ORDER BY created_at",
      [id],
    );
    assert.equal(children.rows.length, 2);
    assert(children.rows.every((c: { task_id: string }) => c.task_id !== id));
    const admissions = await pool.query(
      'SELECT agent_task_id,count(*)::int AS count FROM remote_task_binding WHERE agent_task_id=ANY($1::text[]) GROUP BY agent_task_id',
      [children.rows.map((c: { task_id: string }) => c.task_id)],
    );
    assert.equal(admissions.rows.length, 2);
    assert(admissions.rows.every((a: { count: number }) => a.count === 1));
    evidence.push({ case: 'patrol-' + mode, task: terminal, children: children.rows });
  }
  await writeFile(
    caseFilter
      ? 'reports/inspection-area-v1/JOINT_DEBUG.json'
      : 'reports/inspection-area-v1/JOINT.json',
    JSON.stringify(
      {
        status: caseFilter ? 'PARTIAL_DEBUG_ONLY' : 'PASS',
        ...(caseFilter ? { caseFilter } : {}),
        runId,
        evidenceClass: 'ISOLATED_SIMULATION_REAL_PG_MQTT_MCP',
        sourceRoot,
        evidence,
        modelRequests,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    caseFilter
      ? 'PARTIAL: selected native debug case only\n'
      : 'PASS: native publication, inspection, patrol composition and source-qualified outcomes\n',
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      event: 'inspection_joint.failed',
      summary: error instanceof Error ? error.message : String(error),
    }) + '\n',
  );
  if (pool) {
    const readiness = await pool.query(
      'SELECT capability_id,capability_version,status,reasons,evaluation_input FROM capability_readiness_snapshot ORDER BY capability_id,capability_version,snapshot_version',
    );
    const tasks = await pool.query(
      'SELECT task_id,phase,phase_message,plan_id,error_code,request_metadata FROM agent_task ORDER BY created_at',
    );
    const remote = await pool.query(
      'SELECT binding_id,remote_task_id,agent_task_id,protocol_status,provider_substate,local_state,last_safe_error_code,result_snapshot_json,error_snapshot_json FROM remote_task_binding',
    );
    const provider = await fixtureCommand('probe');
    const controls = await pool.query(
      'SELECT control_id,status,task_id,current_plan_id,final_instance_id FROM workflow_control',
    );
    const instances = await pool.query(
      'SELECT instance_id,status,result_json,errors_json,skill_versions_json FROM workflow_instance',
    );
    const delivery = await pool.query(
      'SELECT event_type,status,error_code FROM remote_task_control_event',
    );
    const attempts = await pool.query(
      'SELECT status,error_code FROM workflow_continuation_attempt',
    );
    const events = await pool.query(
      'SELECT task_id,event_type,summary FROM runtime_event ORDER BY event_timestamp',
    );
    const skills = await pool.query(
      "SELECT v.skill_id,v.version,p.package_checksum,v.tool_policy_json,v.runtime_policy_json,v.usage_specification_json FROM skill_version v LEFT JOIN skill_package_import_audit p ON p.skill_id=v.skill_id AND p.skill_version=v.version WHERE v.skill_id='embodied.move_to'",
    );
    const business = await pool.query(
      "SELECT binding.agent_task_id AS task_id,observation.payload_json->'projection' AS projection FROM remote_task_binding binding JOIN remote_task_observation observation ON observation.binding_id=binding.binding_id WHERE observation.payload_json->>'recordType'='task_business.projection' ORDER BY observation.sequence DESC LIMIT 24",
    );
    await writeFile(
      'reports/inspection-area-v1/JOINT_FAILURE.json',
      JSON.stringify(
        {
          runId,
          readiness: readiness.rows,
          skills: skills.rows,
          business: business.rows,
          tasks: tasks.rows,
          remote: remote.rows,
          provider,
          mcpReadFailures,
          controls: controls.rows,
          instances: instances.rows,
          delivery: delivery.rows,
          attempts: attempts.rows,
          events: events.rows,
        },
        null,
        2,
      ) + '\n',
    );
  }
  throw error;
} finally {
  globalThis.fetch = originalFetch;
  FrozenV1RuntimeLifecycleAdapter.prototype.get = originalLifecycleGet;
  if (previousSimulationAck === undefined) delete process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'];
  else process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'] = previousSimulationAck;
  if (previousSimulationId === undefined) delete process.env['UGV_SIMULATION_RUN_ID'];
  else process.env['UGV_SIMULATION_RUN_ID'] = previousSimulationId;
  const cleanup = async (label: string, action: () => Promise<unknown>) => {
    try {
      process.stdout.write(JSON.stringify({event:'inspection_joint.cleanup_start',label,at:new Date().toISOString()})+'\n');
      await action();
      process.stdout.write(JSON.stringify({event:'inspection_joint.cleanup_end',label,at:new Date().toISOString()})+'\n');
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          event: 'inspection_joint.cleanup_failed',
          label,
          summary: error instanceof Error ? error.message : 'Unknown cleanup failure',
        }) + '\n',
      );
    }
  };
  await cleanup('runtime', async () => runtime?.close());
  await cleanup('control', async () => control?.close());
  await cleanup('pool', async () => pool?.end());
  await cleanup(
    'registry',
    async () => registry && new Promise<void>((resolve) => registry?.close(() => resolve())),
  );
  await cleanup(
    'model',
    async () => model && new Promise<void>((resolve) => model?.close(() => resolve())),
  );
  await cleanup('fixture', async () => {
    if (fixture?.connected) await fixtureCommand('close');
    else fixture?.kill('SIGTERM');
  });
  await cleanup('database', async () =>
    dropIsolatedRuntimeDatabase(config.databaseUrl, databaseName),
  );
  await cleanup('controlDatabase', async () =>
    dropIsolatedRuntimeDatabase(config.databaseUrl, controlDatabaseName),
  );
  await cleanup('temporaryDirectory', async () => rm(temp, { recursive: true, force: true }));
}
