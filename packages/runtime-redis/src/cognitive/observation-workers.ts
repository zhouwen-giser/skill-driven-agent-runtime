import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import type { ExperienceObserverService } from '../../../application/src/cognitive/experience-observer-service.js';
import type { ExperienceJobQueuePort } from '../../../application/src/cognitive/ports.js';
import { COGNITIVE_QUEUE_NAMES } from '../../../domain/src/index.js';
import type { RedisConnectionConfig } from '../bullmq-context-queue.js';

const ObservationWakeSchema = z.object({ jobId: z.string().min(1).max(128) }).strict();
type ObservationWake = z.infer<typeof ObservationWakeSchema>;

export class BullMqObservationQueue implements ExperienceJobQueuePort {
  readonly #queue: Queue<ObservationWake>;

  constructor(connection: RedisConnectionConfig) {
    this.#queue = new Queue(COGNITIVE_QUEUE_NAMES.observe, {
      connection: toConnectionOptions(connection),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false },
    });
  }

  async enqueue(jobId: string): Promise<void> {
    const wake = ObservationWakeSchema.parse({ jobId });
    const existing = await this.#queue.getJob(wake.jobId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return;
      await existing.remove();
    }
    await this.#queue.add('observation-job', wake, {
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

export class BullMqObservationWorker {
  readonly #worker: Worker<ObservationWake, void>;

  constructor(
    connection: RedisConnectionConfig,
    service: Pick<ExperienceObserverService, 'claim' | 'observe'>,
    workerId: string,
  ) {
    this.#worker = new Worker<ObservationWake, void>(
      COGNITIVE_QUEUE_NAMES.observe,
      async (job: Job<ObservationWake>) => {
        ObservationWakeSchema.parse(job.data);
        const claimed = await service.claim(workerId, 4);
        for (const item of claimed) await service.observe(item, workerId);
      },
      {
        connection: toConnectionOptions(connection),
        concurrency: 2,
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
