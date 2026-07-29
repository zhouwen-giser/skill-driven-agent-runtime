import { Queue, QueueEvents } from 'bullmq';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CompilationRunReconciler,
  type CompilationRun,
  type CompilationRunRepository,
} from '../../application/src/index.js';
import {
  BullMqCompilationQueue,
  BullMqCompilationWorker,
  type RedisConnectionConfig,
} from '../src/index.js';

const connection: RedisConnectionConfig = { host: '127.0.0.1', port: 56379 };
const resources: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

describe('P03 BullMQ compilation wake recovery', () => {
  it('rebuilds a lost Redis wake from PostgreSQL-authoritative requeueable state', async () => {
    const queueName = `sdar-p03-rebuild-${String(Date.now())}`;
    const queue = new BullMqCompilationQueue(connection, 'normalization', queueName);
    const raw = new Queue(queueName, { connection });
    resources.push(raw, queue);
    await queue.enqueue('run-p03-rebuild');
    expect(await raw.getJob('run-p03-rebuild')).toBeDefined();

    await raw.obliterate({ force: true });
    expect(await raw.getJob('run-p03-rebuild')).toBeUndefined();
    const reconciler = new CompilationRunReconciler({
      runs: runRepository([runFixture('run-p03-rebuild')]),
      queue,
      runType: 'normalization',
    });
    await expect(reconciler.requeue('2026-07-27T13:00:00.000Z')).resolves.toBe(1);
    expect(await raw.getJob('run-p03-rebuild')).toBeDefined();

    await queue.enqueue('run-p03-rebuild');
    expect(await raw.getJobCounts('waiting', 'active', 'delayed')).toMatchObject({
      active: 0,
      delayed: 0,
      waiting: 1,
    });
  });

  it('uses Redis only to wake a claim/process service and performs no BullMQ retry', async () => {
    const queueName = `sdar-p03-worker-${String(Date.now())}`;
    const queue = new BullMqCompilationQueue(connection, 'normalization', queueName);
    const raw = new Queue(queueName, { connection });
    const events = new QueueEvents(queueName, { connection });
    const run = runFixture('run-p03-worker');
    const processRun = vi.fn(() => Promise.resolve());
    let claimed = false;
    const worker = new BullMqCompilationWorker(
      connection,
      'normalization',
      {
        claim: () => {
          if (claimed) return Promise.resolve([]);
          claimed = true;
          return Promise.resolve([run]);
        },
        process: processRun,
      },
      'worker-p03',
      queueName,
    );
    resources.push(worker, events, raw, queue);
    const enqueuedAt = performance.now();
    await queue.enqueue(run.runId);
    const job = await raw.getJob(run.runId);
    if (job === undefined) throw new Error('P03_REDIS_WAKE_MISSING');
    worker.start();
    await job.waitUntilFinished(events, 5_000);
    const queueLagMs = performance.now() - enqueuedAt;

    expect(processRun).toHaveBeenCalledWith(run, 'worker-p03');
    expect(job.opts.attempts).toBe(1);
    process.stdout.write(
      `${JSON.stringify({
        event: 'p03.compilation_worker.wake',
        processedRuns: 1,
        queueLagMs: Number(queueLagMs.toFixed(3)),
        runsPerSecond: Number((1_000 / queueLagMs).toFixed(3)),
      })}\n`,
    );
  });

  it('reports bounded local worker throughput over ten PostgreSQL-style claim batches', async () => {
    const queueName = `sdar-p03-throughput-${String(Date.now())}`;
    const queue = new BullMqCompilationQueue(connection, 'normalization', queueName);
    const raw = new Queue(queueName, { connection });
    const events = new QueueEvents(queueName, { connection });
    const pending = Array.from({ length: 100 }, (_, index) =>
      runFixture(`run-p03-throughput-${String(index)}`),
    );
    let processed = 0;
    const worker = new BullMqCompilationWorker(
      connection,
      'normalization',
      {
        claim: () => Promise.resolve(pending.splice(0, 10)),
        process: () => {
          processed += 1;
          return Promise.resolve();
        },
      },
      'worker-p03-throughput',
      queueName,
    );
    resources.push(worker, events, raw, queue);
    const wakeIds = Array.from(
      { length: 10 },
      (_, index) => `wake-p03-throughput-${String(index)}`,
    );
    await Promise.all(wakeIds.map((wakeId) => queue.enqueue(wakeId)));
    const jobs = await Promise.all(wakeIds.map((wakeId) => raw.getJob(wakeId)));
    if (jobs.some((job) => job === undefined)) {
      throw new Error('P03_THROUGHPUT_WAKE_MISSING');
    }
    const startedAt = performance.now();
    worker.start();
    await Promise.all(
      jobs.map((job) => {
        if (job === undefined) throw new Error('P03_THROUGHPUT_WAKE_MISSING');
        return job.waitUntilFinished(events, 5_000);
      }),
    );
    const elapsedMs = performance.now() - startedAt;
    expect(processed).toBe(100);
    process.stdout.write(
      `${JSON.stringify({
        event: 'p03.compilation_worker.throughput',
        processedRuns: processed,
        claimBatches: wakeIds.length,
        elapsedMs: Number(elapsedMs.toFixed(3)),
        runsPerSecond: Number(((processed / elapsedMs) * 1_000).toFixed(3)),
      })}\n`,
    );
  });
});

function runRepository(runs: readonly CompilationRun[]): CompilationRunRepository {
  return {
    createNormalizationRun: () => Promise.resolve(runs[0] ?? runFixture('run-fallback')),
    createProcessMiningRun: () => Promise.resolve(runs[0] ?? runFixture('run-fallback')),
    claim: () => Promise.resolve([]),
    complete: () => Promise.resolve(false),
    fail: () => Promise.resolve(false),
    listRequeueable: () => Promise.resolve(runs),
  };
}

function runFixture(runId: string): CompilationRun {
  return {
    runId,
    runType: 'normalization',
    sourceEpisodeId: `episode-${runId}`,
    status: 'pending',
    attempt: 0,
    maxAttempts: 3,
    availableAt: '2026-07-27T13:00:00.000Z',
    idempotencyKey: `normalization:${runId}`,
    payload: { sourceEpisodeId: `episode-${runId}` },
    createdAt: '2026-07-27T13:00:00.000Z',
    updatedAt: '2026-07-27T13:00:00.000Z',
  };
}
