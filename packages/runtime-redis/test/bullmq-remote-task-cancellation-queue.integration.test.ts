import { Queue, QueueEvents } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BullMqRemoteTaskCancellationQueue,
  BullMqRemoteTaskCancellationWorker,
  remoteTaskCancellationJobId,
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

describe('BullMQ remote MCP Task cancellation queue', () => {
  it('stores only request identity/version, deduplicates, and fixes attempts at one', async () => {
    const queueName = `sdar-remote-cancellation-${String(Date.now())}`;
    const queue = new BullMqRemoteTaskCancellationQueue({ connection, queueName });
    const rawQueue = new Queue<{ requestId: string; expectedVersion: number }>(queueName, {
      connection,
    });
    resources.push(rawQueue, queue);
    const input = { requestId: 'cancel:one', expectedVersion: 3 };

    await queue.enqueue(input);
    await queue.enqueue(input);

    const job = await rawQueue.getJob(
      remoteTaskCancellationJobId(input.requestId, input.expectedVersion),
    );
    if (job === undefined) throw new Error('REMOTE_TASK_CANCELLATION_JOB_MISSING');
    expect(job.data).toEqual(input);
    expect(Object.keys(job.data).sort()).toEqual(['expectedVersion', 'requestId']);
    expect(job.opts.attempts).toBe(1);
    await expect(rawQueue.getJobCountByTypes('waiting')).resolves.toBe(1);
  });

  it('does not automatically retry but replaces a failed requested wake on reconciliation', async () => {
    const queueName = `sdar-remote-cancellation-failure-${String(Date.now())}`;
    const queue = new BullMqRemoteTaskCancellationQueue({ connection, queueName });
    const rawQueue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    let calls = 0;
    const worker = new BullMqRemoteTaskCancellationWorker({
      connection,
      queueName,
      processor: {
        process: () => {
          calls += 1;
          return Promise.reject(new Error('simulated cancellation process loss'));
        },
      },
    });
    resources.push(worker, queueEvents, rawQueue, queue);
    const input = { requestId: 'cancel-failure', expectedVersion: 1 };
    await queue.enqueue(input);
    const job = await rawQueue.getJob(
      remoteTaskCancellationJobId(input.requestId, input.expectedVersion),
    );
    if (job === undefined) throw new Error('REMOTE_TASK_CANCELLATION_FAILURE_JOB_MISSING');
    worker.start();

    await expect(job.waitUntilFinished(queueEvents, 5_000)).rejects.toThrow(
      'simulated cancellation process loss',
    );
    expect(calls).toBe(1);
    const failedJob = await rawQueue.getJob(
      remoteTaskCancellationJobId(input.requestId, input.expectedVersion),
    );
    if (failedJob === undefined) throw new Error('REMOTE_TASK_CANCELLATION_FAILED_JOB_MISSING');
    expect(failedJob.attemptsMade).toBe(1);
    await expect(queue.state(input.requestId, input.expectedVersion)).resolves.toBe('failed');
    await worker.close();
    resources.splice(resources.indexOf(worker), 1);
    await queue.enqueue(input);
    await expect(queue.state(input.requestId, input.expectedVersion)).resolves.toBe('scheduled');
    const recoveredWorker = new BullMqRemoteTaskCancellationWorker({
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
      remoteTaskCancellationJobId(input.requestId, input.expectedVersion),
    );
    if (recoveredJob === undefined)
      throw new Error('REMOTE_TASK_CANCELLATION_RECOVERED_JOB_MISSING');
    recoveredWorker.start();
    await recoveredJob.waitUntilFinished(queueEvents, 5_000);
    expect(calls).toBe(2);
  });
});
