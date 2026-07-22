import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  BusinessEventContinuityRecord,
  BusinessEventInboxRecord,
  BusinessEventRelationProjection,
  BusinessEventSubscription,
} from '../../domain/src/index.js';
import {
  FrozenBusinessEventsRuntimeAdapter,
  startFrozenBusinessEventsMockProvider,
  type FrozenBusinessEventsMockHandle,
} from '../../mcp-adapter/src/index.js';
import {
  BusinessEventIngressWorker,
  BusinessEventRelationResolver,
  BusinessEventSubscriptionService,
  type BusinessEventRuntimeRepository,
} from '../src/index.js';

const handles: FrozenBusinessEventsMockHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe('Business Event runtime services', () => {
  it('durably admits before advancing the receive cursor and processes on an independent cursor', async () => {
    const provider = await mock({ scenario: 'task_event' });
    const repository = new MemoryBusinessEventRepository();
    const service = subscriptionService(repository);
    let connected = 0;
    const result = await service.run({
      ...connection(provider),
      onConnected: () => {
        connected += 1;
      },
    });
    expect(result).toMatchObject({ admitted: 1, duplicates: 0, status: 'current' });
    expect(connected).toBe(1);
    expect(repository.subscription?.lastDurablyAdmittedSequence).toBe('1');
    expect(repository.subscription?.lastProcessedSequence).toBe('0');

    const worker = new BusinessEventIngressWorker({
      repository,
      processor: { process: () => Promise.resolve() },
      clock,
    });
    await expect(worker.runOnce()).resolves.toEqual({ processed: 1, failed: 0 });
    expect(repository.subscription?.lastProcessedSequence).toBe('1');
  });

  it('deduplicates repeated delivery and resumes from the durable cursor after restart', async () => {
    const provider = await mock({ scenario: 'duplicate_event' });
    const repository = new MemoryBusinessEventRepository();
    await expect(subscriptionService(repository).run(connection(provider))).resolves.toMatchObject({
      admitted: 1,
      duplicates: 1,
    });
    await expect(subscriptionService(repository).run(connection(provider))).resolves.toMatchObject({
      admitted: 0,
      duplicates: 2,
    });
    const listens = provider.requests.filter(
      (request) => request.method === 'io.sdar/businessEvents/listen',
    );
    expect(listens[1]?.params['cursor']).toEqual({
      streamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001',
      afterSequence: '1',
    });
  });

  it('records continuity idempotently, retires the drained generation, and selects current next', async () => {
    const provider = await mock({ scenario: 'continuity' });
    const repository = new MemoryBusinessEventRepository();
    await expect(subscriptionService(repository).run(connection(provider))).resolves.toMatchObject({
      continuityControls: 1,
      status: 'retired',
    });
    await expect(subscriptionService(repository).run(connection(provider))).resolves.toMatchObject({
      continuityControls: 0,
      status: 'retired',
    });
    expect(repository.continuities).toHaveLength(1);
    expect(repository.subscription?.lastReplayableSequence).toBe('1');
    const listens = provider.requests.filter(
      (request) => request.method === 'io.sdar/businessEvents/listen',
    );
    expect(listens[1]?.params).toMatchObject({ startPosition: 'earliest_available' });
  });

  it('pages a complete immutable relation and fails closed when the relation expires', async () => {
    const provider = await mock({ relationTaskIds: ['task-3', 'task-1', 'task-2'] });
    const repository = new MemoryBusinessEventRepository();
    const resolver = relationResolver(repository);
    const complete = await resolver.resolve({
      ...endpoint(provider),
      inboxId: 'inbox-relation',
      event: resourceEvent(3),
    });
    expect(complete).toMatchObject({
      status: 'complete',
      taskIds: ['task-1', 'task-2', 'task-3'],
      total: 3,
    });

    const expiredProvider = await mock({
      relationError: 'BUSINESS_EVENT_RELATION_CURSOR_EXPIRED',
    });
    const expired = await resolver.resolve({
      ...endpoint(expiredProvider),
      inboxId: 'inbox-expired',
      event: resourceEvent(300),
    });
    expect(expired.status).toBe('expired');
    expect(expired.total).toBe(300);
    expect(expired.taskIds).toEqual([]);
  });

  it('keeps failed processing retryable without rolling back durable admission', async () => {
    const provider = await mock({ scenario: 'task_event' });
    const repository = new MemoryBusinessEventRepository();
    await subscriptionService(repository).run(connection(provider));
    const worker = new BusinessEventIngressWorker({
      repository,
      processor: {
        process: () =>
          Promise.reject(
            Object.assign(new Error('temporary'), { code: 'TEMPORARY_EVENT_FAILURE' }),
          ),
      },
      clock,
    });
    await expect(worker.runOnce()).resolves.toEqual({ processed: 0, failed: 1 });
    expect(repository.subscription?.lastDurablyAdmittedSequence).toBe('1');
    expect(repository.subscription?.lastProcessedSequence).toBe('0');
    expect(repository.inbox[0]?.status).toBe('retryable_failed');
  });
});

