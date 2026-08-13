import type {
  RemoteTaskCancellationJob,
  RemoteTaskCancellationQueue,
  RemoteTaskPollJobState,
} from '../../application/src/index.js';
import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import type { RedisConnectionConfig } from './bullmq-context-queue.js';

const RemoteTaskCancellationJobSchema = z
  .object({
    requestId: z.string().min(1).max(256),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export interface BullMqRemoteTaskCancellationQueueOptions {
  readonly connection: RedisConnectionConfig;
  readonly queueName?: string;
}

export class BullMqRemoteTaskCancellationQueue implements RemoteTaskCancellationQueue {
  readonly #queue: Queue<RemoteTaskCancellationJob>;

  constructor(options: BullMqRemoteTaskCancellationQueueOptions) {
    this.#queue = new Queue(options.queueName ?? 'sdar-remote-mcp-task-cancellations', {
      connection: toConnectionOptions(options.connection),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }

  async enqueue(input: RemoteTaskCancellationJob): Promise<void> {
    const job = RemoteTaskCancellationJobSchema.parse(input);
    const jobId = remoteTaskCancellationJobId(job.requestId, job.expectedVersion);
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
    await this.#queue.add('remote-task-cancellation', job, {
      jobId,
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
  }

  async state(requestId: string, expectedVersion: number): Promise<RemoteTaskPollJobState> {
    const job = await this.#queue.getJob(remoteTaskCancellationJobId(requestId, expectedVersion));
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

export interface RemoteTaskCancellationProcessor {
  process(input: RemoteTaskCancellationJob): Promise<unknown>;
}

export interface BullMqRemoteTaskCancellationWorkerOptions extends BullMqRemoteTaskCancellationQueueOptions {
  readonly concurrency?: number;
  readonly processor: RemoteTaskCancellationProcessor;
}

export class BullMqRemoteTaskCancellationWorker {
  readonly #worker: Worker<RemoteTaskCancellationJob, void>;

  constructor(options: BullMqRemoteTaskCancellationWorkerOptions) {
    this.#worker = new Worker<RemoteTaskCancellationJob, void>(
      options.queueName ?? 'sdar-remote-mcp-task-cancellations',
      async (job: Job<RemoteTaskCancellationJob>) => {
        await options.processor.process(RemoteTaskCancellationJobSchema.parse(job.data));
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

export function remoteTaskCancellationJobId(requestId: string, expectedVersion: number): string {
  const parsed = RemoteTaskCancellationJobSchema.parse({ requestId, expectedVersion });
  return `mcp-task-cancel~${encodeURIComponent(parsed.requestId)}~v${String(parsed.expectedVersion)}`;
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
