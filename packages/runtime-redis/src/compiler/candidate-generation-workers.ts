import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import type {
  CandidateGenerationRun,
  CandidateGenerationWakeQueue,
} from '../../../application/src/compiler/candidate-generation.js';
import { SDAR_V13_ARTIFACT_QUEUES } from '../../../application/src/compiler/artifact-registry.js';
import type { RedisConnectionConfig } from '../bullmq-context-queue.js';

const CandidateWakeSchema = z.object({ runId: z.string().min(1).max(256) }).strict();
type CandidateWake = z.infer<typeof CandidateWakeSchema>;

export const PATTERN_GENERALIZATION_QUEUE = SDAR_V13_ARTIFACT_QUEUES[2];
export const ARTIFACT_GENERATION_QUEUE = SDAR_V13_ARTIFACT_QUEUES[3];

export class BullMqCandidateGenerationQueue implements CandidateGenerationWakeQueue {
  readonly #queue: Queue<CandidateWake>;

  constructor(connection: RedisConnectionConfig, queueName: string = ARTIFACT_GENERATION_QUEUE) {
    this.#queue = new Queue(queueName, {
      connection: toConnectionOptions(connection),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false },
    });
  }

  async enqueue(runId: string): Promise<void> {
    const wake = CandidateWakeSchema.parse({ runId });
    const existing = await this.#queue.getJob(wake.runId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return;
      await existing.remove();
    }
    await this.#queue.add('candidate-generation-run', wake, {
      jobId: wake.runId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  close(): Promise<void> {
    return this.#queue.close();
  }
}

export class BullMqCandidateGenerationWorker {
  readonly #worker: Worker<CandidateWake, void>;

  constructor(
    connection: RedisConnectionConfig,
    service: Readonly<{
      claim(workerId: string, limit?: number): Promise<readonly CandidateGenerationRun[]>;
      process(run: CandidateGenerationRun, workerId: string): Promise<void>;
    }>,
    workerId: string,
    queueName: string = ARTIFACT_GENERATION_QUEUE,
  ) {
    this.#worker = new Worker<CandidateWake, void>(
      queueName,
      async (job: Job<CandidateWake>) => {
        CandidateWakeSchema.parse(job.data);
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

export { BullMqCandidateGenerationWorker as CandidateGenerationWorker };

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
