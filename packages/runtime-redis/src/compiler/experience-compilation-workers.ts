import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import type {
  CompilationRun,
  CompilationRunType,
  CompilationWakeQueuePort,
} from '../../../application/src/compiler/experience-compilation.js';
import { SDAR_V13_ARTIFACT_QUEUES } from '../../../application/src/compiler/artifact-registry.js';
import type { RedisConnectionConfig } from '../bullmq-context-queue.js';

const CompilationWakeSchema = z.object({ runId: z.string().min(1).max(256) }).strict();
type CompilationWake = z.infer<typeof CompilationWakeSchema>;

export class BullMqCompilationQueue implements CompilationWakeQueuePort {
  readonly #queue: Queue<CompilationWake>;

  constructor(connection: RedisConnectionConfig, runType: CompilationRunType) {
    this.#queue = new Queue(queueName(runType), {
      connection: toConnectionOptions(connection),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false },
    });
  }

  async enqueue(runId: string): Promise<void> {
    const wake = CompilationWakeSchema.parse({ runId });
    const existing = await this.#queue.getJob(wake.runId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return;
      await existing.remove();
    }
    await this.#queue.add('compilation-run', wake, {
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

export class BullMqCompilationWorker {
  readonly #worker: Worker<CompilationWake, void>;

  constructor(
    connection: RedisConnectionConfig,
    runType: CompilationRunType,
    service: Readonly<{
      claim(workerId: string, limit?: number): Promise<readonly CompilationRun[]>;
      process(run: CompilationRun, workerId: string): Promise<void>;
    }>,
    workerId: string,
  ) {
    this.#worker = new Worker<CompilationWake, void>(
      queueName(runType),
      async (job: Job<CompilationWake>) => {
        CompilationWakeSchema.parse(job.data);
        const claimed = await service.claim(workerId, 10);
        for (const run of claimed) await service.process(run, workerId);
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

function queueName(
  runType: CompilationRunType,
): (typeof SDAR_V13_ARTIFACT_QUEUES)[0] | (typeof SDAR_V13_ARTIFACT_QUEUES)[1] {
  return runType === 'normalization' ? SDAR_V13_ARTIFACT_QUEUES[0] : SDAR_V13_ARTIFACT_QUEUES[1];
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
