import { Queue, QueueEvents } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CandidateGenerationRunReconciler,
  type CandidateGenerationRun,
  type CandidateGenerationRunRepository,
} from '../../application/src/index.js';
import {
  BullMqCandidateGenerationQueue,
  BullMqCandidateGenerationWorker,
  type RedisConnectionConfig,
} from '../src/index.js';

const connection: RedisConnectionConfig = {
  host: '127.0.0.1',
  port: Number(process.env['SDAR_REDIS_PORT'] ?? '56379'),
};
const resources: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

describe('P04R BullMQ candidate generation wake recovery', () => {
  it('rebuilds a deleted Redis wake from a PostgreSQL-authoritative run', async () => {
    const queueName = `sdar-p04r-rebuild-${String(Date.now())}`;
    const queue = new BullMqCandidateGenerationQueue(connection, queueName);
    const raw = new Queue(queueName, { connection });
    resources.push(raw, queue);
    await queue.enqueue('candidate-run-rebuild');
    expect(await raw.getJob('candidate-run-rebuild')).toBeDefined();

    await raw.obliterate({ force: true });
    expect(await raw.getJob('candidate-run-rebuild')).toBeUndefined();
    const reconciler = new CandidateGenerationRunReconciler({
      runs: runRepository([runFixture('candidate-run-rebuild')]),
      queue,
    });
    await expect(reconciler.requeue('2026-07-28T05:00:00.000Z')).resolves.toBe(1);
    expect(await raw.getJob('candidate-run-rebuild')).toBeDefined();
  });

  it('wakes the claim/process application service instead of returning woken=true', async () => {
    const queueName = `sdar-p04r-worker-${String(Date.now())}`;
    const queue = new BullMqCandidateGenerationQueue(connection, queueName);
    const raw = new Queue(queueName, { connection });
    const events = new QueueEvents(queueName, { connection });
    const run = { ...runFixture('candidate-run-worker'), status: 'leased' as const };
    const processRun = vi.fn(() => Promise.resolve());
    let claimed = false;
    const worker = new BullMqCandidateGenerationWorker(
      connection,
      {
        claim: () => {
          if (claimed) return Promise.resolve([]);
          claimed = true;
          return Promise.resolve([run]);
        },
        process: processRun,
      },
      'candidate-worker-p04r',
      queueName,
    );
    resources.push(worker, events, raw, queue);
    await queue.enqueue(run.runId);
    const job = await raw.getJob(run.runId);
    if (job === undefined) throw new Error('P04R_REDIS_WAKE_MISSING');
    worker.start();
    await job.waitUntilFinished(events, 5_000);

    expect(processRun).toHaveBeenCalledWith(run, 'candidate-worker-p04r');
    expect(job.returnvalue).toBeNull();
    expect(job.returnvalue).not.toEqual({ woken: true });
    expect(job.opts.attempts).toBe(1);
  });
});

function runRepository(runs: readonly CandidateGenerationRun[]): CandidateGenerationRunRepository {
  return {
    createRun: () => Promise.resolve(runs[0] ?? runFixture('candidate-run-fallback')),
    claim: () => Promise.resolve([]),
    loadSource: () => Promise.resolve(undefined),
    findExistingFingerprints: () => Promise.resolve([]),
    completeAtomically: () => Promise.resolve(false),
    fail: () => Promise.resolve(false),
    listRequeueable: () => Promise.resolve(runs),
  };
}

function runFixture(runId: string): CandidateGenerationRun {
  return {
    runId,
    tenantId: 'tenant-p04r',
    sourcePatternRef: `pattern-${runId}`,
    sourceEventId: `event-${runId}`,
    status: 'pending',
    attempt: 0,
    maxAttempts: 3,
    availableAt: '2026-07-28T05:00:00.000Z',
    idempotencyKey: `candidate-generation:${runId}`,
    payload: { sourcePatternRef: `pattern-${runId}` },
    createdAt: '2026-07-28T05:00:00.000Z',
    updatedAt: '2026-07-28T05:00:00.000Z',
  };
}
