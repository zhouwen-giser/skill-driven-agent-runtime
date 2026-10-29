import { McpCapabilityEvidenceProjector } from '../../packages/runtime-control-application/src/mcp-capability-evidence-projector.js';
import { NodeControlFrozenMcpCatalogClient } from '../../packages/mcp-adapter/src/node-control-catalog.js';
import { materializeZmqSiteProvider } from '../../apps/node-control-acceptance/src/zmq-site-materialization.js';
import { renewZmqSiteBinding } from '../../apps/node-control-acceptance/src/zmq-site-renewal.js';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { z } from 'zod';
import { startServerRuntime, type ServerRuntimeHandle } from '../../apps/server/src/runtime.js';
import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../apps/node-control-api/src/runtime.js';
import { parseNodeControlApiEnvironment } from '../../apps/node-control-api/src/environment.js';
import { ConfiguredTrustedIntranetGovernedControlIdentity } from '../../apps/server/src/governed-control-management-identity.js';
import { ugvAgentProfileTaskUnderstandingConfiguration } from '../../apps/server/src/ugv-agent-profile.js';
import { HttpNodeControlCapabilityEvidenceReader } from '../../packages/runtime-control-http-client/src/index.js';
import {
  computeSmppSnapshotChecksum,
  smppCandidateIdentity,
} from '../../packages/node-control-domain/src/index.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../../apps/server/test-support/postgres.js';
import {
  createA2ATestSendMessageBody,
  cancelA2ATestTaskAtUrl,
} from '../../packages/a2a-adapter/test-support/client.js';
import { bootstrapUgvSmppSource } from '../../apps/node-control-acceptance/src/ugv-smpp-source-bootstrap-driver.js';
import { NODE_CONTROL_CARD_CONTENT_MEDIA_TYPE } from '../../packages/node-control-application/src/index.js';
import {
  governNativeZmqSkills,
  governSiteZmqSkills,
} from '../../apps/node-control-acceptance/src/zmq-skill-governance.js';
import { materializeZmqProvider } from '../../apps/node-control-acceptance/src/zmq-provider-materialization.js';
import { zmqCapabilityId } from '../../packages/domain/src/zmq-capability.js';
import {
  verifyNodeControlCardArtifact,
  type ArtifactRef,
  type EvidenceJsonValue,
} from '../../packages/domain/src/index.js';
import {
  SkillEvidenceProjector,
  CatalogValidatingEvidenceWriter,
} from '../../packages/runtime-control-application/src/index.js';
import { PostgresNodeControlEvidenceSource } from '../../packages/node-control-persistence-postgres/src/index.js';
import {
  PostgresEvidenceStore,
  PostgresSkillEvidenceSource,
} from '../../packages/runtime-control-persistence-postgres/src/index.js';
import { AjvJsonSchemaValidator } from '../../packages/json-schema-adapter/src/index.js';

const file = process.env['SMPP_ZMQ_GOVERNANCE_CONFIG_FILE'],
  source = process.env['SMPP_ZMQ_SOURCE_ROOT'],
  evidenceRoot = process.env['SMPP_ZMQ_GOVERNANCE_EVIDENCE_ROOT'];
if (!file || !source || !evidenceRoot) throw Error('OWNED_GOVERNANCE_CONFIGURATION_REQUIRED');
const config = z
  .object({
    owner: z.literal('zmq-phase5-governance'),
    databaseUrl: z.url(),
    redisPort: z.number().int().positive(),
    runId: z.string().regex(/^zmqgov-[a-f0-9]+$/),
    catalogProfile: z.enum(['zmq_v1_2_0_site_control_13', 'zmq_v1_3_0_site_control_13']).optional(),
  })
  .strict()
  .parse(JSON.parse(await readFile(file, 'utf8')));
const site = config.catalogProfile !== undefined;
const db = new URL(config.databaseUrl);
if (db.hostname !== '127.0.0.1' || db.pathname !== '/zmq_governance')
  throw Error('OWNED_DATABASE_REQUIRED');
const id = randomUUID().replaceAll('-', ''),
  runId = config.runId + '-' + id.slice(0, 8),
  databaseName = 'sdar_zmqgov_' + id,
  controlDatabaseName = 'sdar_zmqgov_control_' + id,
  postgresUrl = isolatedDatabaseUrl(config.databaseUrl, databaseName),
  controlUrl = isolatedDatabaseUrl(config.databaseUrl, controlDatabaseName),
  temp = await mkdtemp(join(tmpdir(), 'sdar-zmqgov-')),
  reportRoot = join(evidenceRoot, runId);
await mkdir(reportRoot, { recursive: true, mode: 0o700 });
const token = randomBytes(32).toString('hex'),
  serviceToken = randomBytes(32).toString('hex'),
  object = z.record(z.string(), z.unknown());
let runtime: ServerRuntimeHandle | undefined,
  control: NodeControlApiRuntime | undefined,
  pool: Pool | undefined,
  fixture: ChildProcess | undefined,
  registry: ReturnType<typeof createServer> | undefined,
  model: ReturnType<typeof createServer> | undefined;
let modelRequests = 0,
  fixtureErrors = '',
  endpoint = '',
  succeeded = false;
const evidence: unknown[] = [],
  cleanupErrors: string[] = [],
  mcpCalls: unknown[] = [],
  pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
