import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import type { ExperienceReflectorService } from '../../../application/src/cognitive/experience-reflector-service.js';
import type { ExperienceJobQueuePort } from '../../../application/src/cognitive/ports.js';
import { COGNITIVE_QUEUE_NAMES } from '../../../domain/src/index.js';
import type { RedisConnectionConfig } from '../bullmq-context-queue.js';

const ReflectionWakeSchema = z.object({ jobId: z.string().min(1).max(128) }).strict();
type ReflectionWake = z.infer<typeof ReflectionWakeSchema>;

export class BullMqReflectionQueue implements ExperienceJobQueuePort {
  readonly #queue: Queue<ReflectionWake>;

  constructor(connection: RedisConnectionConfig) {
    this.#queue = new Queue(COGNITIVE_QUEUE_NAMES.reflect, {
      connection: toConnectionOptions(connection),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false },
    });
  }

  async enqueue(jobId: string): Promise<void> {
    const wake = ReflectionWakeSchema.parse({ jobId });
    const existing = await this.#queue.getJob(wake.jobId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return;
      await existing.remove();
    }
    await this.#queue.add('reflection-job', wake, {
      jobId: wake.jobId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  close(): Promise<void> {
    return this.#queue.close();
  }
}

export class BullMqReflectionWorker {
  readonly #worker: Worker<ReflectionWake, void>;

  constructor(
    connection: RedisConnectionConfig,
    service: Pick<ExperienceReflectorService, 'claim' | 'reflect'>,
    workerId: string,
  ) {
    this.#worker = new Worker<ReflectionWake, void>(
      COGNITIVE_QUEUE_NAMES.reflect,
      async (job: Job<ReflectionWake>) => {
        ReflectionWakeSchema.parse(job.data);
        const claimed = await service.claim(workerId, 2);
        for (const item of claimed) await service.reflect(item, workerId);
      },
      {
        connection: toConnectionOptions(connection),
        concurrency: 1,
        maxStalledCount: 0,
        autorun: false,
      },
    );
  }

  start(): void {
    if (!this.#worker.isRunning()) void this.#worker.run();
  }

  close(): Promise<void> {
    return this.#worker.close();
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
