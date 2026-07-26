import type {
  CognitiveInjectionMode,
  ExperienceUsageRecord,
  Goal,
  PlanningKnowledgeBundle,
} from '../../../domain/src/index.js';
import type {
  PlanningKnowledgeRetriever,
  PlanningKnowledgeRetrievalInput,
} from './planning-knowledge-retriever.js';

export interface PlanningExperienceContext {
  readonly bundle: PlanningKnowledgeBundle;
  readonly usageRecords: readonly ExperienceUsageRecord[];
}

export class PlanningExperienceContextBuilder {
  readonly #retriever: Pick<PlanningKnowledgeRetriever, 'prepare'>;
  readonly #catalogs: Readonly<{ getCatalogHash(): Promise<string> }> | undefined;

  constructor(
    retriever: Pick<PlanningKnowledgeRetriever, 'prepare'>,
    catalogs?: Readonly<{ getCatalogHash(): Promise<string> }>,
  ) {
    this.#retriever = retriever;
    this.#catalogs = catalogs;
  }

  async build(
    input: Readonly<{
      taskId: string;
      userId: string;
      planningSessionId: string;
      planCandidateId: string;
      catalogHash?: string;
      promotionPolicyVersion: string;
      mode: CognitiveInjectionMode;
      goal: Goal;
    }>,
  ): Promise<PlanningExperienceContext> {
    const catalogHash = input.catalogHash ?? (await this.#catalogHash());
    const retrieval: PlanningKnowledgeRetrievalInput = {
      query: [
        input.goal.title,
        input.goal.description,
        ...input.goal.constraints,
        ...input.goal.successCriteria,
      ].join('\n'),
      applicabilityTerms: [
        input.goal.title,
        ...input.goal.constraints,
        ...input.goal.successCriteria,
      ],
      scope: { taskId: input.taskId, userId: input.userId },
      catalogHash,
      promotionPolicyVersion: input.promotionPolicyVersion,
      planningSessionId: input.planningSessionId,
      planCandidateId: input.planCandidateId,
      injectionMode: input.mode,
    };
    return this.#retriever.prepare(retrieval);
  }

  async #catalogHash(): Promise<string> {
    const value = await this.#catalogs?.getCatalogHash();
    if (value === undefined) throw new Error('EXPERIENCE_PLANNING_CATALOG_UNAVAILABLE');
    return value;
  }
}
