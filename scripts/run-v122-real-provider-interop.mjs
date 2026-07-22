/* global AbortController, fetch */

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

import {
  BusinessEventsProtocolError,
  FrozenBusinessEventsClient,
  FrozenV1McpClient,
} from '../packages/mcp-adapter/src/index.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidateDirectory = resolve(requiredEnvironment('PROVIDER_CANDIDATE_DIR'));
const providerDatabaseUrl = requiredDisposableDatabase(
  'PROVIDER_DATABASE_URL',
  requiredEnvironment('PROVIDER_DATABASE_URL'),
);
const sdarDatabaseUrl = requiredDisposableDatabase(
  'SDAR_DATABASE_URL',
  requiredEnvironment('SDAR_DATABASE_URL'),
);
const workingDirectory = resolve(requiredEnvironment('INTEROP_WORK_DIR'));
const reportDirectory = resolve(
  process.env.INTEROP_REPORT_DIR ?? resolve(repositoryRoot, 'reports/v1.2.2-interop'),
);
const expectedTasks = 260;
const providerId = 'sdar-interop-provider';
const processes = [];
const processLogs = new Map();
const startedAt = new Date().toISOString();

await mkdir(workingDirectory, { recursive: true });
await mkdir(reportDirectory, { recursive: true });
const adapterStatePath = resolve(workingDirectory, 'adapter-state.json');
const releasePath = resolve(workingDirectory, 'release-events');
const rotatePath = resolve(workingDirectory, 'rotate-source');
const adapterPort = await availablePort();
const providerPort = await availablePort();
const sdarA2aPort = await availablePort();
const sdarManagementPort = await availablePort();
const providerEndpoint = `http://127.0.0.1:${String(providerPort)}/mcp`;
const managementEndpoint = `http://127.0.0.1:${String(sdarManagementPort)}`;
const matrix = {};

