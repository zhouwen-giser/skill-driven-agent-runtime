import { randomBytes, randomUUID } from 'node:crypto';

import { SendMessageRequest, Task, TaskState } from '@a2a-js/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServerRuntime, type ServerRuntimeHandle } from '../../../apps/server/src/runtime.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../../../apps/server/test-support/postgres.js';
import type { ArtifactRetrievalResult } from '../../application/src/index.js';
import type { RuntimeRequestContext } from '../../domain/src/index.js';

const postgresAdminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseName = 'sdar_v13_p10_gateway_e2e';
const postgresUrl = isolatedDatabaseUrl(postgresAdminUrl, databaseName);
const redis = { host: '127.0.0.1', port: 56379 };
let runtime: ServerRuntimeHandle;

beforeAll(async () => {
  await createIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
  const previousMode = process.env['SDAR_V13_ARTIFACT_MODE'];
  const previousGateway = process.env['SDAR_V13_FAST_GATEWAY_ENABLED'];
  const previousRetrieval = process.env['SDAR_V13_RETRIEVAL_ENABLED'];
  process.env['SDAR_V13_ARTIFACT_MODE'] = 'active';
  process.env['SDAR_V13_FAST_GATEWAY_ENABLED'] = 'true';
  process.env['SDAR_V13_RETRIEVAL_ENABLED'] = 'true';
  try {
    runtime = await startServerRuntime({
      postgresUrl,
      redis,
      masterKeyBase64: randomBytes(32).toString('base64'),
      queueName: `p10-e2e-${randomUUID()}`,
      applyMigrations: true,
      a2aWaitTimeoutMs: 10_000,
      fastGateway: {
        contexts: {
          create({ task, requestText }): Promise<RuntimeRequestContext> {
            return Promise.resolve({
              requestId: `gateway-request:${task.taskId}`,
              taskId: task.taskId,
              contextId: task.contextId,
              rawText: requestText,
              normalizedText: requestText.trim(),
              actor: {
                actorId: task.userId,
                tenantId: 'trusted-intranet',
                authenticationRef: `a2a-task:${task.taskId}`,
                authorizationRefs: ['trusted-intranet:task-submit'],
              },
              extractedFeatures: { source: 'a2a' },
              worldStateRef: `world-state:${task.taskId}`,
              capabilitySummaryRef: 'capability-summary:e2e',
              policySnapshotRef: 'policy-snapshot:deny-e2e',
              deadlineAt: new Date(Date.now() + 30_000).toISOString(),
              cancellationRef: `task-cancellation:${task.taskId}`,
              idempotencyKey: `gateway-idempotency:${task.taskId}`,
              createdAt: task.createdAt,
            });
          },
        },
        precheck: {
          authenticate: () => Promise.resolve(true),
          authorizeTenant: () => Promise.resolve(true),
          authorizeRequest: () => Promise.resolve(true),
          readRuntimeState: () =>
            Promise.resolve({
              featureEnabled: true,
              killSwitchActive: false,
              policyDecision: 'deny',
              runtimeSnapshotHash: `sha256:${'a'.repeat(64)}`,
            }),
        },
        retrieval: {
          retrieve: () => Promise.resolve(noMatch()),
        },
        rule: {
          evaluate: () => Promise.resolve({ disposition: 'fallback', resultRef: 'unused' }),
        },
        template: {
          instantiate: () => Promise.resolve({ disposition: 'fallback', resultRef: 'unused' }),
        },
        fallback: {
          start: (input) => Promise.resolve({ fallbackRef: `cognitive:${input.taskId}` }),
        },
        cancellation: { isCancelled: () => Promise.resolve(false) },
        drift: { signal: () => Promise.resolve() },
      },
    });
  } finally {
    restoreEnvironment('SDAR_V13_ARTIFACT_MODE', previousMode);
    restoreEnvironment('SDAR_V13_FAST_GATEWAY_ENABLED', previousGateway);
    restoreEnvironment('SDAR_V13_RETRIEVAL_ENABLED', previousRetrieval);
  }
});

afterAll(async () => {
  await runtime.close();
  await dropIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
});

describe('P10 real A2A -> Task -> Gateway -> PostgreSQL path', () => {
  it('projects policy denial as the existing formal failed Task and never falls back', async () => {
    const result = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Perform a policy-denied operation.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in result)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    expect(result.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    const document = Task.toJSON(result) as { readonly metadata?: unknown };
    expect(document.metadata).toMatchObject({
      internalPhase: 'failed',
      errorCode: 'GATEWAY_DENIED',
    });

    await expect(runtime.gatewayEvidence(result.id)).resolves.toMatchObject({
      decision: { path: 'denied' },
      record: {
        reasonCodes: expect.arrayContaining(['GATEWAY_POLICY_DENY', 'GATEWAY_DENIED']),
      },
      outboxRecorded: true,
    });
  });
});

function noMatch(): ArtifactRetrievalResult {
  return {
    index: [],
    matches: [],
    decision: {
      decisionId: 'unused',
      requestId: 'unused',
      path: 'cognitive_runtime',
      parameterBindings: {},
      missingParameters: [],
      requiredConfirmations: [],
      reasonCodes: [],
      matcherSnapshotHash: `sha256:${'b'.repeat(64)}`,
      policySnapshotHash: `sha256:${'c'.repeat(64)}`,
      createdAt: '2026-07-30T00:00:00.000Z',
    },
  };
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}
