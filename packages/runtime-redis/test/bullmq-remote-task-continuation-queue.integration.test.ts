import { Queue, QueueEvents } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BullMqRemoteTaskContinuationQueue,
  BullMqRemoteTaskContinuationWorker,
  remoteTaskContinuationJobId,
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

describe('BullMQ remote MCP Task continuation queue', () => {
  it('stores only the control reference and deduplicates a pending continuation', async () => {
    const queueName = `sdar-remote-continuation-${String(Date.now())}`;
    const queue = new BullMqRemoteTaskContinuationQueue({ connection, queueName });
    const rawQueue = new Queue<{
      eventId: string;
      bindingId: string;
      eventType: 'task.completed';
    }>(queueName, { connection });
    resources.push(rawQueue, queue);
    const input = {
      eventId: 'event:one',
      bindingId: 'binding:one',
      eventType: 'task.completed' as const,
    };

    await queue.enqueue(input);
    await queue.enqueue(input);

    const job = await rawQueue.getJob(remoteTaskContinuationJobId(input.eventId));
    if (job === undefined) throw new Error('REMOTE_TASK_CONTINUATION_JOB_MISSING');
    expect(job.data).toEqual(input);
    expect(Object.keys(job.data).sort()).toEqual(['bindingId', 'eventId', 'eventType']);
    expect(job.opts.attempts).toBe(1);
    await expect(rawQueue.getJobCountByTypes('waiting')).resolves.toBe(1);
  });

  it('does not automatically retry but replaces a failed wake on authoritative reconciliation', async () => {
    const queueName = `sdar-remote-continuation-failure-${String(Date.now())}`;
    const queue = new BullMqRemoteTaskContinuationQueue({ connection, queueName });
    const rawQueue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    let calls = 0;
    const worker = new BullMqRemoteTaskContinuationWorker({
      connection,
      queueName,
      processor: {
        process: () => {
          calls += 1;
          return Promise.reject(new Error('simulated continuation process loss'));
        },
      },
    });
    resources.push(worker, queueEvents, rawQueue, queue);
    const input = {
      eventId: 'event-failure',
      bindingId: 'binding-failure',
      eventType: 'task.failed' as const,
    };
    await queue.enqueue(input);
    const job = await rawQueue.getJob(remoteTaskContinuationJobId(input.eventId));
    if (job === undefined) throw new Error('REMOTE_TASK_CONTINUATION_FAILURE_JOB_MISSING');
    worker.start();

    await expect(job.waitUntilFinished(queueEvents, 5_000)).rejects.toThrow(
      'simulated continuation process loss',
    );
    expect(calls).toBe(1);
    const failedJob = await rawQueue.getJob(remoteTaskContinuationJobId(input.eventId));
    if (failedJob === undefined) throw new Error('REMOTE_TASK_CONTINUATION_FAILED_JOB_MISSING');
    expect(failedJob.attemptsMade).toBe(1);
    await expect(queue.state(input.eventId)).resolves.toBe('failed');
    await worker.close();
    resources.splice(resources.indexOf(worker), 1);
    await queue.enqueue(input);
    await expect(queue.state(input.eventId)).resolves.toBe('scheduled');
    const recoveredWorker = new BullMqRemoteTaskContinuationWorker({
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
    const recoveredJob = await rawQueue.getJob(remoteTaskContinuationJobId(input.eventId));
    if (recoveredJob === undefined)
      throw new Error('REMOTE_TASK_CONTINUATION_RECOVERED_JOB_MISSING');
    recoveredWorker.start();
    await recoveredJob.waitUntilFinished(queueEvents, 5_000);
    expect(calls).toBe(2);
  });
});