try {
  const adapter = start(
    'adapter',
    process.execPath,
    [resolve(repositoryRoot, 'scripts/v122-real-provider-adapter.mjs')],
    {
      cwd: candidateDirectory,
      env: {
        PROVIDER_CANDIDATE_DIR: candidateDirectory,
        PROVIDER_ID: providerId,
        ADAPTER_HOST: '127.0.0.1',
        ADAPTER_PORT: String(adapterPort),
        ADAPTER_STATE_PATH: adapterStatePath,
        BUSINESS_EVENT_RELEASE_PATH: releasePath,
        BUSINESS_EVENT_ROTATE_PATH: rotatePath,
        INTEROP_EXPECTED_TASKS: String(expectedTasks),
      },
    },
  );
  await waitForLog(adapter, 'adapter.ready');

  let provider = startProvider();
  await waitForHttp(`http://127.0.0.1:${String(providerPort)}/health/ready`);

  const sdar = start('sdar', 'pnpm', ['exec', 'tsx', 'apps/server/src/main.ts'], {
    cwd: repositoryRoot,
    env: {
      SDAR_POSTGRES_URL: sdarDatabaseUrl,
      SDAR_REDIS_HOST: '127.0.0.1',
      SDAR_REDIS_PORT: process.env.SDAR_REDIS_PORT ?? '56379',
      SDAR_A2A_HOST: '127.0.0.1',
      SDAR_A2A_PORT: String(sdarA2aPort),
      SDAR_MANAGEMENT_HOST: '127.0.0.1',
      SDAR_MANAGEMENT_PORT: String(sdarManagementPort),
      SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 23).toString('base64'),
      BUSINESS_EVENTS_ENABLED: 'true',
      BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: 'false',
      BUSINESS_EVENTS_POLL_INTERVAL_MS: '100',
    },
  });
  await waitForLog(sdar, 'server.ready');
  await waitForHttp(`${managementEndpoint}/api/v1/health`);

  const taskClient = new FrozenV1McpClient();
  const eventClient = new FrozenBusinessEventsClient();
  const endpoint = { endpoint: providerEndpoint, headers: {} };
  const taskDiscovery = await taskClient.discover(endpoint);
  const eventDiscovery = await eventClient.discover(endpoint);
  assert(eventDiscovery.continuityClass === 'mixed', 'Expected mixed continuity discovery.');
  assert(eventDiscovery.sources.length === 2, 'Expected two frozen Business Event sources.');
  matrix.discovery = pass({
    taskProtocolVersion: taskDiscovery.supportedVersions[0],
    businessEventsProfileVersion: eventDiscovery.profileVersion,
    continuityClass: eventDiscovery.continuityClass,
  });

  const emptyController = new AbortController();
  const empty = await eventClient.listen({
    ...endpoint,
    startPosition: 'latest',
    signal: emptyController.signal,
  });
  emptyController.abort();
  matrix.emptyStream = pass({
    streamId: empty.ack.streamId,
    currentSequence: empty.ack.currentSequence,
  });

  const registration = await requestJson(`${managementEndpoint}/api/v1/mcp/servers`, {
    method: 'POST',
    body: {
      serverId: providerId,
      name: 'SDAR v1.2.2 real interop Provider',
      endpoint: providerEndpoint,
      credentialHeaders: {},
    },
  });
  assert(registration.server?.serverId === providerId, 'SDAR Provider registration failed.');

  const taskIds = await createTasks(taskClient, endpoint, expectedTasks);
  matrix.task = pass({ created: taskIds.length, firstTaskId: taskIds[0] });
  await writeFile(releasePath, 'release\n', 'utf8');

  const current = await waitForCurrentEvents(eventClient, endpoint, 3);
  const taskEvent = current.messages.find((message) => message.params.scope === 'task');
  const resourceEvent = current.messages.find(
    (message) =>
      message.params.scope === 'resource' &&
      message.params.eventType === 'interop.resource.changed',
  );
  assert(taskEvent !== undefined, 'Real Provider did not publish the Task Event.');
  assert(resourceEvent !== undefined, 'Real Provider did not publish the Resource Event.');
  matrix.event = pass({
    streamId: current.ack.streamId,
    currentSequence: current.ack.currentSequence,
    taskEventId: taskEvent.params.eventId,
    resourceEventId: resourceEvent.params.eventId,
    scopes: [...new Set(current.messages.map((message) => message.params.scope))].sort(),
  });

  const firstRelation = await eventClient.relatedTasks({
    ...endpoint,
    streamId: resourceEvent.params.streamId,
    eventId: resourceEvent.params.eventId,
    limit: 128,
  });
  assert(firstRelation.total === expectedTasks, 'Provider relation total does not match Tasks.');
  assert(firstRelation.nextAfterTaskId !== undefined, 'Provider relation was not paginated.');
  const secondRelation = await eventClient.relatedTasks({
    ...endpoint,
    streamId: firstRelation.streamId,
    eventId: firstRelation.eventId,
    limit: 128,
    projectionToken: firstRelation.projectionToken,
    afterTaskId: firstRelation.nextAfterTaskId,
  });
  assert(secondRelation.items.length === 128, 'Provider second relation page is incomplete.');
  assert(secondRelation.nextAfterTaskId !== undefined, 'Provider relation requires a third page.');
  const thirdRelation = await eventClient.relatedTasks({
    ...endpoint,
    streamId: firstRelation.streamId,
    eventId: firstRelation.eventId,
    limit: 128,
    projectionToken: firstRelation.projectionToken,
    afterTaskId: secondRelation.nextAfterTaskId,
  });
  assert(thirdRelation.items.length === 4, 'Provider final relation page is incomplete.');
  matrix.relation = pass({
    total: firstRelation.total,
    pageSizes: [
      firstRelation.items.length,
      secondRelation.items.length,
      thirdRelation.items.length,
    ],
  });

  const taskProjection = await taskClient.request({
    ...endpoint,
    method: 'tasks/get',
    params: { taskId: taskIds[0] },
  });
  assert(taskProjection.taskId === taskIds[0], 'Provider Task projection identity mismatch.');

  await waitFor(
    async () => {
      const inbox = await requestJson(
        `${managementEndpoint}/api/v1/business-events/inbox?limit=100`,
      );
      return inbox.items?.length >= 3 ? inbox : undefined;
    },
    20_000,
    'SDAR durable inbox admission',
  );
  matrix.sdarRuntimeAdmission = pass({ admittedAtLeast: 3 });

  const liveController = new AbortController();
  const lastObservedSequence = current.messages
    .map((message) => message.params.sequence)
    .filter((value) => value !== undefined)
    .reduce((highest, value) => (BigInt(value) > BigInt(highest) ? value : highest), '0');
  const live = await eventClient.listen({
    ...endpoint,
    cursor: { streamId: current.ack.streamId, afterSequence: lastObservedSequence },
    signal: liveController.signal,
  });
  const liveIterator = live.messages[Symbol.asyncIterator]();
  await writeFile(rotatePath, 'rotate\n', 'utf8');
  const continuityMessage = await withTimeout(liveIterator.next(), 20_000, 'live continuity');
  liveController.abort();
  assert(
    !continuityMessage.done &&
      continuityMessage.value.method === 'notifications/io.sdar/businessEvents/continuity',
    'Current stream did not terminate with Continuity.',
  );
  const newStreamId = continuityMessage.value.params.newStreamId;

  const drained = await eventClient.listen({
    ...endpoint,
    cursor: { streamId: current.ack.streamId, afterSequence: '0' },
  });
  const drainedMessages = [];
  for await (const message of drained.messages) drainedMessages.push(message);
  assert(drained.ack.generationStatus === 'replayable_closed', 'Old generation is not drainable.');
  assert(
    drainedMessages.at(-1)?.method === 'notifications/io.sdar/businessEvents/continuity',
    'Drained generation did not end with Continuity.',
  );
  matrix.drain = pass({
    previousStreamId: current.ack.streamId,
    newStreamId,
    replayedMessages: drainedMessages.length,
  });

  let resetCode;
  try {
    await eventClient.listen({
      ...endpoint,
      cursor: { streamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2affff', afterSequence: '0' },
    });
  } catch (error) {
    if (error instanceof BusinessEventsProtocolError) resetCode = error.code;
  }
  assert(resetCode === 'BUSINESS_EVENT_STREAM_RESET', 'Unknown generation did not fail closed.');
  matrix.reset = pass({ code: resetCode });

  await waitFor(
    async () => {
      const subscriptions = await requestJson(
        `${managementEndpoint}/api/v1/business-events/subscriptions?limit=20`,
      );
      const items = subscriptions.items ?? [];
      return items.some((item) => item.streamId === newStreamId && item.status === 'current')
        ? subscriptions
        : undefined;
    },
    20_000,
    'SDAR continuity rollover',
  );
  matrix.sdarContinuity = pass({ currentStreamId: newStreamId });

  await stop(provider);
  let unavailableCode;
  try {
    await eventClient.discover(endpoint);
  } catch (error) {
    if (error instanceof BusinessEventsProtocolError) unavailableCode = error.code;
  }
  assert(
    unavailableCode === 'BUSINESS_EVENTS_TRANSPORT_FAILED',
    'Provider outage did not fail closed.',
  );
  matrix.providerUnavailable = pass({ code: unavailableCode });

  provider = startProvider();
  await waitForHttp(`http://127.0.0.1:${String(providerPort)}/health/ready`, 30_000);
  const restartedDiscovery = await eventClient.discover(endpoint);
  assert(restartedDiscovery.profileVersion === '1.0', 'Provider restart lost discovery.');
  matrix.restart = pass({ profileVersion: restartedDiscovery.profileVersion });

  const health = await waitFor(
    async () => {
      const response = await requestJson(
        `${managementEndpoint}/api/v1/business-events/providers/${providerId}/health`,
      );
      return response.health?.state === 'healthy' ? response : undefined;
    },
    20_000,
    'SDAR Provider reconnect',
  );
  matrix.reconnect = pass({ reconnects: health.health.reconnects });

  const evidence = {
    schemaVersion: 1,
    status: 'pass',
    claimLevel: 'Real SDAR Interop',
    providerCommit: '8a81b1b02971fb124ed96372c440c449f9087c99',
    providerRequirementsCommit: 'ee14d2fa2b5130d3c7c016c71737175a124d5134',
    sdarCommit: await gitHead(),
    startedAt,
    completedAt: new Date().toISOString(),
    transport: 'real_streamable_http_post_sse',
    persistence: {
      provider: basename(new URL(providerDatabaseUrl).pathname),
      sdar: basename(new URL(sdarDatabaseUrl).pathname),
    },
    matrix,
  };
  await writeFile(
    resolve(reportDirectory, 'real-provider-interop.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  const failure = {
    schemaVersion: 1,
    status: 'fail',
    providerCommit: '8a81b1b02971fb124ed96372c440c449f9087c99',
    sdarCommit: await gitHead().catch(() => 'unknown'),
    startedAt,
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    matrix,
    processLogs: Object.fromEntries(processLogs),
  };
  await writeFile(
    resolve(reportDirectory, 'real-provider-interop-failure.json'),
    `${JSON.stringify(failure, null, 2)}\n`,
    'utf8',
  );
  throw error;
} finally {
  await Promise.allSettled([...processes].reverse().map((entry) => stop(entry)));
}

function startProvider() {
  return start('provider', process.execPath, ['dist/apps/runtime/src/main.js'], {
    cwd: candidateDirectory,
    env: {
      RUNTIME_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(providerPort),
      PROVIDER_ID: providerId,
      DATABASE_URL: providerDatabaseUrl,
      ADAPTER_ENDPOINT: `127.0.0.1:${String(adapterPort)}`,
      AUTH_MODE: 'development',
      BUSINESS_EVENTS_ENABLED: 'true',
      BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: 'true',
      BUSINESS_EVENTS_POLL_INTERVAL_MS: '100',
      BUSINESS_EVENTS_MAX_STREAM_DURATION_MS: '60000',
      RATE_LIMIT_MAX: '100000',
      RATE_LIMIT_MAX_KEYS: '100000',
      LOG_LEVEL: 'warn',
    },
  });
}

function start(name, command, arguments_, options) {
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entry = { name, child, output: '' };
  processes.push(entry);
  processLogs.set(name, '');
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      entry.output = `${entry.output}${chunk}`.slice(-64_000);
      processLogs.set(name, entry.output);
    });
  }
  return entry;
}

