import { describe, expect, it } from 'vitest';

import { frozenTaskReadinessAttributes } from '../../domain/src/index.js';
import {
  FROZEN_TASK_AVAILABILITY_METHOD,
  FrozenTaskAvailabilityClient,
  FrozenV1McpClient,
  parseFrozenTaskExecutionProfile,
} from '../src/index.js';

const endpoint = 'https://provider.example.test/mcp';
const check = {
  requestId: 'node-1',
  operationName: 'embodied.move',
  arguments: {
    state: 'partial' as const,
    knownValue: { resourceId: 'UGV-1' },
    unresolvedPaths: [''],
  },
  timing: {
    start: { mode: 'immediate' as const, startToleranceMs: 1000 },
    maxElapsedMs: 60_000,
  },
};

describe('Frozen V1 Availability', () => {
  it('uses the frozen method and exact profile/check/requestId/knownValue fields', async () => {
    let request: Record<string, unknown> | undefined;
    const client = createClient((body) => {
      request = body;
      return response();
    });
    await expect(client.check([check])).resolves.toMatchObject([
      { requestId: 'node-1', availability: 'available' },
    ]);
    expect(request?.['method']).toBe(FROZEN_TASK_AVAILABILITY_METHOD);
    expect(request?.['params']).toMatchObject({ profileVersion: '1.0', checks: [check] });
    const encoded = JSON.stringify(request);
    for (const legacy of [
      'io.sdar/tasks/checkAvailability',
      '"requests"',
      '"nodeId"',
      '"unresolved"',
      'knownArguments',
    ])
      expect(encoded).not.toContain(legacy);
  });

  it('parses the frozen Tool profile and derives only frozen readiness attributes', () => {
    const profile = parseFrozenTaskExecutionProfile({
      'io.sdar/taskExecution': {
        profileVersion: '1.0',
        taskBehavior: 'task_required',
        availability: 'dynamic',
        supportsScheduling: true,
        supportsMaxElapsed: true,
        supportsCancellation: true,
        supportsPauseResume: true,
        supportsObservations: true,
        supportsInputRequired: true,
        idempotency: 'client_request_key',
      },
    });
    const attributes = frozenTaskReadinessAttributes(profile, true);
    expect(attributes).toEqual([
      'task_behavior:task_required',
      'availability:dynamic',
      'scheduling',
      'max_elapsed',
      'cancellation',
      'pause_resume',
      'observations',
      'input_required',
      'idempotency:client_request_key',
      'task_notifications',
    ]);
    expect(JSON.stringify(attributes)).not.toMatch(/cancellation:|execution:/u);
  });

  it('rejects Legacy profile vocabulary and extra fields', () => {
    for (const profile of [
      { revision: '1.0', execution: 'task_required' },
      {
        profileVersion: '1.0',
        taskBehavior: 'task_required',
        availability: 'dynamic',
        supportsScheduling: true,
        supportsMaxElapsed: true,
        supportsObservations: true,
        supportsInputRequired: true,
        idempotency: 'server_managed',
        cancellation: 'task_cancel',
      },
    ])
      expect(() => parseFrozenTaskExecutionProfile({ 'io.sdar/taskExecution': profile })).toThrow(
        'violates profile 1.0',
      );
  });

  it('validates restricted windows and guaranteed reservation semantics', async () => {
    const invalidResponses = [
      response({ availability: 'restricted', validUntil: undefined }),
      response({ reservationMode: 'guaranteed' }),
      response({
        availability: 'restricted',
        validUntil: '2026-07-18T04:00:00.000Z',
        nextAvailableWindows: [
          { startTime: '2026-07-18T03:30:00.000Z', endTime: '2026-07-18T03:50:00.000Z' },
          { startTime: '2026-07-18T03:40:00.000Z', endTime: '2026-07-18T04:00:00.000Z' },
        ],
      }),
    ];
    for (const invalid of invalidResponses)
      await expect(createClient(() => invalid).check([check])).rejects.toMatchObject({
        code: 'FROZEN_AVAILABILITY_RESPONSE_INVALID',
      });
  });

  it('rejects missing resultType and Legacy response correlation fields', async () => {
    for (const invalid of [
      { profileVersion: '1.0', results: response().results },
      {
        resultType: 'complete',
        profileVersion: '1.0',
        results: [{ ...response().results[0], requestId: undefined, nodeId: 'node-1' }],
      },
    ])
      await expect(createClient(() => invalid).check([check])).rejects.toMatchObject({
        code: 'FROZEN_AVAILABILITY_RESPONSE_INVALID',
      });
  });

  it('rejects duplicate checks before transport', async () => {
    let calls = 0;
    const client = createClient(() => {
      calls += 1;
      return response();
    });
    await expect(client.check([check, check])).rejects.toMatchObject({
      code: 'FROZEN_AVAILABILITY_REQUEST_INVALID',
    });
    expect(calls).toBe(0);
  });
});

function createClient(
  responder: (body: Record<string, unknown>) => unknown,
): FrozenTaskAvailabilityClient {
  const client = new FrozenV1McpClient((_url, init) => {
    const body = parseRequestBody(init);
    return Promise.resolve(
      Response.json({ jsonrpc: '2.0', id: body['id'], result: responder(body) }),
    );
  });
  return new FrozenTaskAvailabilityClient({ client, endpoint, headers: {} });
}

function response(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    resultType: 'complete' as const,
    profileVersion: '1.0' as const,
    results: [
      {
        requestId: 'node-1',
        operationName: 'embodied.move',
        availability: 'available',
        riskLevel: 'low',
        reservationMode: 'none',
        ...overrides,
      },
    ],
  };
}

function parseRequestBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new TypeError('Expected JSON request body');
  return JSON.parse(init.body) as Record<string, unknown>;
}
