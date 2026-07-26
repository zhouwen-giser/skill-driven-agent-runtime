import {
  createActiveKnowledgeProjection,
  type ActiveKnowledgeProjection,
} from '../../../domain/src/index.js';
import type {
  ActiveKnowledgeProjectionRepository,
  PromotionCandidateRecord,
} from './promotion-ports.js';

export class ActiveKnowledgeProjector {
  readonly #repository: ActiveKnowledgeProjectionRepository;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: ActiveKnowledgeProjectionRepository;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  create(candidate: PromotionCandidateRecord): ActiveKnowledgeProjection {
    if (candidate.status !== 'active') throw new Error('KNOWLEDGE_PROJECTION_REQUIRES_ACTIVE');
    return createActiveKnowledgeProjection({
      schemaVersion: '1.0',
      projectionId: projectionId(candidate),
      knowledgeKind: candidate.kind,
      knowledgeId: candidate.knowledgeId,
      knowledgeRevision: candidate.revision,
      authoritativeRef: `${candidate.kind}:${candidate.knowledgeId}:${String(candidate.revision)}`,
      title: candidate.title,
      summary: candidate.summary,
      risk: candidate.risk,
      status: 'active',
      projectedAt: this.#clock.now(),
    });
  }

  async project(candidate: PromotionCandidateRecord): Promise<ActiveKnowledgeProjection> {
    const projection = this.create(candidate);
    await this.#repository.upsert(projection);
    return projection;
  }

  async rebuild(candidates: readonly PromotionCandidateRecord[]): Promise<number> {
    let count = 0;
    for (const candidate of candidates) {
      if (candidate.status !== 'active') continue;
      await this.project(candidate);
      count += 1;
    }
    return count;
  }

  async reconcile(candidates: readonly PromotionCandidateRecord[]): Promise<number> {
    const active = candidates.filter((candidate) => candidate.status === 'active');
    await this.#repository.prune(
      new Set(active.map(projectionId)),
      'system.knowledge-projection-reconciler',
      'PostgreSQL no longer marks this Knowledge revision active.',
    );
    return this.rebuild(active);
  }

  remove(candidate: PromotionCandidateRecord, actorId: string, reason: string): Promise<void> {
    return this.#repository.remove(
      candidate.kind,
      candidate.knowledgeId,
      candidate.revision,
      actorId,
      reason,
    );
  }
}

function projectionId(candidate: PromotionCandidateRecord): string {
  return `knowledge-projection-${candidate.kind}-${candidate.knowledgeId}-${String(candidate.revision)}`;
}
