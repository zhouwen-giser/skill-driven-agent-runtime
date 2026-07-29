import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import {
  ARTIFACT_REVALIDATION_QUEUE_NAME,
  ARTIFACT_SHADOW_QUEUE_NAME,
  type ArtifactShadowRunRecord,
  type ArtifactShadowWakeQueue,
} from '../../../application/src/index.js';
import type { RedisConnectionConfig } from '../bullmq-context-queue.js';

const ShadowWakeSchema = z.object({ shadowRunId: z.string().min(1).max(512) }).strict();
type ShadowWake = z.infer<typeof ShadowWakeSchema>;

/** Redis contains only an idempotent wake; PostgreSQL owns every run/evidence transition. */
export class BullMqArtifactShadowQueue implements ArtifactShadowWakeQueue {
  readonly #queue: Queue<ShadowWake>;

  constructor(connection: RedisConnectionConfig, queueName: string = ARTIFACT_SHADOW_QUEUE_NAME) {
    this.#queue = new Queue(queueName, {
      connection: toConnectionOptions(connection),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false },
    });
  }

  async enqueue(shadowRunId: string): Promise<void> {
    const wake = ShadowWakeSchema.parse({ shadowRunId });
    const existing = await this.#queue.getJob(wake.shadowRunId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return;
      await existing.remove();
    }
    await this.#queue.add('artifact-shadow-run', wake, {
      jobId: wake.shadowRunId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  close(): Promise<void> {
    return this.#queue.close();
  }
}

export class BullMqArtifactShadowWorker {
  readonly #worker: Worker<ShadowWake, void>;

  constructor(
    connection: RedisConnectionConfig,
    service: Readonly<{
      claim(workerId: string, limit?: number): Promise<readonly ArtifactShadowRunRecord[]>;
      process(run: ArtifactShadowRunRecord, workerId: string): Promise<void>;
    }>,
    workerId: string,
    queueName: string = ARTIFACT_SHADOW_QUEUE_NAME,
  ) {
    this.#worker = new Worker<ShadowWake, void>(
      queueName,
      async (job: Job<ShadowWake>) => {
        ShadowWakeSchema.parse(job.data);
        const claimed = await service.claim(workerId, 1);
        for (const run of claimed) await service.process(run, workerId);
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

/** Revalidation wakes are isolated from the formal runtime and contain only trigger ids. */
export class BullMqArtifactRevalidationQueue {
  readonly #queue: Queue<ShadowWake>;

  constructor(connection: RedisConnectionConfig) {
    this.#queue = new Queue(ARTIFACT_REVALIDATION_QUEUE_NAME, {
      connection: toConnectionOptions(connection),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false },
    });
  }

  async enqueue(triggerId: string): Promise<void> {
    const wake = ShadowWakeSchema.parse({ shadowRunId: triggerId });
    const existing = await this.#queue.getJob(triggerId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return;
      await existing.remove();
    }
    await this.#queue.add('artifact-revalidation-trigger', wake, {
      jobId: triggerId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  close(): Promise<void> {
    return this.#queue.close();
  }
}

/**
 * Consumes only a durable trigger id, resolves its P02 validation run through
 * PostgreSQL, then wakes the existing P05 replay queue. It never owns a run or
 * returns a synthetic wake acknowledgement.
 */
export class BullMqArtifactRevalidationWorker {
  readonly #worker: Worker<ShadowWake, void>;

  constructor(
    connection: RedisConnectionConfig,
    service: Readonly<{ process(triggerId: string): Promise<void> }>,
    queueName: string = ARTIFACT_REVALIDATION_QUEUE_NAME,
  ) {
    this.#worker = new Worker<ShadowWake, void>(
      queueName,
      async (job: Job<ShadowWake>) => {
        const wake = ShadowWakeSchema.parse(job.data);
        await service.process(wake.shadowRunId);
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
