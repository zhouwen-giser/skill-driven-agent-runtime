import type { ContextTaskQueue } from '../../application/src/index.js';
import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import { ContextSerialExecutor } from './context-serial-executor.js';

const ContextTaskJobSchema = z.object({
  taskId: z.string().min(1),
  contextId: z.string().min(1),
  attemptId: z.string().min(1),
  mode: z.enum(['initial', 'continue_after_input']),
});
export type ContextTaskJob = z.infer<typeof ContextTaskJobSchema>;
export const DEFAULT_CONTEXT_WORKER_CONCURRENCY = 10;

export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly password?: string;
  readonly db?: number;
}

export interface BullMqContextQueueOptions {
  readonly connection: RedisConnectionConfig;
  readonly queueName?: string;
}

export class BullMqContextTaskQueue implements ContextTaskQueue {
  readonly #queue: Queue<ContextTaskJob>;

  constructor(options: BullMqContextQueueOptions) {
    this.#queue = new Queue(options.queueName ?? 'sdar-context-tasks', {
      connection: toConnectionOptions(options.connection),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }

  async enqueue(input: ContextTaskJob): Promise<void> {
    const job = ContextTaskJobSchema.parse(input);
    await this.#queue.add('task', job, {
      jobId: contextTaskJobId(job.taskId, job.attemptId),
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
  }

  async close(): Promise<void> {
    await this.#queue.close();
  }
}

/** BullMQ rejects ':' in custom IDs, so encode both composite identity segments explicitly. */
export function contextTaskJobId(taskId: string, attemptId: string): string {
  return `${encodeURIComponent(taskId)}~${encodeURIComponent(attemptId)}`;
}

export interface ContextTaskProcessor {
  process(input: ContextTaskJob): Promise<void>;
}

export interface BullMqContextWorkerOptions extends BullMqContextQueueOptions {
  readonly concurrency?: number;
  readonly processor: ContextTaskProcessor;
}

export class BullMqContextWorker {
  readonly #worker: Worker<ContextTaskJob, void>;
  readonly #serializer = new ContextSerialExecutor();

  constructor(options: BullMqContextWorkerOptions) {
    this.#worker = new Worker<ContextTaskJob, void>(
      options.queueName ?? 'sdar-context-tasks',
      async (job: Job<ContextTaskJob>) => {
        const input = ContextTaskJobSchema.parse(job.data);
        await this.#serializer.run(input.contextId, () => options.processor.process(input));
      },
      {
        connection: toConnectionOptions(options.connection),
        concurrency: options.concurrency ?? DEFAULT_CONTEXT_WORKER_CONCURRENCY,
        maxStalledCount: 0,
        autorun: false,
      },
    );
  }

  start(): void {
    if (!this.#worker.isRunning()) void this.#worker.run();
  }

  async close(): Promise<void> {
    await this.#worker.close();
  }
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
