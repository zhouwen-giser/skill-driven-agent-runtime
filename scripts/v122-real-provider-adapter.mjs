import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { resolve } from 'node:path';
import { clearInterval, setInterval } from 'node:timers';
import { pathToFileURL } from 'node:url';

const candidateDirectory = requiredEnvironment('PROVIDER_CANDIDATE_DIR');
const statePath = requiredEnvironment('ADAPTER_STATE_PATH');
const releasePath = requiredEnvironment('BUSINESS_EVENT_RELEASE_PATH');
const rotatePath = requiredEnvironment('BUSINESS_EVENT_ROTATE_PATH');
const providerId = process.env.PROVIDER_ID ?? 'sdar-interop-provider';
const host = process.env.ADAPTER_HOST ?? '127.0.0.1';
const port = Number(process.env.ADAPTER_PORT ?? '57001');
const expectedTasks = Number(process.env.INTEROP_EXPECTED_TASKS ?? '260');

const { bindMockAdapter, createMockAdapterServer } = await import(
  pathToFileURL(resolve(candidateDirectory, 'dist/examples/mock-adapter-typescript/src/server.js'))
    .href
);

const durableSource = {
  sourceId: 'interop.durable',
  sourceStreamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1001',
  deliverySemantics: 'durable_at_least_once',
  replaySupported: true,
  sourceRetentionMs: '604800000',
  maxEventBytes: '65536',
  maxPayloadDepth: 16,
  maxPayloadNodes: 4096,
  maxPayloadStringBytes: '16384',
};
const liveSource = {
  sourceId: 'interop.live',
  sourceStreamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1002',
  deliverySemantics: 'best_effort_live',
  replaySupported: false,
  sourceRetentionMs: '0',
  maxEventBytes: '65536',
  maxPayloadDepth: 16,
  maxPayloadNodes: 4096,
  maxPayloadStringBytes: '16384',
};
const events = {
  [durableSource.sourceId]: [],
  [liveSource.sourceId]: [],
};
const server = createMockAdapterServer({
  providerId,
  statePath,
  businessEventSources: [durableSource, liveSource],
  businessEvents: events,
});
const boundPort = await bindMockAdapter(server, `${host}:${String(port)}`);
process.stdout.write(`${JSON.stringify({ event: 'adapter.ready', host, port: boundPort })}\n`);

let released = false;
let rotated = false;
const interval = setInterval(() => {
  if (!released && existsSync(releasePath)) released = releaseEvents();
  if (!rotated && existsSync(rotatePath)) {
    durableSource.sourceStreamId = '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a2001';
    rotated = true;
    process.stdout.write(`${JSON.stringify({ event: 'adapter.source_reset' })}\n`);
  }
}, 50);

function releaseEvents() {
  const document = JSON.parse(readFileSync(statePath, 'utf8'));
  const records = Object.entries(document.records ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (records.length < expectedTasks) return false;
  const [taskId, execution] = records[0];
  const now = new Date();
  const occurredAt = {
    seconds: String(Math.floor(now.getTime() / 1000)),
    nanos: now.getUTCMilliseconds() * 1_000_000,
  };
  events[durableSource.sourceId].push(
    {
      sourceEventId: 'interop-task-event-1',
      sourceSequence: '1',
      sourceStreamId: durableSource.sourceStreamId,
      scope: 'task',
      occurredAt,
      eventType: 'interop.task.observed',
      description: 'Real Provider task-scoped interoperability event.',
      externalExecutionId: execution.externalExecutionId ?? `task-${taskId}`,
      severityHint: 'info',
      reasonCode: 'INTEROP_TASK_EVENT',
      rawPayload: { matrixCase: 'task_event' },
    },
    {
      sourceEventId: 'interop-resource-event-1',
      sourceSequence: '2',
      sourceStreamId: durableSource.sourceStreamId,
      scope: 'resource',
      occurredAt,
      eventType: 'interop.resource.changed',
      description: 'Real Provider resource-scoped interoperability event.',
      resourceRef: 'vehicle:42',
      severityHint: 'warning',
      reasonCode: 'INTEROP_RESOURCE_EVENT',
      rawPayload: { matrixCase: 'resource_event_relation' },
    },
  );
  events[liveSource.sourceId].push({
    sourceEventId: 'interop-live-event-1',
    sourceSequence: '1',
    sourceStreamId: liveSource.sourceStreamId,
    scope: 'resource',
    occurredAt,
    eventType: 'interop.live.observed',
    description: 'Real Provider best-effort interoperability event.',
    resourceRef: 'vehicle:42',
    severityHint: 'info',
    reasonCode: 'INTEROP_LIVE_EVENT',
    rawPayload: { matrixCase: 'mixed_continuity' },
  });
  process.stdout.write(
    `${JSON.stringify({ event: 'adapter.events_released', taskCount: records.length })}\n`,
  );
  return true;
}

async function close() {
  clearInterval(interval);
  await new Promise((resolveClose) => server.tryShutdown(resolveClose));
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name}_REQUIRED`);
  return value;
}
