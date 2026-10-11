import type {
  SkillEvolutionCorrectionExperience,
  SkillFormalizationCandidate,
} from '../../domain/src/index.js';

/** Owns candidate/base CAS and the Skill version, current pointer, receipt and catalog outbox transaction. */
export interface SkillEvolutionCommitPort {
  commit(
    input: Readonly<{
      expectedCandidateHash: string;
      candidate: SkillFormalizationCandidate;
      correction?: SkillEvolutionCorrectionExperience;
    }>,
  ): Promise<SkillFormalizationCandidate>;
}