async function stop(entry) {
  if (entry.child.exitCode !== null || entry.child.signalCode !== null) return;
  entry.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => entry.child.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGKILL');
}

async function createTasks(client, endpoint, count) {
  const taskIds = [];
  for (let offset = 0; offset < count; offset += 20) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(20, count - offset) }, async (_, index) => {
        const ordinal = offset + index;
        const result = await client.request({
          ...endpoint,
          method: 'tools/call',
          params: {
            name: 'durable_task',
            arguments: { resourceId: 'vehicle:42', scenario: 'hold_running' },
            _meta: {
              'io.sdar/taskExecution': {
                profileVersion: '1.0',
                idempotencyKey: `sdar-v122-interop-${String(ordinal).padStart(3, '0')}`,
              },
            },
          },
        });
        assert(typeof result.taskId === 'string', 'Provider did not create a frozen Task.');
        return result.taskId;
      }),
    );
    taskIds.push(...batch);
  }
  return taskIds.sort();
}

async function waitForCurrentEvents(client, endpoint, expected) {
  return waitFor(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      try {
        const stream = await client.listen({
          ...endpoint,
          startPosition: 'earliest_available',
          signal: controller.signal,
        });
        const messages = [];
        try {
          for await (const message of stream.messages) {
            if (message.method === 'notifications/io.sdar/businessEvents') messages.push(message);
            if (messages.length >= expected) break;
          }
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        }
        if (messages.length >= expected) return { ack: stream.ack, messages };
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
      return undefined;
    },
    25_000,
    'Provider Business Events',
  );
}

