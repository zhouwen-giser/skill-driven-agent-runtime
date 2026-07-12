import { z } from 'zod';

import type {
  GoalInferenceSource,
  GoalInputInferenceRecord,
  MemorySearchHit,
} from '../../domain/src/index.js';
import type { Clock, GoalInputInferenceRepository, StructuredModelProvider } from './ports.js';
import type { MemoryService } from './memory-service.js';

const DecisionSchema = z
  .object({
    outcome: z.enum(['inferred', 'input_required']),
    decisionSummary: z.string().min(1),
    usedSourceIds: z.array(z.string().min(1)),
    inferredGoal: z
      .object({
        title: z.string().min(1),
        description: z.string().min(1),
        constraints: z.array(z.string()),
        successCriteria: z.array(z.string()),
      })
      .strict()
      .optional(),
    clarificationQuestion: z.string().min(1).optional(),
  })
  .strict();
const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'decisionSummary', 'usedSourceIds'],
  properties: {
    outcome: { enum: ['inferred', 'input_required'] },
    decisionSummary: { type: 'string', minLength: 1 },
    usedSourceIds: { type: 'array', items: { type: 'string', minLength: 1 } },
    inferredGoal: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'constraints', 'successCriteria'],
      properties: {
        title: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        constraints: { type: 'array', items: { type: 'string' } },
        successCriteria: { type: 'array', items: { type: 'string' } },
      },
    },
    clarificationQuestion: { type: 'string', minLength: 1 },
  },
} as const;

export class GoalInputInferenceService {
  readonly #repository: GoalInputInferenceRepository;
  readonly #memories: Pick<MemoryService, 'search'>;
  readonly #model: StructuredModelProvider;
  readonly #clock: Clock;
  readonly #nextId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: GoalInputInferenceRepository;
      memories: Pick<MemoryService, 'search'>;
      model: StructuredModelProvider;
      clock: Clock;
      nextId: () => string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#memories = dependencies.memories;
    this.#model = dependencies.model;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
  }

  async resolve(input: Readonly<{ taskId: string; contextId: string; requestText: string }>) {
    const context = await this.#repository.collect(input.contextId, input.taskId, 10);
    const memoryHits = await this.#memories.search(input.requestText, 10);
    const sources = [
      ...context.conversationHistory,
      ...memoryHits.map(memorySource),
      ...context.existingData,
    ];
    const decision = DecisionSchema.parse(
      await this.#model.generateStructured({
        stage: 'goal',
        instruction: JSON.stringify({
          operation: 'infer_missing_goal_input',
          requestText: input.requestText,
          evidence: sources,
          policy:
            'Infer only when evidence reliably determines the missing input; otherwise ask one explicit question.',
        }),
        responseSchema,
        correctionErrors: [],
      }),
    );
    validateShape(decision);
    const byId = new Map(sources.map((source) => [source.sourceId, source]));
    const usedSources = [...new Set(decision.usedSourceIds)].map((id) => {
      const source = byId.get(id);
      if (source === undefined)
        throw new GoalInputInferenceError(
          'GOAL_INFERENCE_SOURCE_INVALID',
          'The model selected an unavailable inference source.',
        );
      return source;
    });
    if (decision.outcome === 'inferred' && usedSources.length === 0)
      throw new GoalInputInferenceError(
        'GOAL_INFERENCE_SOURCE_REQUIRED',
        'An inferred Goal requires at least one explainable source.',
      );
    const record: GoalInputInferenceRecord = {
      inferenceId: this.#nextId(),
      taskId: input.taskId,
      contextId: input.contextId,
      outcome: decision.outcome,
      decisionSummary: decision.decisionSummary,
      usedSources,
      ...(decision.inferredGoal === undefined ? {} : { inferredGoal: decision.inferredGoal }),
      ...(decision.clarificationQuestion === undefined
        ? {}
        : { clarificationQuestion: decision.clarificationQuestion }),
      createdAt: this.#clock.now(),
    };
    await this.#repository.save(record);
    return record;
  }

  list(taskId: string) {
    return this.#repository.listByTask(taskId);
  }
}

function memorySource(hit: MemorySearchHit): GoalInferenceSource {
  return {
    sourceId: `memory:${hit.item.memoryId}`,
    kind: 'global_memory',
    summary: `${hit.item.summary} (similarity ${hit.score.toFixed(3)})`,
    content: hit.item.content,
  };
}

function validateShape(decision: z.infer<typeof DecisionSchema>) {
  if (
    decision.outcome === 'inferred' &&
    (decision.inferredGoal === undefined || decision.clarificationQuestion !== undefined)
  )
    throw new GoalInputInferenceError(
      'GOAL_INFERENCE_SHAPE_INVALID',
      'An inferred decision requires only a complete Goal.',
    );
  if (
    decision.outcome === 'input_required' &&
    (decision.clarificationQuestion === undefined || decision.inferredGoal !== undefined)
  )
    throw new GoalInputInferenceError(
      'GOAL_INFERENCE_SHAPE_INVALID',
      'An input-required decision requires only a clarification question.',
    );
}

export type GoalInputInferenceErrorCode =
  | 'GOAL_INFERENCE_SHAPE_INVALID'
  | 'GOAL_INFERENCE_SOURCE_INVALID'
  | 'GOAL_INFERENCE_SOURCE_REQUIRED';
export class GoalInputInferenceError extends Error {
  readonly code: GoalInputInferenceErrorCode;
  constructor(code: GoalInputInferenceErrorCode, message: string) {
    super(message);
    this.name = 'GoalInputInferenceError';
    this.code = code;
  }
}
