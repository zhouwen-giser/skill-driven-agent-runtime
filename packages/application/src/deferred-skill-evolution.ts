import type { SkillFormalizationCandidate } from '../../domain/src/index.js';
import type { TemporarySkillRepository } from './ports.js';
import type { SkillEvolutionService } from './skill-evolution.js';

export class SkillEvolutionPublicationDeferredError extends Error {
  readonly code = 'SKILL_EVOLUTION_PUBLICATION_DEFERRED';

  constructor() {
    super('Evolution publication is deferred until complete candidate validation is implemented.');
    this.name = 'SkillEvolutionPublicationDeferredError';
  }
}

/** The deployed runtime has read access only; no model, tool or registry writer is reachable. */
export class DeferredSkillEvolutionService implements Pick<
  SkillEvolutionService,
  'get' | 'listCorrections' | 'evaluateAndPublish' | 'correctAndRevalidate'
> {
  constructor(
    private readonly repository: Pick<
      TemporarySkillRepository,
      'findFormalizationCandidateById' | 'listCorrectionExperiences'
    >,
  ) {}

  async get(candidateId: string): Promise<SkillFormalizationCandidate> {
    const candidate = await this.repository.findFormalizationCandidateById(candidateId);
    if (candidate === undefined) throw new Error('SKILL_FORMALIZATION_CANDIDATE_NOT_FOUND');
    return candidate;
  }

  listCorrections(candidateId: string) {
    return this.repository.listCorrectionExperiences(candidateId);
  }

  async evaluateAndPublish(candidateId: string): Promise<SkillFormalizationCandidate> {
    await this.get(candidateId);
    throw new SkillEvolutionPublicationDeferredError();
  }

  async correctAndRevalidate(
    candidateId: string,
    input: Parameters<SkillEvolutionService['correctAndRevalidate']>[1],
  ): ReturnType<SkillEvolutionService['correctAndRevalidate']> {
    void input; // Corrections are retained by callers; no validation or mutation is attempted.
    await this.get(candidateId);
    throw new SkillEvolutionPublicationDeferredError();
  }
}
