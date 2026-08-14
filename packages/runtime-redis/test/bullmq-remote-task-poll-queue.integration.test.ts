import { Queue, QueueEvents } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BullMqRemoteTaskPollQueue,
  BullMqRemoteTaskPollWorker,
  remoteTaskPollJobId,
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

describe('BullMQ remote MCP Task poll queue', () => {
  it('stores only the versioned PostgreSQL reference and deduplicates a delayed poll', async () => {
    const queueName = `sdar-remote-payload-${String(Date.now())}`;
    const now = Date.parse('2026-07-16T08:00:00.000Z');
    const queue = new BullMqRemoteTaskPollQueue({
      connection,
      queueName,
      nowMilliseconds: () => now,
    });
    const rawQueue = new Queue<{ bindingId: string; expectedVersion: number }>(queueName, {
      connection,
    });
    resources.push(rawQueue, queue);
    const input = { bindingId: 'binding:one', expectedVersion: 7 };

    await queue.enqueue(input, '2026-07-16T08:00:05.000Z');
    await queue.enqueue(input, '2026-07-16T08:00:09.000Z');

    const job = await rawQueue.getJob(remoteTaskPollJobId(input.bindingId, input.expectedVersion));
    if (job === undefined) throw new Error('REMOTE_TASK_POLL_JOB_MISSING');
    expect(job.data).toEqual(input);
    expect(Object.keys(job.data).sort()).toEqual(['bindingId', 'expectedVersion']);
    expect(job.opts.attempts).toBe(1);
    expect(job.opts.delay).toBe(5_000);
    await expect(rawQueue.getJobCountByTypes('delayed')).resolves.toBe(1);
  });

  it('retains a failed poll for audit and replaces it on authoritative reconciliation', async () => {
    const queueName = `sdar-remote-dead-letter-${String(Date.now())}`;
    const queue = new BullMqRemoteTaskPollQueue({ connection, queueName });
    const rawQueue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    let calls = 0;
    const worker = new BullMqRemoteTaskPollWorker({
      connection,
      queueName,
      processor: {
        process: () => {
          calls += 1;
          return Promise.reject(new Error('simulated worker crash'));
        },
      },
    });
    resources.push(worker, queueEvents, rawQueue, queue);
    const input = { bindingId: 'binding-dead-letter', expectedVersion: 3 };
    await queue.enqueue(input, new Date().toISOString());
    const job = await rawQueue.getJob(remoteTaskPollJobId(input.bindingId, input.expectedVersion));
    if (job === undefined) throw new Error('REMOTE_TASK_DEAD_LETTER_JOB_MISSING');
    worker.start();

    await expect(job.waitUntilFinished(queueEvents, 5_000)).rejects.toThrow(
      'simulated worker crash',
    );
    expect(calls).toBe(1);
    await expect(queue.listDeadLetters(10)).resolves.toEqual([
      expect.objectContaining({
        jobId: remoteTaskPollJobId(input.bindingId, input.expectedVersion),
        bindingId: input.bindingId,
        expectedVersion: input.expectedVersion,
        attemptsMade: 1,
      }),
    ]);

    await worker.close();
    resources.splice(resources.indexOf(worker), 1);
    await queue.enqueue(input, new Date().toISOString());
    await expect(queue.state(input.bindingId, input.expectedVersion)).resolves.toBe('scheduled');
    const recoveredWorker = new BullMqRemoteTaskPollWorker({
      connection,
      queueName,
      processor: {
        process: () => {
          calls += 1;
          return Promise.resolve();
        },
      },
    });
    resources.push(recoveredWorker);
    const recoveredJob = await rawQueue.getJob(
      remoteTaskPollJobId(input.bindingId, input.expectedVersion),
    );
    if (recoveredJob === undefined) throw new Error('REMOTE_TASK_RECOVERED_JOB_MISSING');
    recoveredWorker.start();
    await recoveredJob.waitUntilFinished(queueEvents, 5_000);
    expect(calls).toBe(2);
  });

  it('replaces a completed poll when PostgreSQL reconciliation still owns the same version', async () => {
    const queueName = `sdar-remote-reconcile-${String(Date.now())}`;
    const queue = new BullMqRemoteTaskPollQueue({ connection, queueName });
    const rawQueue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    let calls = 0;
    const worker = new BullMqRemoteTaskPollWorker({
      connection,
      queueName,
      processor: {
        process: () => {
          calls += 1;
          return Promise.resolve();
        },
      },
    });
    resources.push(worker, queueEvents, rawQueue, queue);
    worker.start();
    const input = { bindingId: 'binding-reconcile', expectedVersion: 11 };

    await queue.enqueue(input, new Date().toISOString());
    const first = await rawQueue.getJob(
      remoteTaskPollJobId(input.bindingId, input.expectedVersion),
    );
    if (first === undefined) throw new Error('REMOTE_TASK_FIRST_JOB_MISSING');
    await first.waitUntilFinished(queueEvents, 5_000);
    await queue.enqueue(input, new Date().toISOString());
    const replacement = await rawQueue.getJob(
      remoteTaskPollJobId(input.bindingId, input.expectedVersion),
    );
    if (replacement === undefined) throw new Error('REMOTE_TASK_REPLACEMENT_JOB_MISSING');
    await replacement.waitUntilFinished(queueEvents, 5_000);

    expect(calls).toBe(2);
    expect(replacement.opts.attempts).toBe(1);
  });
});
