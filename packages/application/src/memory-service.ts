import { createMemoryItem, type MemoryItem } from '../../domain/src/index.js';
import type { Clock, MemoryRepository, TextEmbeddingProvider } from './ports.js';

export class MemoryService {
  readonly #repository: MemoryRepository;
  readonly #embeddings: TextEmbeddingProvider;
  readonly #clock: Clock;
  readonly #nextId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: MemoryRepository;
      embeddings: TextEmbeddingProvider;
      clock: Clock;
      nextId: () => string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#embeddings = dependencies.embeddings;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
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
  | 'MEMORY_EMBEDDING_INVALID'
  | 'MEMORY_LIMIT_INVALID'
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_QUERY_REQUIRED';
export class MemoryApplicationError extends Error {
  readonly code: MemoryApplicationErrorCode;
  constructor(code: MemoryApplicationErrorCode, message: string) {
    super(message);
    this.name = 'MemoryApplicationError';
    this.code = code;
  }
}