class MemoryBusinessEventRepository implements BusinessEventRuntimeRepository {
  subscription: BusinessEventSubscription | undefined;
  readonly inbox: BusinessEventInboxRecord[] = [];
  readonly continuities: BusinessEventContinuityRecord[] = [];
  readonly projections: BusinessEventRelationProjection[] = [];

  saveBusinessEventSubscription(subscription: BusinessEventSubscription): Promise<void> {
    this.subscription = subscription;
    return Promise.resolve();
  }

  findCurrentBusinessEventSubscription(): Promise<BusinessEventSubscription | undefined> {
    return Promise.resolve(this.subscription?.status === 'current' ? this.subscription : undefined);
  }

  findLatestBusinessEventSubscription(): Promise<BusinessEventSubscription | undefined> {
    return Promise.resolve(this.subscription);
  }

  transitionBusinessEventSubscription(
    _subscriptionId: string,
    status: BusinessEventSubscription['status'],
    updatedAt: string,
    lastReplayableSequence?: string,
  ): Promise<void> {
    if (this.subscription === undefined) throw new Error('missing subscription');
    this.subscription = {
      ...this.subscription,
      status,
      updatedAt,
      ...(lastReplayableSequence === undefined ? {} : { lastReplayableSequence }),
    };
    return Promise.resolve();
  }

  recordBusinessEventContinuity(
    record: BusinessEventContinuityRecord,
  ): Promise<Readonly<{ created: boolean }>> {
    const duplicate = this.continuities.some(
      (item) =>
        item.subscriptionId === record.subscriptionId &&
        item.previousStreamId === record.previousStreamId &&
        item.newStreamId === record.newStreamId &&
        item.reasonCode === record.reasonCode &&
        item.lastReplayableSequence === record.lastReplayableSequence,
    );
    if (!duplicate) this.continuities.push(record);
    if (this.subscription !== undefined)
      this.subscription = {
        ...this.subscription,
        status: 'draining_closed',
        lastReplayableSequence: record.lastReplayableSequence,
      };
    return Promise.resolve({ created: !duplicate });
  }

  admitBusinessEvent(record: BusinessEventInboxRecord): Promise<Readonly<{ created: boolean }>> {
    const existing = this.inbox.find(
      (item) => item.subscriptionId === record.subscriptionId && item.eventId === record.eventId,
    );
    if (existing !== undefined) {
      if (existing.envelopeHash !== record.envelopeHash || existing.sequence !== record.sequence)
        throw new Error('BUSINESS_EVENT_IDENTITY_HASH_MISMATCH');
      return Promise.resolve({ created: false });
    }
    this.inbox.push(record);
    if (this.subscription !== undefined)
      this.subscription = {
        ...this.subscription,
        lastDurablyAdmittedSequence: maxSequence(
          this.subscription.lastDurablyAdmittedSequence,
          record.sequence,
        ),
      };
    return Promise.resolve({ created: true });
  }