const originalFetch = globalThis.fetch;
const originalControlLoad = PostgresNodeControlEvidenceSource.prototype.load;
const seenControlLoadFailures = new Set<string>();
PostgresNodeControlEvidenceSource.prototype.load = async function (partition) {
  try {
    return await originalControlLoad.call(this, partition);
  } catch (error) {
    if (!seenControlLoadFailures.has(partition.sourcePartition)) {
      seenControlLoadFailures.add(partition.sourcePartition);
      evidence.push({
        controlEvidenceFailure: error instanceof Error ? error.stack : String(error),
        partition,
      });
    }
    throw error;
  }
};
const originalMcpProjection = McpCapabilityEvidenceProjector.prototype.projectTask;
McpCapabilityEvidenceProjector.prototype.projectTask = async function (taskId) {
  try {
    return await originalMcpProjection.call(this, taskId);
  } catch (error) {
    evidence.push({ mcpEvidenceFailure: error instanceof Error ? error.stack : String(error) });
    throw error;
  }
};
const originalDiscovery = NodeControlFrozenMcpCatalogClient.prototype.discover;
NodeControlFrozenMcpCatalogClient.prototype.discover = async function (input) {
  try {
    return await originalDiscovery.call(this, input);
  } catch (error) {
    evidence.push({
      catalogDiscoveryFailure: error instanceof Error ? error.stack : String(error),
    });
    throw error;
  }
};
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  limit = 45000,
): Promise<T> {
  const start = Date.now();
  let value: T;
  do {
    value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() - start < limit);
  throw Error('ZMQ_JOINT_WAIT_TIMEOUT:' + JSON.stringify(value) + ':' + fixtureErrors.slice(-2000));
}
async function freePort() {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('OWNED_PORT_REQUIRED');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function fixtureCommand(action: string, report?: string) {
  if (!fixture?.connected) throw Error('OWNED_FIXTURE_NOT_CONNECTED');
  const command = randomUUID();
  const result = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(command);
      reject(Error('OWNED_FIXTURE_TIMEOUT:' + action));
    }, 30000);
    pending.set(command, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
  });
  fixture.send({ id: command, action, ...(report === undefined ? {} : { report }) });
  return result;
}
async function json(url: string, body?: unknown) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw Error('OWNED_HTTP_FAILED:' + response.status + ':' + JSON.stringify(value));
  return value;
}
async function a2a(message: Record<string, unknown>, returnImmediately = true) {
  if (!runtime) throw Error('OWNED_RUNTIME_REQUIRED');
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
              text: 'Execute only this explicitly admitted isolated native Skill.',
              mediaType: 'text/plain',
            },
          ],
          ...message,
        },
        configuration: { returnImmediately },
      }),
    ),
  });
  const body: unknown = await response.json();
  if (!response.ok) throw Error('OWNED_A2A_FAILED:' + JSON.stringify(body));
  const payload = object.parse(body);
  return object.parse(payload['task'] ?? payload['message']);
}
async function task(taskId: string) {
  if (!pool) throw Error('OWNED_POOL_REQUIRED');
  const rows = await pool.query<{
    task_id: string;
    context_id: string;
    phase: string;
    plan_id: string | null;
    phase_message: string;
    output_structured: unknown;
    error_code: string | null;
    selected_skill_id: string | null;
  }>(
    'SELECT task_id,context_id,phase,plan_id,phase_message,output_structured,error_code,selected_skill_id FROM agent_task WHERE task_id=$1',
    [taskId],
  );
  const row = rows.rows[0];
  if (!row) throw Error('OWNED_TASK_NOT_FOUND');
  return row;
}
const oldAck = process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'],
  oldSimulation = process.env['UGV_SIMULATION_RUN_ID'],
  oldLive = process.env['ALLOW_UGV_LIVE_SIDE_EFFECTS'];
