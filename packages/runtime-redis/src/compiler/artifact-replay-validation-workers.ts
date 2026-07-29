import { Queue, Worker, type Job } from 'bullmq';
import { z } from 'zod';

import {
  ARTIFACT_REPLAY_QUEUE_NAME,
  type ReplayValidationRunRecord,
  type ReplayValidationWakeQueue,
} from '../../../application/src/index.js';
import type { RedisConnectionConfig } from '../bullmq-context-queue.js';

const ReplayValidationWakeSchema = z
  .object({ validationRunId: z.string().min(1).max(512) })
  .strict();
type ReplayValidationWake = z.infer<typeof ReplayValidationWakeSchema>;

export class BullMqReplayValidationQueue implements ReplayValidationWakeQueue {
  private readonly queue: Queue<ReplayValidationWake>;

  constructor(connection: RedisConnectionConfig, queueName: string = ARTIFACT_REPLAY_QUEUE_NAME) {
    this.queue = new Queue(queueName, {
      connection: toConnectionOptions(connection),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false },
    });
  }

  async enqueue(validationRunId: string): Promise<void> {
    const wake = ReplayValidationWakeSchema.parse({ validationRunId });
    const existing = await this.queue.getJob(wake.validationRunId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return;
      await existing.remove();
    }
    await this.queue.add('artifact-replay-validation-run', wake, {
      jobId: wake.validationRunId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}

export class BullMqReplayValidationWorker {
  private readonly worker: Worker<ReplayValidationWake, void>;

  constructor(
    connection: RedisConnectionConfig,
    service: Readonly<{
      claim(workerId: string, limit?: number): Promise<readonly ReplayValidationRunRecord[]>;
      process(run: ReplayValidationRunRecord, workerId: string): Promise<void>;
    }>,
    workerId: string,
    queueName: string = ARTIFACT_REPLAY_QUEUE_NAME,
  ) {
    this.worker = new Worker<ReplayValidationWake, void>(
      queueName,
      async (job: Job<ReplayValidationWake>) => {
        ReplayValidationWakeSchema.parse(job.data);
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
    if (!this.worker.isRunning()) void this.worker.run();
  }

  close(): Promise<void> {
    return this.worker.close();
  }
}

export { BullMqReplayValidationWorker as ArtifactReplayValidationWorker };

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