  claimBusinessEventInbox(limit: number): Promise<readonly BusinessEventInboxRecord[]> {
    const claimed = this.inbox
      .filter((record) => record.status === 'admitted' || record.status === 'retryable_failed')
      .slice(0, limit);
    for (const record of claimed) this.replaceInbox({ ...record, status: 'processing' });
    return Promise.resolve(claimed.map((record) => ({ ...record, status: 'processing' })));
  }

  markBusinessEventProcessed(inboxId: string): Promise<void> {
    const record = this.inbox.find((item) => item.inboxId === inboxId);
    if (record === undefined) throw new Error('missing inbox');
    this.replaceInbox({ ...record, status: 'processed' });
    if (this.subscription !== undefined)
      this.subscription = {
        ...this.subscription,
        lastProcessedSequence: maxSequence(
          this.subscription.lastProcessedSequence,
          record.sequence,
        ),
      };
    return Promise.resolve();
  }

  markBusinessEventFailed(inboxId: string, _errorCode: string, retryable: boolean): Promise<void> {
    const record = this.inbox.find((item) => item.inboxId === inboxId);
    if (record === undefined) throw new Error('missing inbox');
    this.replaceInbox({
      ...record,
      status: retryable ? 'retryable_failed' : 'terminal_failed',
    });
    return Promise.resolve();
  }

  saveBusinessEventRelationProjection(projection: BusinessEventRelationProjection): Promise<void> {
    this.projections.push(projection);
    return Promise.resolve();
  }

  private replaceInbox(record: BusinessEventInboxRecord): void {
    const index = this.inbox.findIndex((item) => item.inboxId === record.inboxId);
    this.inbox[index] = record;
  }
}

function subscriptionService(repository: BusinessEventRuntimeRepository) {
  let sequence = 0;
  return new BusinessEventSubscriptionService({
    runtime: new FrozenBusinessEventsRuntimeAdapter(),
    repository,
    clock,
    nextSubscriptionId: () => `subscription-${String(++sequence)}`,
    nextInboxId: () => `inbox-${String(++sequence)}`,
    nextContinuityId: () => `continuity-${String(++sequence)}`,
    hash,
  });
}

function relationResolver(repository: BusinessEventRuntimeRepository) {
  let sequence = 0;
  return new BusinessEventRelationResolver({
    runtime: new FrozenBusinessEventsRuntimeAdapter(),
    repository,
    clock,
    nextProjectionId: () => `relation-${String(++sequence)}`,
    hash,
  });
}

function resourceEvent(total: number) {
  return {
    streamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001',
    eventId: 'nZ_hzhW-zrueWt69x9wP5gq-T_rLs_WgSgyTE7jER_o',
    sequence: '1',
    sourceId: 'adapter.vehicle',
    eventType: 'vehicle.battery.low',
    occurredAt: '2026-07-22T01:00:00Z',
    scope: 'resource' as const,
    description: 'Battery is low.',
    resourceRef: 'vehicle:42',
    relatedTaskIds: [],
    relatedTaskCount: total,
    relationTruncated: true,
  };
}

async function mock(
  options: Parameters<typeof startFrozenBusinessEventsMockProvider>[0],
): Promise<FrozenBusinessEventsMockHandle> {
  const handle = await startFrozenBusinessEventsMockProvider(options);
  handles.push(handle);
  return handle;
}

function endpoint(provider: FrozenBusinessEventsMockHandle) {
  return { endpoint: provider.endpoint.href, headers: {} };
}

function connection(provider: FrozenBusinessEventsMockHandle) {
  return { providerId: 'provider-1', ...endpoint(provider) };
}

const clock = { now: () => '2026-07-22T02:00:00.000Z' };
function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
function maxSequence(left: string, right: string): string {
  return BigInt(left) >= BigInt(right) ? left : right;
}