process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'] = 'YES';
process.env['UGV_SIMULATION_RUN_ID'] = runId;
if (site) process.env['ALLOW_UGV_LIVE_SIDE_EFFECTS'] = 'YES';
try {
  const fixtureConfig = join(temp, 'provider.json');
  await writeFile(
    fixtureConfig,
    JSON.stringify({
      owner: config.owner,
      databaseUrl: config.databaseUrl,
      simulationId: runId,
      evidenceFile: join(reportRoot, 'provider-evidence.json'),
    }),
    { mode: 0o600 },
  );
  const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
    fixture = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        site
          ? 'scripts/ugv-zmq/site-joint-fixture.mjs'
          : 'tests/ugv-zmq-provider/governance-fixture.ts',
      ],
      {
        cwd: site ? process.cwd() : source,
        env: {
          ...process.env,
          SMPP_ZMQ_GOVERNANCE_FIXTURE_CONFIG: fixtureConfig,
          SMPP_ZMQ_JOINT_PROFILE: config.catalogProfile ?? '',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    fixture.stdout?.on('data', (bytes: Buffer) => {
      fixtureErrors += bytes.toString();
    });
    fixture.stderr?.on('data', (bytes: Buffer) => {
      fixtureErrors += bytes.toString();
    });
    fixture.on('message', (input: unknown) => {
      const message = object.parse(input);
      if (message['ready'] === true) resolve(message);
      else if (typeof message['id'] === 'string') {
        const wait = pending.get(message['id']);
        pending.delete(message['id']);
        if (typeof message['error'] === 'string') wait?.reject(Error(message['error']));
        else wait?.resolve(message['result']);
      }
    });
    fixture.on('exit', (code) => {
      if (code !== 0)
        reject(Error('OWNED_FIXTURE_EXIT:' + code + ':' + fixtureErrors.slice(-2000)));
    });
    fixture.on('error', reject);
  });
  const providerInfo = await Promise.race([
    ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Error('OWNED_FIXTURE_START_TIMEOUT')), 30000),
    ),
  ]);
  endpoint = z.url().parse(providerInfo['endpoint']);
  const resourceId = z.string().parse(providerInfo['resourceId']),
    providerId = z.string().parse(providerInfo['providerId']);
  globalThis.fetch = async (url, options) => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const response = await originalFetch(url, options);
    if (response.status === 202 && target !== endpoint) {
      const operation = object.parse(await response.clone().json());
      if (operation['status'] === 'failed') {
        evidence.push({ operationFailure: operation });
        process.stderr.write(JSON.stringify(operation) + '\n');
      }
    }
    if (response.status >= 400 && target !== endpoint) {
      const problem = (await response
        .clone()
        .json()
        .catch(() => null)) as unknown;
      const failure = { path: new URL(target).pathname, status: response.status, problem };
      evidence.push({ managementFailure: failure });
      process.stderr.write(JSON.stringify(failure) + '\n');
    }
    if (target === endpoint && typeof options?.body === 'string')
      mcpCalls.push({
        hasAuthorization: new Headers(options.headers).has('authorization'),
        request: JSON.parse(options.body) as unknown,
        status: response.status,
        response: await response
          .clone()
          .json()
          .catch(() => null),
      });
    return response;
  };
  await createIsolatedRuntimeDatabase(config.databaseUrl, databaseName, { template: 'template0' });
  const admin = new Pool({ connectionString: config.databaseUrl });
  try {
    await admin.query(`CREATE DATABASE ${controlDatabaseName} TEMPLATE template0`);
  } finally {
    await admin.end();
  }
  const controlBase = 'http://127.0.0.1:' + String(await freePort());
  model = createServer((_req, res) => {
    modelRequests++;
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{"error":{"code":"NATIVE_ZMQ_MODEL_GENERATION_FORBIDDEN"}}');
  });
  await new Promise<void>((resolve) => model?.listen(0, '127.0.0.1', resolve));
  const modelAddress = model.address();
  if (!modelAddress || typeof modelAddress === 'string') throw Error('OWNED_MODEL_GUARD_REQUIRED');
  const reader = new HttpNodeControlCapabilityEvidenceReader({
    baseUrl: controlBase,
    serviceToken,
    bindingServiceToken: serviceToken,
    unsafeTestOpen: true,
  });
  const runtimeOptions: Parameters<typeof startServerRuntime>[0] = {
    postgresUrl,
    redis: { host: '127.0.0.1', port: config.redisPort },
    modelBootstrap: {
      providerId: 'zmq-guard-model',
      name: 'Native no-generation guard',
      kind: 'local',
      apiStyle: 'openai_chat_completions',
      baseUrl: 'http://127.0.0.1:' + modelAddress.port,
      model: 'native-zmq-guard',
      enabled: true,
      timeoutMs: 1000,
      credentialHeaders: {},
    },
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
      actorId: 'zmq-isolated-test-human',
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
  };
  runtime = await startServerRuntime(runtimeOptions);
  pool = new Pool({ connectionString: postgresUrl, max: 4 });
  control = await startNodeControlApi(
    parseNodeControlApiEnvironment({
      NODE_ENV: 'test',
      SDAR_CONTROL_DATABASE_URL: controlUrl,
      SDAR_CONTROL_RUNTIME_DATABASE_URL: postgresUrl,
      SDAR_CONTROL_API_PORT: new URL(controlBase).port,
      SDAR_CONTROL_API_TOKEN: token,
      SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: serviceToken,
      SDAR_CONTROL_NODE_ID: 'zmq-isolated-node',
      SDAR_CONTROL_NODE_DISPLAY_NAME: 'Native ZMQ isolated node',
      SDAR_CONTROL_ENVIRONMENT: 'integration',
      SDAR_CONTROL_RUNTIME_ENDPOINT_REF: runtime.management.baseUrl,
      SDAR_CONTROL_PUBLIC_URL: controlBase,
      SDAR_CONTROL_NODE_EVENTS_URL: controlBase + '/api/v1/events',
      SDAR_CONTROL_A2A_AGENT_CARD_URL: runtime.a2a.baseUrl + '/.well-known/agent-card.json',
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
    }),
  );
  const sourceId = 'zmq-isolated-smpp',
    externalServerId = 'zmq-isolated-mcp',
    providers = [
      {
        externalProviderId: providerId,
        externalServerId,
        serverEndpoint: endpoint,
        catalogRevision: '1',
        labels: { environment: 'integration', protocolMode: 'frozen_v1' as const },
      },
    ],
    snapshot = {
      smppSourceId: sourceId,
      revision: 1,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      candidates: providers.map((p) => ({
        smppSourceId: sourceId,
        ...p,
        compositeIdentity: smppCandidateIdentity(
          sourceId,
          p.externalProviderId,
          p.externalServerId,
        ),
      })),
    },
    checksum = computeSmppSnapshotChecksum(snapshot);
  registry = createServer((req, res) => {
    const unchanged = req.headers['if-none-match'] === '"' + checksum + '"';
    res.writeHead(unchanged ? 304 : 200, {
      'content-type': 'application/json',
      etag: '"' + checksum + '"',
      'x-smpp-native-revision': '1',
      'x-smpp-native-checksum': checksum,
      'x-smpp-projection-contract': 'sdar-registry-v1',
    });
    res.end(
      unchanged
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
  const registryAddress = registry.address();
  if (!registryAddress || typeof registryAddress === 'string')
    throw Error('OWNED_REGISTRY_REQUIRED');
  evidence.push(
    await bootstrapUgvSmppSource({
      nodeControlBaseUrl: controlBase,
      nodeControlAdminToken: token,
      smppSourceId: sourceId,
      smppEnvironment: 'integration',
      registryEndpoint: `http://127.0.0.1:${String(registryAddress.port)}/api/v1/registry/integration/consumers/sdar/v1/sources/${sourceId}/latest`,
      registryCredentialRef: 'unauthenticated://none',
      syncMode: 'manual',
      snapshotTtlSeconds: 3600,
      lkgPolicy: 'deny_when_unavailable',
      externalProviderId: providerId,
      externalServerId,
      runId,
    }),
  );
  const governance = {
    qualification: 'isolated_simulator' as const,
    nodeControlBaseUrl: controlBase,
    nodeControlBearerToken: token,
    runtimeManagementBaseUrl: runtime.management.baseUrl,
    smppSourceId: sourceId,
    runId,
    providerId,
    externalServerId,
    localServerId: 'zmq-native-provider',
    bindingId: 'zmq-native-binding',
    resourceId,
    simulationId: runId,
    packageWorkspaceRoot: join(temp, 'packages'),
  };
  const siteGovernance = {
    nodeControlBaseUrl: controlBase,
    nodeControlBearerToken: token,
    runtimeManagementBaseUrl: runtime.management.baseUrl,
    runId,
    catalogProfile: config.catalogProfile ?? ('zmq_v1_2_0_site_control_13' as const),
    providerId,
    resourceId,
    localServerId: governance.localServerId,
    bindingId: governance.bindingId,
    packageWorkspaceRoot: governance.packageWorkspaceRoot,
    endpointAllowlist: [controlBase, runtime.management.baseUrl, new URL(endpoint).origin],
    source: { originType: 'smpp_registry' as const, smppSourceId: sourceId, externalServerId },
  };
  const govern = (suffix = '') =>
    site
      ? governSiteZmqSkills({ ...siteGovernance, runId: runId + suffix })
      : governNativeZmqSkills({ ...governance, runId: runId + suffix });
  process.stdout.write('Publish the exact native contracts through existing CAS APIs\n');
  const published = await govern();
  evidence.push(published);
  const repeated = await govern('-repeat');
  assert.deepEqual(repeated.published, published.published);
  assert.equal(published.published.length, site ? 14 : 12);
  if (site) {
    const authority = object.parse(published)['authority'];
    const { ZmqSiteAuthoritySchema } =
      await import('../../packages/ugv-profile/src/zmq-site-profile.js');
    evidence.push(
      await renewZmqSiteBinding(siteGovernance, ZmqSiteAuthoritySchema.parse(authority)),
    );
  }
  assert.equal(object.parse(await fixtureCommand('status'))['commands'], 0);
  let bindingWrites = 0;
  const mutatedFetch: typeof fetch = async (url, options) => {
    const target = String(url);
    if (target.includes('/mcp-provider-bindings') && options?.method === 'POST') bindingWrites++;
    const response = await fetch(url, options);
    if (target.endsWith('/api/v1/mcp/servers/zmq-native-provider/tools') && response.ok) {
      const body = object.parse(await response.json()),
        items = z.array(object).parse(body['items']);
      const first = items[0];
      if (!first) throw Error('OWNED_TOOL_REQUIRED');
      first['inputSchema'] = { type: 'object' };
      return Response.json({ ...body, items });
    }
    return response;
  };
  await assert.rejects(
    () =>
      site
        ? materializeZmqSiteProvider(
            { ...siteGovernance, bindingId: 'zmq-rejected-binding', runId: runId + '-drift' },
            { fetch: mutatedFetch },
          )
        : materializeZmqProvider(
            { ...governance, bindingId: 'zmq-rejected-binding', runId: runId + '-drift' },
            { fetch: mutatedFetch },
          ),
    /ZMQ_(?:TOOL_CONTRACT|RESOURCE_BINDING)_MISMATCH/,
  );
  assert.equal(bindingWrites, 0);
  evidence.push({ case: 'schema-drift-before-binding', bindingWrites });
  const exposure = (tool: string) => {
    const found = published.published.find((p) => p.capabilityId === 'vehicle.ugv.zmq.' + tool);
    if (!found) throw Error('OWNED_EXPOSURE_REQUIRED');
    return found;
  };
  async function submit(tool: string, input: unknown) {
    const e = exposure(tool),
      requestId = randomUUID();
    const submitted = await a2a({
      parts: [
        { text: 'Run the exact admitted isolated native report.', mediaType: 'text/plain' },
        { data: input, mediaType: 'application/json' },
      ],
      metadata: {
        idempotency_key: requestId,
        'io.sdar/requestedCapability': {
          exposureId: e.exposureId,
          versionConstraint: String(e.exposureVersion),
          requestId,
        },
        structured_input: input,
      },
    });
    return z.string().parse(submitted['id']);
  }
  async function confirm(taskId: string) {
    const row = await task(taskId);
    await a2a({ taskId, contextId: row.context_id, metadata: { sdar_action: 'confirm_plan' } });
  }
  const area = {
    crs: 'OGC:CRS84',
    searchStrategy: 'track',
    vertices: [
      { longitude: 106, latitude: 29, ellipsoidHeightM: 10 },
      { longitude: 106.001, latitude: 29, ellipsoidHeightM: 10 },
      { longitude: 106.001, latitude: 29.001, ellipsoidHeightM: 10 },
      { longitude: 106, latitude: 29.001, ellipsoidHeightM: 10 },
    ],
  };
  if (config.catalogProfile === 'zmq_v1_3_0_site_control_13')
    for (const p of area.vertices) Reflect.deleteProperty(p, 'ellipsoidHeightM');
  const inspectionInput = () => ({
    resourceId,
    area,
    timeWindow: {
      earliestStart: new Date().toISOString(),
      deadline: new Date(Date.now() + 300000).toISOString(),
    },
  });
  process.stdout.write('Run native read-only Skill through formal A2A Task admission\n');
  const readId = await submit('vehicle_get_capabilities', { resourceId });
  const read = await until(
    () => task(readId),
    (t) => ['completed', 'failed', 'awaiting_plan_confirmation'].includes(t.phase),
  );
  if (read.phase === 'awaiting_plan_confirmation') await confirm(readId);
  const readFinal = await until(
    () => task(readId),
    (t) => ['completed', 'failed'].includes(t.phase),
  );
  assert.equal(readFinal.phase, 'completed', JSON.stringify(readFinal));
  assert.equal(object.parse(readFinal.output_structured)['status'], 'completed');
  assert.equal(object.parse(await fixtureCommand('status'))['commands'], 0);
  evidence.push({ case: 'readonly-native-task', task: readFinal });
  for (const mode of ['empty', 'missing', 'cancel', 'failed'] as const) {
    process.stdout.write('Run native inspection Task: ' + mode + '\n');
    const before = object.parse(await fixtureCommand('status'))['commands'],
      input = inspectionInput(),
      taskId = await submit('vehicle_zmq_inspect_area', input);
    const waiting = await until(
      () => task(taskId),
      (t) => ['awaiting_plan_confirmation', 'failed'].includes(t.phase),
    );
    assert.equal(waiting.phase, 'awaiting_plan_confirmation', JSON.stringify(waiting));
    assert.equal(object.parse(await fixtureCommand('status'))['commands'], before);
    await confirm(taskId);
    await until(
      () => task(taskId),
      (t) => ['executing', 'failed'].includes(t.phase),
    );
    await until(
      async () => object.parse(await fixtureCommand('status')),
      (status) =>
        z
          .array(object)
          .parse(status['active'])
          .some((e) => e['state'] === 'RUNNING'),
    );
    if (mode === 'empty' || mode === 'missing') await fixtureCommand('inspect', mode);
    else if (mode === 'failed') await fixtureCommand('fail');
    else await cancelA2ATestTaskAtUrl(runtime.a2a.baseUrl, taskId);
    const final = await until(
      () => task(taskId),
      (t) => ['completed', 'failed', 'canceled'].includes(t.phase),
    );
    if (mode === 'empty' || mode === 'missing') {
      assert.equal(final.phase, 'completed', JSON.stringify(final));
      const output = object.parse(final.output_structured);
      assert.equal(output['status'], 'degraded');
      assert.ok(
        z
          .array(z.string())
          .parse(output['missingEvidence'])
          .includes('TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE'),
      );
      const native = object.parse(output['providerResult']),
        report = object.parse(native['inspectionReport']);
      assert.equal(
        report['absenceConclusion'],
        mode === 'empty' ? 'no_observations_in_received_frames' : 'unavailable',
      );
    } else
      assert.equal(final.phase, mode === 'cancel' ? 'canceled' : 'failed', JSON.stringify(final));
    evidence.push({ case: 'native-inspection-' + mode, input, task: final });
    await until(
      async () => object.parse(await fixtureCommand('status')),
      (status) => z.array(object).parse(status['active']).length === 0,
    );
  }
  if (site) {
    for (const name of [
      'vehicle_zmq_camera',
      'vehicle_zmq_area_recon',
      'vehicle_zmq_circular_recon',
      'simulation_apply_effect',
    ] as const) {
      process.stdout.write('Run native control Task: ' + name + '\n');
      const common = inspectionInput();
      const input =
        name === 'vehicle_zmq_camera'
          ? {
              resourceId,
              timeWindow: common.timeWindow,
              operation: { name: 'camera.zoom', params: { zoom_ratio: 2, zoom_timeout_ms: 1000 } },
            }
          : name === 'vehicle_zmq_area_recon'
            ? common
            : name === 'vehicle_zmq_circular_recon'
              ? {
                  resourceId,
                  timeWindow: common.timeWindow,
                  params: {
                    scan_mode: 'circular',
                    yaw_center_rad: null,
                    yaw_span_rad: null,
                    pitch_rad: 0,
                    yaw_speed_rad_s: 0.2,
                    cycle_count: 1,
                    task_timeout_ms: 10000,
                    search_strategy: 'recognize',
                  },
                }
              : {
                  resourceId,
                  timeWindow: common.timeWindow,
                  targetId: 'object-1',
                  targetSource: 'manual',
                  sourceNote: 'The isolated test human selected this virtual entity.',
                  position: { longitude_deg: 106.001, latitude_deg: 29, ellipsoid_height_m: null },
                };
      const before = object.parse(await fixtureCommand('status'))['commands'];
      const taskId = await submit(name, input);
      const waiting = await until(
        () => task(taskId),
        (t) => ['awaiting_plan_confirmation', 'failed'].includes(t.phase),
      );
      assert.equal(waiting.phase, 'awaiting_plan_confirmation', JSON.stringify(waiting));
      assert.equal(object.parse(await fixtureCommand('status'))['commands'], before);
      await confirm(taskId);
      if (['vehicle_zmq_area_recon', 'vehicle_zmq_circular_recon'].includes(name)) {
        await until(
          async () => object.parse(await fixtureCommand('status')),
          (state) =>
            z
              .array(object)
              .parse(state['active'])
              .some((e) => e['operationName'] === name && e['state'] === 'RUNNING'),
        );
        await fixtureCommand('complete');
      }
      const final = await until(
        () => task(taskId),
        (t) => ['completed', 'failed'].includes(t.phase),
      );
      assert.equal(final.phase, 'completed', JSON.stringify(final));
      const report = object.parse(final.output_structured);
      assert.ok(['completed', 'degraded'].includes(String(report['status'])));
      if (name === 'simulation_apply_effect')
        assert.equal(
          object.parse(object.parse(report['providerResult'])['targetProvenance'])['kind'],
          'manual',
        );
      evidence.push({ case: 'native-control-' + name, input, task: final });
      await until(
        async () => object.parse(await fixtureCommand('status')),
        (state) => z.array(object).parse(state['active']).length === 0,
      );
    }
    const beforePreview = object.parse(await fixtureCommand('status'))['commands'];
    const previewId = await submit('vehicle_zmq_plan_route', {
      resourceId,
      start: { longitude: 106.81485 - 340 / 111320, latitude: 29.7195 - 100 / 110540 },
      waypoints: [{ longitude: 106.81485 - 192 / 111320, latitude: 29.7195 - 100 / 110540 }],
      density: 'adaptive',
    });
    const preview = await until(
      () => task(previewId),
      (t) => ['completed', 'failed'].includes(t.phase),
    );
    assert.equal(preview.phase, 'completed', JSON.stringify(preview));
    assert.equal(
      object.parse(object.parse(preview.output_structured)['providerResult'])['adoption'],
      'preview_only',
    );
    assert.equal(object.parse(await fixtureCommand('status'))['commands'], beforePreview);
    evidence.push({ case: 'native-route-preview-without-navigation', task: preview });
    for (const mode of ['degraded', 'pause-resume', 'restart', 'cancel', 'timeout'] as const) {
      process.stdout.write('Run native single-region patrol: ' + mode + '\n');
      const input = {
        ...inspectionInput(),
        entryPoint: { longitude: 106.0005, latitude: 29.0005 },
        speedLimitMps: config.catalogProfile === 'zmq_v1_3_0_site_control_13' ? 60 / 3.6 : 1,
        obstacleAvoidance: true,
      };
      if (mode === 'timeout') input.timeWindow.deadline = new Date(Date.now() + 8000).toISOString();
      const taskId = await submit('area_patrol', input);
      const waiting = await until(
        () => task(taskId),
        (t) => ['awaiting_plan_confirmation', 'failed'].includes(t.phase),
      );
      assert.equal(waiting.phase, 'awaiting_plan_confirmation', JSON.stringify(waiting));
      await confirm(taskId);
      await until(
        async () => object.parse(await fixtureCommand('status')),
        (s) =>
          z
            .array(object)
            .parse(s['active'])
            .some((e) => e['operationName'] === 'vehicle_zmq_navigate' && e['state'] === 'RUNNING'),
      );
      const motionDispatches = object.parse(await fixtureCommand('status'))[
        'chassisMotionDispatches'
      ];
      if (mode === 'pause-resume') {
        const current = await task(taskId);
        const resumeCalls = () =>
          mcpCalls.filter(
            (call) =>
              object.parse(object.parse(call)['request'])['method'] ===
              'io.sdar/taskExecution/tasks/resume',
          ).length;
        const beforeInvalidResume = resumeCalls();
        const invalidResume = await a2a(
          { taskId, contextId: current.context_id, metadata: { sdar_action: 'resume' } },
          false,
        );
        assert.equal(invalidResume['taskId'], taskId);
        assert.equal(invalidResume['role'], 'ROLE_AGENT');
        assert.deepEqual(
          object.parse(object.parse(invalidResume['metadata'])['io.sdar/controlAction']),
          {
            action: 'resume',
            status: 'rejected',
            code: 'TASK_PHASE_TRANSITION_INVALID',
            message: 'The lifecycle command is invalid for the current Task state.',
          },
        );
        assert.equal((await task(taskId)).phase, 'executing');
        assert.equal(resumeCalls(), beforeInvalidResume);
        evidence.push({
          case: 'invalid-resume-command-rejected-without-task-failure',
          taskId,
          response: invalidResume,
          additionalResumeCalls: resumeCalls() - beforeInvalidResume,
        });
        await a2a({ taskId, contextId: current.context_id, metadata: { sdar_action: 'pause' } });
        await until(
          () => task(taskId),
          (t) => t.phase === 'paused',
        );
        await until(
          async () => object.parse(await fixtureCommand('status')),
          (s) =>
            z
              .array(object)
              .parse(s['active'])
              .some((e) => e['state'] === 'PAUSED'),
        );
        assert.equal(
          object.parse(await fixtureCommand('status'))['chassisMotionDispatches'],
          motionDispatches,
        );
        await a2a({ taskId, contextId: current.context_id, metadata: { sdar_action: 'resume' } });
        await until(
          async () => object.parse(await fixtureCommand('status')),
          (s) =>
            z
              .array(object)
              .parse(s['active'])
              .some((e) => e['state'] === 'RUNNING'),
        );
        assert.equal(
          object.parse(await fixtureCommand('status'))['chassisMotionDispatches'],
          motionDispatches,
        );
      }
      if (mode === 'restart') {
        const ports = {
          a2aPort: Number(new URL(runtime.a2a.baseUrl).port),
          managementPort: Number(new URL(runtime.management.baseUrl).port),
        };
        await runtime.close();
        runtime = undefined;
        runtime = await startServerRuntime({ ...runtimeOptions, ...ports, applyMigrations: false });
        assert.equal(
          object.parse(await fixtureCommand('status'))['chassisMotionDispatches'],
          motionDispatches,
        );
      }
      if (mode === 'cancel') await cancelA2ATestTaskAtUrl(runtime.a2a.baseUrl, taskId);
      else if (mode !== 'timeout') {
        await fixtureCommand('finish');
        await until(
          async () => object.parse(await fixtureCommand('status')),
          (s) =>
            z
              .array(object)
              .parse(s['active'])
              .some(
                (e) =>
                  e['operationName'] === 'vehicle_zmq_inspect_area' && e['state'] === 'RUNNING',
              ),
        );
        await fixtureCommand('inspect', 'empty');
      }
      const final = await until(
        () => task(taskId),
        (t) => ['completed', 'failed', 'canceled'].includes(t.phase),
      );
      assert.equal(
        final.phase,
        mode === 'cancel' ? 'canceled' : 'completed',
        JSON.stringify(final),
      );
      assert.equal(
        object.parse(final.output_structured)['status'],
        mode === 'cancel' ? 'cancelled' : mode === 'timeout' ? 'failed' : 'degraded',
      );
      const children = await pool.query(
        "SELECT task_id,selected_skill_id,phase,output_structured FROM agent_task WHERE request_metadata->'io.sdar/governedChildTask'->>'parentTaskId'=$1 ORDER BY created_at",
        [taskId],
      );
      assert.equal(children.rows.length, mode === 'cancel' || mode === 'timeout' ? 1 : 2);
      evidence.push({ case: 'native-patrol-' + mode, input, task: final, children: children.rows });
      await until(
        async () => object.parse(await fixtureCommand('status')),
        (s) => z.array(object).parse(s['active']).length === 0,
      );
    }
    assert.ok(mcpCalls.every((call) => object.parse(call)['hasAuthorization'] === false));
    evidence.push({ case: 'anonymous-mcp-no-client-authorization', requestCount: mcpCalls.length });
  }
  const generation = await pool.query<{ stage: string; count: string }>(
    "SELECT stage,count(*)::text AS count FROM model_invocation WHERE stage IN ('intent','goal','goal_planning','skill_selection','skill_input_resolution','workflow_planning','goal_evaluation','execution_decision') GROUP BY stage",
  );
  assert.deepEqual(generation.rows, []);
  evidence.push({
    case: 'no-model-generation-or-control-decision',
    stages: generation.rows,
    optionalBackgroundModelRequests: modelRequests,
  });
  const store = new PostgresEvidenceStore(pool);
  const writer = Object.assign(
    new CatalogValidatingEvidenceWriter({
      delegate: store,
      validator: new AjvJsonSchemaValidator({ strict: false }),
    }),
    {
      hasRecord: store.hasRecord.bind(store),
      recordQualityIssue: store.recordQualityIssue.bind(store),
      resolveQualityIssues: store.resolveQualityIssues.bind(store),
      saveCheckpoint: store.saveCheckpoint.bind(store),
    },
  );
  const skillProjector = new SkillEvidenceProjector({
    source: new PostgresSkillEvidenceSource(pool),
    writer,
    environment: 'runtime',
  });
  for (const row of (await pool.query<{ task_id: string }>('SELECT task_id FROM agent_task')).rows)
    await skillProjector.projectTask(row.task_id);
  const projectionIssues = await until(
    async () =>
      (
        await pool!.query(
          'SELECT source_table,issue_code,detail FROM evidence_projection_issue WHERE resolved_at IS NULL',
        )
      ).rows,
    (issues) => issues.length === 0,
  );
  evidence.push({ case: 'canonical-evidence-projection', unresolvedIssues: projectionIssues });
  const cardEvidence = await until(
    async () =>
      (
        await pool!.query<{ payload: Record<string, unknown>; artifact_refs: string[] }>(
          "SELECT payload,artifact_refs FROM evidence_outbox WHERE record_type='node_control.agent_card_revision' AND payload->>'status'='active' ORDER BY sequence DESC LIMIT 1",
        )
      ).rows[0],
    (row) => row !== undefined,
  );
  if (!cardEvidence) throw Error('OWNED_CARD_EVIDENCE_REQUIRED');
  const descriptor = object.parse(object.parse(cardEvidence.payload['card'])['sourceArtifactRef']);
  const ref = z
    .object({
      artifactId: z.string(),
      version: z.number(),
      uri: z.string(),
      sha256: z.string(),
      mediaType: z.string(),
      byteSize: z.number(),
    })
    .strict()
    .parse(descriptor) as ArtifactRef;
  assert.deepEqual(cardEvidence.artifact_refs, [ref.uri]);
  const controlEvidencePool = new Pool({ connectionString: controlUrl, max: 2 });
  try {
    const source = new PostgresNodeControlEvidenceSource(controlEvidencePool, pool, {
      principalType: 'service',
      actorId: 'service:node-control-evidence-projector:zmq-isolated-node',
      role: 'node_control_evidence_projector',
      permission: 'node_control.evidence.read',
      authorityScope: 'global_authority',
      organizationScope: 'node_local',
      nodeId: 'zmq-isolated-node',
      allowedDataClassifications: ['public', 'internal', 'restricted'],
    });
    const resolved = await source.resolveCardArtifact(ref);
    const cardUrl =
      governance.nodeControlBaseUrl + `/api/v1/a2a-agent-card-revisions/${String(ref.version)}`;
    assert.equal((await originalFetch(cardUrl, { redirect: 'manual' })).status, 401);
    const response = await originalFetch(cardUrl, {
      headers: { authorization: 'Bearer ' + token, accept: NODE_CONTROL_CARD_CONTENT_MEDIA_TYPE },
      redirect: 'manual',
    });
    assert.equal(response.status, 200);
    assert.ok(
      response.headers.get('content-type')?.startsWith(NODE_CONTROL_CARD_CONTENT_MEDIA_TYPE),
    );
    const revision = object.parse(await response.json());
    verifyNodeControlCardArtifact(
      ref,
      z.string().parse(object.parse(revision['revision'])['nodeId']),
      ref.version,
      revision['card'] as EvidenceJsonValue,
    );
    assert.deepEqual(revision['sourceArtifactRef'], ref);
    assert.deepEqual(revision['card'], resolved.value);
    assert.equal(
      (
        await originalFetch(
          governance.nodeControlBaseUrl + '/api/v1/a2a-agent-card-revisions/2147483647',
          {
            headers: {
              authorization: 'Bearer ' + token,
              accept: NODE_CONTROL_CARD_CONTENT_MEDIA_TYPE,
            },
            redirect: 'manual',
          },
        )
      ).status,
      404,
    );
    evidence.push({
      case: 'complete-agent-card-artifact',
      ref,
      sha256: resolved.artifactRef.sha256,
    });
  } finally {
    await controlEvidencePool.end();
  }
  succeeded = true;
} catch (error) {
  evidence.push({
    failure: error instanceof Error ? error.stack : String(error),
    code: error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined,
  });
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
  if (control && pool) {
    const closing = control;
    control = undefined;
    await closing.close();
    const diagnostic = new Pool({ connectionString: controlUrl, max: 2 });
    try {
      const source = new PostgresNodeControlEvidenceSource(diagnostic, pool, {
        principalType: 'service',
        actorId: 'service:node-control-evidence-projector:zmq-isolated-node',
        role: 'node_control_evidence_projector',
        permission: 'node_control.evidence.read',
        authorityScope: 'global_authority',
        organizationScope: 'node_local',
        nodeId: 'zmq-isolated-node',
        allowedDataClassifications: ['public', 'internal', 'restricted'],
      });
      for (const partition of await source.pendingPartitions(200)) {
        if (partition.recordType !== 'node_control.smpp_source_revision') continue;
        try {
          const snapshot = await source.load(partition);
          evidence.push({ sourceDiagnostic: partition, references: snapshot?.references });
        } catch (failure) {
          evidence.push({
            sourceDiagnostic: partition,
            error: failure instanceof Error ? failure.stack : String(failure),
          });
        }
      }
      evidence.push({
        sourceLedger: (
          await diagnostic.query(
            "SELECT observation_sequence,record_type,source_record_id,occurred_at,authority_payload->>'revision' revision,authority_payload->>'status' status,authority_payload->>'updated_at' updated_at,authority_payload->>'aggregate_id' aggregate_id,authority_payload->>'created_at' created_at,authority_payload->>'result_revision' result_revision FROM sdar_control.node_control_evidence_observation WHERE record_type='node_control.smpp_source_revision' OR (record_type='node_control.audit_event' AND authority_payload->>'aggregate_type'='smpp_source') ORDER BY observation_sequence",
          )
        ).rows,
      });
    } catch (failure) {
      evidence.push({ diagnosticFailure: String(failure) });
    } finally {
      await diagnostic.end();
    }
  }
} finally {
  if (pool) {
    const snapshot: Record<string, unknown> = {};
    for (const [name, sql] of Object.entries({
      tasks:
        'SELECT task_id,phase,error_code,phase_message,selected_skill_id,output_structured FROM agent_task',
      bindings:
        'SELECT task_id,requested_capability_id,capability_version,input_snapshot,constraint_snapshot FROM task_capability_binding',
      invocations:
        'SELECT invocation_id,task_id,tool_name,status,arguments_json,result_json FROM mcp_invocation',
      remote:
        'SELECT remote_task_id,agent_task_id,protocol_status,local_state,last_safe_error_code FROM remote_task_binding',
      workflow: 'SELECT instance_id,status,result_json,errors_json FROM workflow_instance',
      controls: 'SELECT * FROM workflow_control',
      rounds: 'SELECT * FROM workflow_control_round',
      events: 'SELECT task_id,event_type,summary FROM runtime_event ORDER BY event_timestamp',
      modelInvocations: 'SELECT stage,status,error_code FROM model_invocation',
      evidenceIssues:
        'SELECT issue_code,source_table,source_record_id,detail FROM evidence_projection_issue WHERE resolved_at IS NULL',
    })) {
      try {
        snapshot[name] = (await pool.query(sql)).rows;
      } catch (error) {
        snapshot[name] = {
          diagnosticError: error instanceof Error ? error.message : String(error),
        };
      }
    }
    evidence.push({ retainedRuntimeSnapshot: snapshot });
  }
  globalThis.fetch = originalFetch;
  PostgresNodeControlEvidenceSource.prototype.load = originalControlLoad;
  NodeControlFrozenMcpCatalogClient.prototype.discover = originalDiscovery;
  McpCapabilityEvidenceProjector.prototype.projectTask = originalMcpProjection;
  if (oldAck === undefined) delete process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'];
  else process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'] = oldAck;
  if (oldSimulation === undefined) delete process.env['UGV_SIMULATION_RUN_ID'];
  else process.env['UGV_SIMULATION_RUN_ID'] = oldSimulation;
  if (oldLive === undefined) delete process.env['ALLOW_UGV_LIVE_SIDE_EFFECTS'];
  else process.env['ALLOW_UGV_LIVE_SIDE_EFFECTS'] = oldLive;
  const cleanup = async (name: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      cleanupErrors.push(name + ':' + String(error));
      process.exitCode = 1;
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
  await cleanup('fixture', async () =>
    fixture?.connected ? fixtureCommand('stop') : fixture?.kill('SIGTERM'),
  );
  await cleanup('runtimeDatabase', () =>
    dropIsolatedRuntimeDatabase(config.databaseUrl, databaseName),
  );
  await cleanup('controlDatabase', () =>
    dropIsolatedRuntimeDatabase(config.databaseUrl, controlDatabaseName),
  );
  await cleanup('temporaryDirectory', () => rm(temp, { recursive: true, force: true }));
  await writeFile(
    join(reportRoot, 'joint-evidence.json'),
    JSON.stringify(
      {
        schemaVersion: 'sdar.zmq-governance-joint/1',
        runId,
        status: succeeded && cleanupErrors.length === 0 ? 'passed' : 'failed',
        modelRequests,
        evidence,
        mcpCalls,
        cleanupErrors,
        fixtureDiagnostics: fixtureErrors,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  process.stdout.write(
    JSON.stringify({ runId, passed: succeeded && cleanupErrors.length === 0, reportRoot }) + '\n',
  );
}
