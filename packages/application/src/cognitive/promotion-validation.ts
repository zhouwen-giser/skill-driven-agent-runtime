import type { PromotionReplayReport } from '../../../domain/src/index.js';
import type { KnowledgePromotionRepository, PromotionCandidateRecord } from './promotion-ports.js';

export class DuplicateCandidateDetector {
  readonly #repository: Pick<KnowledgePromotionRepository, 'findDuplicate'>;

  constructor(repository: Pick<KnowledgePromotionRepository, 'findDuplicate'>) {
    this.#repository = repository;
  }

  find(candidate: PromotionCandidateRecord): Promise<PromotionCandidateRecord | undefined> {
    return this.#repository.findDuplicate(candidate);
  }
}

export interface PromotionReplayCase {
  readonly caseId: string;
  readonly sourceRef: string;
  readonly expectedOutcome: 'success' | 'failure';
}

export interface PromotionReplayCaseSource {
  list(candidate: PromotionCandidateRecord): Promise<readonly PromotionReplayCase[]>;
}

export interface PromotionCaseRunner {
  run(
    candidate: PromotionCandidateRecord,
    testCase: PromotionReplayCase,
  ): Promise<Readonly<{ observedOutcome: 'success' | 'failure' }>>;
}

export class ReplayEvaluationRunner {
  readonly #cases: PromotionReplayCaseSource;
  readonly #runner: PromotionCaseRunner;

  constructor(
    dependencies: Readonly<{
      cases: PromotionReplayCaseSource;
      runner: PromotionCaseRunner;
    }>,
  ) {
    this.#cases = dependencies.cases;
    this.#runner = dependencies.runner;
  }

  async run(candidate: PromotionCandidateRecord): Promise<PromotionReplayReport> {
    const cases = await this.#cases.list(candidate);
    let passedCount = 0;
    let failedCount = 0;
    for (const testCase of cases) {
      const observed = await this.#runner.run(candidate, testCase);
      if (observed.observedOutcome === testCase.expectedOutcome) passedCount += 1;
      else failedCount += 1;
    }
    return Object.freeze({
      reportRef: `promotion-replay:${candidate.kind}:${candidate.knowledgeId}:${String(candidate.revision)}`,
      passedCount,
      failedCount,
    });
  }
}
