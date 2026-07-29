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
    const raw = new Queue<{ readonly validationRunId: string }>(queueName, { connection });
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
    const raw = new Queue<{ readonly validationRunId: string }>(queueName, { connection });
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
    const raw = new Queue<{ readonly validationRunId: string }>(queueName, { connection });
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
    const enqueuedAt = performance.now();
    await queue.enqueue(run.validationRunId);
    const job = await raw.getJob(run.validationRunId);
    if (job === undefined) throw new Error('P05_REDIS_WAKE_MISSING');
    worker.start();
    await job.waitUntilFinished(events, 5_000);
    const queueLagMs = performance.now() - enqueuedAt;

    expect(processRun).toHaveBeenCalledWith(run, 'replay-worker-p05');
    expect(job.returnvalue).toBeNull();
    expect(job.opts.attempts).toBe(1);
    expect(queueLagMs).toBeLessThan(5_000);
    console.info(
      JSON.stringify({
        event: 'p05.replay_validation.redis_queue_lag',
        queueLagMs: Number(queueLagMs.toFixed(3)),
        wakePayloadFields: Object.keys(job.data).sort(),
        redisAuthority: false,
      }),
    );
  });

  it('applies one-at-a-time worker backpressure and forwards PostgreSQL cancellation state', async () => {
    const queueName = `sdar-p05-backpressure-${String(Date.now())}`;
    const queue = new BullMqReplayValidationQueue(connection, queueName);
    const raw = new Queue<{ readonly validationRunId: string }>(queueName, { connection });
    const events = new QueueEvents(queueName, { connection });
    const runs = Array.from({ length: 5 }, (_, index) =>
      runFixture(
        `validation-run-backpressure-${String(index + 1)}`,
        'leased',
        index === 2 ? { cancelRequestedAt: '2026-07-29T01:00:01.000Z' } : {},
      ),
    );
    let claimIndex = 0;
    let active = 0;
    let maximumActive = 0;
    const processed: ReplayValidationRunRecord[] = [];
    const worker = new BullMqReplayValidationWorker(
      connection,
      {
        claim: () => {
          const run = runs[claimIndex++];
          return Promise.resolve(run === undefined ? [] : [run]);
        },
        process: async (run) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          processed.push(run);
          active -= 1;
        },
      },
      'replay-worker-p05-backpressure',
      queueName,
    );
    resources.push(worker, events, raw, queue);
    for (const run of runs) await queue.enqueue(run.validationRunId);
    const jobs = await Promise.all(runs.map((run) => raw.getJob(run.validationRunId)));
    if (jobs.some((job) => job === undefined)) throw new Error('P05_REDIS_WAKE_MISSING');
    worker.start();
    await Promise.all(
      jobs.map((job) => {
        if (job === undefined) throw new Error('P05_REDIS_WAKE_MISSING');
        return job.waitUntilFinished(events, 5_000);
      }),
    );

    expect(processed).toHaveLength(5);
    expect(maximumActive).toBe(1);
    expect(processed.filter((run) => run.cancelRequestedAt !== undefined)).toHaveLength(1);
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
  overrides: Partial<ReplayValidationRunRecord> = {},
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
    ...overrides,
  };
}
