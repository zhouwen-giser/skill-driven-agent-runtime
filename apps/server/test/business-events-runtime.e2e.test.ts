import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startFrozenBusinessEventsMockProvider,
  type FrozenBusinessEventsMockHandle,
} from '../../../packages/mcp-adapter/src/index.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../test-support/postgres.js';
import { startServerRuntime, type ServerRuntimeHandle } from '../src/runtime.js';

const postgresAdminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseName = 'sdar_v122_business_events_e2e';
const postgresUrl = isolatedDatabaseUrl(postgresAdminUrl, databaseName);
let runtime: ServerRuntimeHandle;
let provider: FrozenBusinessEventsMockHandle;

beforeAll(async () => {
  await createIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
  provider = await startFrozenBusinessEventsMockProvider({ scenario: 'task_event' });
  runtime = await startServerRuntime({
    postgresUrl,
    redis: {
      host: '127.0.0.1',
      port: Number(process.env['SDAR_REDIS_PORT'] ?? '56379'),
    },
    masterKeyBase64: randomBytes(32).toString('base64'),
    queueName: `business-events-e2e-${randomUUID()}`,
    applyMigrations: true,
    a2aPort: 0,
    managementPort: 0,
    frozenMcpTasks: {
      isolationAcknowledged: true,
      queueName: `business-events-remote-${randomUUID()}`,
      reconcileIntervalMs: 100,
    },
    businessEvents: {
      enabled: true,
      reconnectDelayMs: 1_000,
      processingIntervalMs: 25,
      maxSubscriptions: 4,
    },
  });
  const registration = await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      serverId: 'provider.business-events.e2e',
      name: 'Business Events E2E Provider',
      endpoint: provider.endpoint.href,
      credentialHeaders: {},
    }),
  });
  expect(registration.status).toBe(201);
});

afterAll(async () => {
  await runtime.close();
  await provider.close();
  await dropIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
});

describe('Business Events product runtime', () => {
  it('runs discovery → Ack → durable Inbox → impact processing through the real HTTP and PostgreSQL boundaries', async () => {
    await eventually(async () => {
      const response = await fetch(`${runtime.management.baseUrl}/api/v1/business-events/inbox`);
      const body = (await response.json()) as Readonly<{ items: readonly unknown[] }>;
      expect(body.items).toHaveLength(1);
    });
    await eventually(async () => {
      const value = await json(
        `${runtime.management.baseUrl}/api/v1/business-events/subscriptions`,
      );
      expect(value).toMatchObject({
        items: [{ lastDurablyAdmittedSequence: '1', lastProcessedSequence: '1' }],
      });
    });
    const subscriptions = await json(
      `${runtime.management.baseUrl}/api/v1/business-events/subscriptions`,
    );
    expect(subscriptions).toMatchObject({
      items: [
        {
          providerId: 'provider.business-events.e2e',
          status: 'current',
          lastDurablyAdmittedSequence: '1',
          lastProcessedSequence: '1',
        },
      ],
    });
    const assessments = await json(
      `${runtime.management.baseUrl}/api/v1/business-events/impact-assessments`,
    );
    expect(assessments).toMatchObject({
      items: [
        {
          classification: 'none',
          confidence: 'high',
          action: 'record_only',
        },
      ],
    });
    expect(runtime.businessEventsHealth('provider.business-events.e2e')).toMatchObject({
      state: 'healthy',
      admitted: 1,
    });
    expect(
      provider.requests.find((request) => request.method === 'io.sdar/businessEvents/listen')
        ?.headers,
    ).toMatchObject({
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'io.sdar/businessEvents/listen',
    });
  });
});

async function json(url: string): Promise<unknown> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}

async function eventually(assertion: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error: unknown) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}
