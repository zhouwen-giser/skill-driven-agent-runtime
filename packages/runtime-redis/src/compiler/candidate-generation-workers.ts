import { Worker } from 'bullmq';

import { CANDIDATE_GENERATOR_VERSION } from '../../../domain/src/index.js';

export interface CandidateGenerationWorkerOptions {
  readonly queueName: string;
  readonly concurrency?: number;
  readonly onWake?: (jobId: string, sourcePatternRef: string) => Promise<void>;
}

export class CandidateGenerationWorker {
  readonly #worker: Worker;
  readonly #queueName: string;

  constructor(
    connection: { host: string; port: number },
    options: CandidateGenerationWorkerOptions,
  ) {
    this.#queueName = options.queueName;
    const concurrency = options.concurrency ?? 1;
    const onWake = options.onWake;

    this.#worker = new Worker(
      options.queueName,
      async (job) => {
        const sourcePatternRef =
          (job.data as { sourcePatternRef?: string } | undefined)?.sourcePatternRef ?? '';
        if (onWake !== undefined) {
          await onWake(job.id ?? 'unknown', sourcePatternRef);
        }
        return {
          woken: true,
          jobId: job.id,
          sourcePatternRef,
          generatorVersion: CANDIDATE_GENERATOR_VERSION,
        };
      },
      {
        connection,
        concurrency,
      },
    );
  }

  get queueName(): string {
    return this.#queueName;
  }

  async close(): Promise<void> {
    await this.#worker.close();
  }
}

export const PATTERN_GENERALIZATION_QUEUE = 'sdar-compiler-pattern-generalization';
export const ARTIFACT_GENERATION_QUEUE = 'sdar-compiler-artifact-generation';
