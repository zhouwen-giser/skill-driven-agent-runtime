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
