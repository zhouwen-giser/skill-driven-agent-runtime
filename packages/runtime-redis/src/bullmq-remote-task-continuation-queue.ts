import type {
  RemoteTaskContinuationJob,
  RemoteTaskContinuationQueue,
  RemoteTaskPollJobState,
} from '../../application/src/index.js';
import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import type { RedisConnectionConfig } from './bullmq-context-queue.js';

const RemoteTaskContinuationJobSchema = z
  .object({
    eventId: z.string().min(1).max(256),
    bindingId: z.string().min(1).max(256),
    eventType: z.enum(['task.input_required', 'task.completed', 'task.failed', 'task.cancelled']),
  })
  .strict();

export interface BullMqRemoteTaskContinuationQueueOptions {
  readonly connection: RedisConnectionConfig;
  readonly queueName?: string;
}

export class BullMqRemoteTaskContinuationQueue implements RemoteTaskContinuationQueue {
  readonly #queue: Queue<RemoteTaskContinuationJob>;

  constructor(options: BullMqRemoteTaskContinuationQueueOptions) {
    this.#queue = new Queue(options.queueName ?? 'sdar-remote-mcp-task-continuations', {
      connection: toConnectionOptions(options.connection),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }

  async enqueue(input: RemoteTaskContinuationJob): Promise<void> {
    const job = RemoteTaskContinuationJobSchema.parse(input);
    const jobId = remoteTaskContinuationJobId(job.eventId);
    const existing = await this.#queue.getJob(jobId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'active' ||
        state === 'waiting-children' ||
        state === 'prioritized'
      )
        return;
      await existing.remove();
    }
    await this.#queue.add('remote-task-continuation', job, {
      jobId,
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
  }

  async state(eventId: string): Promise<RemoteTaskPollJobState> {
    const job = await this.#queue.getJob(remoteTaskContinuationJobId(eventId));
    if (job === undefined) return 'missing';
    const state = await job.getState();
    if (state === 'active') return 'active';
    if (state === 'completed') return 'completed';
    if (state === 'failed') return 'failed';
    if (
      state === 'waiting' ||
      state === 'delayed' ||
      state === 'waiting-children' ||
      state === 'prioritized'
    )
      return 'scheduled';
    return 'missing';
  }

  async close(): Promise<void> {
    await this.#queue.close();
  }
}

export interface RemoteTaskContinuationProcessor {
  process(input: RemoteTaskContinuationJob): Promise<unknown>;
}

export interface BullMqRemoteTaskContinuationWorkerOptions extends BullMqRemoteTaskContinuationQueueOptions {
  readonly concurrency?: number;
  readonly processor: RemoteTaskContinuationProcessor;
}

export class BullMqRemoteTaskContinuationWorker {
  readonly #worker: Worker<RemoteTaskContinuationJob, void>;

  constructor(options: BullMqRemoteTaskContinuationWorkerOptions) {
    this.#worker = new Worker<RemoteTaskContinuationJob, void>(
      options.queueName ?? 'sdar-remote-mcp-task-continuations',
      async (job: Job<RemoteTaskContinuationJob>) => {
        await options.processor.process(RemoteTaskContinuationJobSchema.parse(job.data));
      },
      {
        connection: toConnectionOptions(options.connection),
        concurrency: options.concurrency ?? 10,
        maxStalledCount: 0,
        autorun: false,
      },
    );
  }

  start(): void {
    if (!this.#worker.isRunning()) void this.#worker.run();
  }

  async close(force = false): Promise<void> {
    await this.#worker.close(force);
  }
}

export function remoteTaskContinuationJobId(eventId: string): string {
  const parsed = z.string().min(1).max(256).parse(eventId);
  return `mcp-task-continuation~${encodeURIComponent(parsed)}`;
}

function toConnectionOptions(config: RedisConnectionConfig): Readonly<{
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
}> {
  return {
    host: config.host,
    port: config.port,
    ...(config.password === undefined ? {} : { password: config.password }),
    ...(config.db === undefined ? {} : { db: config.db }),
    maxRetriesPerRequest: null,
  };
}
