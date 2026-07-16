import type {
  RemoteTaskDeadLetter,
  RemoteTaskPollJob,
  RemoteTaskPollJobState,
  RemoteTaskPollQueue,
} from '../../application/src/index.js';
import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import type { RedisConnectionConfig } from './bullmq-context-queue.js';

const RemoteTaskPollJobSchema = z
  .object({
    bindingId: z.string().min(1).max(256),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export interface BullMqRemoteTaskPollQueueOptions {
  readonly connection: RedisConnectionConfig;
  readonly queueName?: string;
  readonly nowMilliseconds?: () => number;
}

export class BullMqRemoteTaskPollQueue implements RemoteTaskPollQueue {
  readonly #queue: Queue<RemoteTaskPollJob>;
  readonly #nowMilliseconds: () => number;

  constructor(options: BullMqRemoteTaskPollQueueOptions) {
    this.#queue = new Queue(options.queueName ?? 'sdar-remote-mcp-task-polls', {
      connection: toConnectionOptions(options.connection),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
    this.#nowMilliseconds = options.nowMilliseconds ?? Date.now;
  }

  async enqueue(input: RemoteTaskPollJob, runAt: string): Promise<void> {
    const job = RemoteTaskPollJobSchema.parse(input);
    const runAtMilliseconds = Date.parse(runAt);
    if (!Number.isFinite(runAtMilliseconds)) throw new Error('REMOTE_TASK_POLL_RUN_AT_INVALID');
    const jobId = remoteTaskPollJobId(job.bindingId, job.expectedVersion);
    const existing = await this.#queue.getJob(jobId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'active' ||
        state === 'waiting-children' ||
        state === 'prioritized' ||
        state === 'failed'
      ) {
        return;
      }
      await existing.remove();
    }
    await this.#queue.add('remote-task-poll', job, {
      jobId,
      attempts: 1,
      delay: Math.max(0, runAtMilliseconds - this.#nowMilliseconds()),
      removeOnComplete: false,
      removeOnFail: false,
    });
  }

  async state(bindingId: string, expectedVersion: number): Promise<RemoteTaskPollJobState> {
    const job = await this.#queue.getJob(remoteTaskPollJobId(bindingId, expectedVersion));
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
    ) {
      return 'scheduled';
    }
    return 'missing';
  }

  async listDeadLetters(limit: number): Promise<readonly RemoteTaskDeadLetter[]> {
    const safeLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    const jobs = await this.#queue.getJobs(['failed'], 0, safeLimit - 1, true);
    return jobs.map((job) => {
      const data = RemoteTaskPollJobSchema.parse(job.data);
      return {
        jobId: String(job.id),
        bindingId: data.bindingId,
        expectedVersion: data.expectedVersion,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
      };
    });
  }

  async retryDeadLetter(jobId: string): Promise<void> {
    const job = await this.#queue.getJob(jobId);
    if (job === undefined || (await job.getState()) !== 'failed') {
      throw new Error('REMOTE_TASK_DEAD_LETTER_NOT_FOUND');
    }
    const data = RemoteTaskPollJobSchema.parse(job.data);
    await job.remove();
    await this.enqueue(data, new Date(this.#nowMilliseconds()).toISOString());
  }

  async close(): Promise<void> {
    await this.#queue.close();
  }
}

export interface RemoteTaskPollProcessor {
  process(input: RemoteTaskPollJob): Promise<unknown>;
}

export interface BullMqRemoteTaskPollWorkerOptions extends BullMqRemoteTaskPollQueueOptions {
  readonly concurrency?: number;
  readonly processor: RemoteTaskPollProcessor;
}

export class BullMqRemoteTaskPollWorker {
  readonly #worker: Worker<RemoteTaskPollJob, void>;

  constructor(options: BullMqRemoteTaskPollWorkerOptions) {
    this.#worker = new Worker<RemoteTaskPollJob, void>(
      options.queueName ?? 'sdar-remote-mcp-task-polls',
      async (job: Job<RemoteTaskPollJob>) => {
        await options.processor.process(RemoteTaskPollJobSchema.parse(job.data));
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

export function remoteTaskPollJobId(bindingId: string, expectedVersion: number): string {
  const parsed = RemoteTaskPollJobSchema.parse({ bindingId, expectedVersion });
  return `mcp-task-poll~${encodeURIComponent(parsed.bindingId)}~v${String(parsed.expectedVersion)}`;
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
