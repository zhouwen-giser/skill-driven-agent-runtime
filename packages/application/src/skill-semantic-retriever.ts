import type { SkillVersion } from '../../domain/src/index.js';

import type {
  Clock,
  SkillEmbeddingRepository,
  SkillSemanticRetriever,
  TextEmbeddingProvider,
} from './ports.js';

export class PersistedSkillSemanticRetriever implements SkillSemanticRetriever {
  readonly #embeddings: TextEmbeddingProvider;
  readonly #repository: SkillEmbeddingRepository;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      embeddings: TextEmbeddingProvider;
      repository: SkillEmbeddingRepository;
      clock: Clock;
    }>,
  ) {
    this.#embeddings = dependencies.embeddings;
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  async score(
    goalDescription: string,
    skills: readonly SkillVersion[],
  ): Promise<Readonly<Record<string, number>>> {
    const query = await this.#embeddings.embed(goalDescription);
    assertEmbedding(query.providerId, query.vector);
    for (const skill of skills) {
      const searchableText = [
        skill.name,
        skill.summary,
        skill.description,
        ...skill.capabilities,
        skill.workflowGuidance,
        skill.outputInstruction,
      ].join('\n');
      const embedded = await this.#embeddings.embed(searchableText);
      assertEmbedding(embedded.providerId, embedded.vector);
      if (
        embedded.providerId !== query.providerId ||
        embedded.vector.length !== query.vector.length
      ) {
        throw new SkillSemanticRetrievalError(
          'SKILL_EMBEDDING_INCONSISTENT',
          'Embedding provider and dimensions must remain fixed during one retrieval.',
        );
      }
      await this.#repository.upsert({
        skillId: skill.skillId,
        skillVersion: skill.version,
        providerId: embedded.providerId,
        searchableText,
        vector: embedded.vector,
        updatedAt: this.#clock.now(),
      });
    }
    return this.#repository.cosineScores({
      skillIds: skills.map((skill) => skill.skillId),
      providerId: query.providerId,
      vector: query.vector,
    });
  }
}

function assertEmbedding(providerId: string, vector: readonly number[]): void {
  if (
    providerId.trim() === '' ||
    vector.length === 0 ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new SkillSemanticRetrievalError(
      'SKILL_EMBEDDING_INVALID',
      'Embedding provider ID and finite non-empty vector are required.',
    );
  }
}

export type SkillSemanticRetrievalErrorCode =
  'SKILL_EMBEDDING_INCONSISTENT' | 'SKILL_EMBEDDING_INVALID';

export class SkillSemanticRetrievalError extends Error {
  readonly code: SkillSemanticRetrievalErrorCode;
  constructor(code: SkillSemanticRetrievalErrorCode, message: string) {
    super(message);
    this.name = 'SkillSemanticRetrievalError';
    this.code = code;
  }
}
