import {
  createMemoryItem,
  type MemoryItem,
  type MemoryRetrievalStage,
  type MemoryStatusTransition,
  type MemoryType,
  type ProcessedResultRecord,
} from '../../domain/src/index.js';
import { z } from 'zod';
import type {
  Clock,
  MemoryRepository,
  StructuredModelProvider,
  TextEmbeddingProvider,
} from './ports.js';

const RefinedMemorySchema = z
  .object({
    type: z.enum([
      'fact',
      'success_experience',
      'failure_experience',
      'workflow_pattern',
      'skill_learning',
      'prompt_learning',
    ]),
    content: z.record(z.string(), z.unknown()),
    summary: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const refinedMemoryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'content', 'summary', 'confidence'],
  properties: {
    type: {
      enum: [
        'fact',
        'success_experience',
        'failure_experience',
        'workflow_pattern',
        'skill_learning',
        'prompt_learning',
      ],
    },
    content: { type: 'object' },
    summary: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

export class MemoryService {
  readonly #repository: MemoryRepository;
  readonly #embeddings: TextEmbeddingProvider;
  readonly #clock: Clock;
  readonly #nextId: () => string;
  readonly #model: StructuredModelProvider | undefined;
  readonly #nextTransitionId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: MemoryRepository;
      embeddings: TextEmbeddingProvider;
      clock: Clock;
      nextId: () => string;
      model?: StructuredModelProvider;
      nextTransitionId?: () => string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#embeddings = dependencies.embeddings;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
    this.#model = dependencies.model;
    this.#nextTransitionId =
      dependencies.nextTransitionId ?? (() => `${this.#nextId()}-transition`);
  }

  async create(
    input: Omit<MemoryItem, 'createdAt' | 'memoryId' | 'status' | 'supersedes'> &
      Partial<Pick<MemoryItem, 'memoryId' | 'supersedes'>>,
  ): Promise<MemoryItem> {
    const item = createMemoryItem({
      memoryId: input.memoryId ?? this.#nextId(),
      type: input.type,
      content: input.content,
      summary: input.summary,
      status: 'active',
      sourceRefs: input.sourceRefs,
      supersedes: input.supersedes ?? [],
      confidence: input.confidence,
      createdAt: this.#clock.now(),
    });
    const embedding = await this.#embeddings.embed(searchableText(item));
    validateEmbedding(embedding);
    await this.#repository.save(item, embedding);
    return item;
  }

  async get(memoryId: string): Promise<MemoryItem> {
    const item = await this.#repository.find(memoryId);
    if (item === undefined)
      throw new MemoryApplicationError('MEMORY_NOT_FOUND', 'Memory not found.');
    return item;
  }

  async search(query: string, limit = 10) {
    if (query.trim() === '')
      throw new MemoryApplicationError('MEMORY_QUERY_REQUIRED', 'Query is required.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new MemoryApplicationError('MEMORY_LIMIT_INVALID', 'Limit must be between 1 and 100.');
    const embedding = await this.#embeddings.embed(query);
    validateEmbedding(embedding);
    return this.#repository.search({ ...embedding, limit });
  }

  async searchForStage(stage: MemoryRetrievalStage, subject: string, limit = 5) {
    if (subject.trim() === '')
      throw new MemoryApplicationError('MEMORY_QUERY_REQUIRED', 'Stage subject is required.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new MemoryApplicationError(
        'MEMORY_LIMIT_INVALID',
        'Stage memory limit must be between 1 and 20.',
      );
    const policy = stagePolicy(stage);
    const embedding = await this.#embeddings.embed(policy.queryTemplate(subject.trim()));
    validateEmbedding(embedding);
    return (await this.#repository.search({ ...embedding, limit: 100 }))
      .filter((hit) => policy.types.includes(hit.item.type))
      .slice(0, limit);
  }

  async admitProcessedResult(result: ProcessedResultRecord) {
    const admitted: MemoryItem[] = [];
    const duplicateMemoryIds: string[] = [];
    if (!result.valuable) return { admitted, duplicateMemoryIds };
    for (const candidate of result.memoryCandidates) {
      const summary = normalizeCandidate(candidate.content);
      const type = candidateType(candidate.kind, result.normalized.errors.length > 0);
      const duplicate = await this.#findDuplicate(type, summary);
      if (duplicate !== undefined) {
        duplicateMemoryIds.push(duplicate.memoryId);
        continue;
      }
      admitted.push(
        await this.create({
          type,
          summary,
          content: { kind: candidate.kind, statement: summary },
          sourceRefs: [`task:${result.taskId}`, `processed-result:${result.resultId}`],
          confidence: candidate.confidence,
        }),
      );
    }
    return { admitted, duplicateMemoryIds };
  }

  async refine(
    input: Readonly<{
      memoryId?: string;
      type: MemoryType;
      content: Readonly<Record<string, unknown>>;
      summary: string;
      sourceRefs: readonly string[];
      confidence: number;
      supersedes?: readonly string[];
    }>,
  ): Promise<MemoryItem> {
    const refined = await this.#refineData(input);
    const duplicate = await this.#findDuplicate(refined.type, normalizeCandidate(refined.summary));
    if (duplicate !== undefined) return duplicate;
    return this.create({
      ...refined,
      sourceRefs: input.sourceRefs,
      ...(input.memoryId === undefined ? {} : { memoryId: input.memoryId }),
      ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
    });
  }

  async supersede(
    memoryId: string,
    input: Readonly<{
      memoryId?: string;
      type: MemoryType;
      content: Readonly<Record<string, unknown>>;
      summary: string;
      sourceRefs: readonly string[];
      confidence: number;
      actor: string;
      reason: string;
    }>,
  ): Promise<MemoryItem> {
    const current = await this.get(memoryId);
    if (current.status !== 'active')
      throw new MemoryApplicationError(
        'MEMORY_STATUS_CONFLICT',
        'Only active Memory may be superseded.',
      );
    const refined = await this.#refineData(input);
    const replacement = createMemoryItem({
      ...refined,
      memoryId: input.memoryId ?? this.#nextId(),
      status: 'active',
      sourceRefs: input.sourceRefs,
      supersedes: [memoryId],
      createdAt: this.#clock.now(),
    });
    const embedding = await this.#embeddings.embed(searchableText(replacement));
    validateEmbedding(embedding);
    const transition: MemoryStatusTransition = {
      transitionId: this.#nextTransitionId(),
      memoryId,
      fromStatus: 'active',
      toStatus: 'superseded',
      replacementMemoryId: replacement.memoryId,
      actor: requiredText(input.actor, 'MEMORY_ACTOR_REQUIRED'),
      reason: requiredText(input.reason, 'MEMORY_REASON_REQUIRED'),
      createdAt: this.#clock.now(),
    };
    await this.#repository.saveAndSupersede(replacement, embedding, [transition]);
    return replacement;
  }

  async invalidate(memoryId: string, actor: string, reason: string): Promise<void> {
    const current = await this.get(memoryId);
    if (current.status === 'invalid')
      throw new MemoryApplicationError('MEMORY_STATUS_CONFLICT', 'Memory is already invalid.');
    await this.#repository.invalidate({
      transitionId: this.#nextTransitionId(),
      memoryId,
      fromStatus: current.status,
      toStatus: 'invalid',
      actor: requiredText(actor, 'MEMORY_ACTOR_REQUIRED'),
      reason: requiredText(reason, 'MEMORY_REASON_REQUIRED'),
      createdAt: this.#clock.now(),
    });
  }

  listTransitions(memoryId: string) {
    return this.#repository.listTransitions(memoryId);
  }

  async #refineData(
    input: Readonly<{
      type: MemoryType;
      content: Readonly<Record<string, unknown>>;
      summary: string;
      confidence: number;
    }>,
  ) {
    if (this.#model === undefined)
      throw new MemoryApplicationError(
        'MEMORY_REFINEMENT_UNAVAILABLE',
        'Memory refinement model is unavailable.',
      );
    return RefinedMemorySchema.parse(
      await this.#model.generateStructured({
        stage: 'result_processing',
        instruction: JSON.stringify({
          operation: 'refine_memory',
          candidate: {
            type: input.type,
            content: input.content,
            summary: input.summary,
            confidence: input.confidence,
          },
          instruction:
            'Extract, deduplicate in wording, and return only structured durable knowledge. Do not copy raw task traces.',
        }),
        responseSchema: refinedMemoryResponseSchema,
        correctionErrors: [],
      }),
    );
  }

  async #findDuplicate(type: MemoryType, summary: string): Promise<MemoryItem | undefined> {
    const embedding = await this.#embeddings.embed(`${type}\n${summary}`);
    validateEmbedding(embedding);
    return (await this.#repository.search({ ...embedding, limit: 20 })).find(
      (hit) => hit.item.type === type && normalizeCandidate(hit.item.summary) === summary,
    )?.item;
  }
}

