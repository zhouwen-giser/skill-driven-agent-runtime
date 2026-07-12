import { z } from 'zod';

import { normalizeResultEnvelope, type ProcessedResultRecord } from '../../domain/src/index.js';

import type { Clock, ProcessedResultRepository, StructuredModelProvider } from './ports.js';
import type { ResultProcessor } from './result-processor.js';
import type { MemoryService } from './memory-service.js';

const ResultDecisionSchema = z
  .object({
    text: z.string().min(1),
    structured: z.unknown(),
    keyFacts: z.array(
      z
        .object({
          name: z.string().min(1),
          value: z.unknown(),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
    ),
    valueAssessment: z.object({ valuable: z.boolean(), summary: z.string().min(1) }).strict(),
    memoryCandidates: z.array(
      z
        .object({
          kind: z.enum(['fact', 'preference', 'procedure', 'outcome']),
          content: z.string().min(1),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
    ),
  })
  .strict();

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'structured', 'keyFacts', 'valueAssessment', 'memoryCandidates'],
  properties: {
    text: { type: 'string', minLength: 1 },
    structured: {},
    keyFacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value', 'confidence'],
        properties: {
          name: { type: 'string', minLength: 1 },
          value: {},
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    valueAssessment: {
      type: 'object',
      additionalProperties: false,
      required: ['valuable', 'summary'],
      properties: {
        valuable: { type: 'boolean' },
        summary: { type: 'string', minLength: 1 },
      },
    },
    memoryCandidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'content', 'confidence'],
        properties: {
          kind: { enum: ['fact', 'preference', 'procedure', 'outcome'] },
          content: { type: 'string', minLength: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

export class ResultProcessingService {
  readonly #model: StructuredModelProvider;
  readonly #processor: ResultProcessor;
  readonly #repository: ProcessedResultRepository;
  readonly #clock: Clock;
  readonly #nextId: () => string;
  readonly #maxContextCharacters: number;
  readonly #memories: Pick<MemoryService, 'admitProcessedResult'> | undefined;

  constructor(
    dependencies: Readonly<{
      model: StructuredModelProvider;
      processor: ResultProcessor;
      repository: ProcessedResultRepository;
      clock: Clock;
      nextId: () => string;
      maxContextCharacters?: number;
      memories?: Pick<MemoryService, 'admitProcessedResult'>;
    }>,
  ) {
    this.#model = dependencies.model;
    this.#processor = dependencies.processor;
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
    this.#maxContextCharacters = dependencies.maxContextCharacters ?? 16_000;
    this.#memories = dependencies.memories;
  }

  async process(
    input: Readonly<{
      taskId: string;
      skillId: string;
      skillVersion: number;
      outputInstruction: string;
      outputSchema: unknown;
      rawResult: unknown;
      errors?: readonly Readonly<{ code: string; message: string }>[];
    }>,
  ): Promise<ProcessedResultRecord> {
    const normalized = normalizeResultEnvelope(
      input.rawResult,
      input.errors ?? [],
      this.#maxContextCharacters,
    );
    const decision = ResultDecisionSchema.parse(
      await this.#model.generateStructured({
        stage: 'result_processing',
        instruction: JSON.stringify({
          operation: 'process_workflow_result',
          skill: {
            skillId: input.skillId,
            skillVersion: input.skillVersion,
            outputInstruction: input.outputInstruction,
            outputSchema: input.outputSchema,
          },
          normalized,
        }),
        responseSchema,
        correctionErrors: [],
      }),
    );
    const output = this.#processor.process({
      text: decision.text,
      structured: decision.structured,
      outputSchema: input.outputSchema,
    });
    const record: ProcessedResultRecord = {
      resultId: this.#nextId(),
      taskId: input.taskId,
      skillId: input.skillId,
      skillVersion: input.skillVersion,
      normalized,
      output,
      facts: decision.keyFacts,
      valuable: decision.valueAssessment.valuable,
      valueSummary: decision.valueAssessment.summary,
      memoryCandidates: decision.memoryCandidates,
      createdAt: this.#clock.now(),
    };
    await this.#repository.save(record);
    await this.#memories?.admitProcessedResult(record);
    return record;
  }

  async get(resultId: string): Promise<ProcessedResultRecord> {
    const record = await this.#repository.find(resultId);
    if (record === undefined) throw new Error('PROCESSED_RESULT_NOT_FOUND');
    return record;
  }

  list(taskId: string): Promise<readonly ProcessedResultRecord[]> {
    return this.#repository.listByTask(taskId);
  }
}