async function requestJson(url, input = {}) {
  const response = await fetch(url, {
    method: input.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} ${JSON.stringify(body)}`);
  return body;
}

async function waitForHttp(url, timeoutMs = 20_000) {
  return waitFor(
    async () => {
      try {
        const response = await fetch(url);
        return response.ok ? true : undefined;
      } catch {
        return undefined;
      }
    },
    timeoutMs,
    url,
  );
}

async function waitForLog(entry, marker) {
  return waitFor(
    async () => {
      if (entry.output.includes(marker)) return true;
      if (entry.child.exitCode !== null)
        throw new Error(
          `${entry.name} exited with ${String(entry.child.exitCode)}: ${entry.output}`,
        );
      return undefined;
    },
    20_000,
    `${entry.name}:${marker}`,
  );
}

async function waitFor(operation, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result !== undefined && result !== false) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(
    `${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  );
}

async function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs),
    ),
  ]);
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : undefined;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  if (port === undefined) throw new Error('INTEROP_PORT_ALLOCATION_FAILED');
  return port;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name}_REQUIRED`);
  return value;
}

function requiredDisposableDatabase(name, connectionString) {
  const databaseName = basename(new URL(connectionString).pathname);
  if (!/^(sdar_provider_interop_|sdar_v122_interop_)[a-z0-9_]+$/u.test(databaseName))
    throw new Error(`${name}_DISPOSABLE_DATABASE_REQUIRED`);
  return connectionString;
}

function pass(details) {
  return { status: 'pass', ...details };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gitHead() {
  const head = await readFile(resolve(repositoryRoot, '.git/HEAD'), 'utf8');
  if (!head.startsWith('ref: ')) return head.trim();
  return (await readFile(resolve(repositoryRoot, '.git', head.slice(5).trim()), 'utf8')).trim();
}