function normalizeCandidate(value: string): string {
  return value.trim().replaceAll(/\s+/g, ' ');
}

function requiredText(
  value: string,
  code: 'MEMORY_ACTOR_REQUIRED' | 'MEMORY_REASON_REQUIRED',
): string {
  const normalized = value.trim();
  if (normalized === '')
    throw new MemoryApplicationError(code, 'A non-empty audit value is required.');
  return normalized;
}

function candidateType(
  kind: ProcessedResultRecord['memoryCandidates'][number]['kind'],
  errorBearing: boolean,
): MemoryType {
  if (kind === 'fact' || kind === 'preference') return 'fact';
  if (kind === 'procedure') return 'workflow_pattern';
  return errorBearing ? 'failure_experience' : 'success_experience';
}

function stagePolicy(stage: MemoryRetrievalStage): Readonly<{
  types: readonly MemoryType[];
  queryTemplate(subject: string): string;
}> {
  switch (stage) {
    case 'intent':
      return {
        types: ['fact', 'success_experience', 'failure_experience'],
        queryTemplate: (subject) => `Intent recognition evidence for request: ${subject}`,
      };
    case 'skill_selection':
      return {
        types: ['skill_learning', 'success_experience', 'failure_experience'],
        queryTemplate: (subject) => `Skill selection outcomes and lessons for Goal: ${subject}`,
      };
    case 'workflow_generation':
      return {
        types: ['workflow_pattern', 'success_experience', 'failure_experience'],
        queryTemplate: (subject) => `Workflow planning patterns and outcomes for Goal: ${subject}`,
      };
    case 'exception_handling':
      return {
        types: ['failure_experience', 'skill_learning', 'workflow_pattern'],
        queryTemplate: (subject) => `Exception recovery evidence for failure: ${subject}`,
      };
    case 'goal_evaluation':
      return {
        types: ['fact', 'success_experience', 'failure_experience'],
        queryTemplate: (subject) => `Goal evaluation evidence and prior outcomes for: ${subject}`,
      };
  }
}

function searchableText(item: MemoryItem): string {
  return `${item.type}\n${item.summary}\n${JSON.stringify(item.content)}`;
}

function validateEmbedding(value: Readonly<{ providerId: string; vector: readonly number[] }>) {
  if (
    value.providerId.trim() === '' ||
    value.vector.length !== 3 ||
    value.vector.some((x) => !Number.isFinite(x))
  )
    throw new MemoryApplicationError(
      'MEMORY_EMBEDDING_INVALID',
      'Memory embedding requires a provider ID and three finite dimensions.',
    );
}

export type MemoryApplicationErrorCode =
  | 'MEMORY_ACTOR_REQUIRED'
  | 'MEMORY_EMBEDDING_INVALID'
  | 'MEMORY_LIMIT_INVALID'
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_QUERY_REQUIRED'
  | 'MEMORY_REFINEMENT_UNAVAILABLE'
  | 'MEMORY_REASON_REQUIRED'
  | 'MEMORY_STATUS_CONFLICT';
export class MemoryApplicationError extends Error {
  readonly code: MemoryApplicationErrorCode;
  constructor(code: MemoryApplicationErrorCode, message: string) {
    super(message);
    this.name = 'MemoryApplicationError';
    this.code = code;
  }
}
