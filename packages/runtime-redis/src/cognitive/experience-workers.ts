import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import type { ExperienceJobQueuePort } from '../../../application/src/cognitive/ports.js';
import type { ExperienceJobService } from '../../../application/src/cognitive/experience-job-service.js';
import { COGNITIVE_QUEUE_NAMES } from '../../../domain/src/index.js';
import type { RedisConnectionConfig } from '../bullmq-context-queue.js';

const ExperienceWakeSchema = z.object({ jobId: z.string().min(1).max(128) }).strict();
type ExperienceWake = z.infer<typeof ExperienceWakeSchema>;

export class BullMqExperienceQueue implements ExperienceJobQueuePort {
  readonly #queue: Queue<ExperienceWake>;

  constructor(connection: RedisConnectionConfig) {
    this.#queue = new Queue(COGNITIVE_QUEUE_NAMES.episodeBuild, {
      connection: toConnectionOptions(connection),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false },
    });
  }

  async enqueue(jobId: string): Promise<void> {
    const wake = ExperienceWakeSchema.parse({ jobId });
    const existing = await this.#queue.getJob(wake.jobId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return;
      await existing.remove();
    }
    await this.#queue.add('experience-job', wake, {
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

export class BullMqExperienceWorker {
  readonly #worker: Worker<ExperienceWake, void>;

  constructor(
    connection: RedisConnectionConfig,
    service: Pick<ExperienceJobService, 'claim' | 'process'>,
    workerId: string,
  ) {
    this.#worker = new Worker<ExperienceWake, void>(
      COGNITIVE_QUEUE_NAMES.episodeBuild,
      async (job: Job<ExperienceWake>) => {
        ExperienceWakeSchema.parse(job.data);
        const claimed = await service.claim(workerId, 10);
        for (const item of claimed) await service.process(item, workerId);
      },
      {
        connection: toConnectionOptions(connection),
        concurrency: 4,
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
