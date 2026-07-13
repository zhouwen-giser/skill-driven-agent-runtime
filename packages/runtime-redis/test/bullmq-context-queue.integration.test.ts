import { Queue, QueueEvents } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BullMqContextTaskQueue,
  BullMqContextWorker,
  type RedisConnectionConfig,
} from '../src/index.js';

const connection: RedisConnectionConfig = { host: '127.0.0.1', port: 56379 };
const resources: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

describe('BullMQ context queue', () => {
  it('runs ten contexts concurrently without overlapping tails from the same context', async () => {
    const queueName = `sdar-ten-contexts-${String(Date.now())}`;
    const queue = new BullMqContextTaskQueue({ connection, queueName });
    const rawQueue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    resources.push(queueEvents, rawQueue, queue);
    let active = 0;
    let maximumActive = 0;
    let releaseFirstWave: () => void = () => undefined;
    const firstWaveBlocked = new Promise<void>((resolve) => {
      releaseFirstWave = resolve;
    });
    const events = new Map<string, string[]>();
    const worker = new BullMqContextWorker({
      connection,
      queueName,
      concurrency: 20,
      processor: {
        process: async ({ taskId, contextId }) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          const contextEvents = events.get(contextId) ?? [];
          contextEvents.push(`${taskId}:start`);
          events.set(contextId, contextEvents);
          if (taskId.endsWith('-first')) await firstWaveBlocked;
          contextEvents.push(`${taskId}:end`);
          active -= 1;
        },
      },
    });
    resources.unshift(worker);
    worker.start();

    const firstIds = Array.from({ length: 10 }, (_, index) => `task-${String(index)}-first`);
    await Promise.all(
      firstIds.map((taskId, index) =>
        queue.enqueue({ taskId, contextId: `context-${String(index)}` }),
      ),
    );
    await waitFor(() => active === 10);
    const tailIds = Array.from({ length: 10 }, (_, index) => `task-${String(index)}-tail`);
    await Promise.all(
      tailIds.map((taskId, index) =>
        queue.enqueue({ taskId, contextId: `context-${String(index)}` }),
      ),
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
    expect(maximumActive).toBe(10);
    expect([...events.values()].every((value) => value.length === 1)).toBe(true);
    releaseFirstWave();

    const jobs = await Promise.all(
      [...firstIds, ...tailIds].map((taskId) => rawQueue.getJob(taskId)),
    );
    await Promise.all(
      jobs.map((job) => {
        if (job === undefined) throw new Error('BULLMQ_TEN_CONTEXT_JOB_MISSING');
        return job.waitUntilFinished(queueEvents, 5_000);
      }),
    );
    expect(active).toBe(0);
    expect(
      [...events.values()].every(
        (value) =>
          value.length === 4 &&
          value[0]?.endsWith('-first:start') === true &&
          value[1]?.endsWith('-first:end') === true &&
          value[2]?.endsWith('-tail:start') === true &&
          value[3]?.endsWith('-tail:end') === true,
      ),
    ).toBe(true);
  });

  it('keeps one context strictly serial while different contexts overlap', async () => {
    const queueName = `sdar-context-serial-${String(Date.now())}`;
    const queue = new BullMqContextTaskQueue({ connection, queueName });
    const rawQueue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    resources.push(queueEvents, rawQueue, queue);
    const events: string[] = [];
    let releaseA1: () => void = () => undefined;
    const a1Blocked = new Promise<void>((resolve) => {
      releaseA1 = resolve;
    });
    const worker = new BullMqContextWorker({
      connection,
      queueName,
      concurrency: 4,
      processor: {
        process: async ({ taskId }) => {
          events.push(`${taskId}:start`);
          if (taskId === 'a1') await a1Blocked;
          events.push(`${taskId}:end`);
        },
      },
    });
    resources.unshift(worker);
    worker.start();

    await queue.enqueue({ taskId: 'a1', contextId: 'context-a' });
    await queue.enqueue({ taskId: 'a2', contextId: 'context-a' });
    await queue.enqueue({ taskId: 'b1', contextId: 'context-b' });
    const a1 = await rawQueue.getJob('a1');
    const a2 = await rawQueue.getJob('a2');
    const b1 = await rawQueue.getJob('b1');
    if (a1 === undefined || a2 === undefined || b1 === undefined)
      throw new Error('BULLMQ_JOB_MISSING');

    await waitFor(() => events.includes('b1:end'));
    expect(events).not.toContain('a2:start');
    releaseA1();
    await Promise.all([
      a1.waitUntilFinished(queueEvents, 5_000),
      a2.waitUntilFinished(queueEvents, 5_000),
      b1.waitUntilFinished(queueEvents, 5_000),
    ]);

    expect(events.indexOf('a1:end')).toBeLessThan(events.indexOf('a2:start'));
    expect(a1.opts.attempts).toBe(1);
    expect(a2.opts.attempts).toBe(1);
  });

  it('retains a queued job across queue-client restart before a worker starts', async () => {
    const queueName = `sdar-queue-restart-${String(Date.now())}`;
    const firstQueue = new BullMqContextTaskQueue({ connection, queueName });
    await firstQueue.enqueue({ taskId: 'queued-1', contextId: 'context-restart' });
    await firstQueue.close();

    const observed: string[] = [];
    const queueEvents = new QueueEvents(queueName, { connection });
    const rawQueue = new Queue(queueName, { connection });
    const worker = new BullMqContextWorker({
      connection,
      queueName,
      processor: {
        process: ({ taskId }) => {
          observed.push(taskId);
          return Promise.resolve();
        },
      },
    });
    resources.push(worker, queueEvents, rawQueue);
    const job = await rawQueue.getJob('queued-1');
    if (job === undefined) throw new Error('BULLMQ_RESTART_JOB_MISSING');
    worker.start();
    await job.waitUntilFinished(queueEvents, 5_000);

    expect(observed).toEqual(['queued-1']);
    expect(job.opts.attempts).toBe(1);
  });

  it('retains a failed Worker job and never retries the whole Task', async () => {
    const queueName = `sdar-worker-failure-${String(Date.now())}`;
    const queue = new BullMqContextTaskQueue({ connection, queueName });
    const rawQueue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    let processorCalls = 0;
    const worker = new BullMqContextWorker({
      connection,
      queueName,
      processor: {
        process: () => {
          processorCalls += 1;
          return Promise.reject(new Error('worker failed after a side effect'));
        },
      },
    });
    resources.push(worker, queueEvents, rawQueue, queue);

    await queue.enqueue({ taskId: 'failed-once', contextId: 'context-failure' });
    const job = await rawQueue.getJob('failed-once');
    if (job === undefined) throw new Error('BULLMQ_FAILED_JOB_MISSING');
    worker.start();
    await expect(job.waitUntilFinished(queueEvents, 5_000)).rejects.toThrow(
      'worker failed after a side effect',
    );
    await waitFor(() => processorCalls === 1);
    const failedJob = await rawQueue.getJob('failed-once');
    if (failedJob === undefined) throw new Error('BULLMQ_FAILED_JOB_NOT_RETAINED');

    expect(processorCalls).toBe(1);
    expect(failedJob.opts.attempts).toBe(1);
    expect(failedJob.attemptsMade).toBe(1);
    await expect(failedJob.getState()).resolves.toBe('failed');
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('TEST_WAIT_TIMEOUT');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}
