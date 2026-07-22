import { describe, expect, it } from 'vitest';

import {
  BusinessEventsProtocolError,
  FrozenBusinessEventsClient,
  startFrozenBusinessEventsMockProvider,
} from '../src/index.js';

describe('Frozen Business Events client', () => {
  it('discovers the exact Profile and admits a Task Event after the first Ack', async () => {
    const provider = await startFrozenBusinessEventsMockProvider({ scenario: 'task_event' });
    try {
      const client = new FrozenBusinessEventsClient();
      const discovery = await client.discover(endpoint(provider.endpoint));
      expect(discovery.profileVersion).toBe('1.0');
      expect(discovery.delivery).toBe('post_sse');
      const stream = await client.listen({
        ...endpoint(provider.endpoint),
        startPosition: 'latest',
      });
      expect(stream.ack.generationStatus).toBe('current');
      const messages = await collect(stream.messages);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.method).toBe('notifications/io.sdar/businessEvents');
      expect(provider.requests.map((request) => request.method)).toEqual([
        'server/discover',
        'io.sdar/businessEvents/listen',
      ]);
      expect(provider.requests[1]?.headers['mcp-name']).toBeUndefined();
    } finally {
      await provider.close();
    }
  });

  it('drains a replayable closed generation and validates its continuity control', async () => {
    const provider = await startFrozenBusinessEventsMockProvider({ scenario: 'continuity' });
    try {
      const stream = await new FrozenBusinessEventsClient().listen({
        ...endpoint(provider.endpoint),
        cursor: {
          streamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001',
          afterSequence: '0',
        },
      });
      expect(stream.ack.generationStatus).toBe('replayable_closed');
      const messages = await collect(stream.messages);
      expect(messages.map((message) => message.method)).toEqual([
        'notifications/io.sdar/businessEvents',
        'notifications/io.sdar/businessEvents/continuity',
      ]);
    } finally {
      await provider.close();
    }
  });

  it('resolves stable relation pages with the exact event routing header', async () => {
    const provider = await startFrozenBusinessEventsMockProvider({
      relationTaskIds: ['task-003', 'task-001', 'task-002'],
    });
    try {
      const client = new FrozenBusinessEventsClient();
      const first = await client.relatedTasks({
        ...endpoint(provider.endpoint),
        streamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001',
        eventId: 'nZ_hzhW-zrueWt69x9wP5gq-T_rLs_WgSgyTE7jER_o',
        limit: 2,
      });
      const second = await client.relatedTasks({
        ...endpoint(provider.endpoint),
        streamId: first.streamId,
        eventId: first.eventId,
        limit: 2,
        projectionToken: first.projectionToken,
        afterTaskId: first.nextAfterTaskId ?? '',
      });
      expect(first.items).toEqual(['task-001', 'task-002']);
      expect(second.items).toEqual(['task-003']);
      expect(provider.requests[0]?.headers['mcp-name']).toBe(first.eventId);
    } finally {
      await provider.close();
    }
  });

  it('fails closed on a malformed first message and preserves Provider error codes', async () => {
    const invalid = await startFrozenBusinessEventsMockProvider({ scenario: 'invalid_ack' });
    try {
      await expect(
        new FrozenBusinessEventsClient().listen({
          ...endpoint(invalid.endpoint),
          startPosition: 'latest',
        }),
      ).rejects.toMatchObject({ code: 'BUSINESS_EVENTS_ACK_MISSING' });
    } finally {
      await invalid.close();
    }
    const reset = await startFrozenBusinessEventsMockProvider({ scenario: 'stream_reset' });
    try {
      const rejection = new FrozenBusinessEventsClient().listen({
        ...endpoint(reset.endpoint),
        startPosition: 'earliest_available',
      });
      await expect(rejection).rejects.toBeInstanceOf(BusinessEventsProtocolError);
      await expect(rejection).rejects.toMatchObject({
        code: 'BUSINESS_EVENT_STREAM_RESET',
        retryable: true,
      });
    } finally {
      await reset.close();
    }
  });

  it('preserves frozen relation expiration as a fail-closed typed error', async () => {
    const provider = await startFrozenBusinessEventsMockProvider({
      relationError: 'BUSINESS_EVENT_RELATION_CURSOR_EXPIRED',
    });
    try {
      await expect(
        new FrozenBusinessEventsClient().relatedTasks({
          ...endpoint(provider.endpoint),
          streamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001',
          eventId: 'nZ_hzhW-zrueWt69x9wP5gq-T_rLs_WgSgyTE7jER_o',
          limit: 256,
        }),
      ).rejects.toMatchObject({ code: 'BUSINESS_EVENT_RELATION_CURSOR_EXPIRED' });
    } finally {
      await provider.close();
    }
  });
});

function endpoint(url: URL) {
  return { endpoint: url.href, headers: {} };
}

async function collect<T>(messages: AsyncIterable<T>): Promise<readonly T[]> {
  const result: T[] = [];
  for await (const message of messages) result.push(message);
  return result;
}
