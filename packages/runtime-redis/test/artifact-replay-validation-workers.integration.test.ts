import { Queue, QueueEvents } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ReplayValidationRunReconciler,
  type ReplayValidationRepository,
  type ReplayValidationRunRecord,
} from '../../application/src/index.js';
import {
  BullMqReplayValidationQueue,
  BullMqReplayValidationWorker,
  type RedisConnectionConfig,
} from '../src/index.js';

const connection: RedisConnectionConfig = { host: '127.0.0.1', port: 56379 };
const resources: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

describe('P05 BullMQ replay-validation wake recovery', () => {
  it('rebuilds an erased Redis wake from a PostgreSQL-authoritative validation run', async () => {
    const queueName = `sdar-p05-rebuild-${String(Date.now())}`;
    const queue = new BullMqReplayValidationQueue(connection, queueName);
    const raw = new Queue(queueName, { connection });
    resources.push(raw, queue);
    await queue.enqueue('validation-run-rebuild');
    expect(await raw.getJob('validation-run-rebuild')).toBeDefined();

    await raw.obliterate({ force: true });
    expect(await raw.getJob('validation-run-rebuild')).toBeUndefined();
    const reconciler = new ReplayValidationRunReconciler(
      replayRepository([runFixture('validation-run-rebuild')]),
      queue,
    );
    await expect(reconciler.requeue('2026-07-29T01:00:00.000Z')).resolves.toBe(1);
    expect(await raw.getJob('validation-run-rebuild')).toBeDefined();
  });

  it('deduplicates wake messages and stores only the validation run identifier', async () => {
    const queueName = `sdar-p05-deduplicate-${String(Date.now())}`;
    const queue = new BullMqReplayValidationQueue(connection, queueName);
    const raw = new Queue(queueName, { connection });
    resources.push(raw, queue);

    await queue.enqueue('validation-run-deduplicate');
    await queue.enqueue('validation-run-deduplicate');

    const jobs = await raw.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ validationRunId: 'validation-run-deduplicate' });
  });

  it('claims PostgreSQL work and executes the application service instead of owning results', async () => {
    const queueName = `sdar-p05-worker-${String(Date.now())}`;
    const queue = new BullMqReplayValidationQueue(connection, queueName);
    const raw = new Queue(queueName, { connection });
    const events = new QueueEvents(queueName, { connection });
    const run = runFixture('validation-run-worker', 'leased');
    const processRun = vi.fn(() => Promise.resolve());
    let claimed = false;
    const worker = new BullMqReplayValidationWorker(
      connection,
      {
        claim: () => {
          if (claimed) return Promise.resolve([]);
          claimed = true;
          return Promise.resolve([run]);
        },
        process: processRun,
      },
      'replay-worker-p05',
      queueName,
    );
    resources.push(worker, events, raw, queue);
    await queue.enqueue(run.validationRunId);
    const job = await raw.getJob(run.validationRunId);
    if (job === undefined) throw new Error('P05_REDIS_WAKE_MISSING');
    worker.start();
    await job.waitUntilFinished(events, 5_000);

    expect(processRun).toHaveBeenCalledWith(run, 'replay-worker-p05');
    expect(job.returnvalue).toBeNull();
    expect(job.opts.attempts).toBe(1);
  });
});

function replayRepository(runs: readonly ReplayValidationRunRecord[]): ReplayValidationRepository {
  return {
    listPendingTriggers: () => Promise.resolve([]),
    listSources: () => Promise.resolve([]),
    persistDatasetAndCreateRun: () =>
      Promise.resolve(runs[0] ?? runFixture('validation-run-fallback')),
    claim: () => Promise.resolve([]),
    loadWork: () => Promise.resolve(undefined),
    completeAtomically: () => Promise.resolve(false),
    fail: () => Promise.resolve(false),
    listRequeueable: () => Promise.resolve(runs),
    requestCancellation: () => Promise.resolve(false),
    purgeTenant: () => Promise.resolve(0),
    purgeExpired: () => Promise.resolve(0),
  };
}

function runFixture(
  validationRunId: string,
  workState: ReplayValidationRunRecord['workState'] = 'pending',
): ReplayValidationRunRecord {
  return {
    validationRunId,
    tenantId: 'tenant-p05',
    artifactId: 'artifact-p05',
    artifactVersion: 1,
    artifactHash: `sha256:${'1'.repeat(64)}`,
    datasetId: 'dataset-p05',
    datasetVersion: 1,
    datasetHash: `sha256:${'2'.repeat(64)}`,
    workState,
    attempt: workState === 'leased' ? 1 : 0,
    maxAttempts: 3,
    availableAt: '2026-07-29T01:00:00.000Z',
    ...(workState === 'leased'
      ? {
          leaseOwner: 'replay-worker-p05',
          leaseToken: 'lease-token-p05',
          leaseExpiresAt: '2026-07-29T01:02:00.000Z',
        }
      : {}),
    idempotencyKey: `artifact-replay:${validationRunId}`,
    createdAt: '2026-07-29T01:00:00.000Z',
    updatedAt: '2026-07-29T01:00:00.000Z',
  };
}
