import type {
  CognitiveDomainEvent,
  CognitiveModelStage,
  CognitiveRuntimeFeatureFlags,
  GenericTaskUnderstandingRevision,
  GoalExperienceEpisode,
  InteractiveSessionSnapshot,
  GoalContractCandidateSnapshot,
  InteractiveGoalSessionSnapshot,
  InteractiveGoalTurn,
  InteractivePlanningSessionSnapshot,
  InteractivePlanningTurn,
  KnowledgeCandidateSnapshot,
  KnowledgeStatusTransition,
  PublicCapabilityCardSnapshot,
  RuntimeCapabilitySummarySnapshot,
  SkillVersion,
  UserGoalPlanCandidateSnapshot,
  UserGoalPlan,
} from '../../../domain/src/index.js';

export interface CognitiveFeatureFlagSource {
  load(): Promise<CognitiveRuntimeFeatureFlags>;
}

export interface CapabilityCatalogSource {
  listEnabledSkillVersions(): Promise<readonly SkillVersion[]>;
}

export interface CapabilitySummaryRepository {
  findActive(): Promise<RuntimeCapabilitySummarySnapshot | undefined>;
  findByCatalogHash(
    catalogHash: string,
    generationPolicyVersion: string,
  ): Promise<RuntimeCapabilitySummarySnapshot | undefined>;
  saveAndActivate(
    snapshot: RuntimeCapabilitySummarySnapshot,
    expectedActiveRevision?: number,
  ): Promise<RuntimeCapabilitySummarySnapshot>;
}

export interface CapabilityCatalogChangeSource {
  listPendingCatalogChangeEventIds(limit: number): Promise<readonly string[]>;
  markCatalogChangeEventsPublished(eventIds: readonly string[], publishedAt: string): Promise<void>;
}

export interface CapabilityCardRepository {
  findActive(): Promise<PublicCapabilityCardSnapshot | undefined>;
  findByCatalogHash(
    catalogHash: string,
    generationPolicyVersion: string,
  ): Promise<PublicCapabilityCardSnapshot | undefined>;
  activate(
    candidate: PublicCapabilityCardSnapshot,
    expectedActiveRevision?: number,
  ): Promise<PublicCapabilityCardSnapshot>;
}

export interface TaskUnderstandingRepository {
  findCurrent(taskId: string): Promise<GenericTaskUnderstandingRevision | undefined>;
  listRevisions(taskId: string): Promise<readonly GenericTaskUnderstandingRevision[]>;
  saveRevision(
    revision: GenericTaskUnderstandingRevision,
    expectedCurrentRevision?: number,
  ): Promise<void>;
}

export interface InteractiveSessionRepository {
  find(sessionId: string): Promise<InteractiveSessionSnapshot | undefined>;
  save(
    snapshot: InteractiveSessionSnapshot,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<InteractiveSessionSnapshot>;
}

export interface InteractiveGoalMutation {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly turn: InteractiveGoalTurn;
  readonly nextSession: InteractiveGoalSessionSnapshot;
  readonly candidate?: GoalContractCandidateSnapshot;
}

export type InteractiveGoalMutationResult =
  | Readonly<{
      outcome: 'applied' | 'duplicate';
      session: InteractiveGoalSessionSnapshot;
      candidate?: GoalContractCandidateSnapshot;
    }>
  | Readonly<{
      outcome: 'conflict';
      session: InteractiveGoalSessionSnapshot;
    }>;

export interface InteractiveGoalRepository {
  findByTask(taskId: string): Promise<InteractiveGoalSessionSnapshot | undefined>;
  find(sessionId: string): Promise<InteractiveGoalSessionSnapshot | undefined>;
  listTurns(sessionId: string): Promise<readonly InteractiveGoalTurn[]>;
  listCandidates(sessionId: string): Promise<readonly GoalContractCandidateSnapshot[]>;
  findTurnByIdempotencyKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<InteractiveGoalTurn | undefined>;
  start(
    session: InteractiveGoalSessionSnapshot,
    candidate?: GoalContractCandidateSnapshot,
  ): Promise<InteractiveGoalSessionSnapshot>;
  apply(mutation: InteractiveGoalMutation): Promise<InteractiveGoalMutationResult>;
}

export interface InteractivePlanningMutation {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly turn: InteractivePlanningTurn;
  readonly nextSession: InteractivePlanningSessionSnapshot;
  readonly candidate?: UserGoalPlanCandidateSnapshot<UserGoalPlan>;
}

export type InteractivePlanningMutationResult =
  | Readonly<{
      outcome: 'applied' | 'duplicate';
      session: InteractivePlanningSessionSnapshot;
      candidate?: UserGoalPlanCandidateSnapshot<UserGoalPlan>;
    }>
  | Readonly<{
      outcome: 'conflict';
      session: InteractivePlanningSessionSnapshot;
    }>;

export interface InteractivePlanningRepository {
  findByTask(taskId: string): Promise<InteractivePlanningSessionSnapshot | undefined>;
  find(sessionId: string): Promise<InteractivePlanningSessionSnapshot | undefined>;
  listTurns(sessionId: string): Promise<readonly InteractivePlanningTurn[]>;
  listCandidates(
    sessionId: string,
  ): Promise<readonly UserGoalPlanCandidateSnapshot<UserGoalPlan>[]>;
  findTurnByIdempotencyKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<InteractivePlanningTurn | undefined>;
  start(
    session: InteractivePlanningSessionSnapshot,
    candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
  ): Promise<InteractivePlanningSessionSnapshot>;
  apply(mutation: InteractivePlanningMutation): Promise<InteractivePlanningMutationResult>;
}

export interface GoalVersionLock {
  withLock<T>(goalId: string, goalVersion: number, operation: () => Promise<T>): Promise<T>;
}

export interface GoalExperienceEpisodeRepository {
  findById(episodeId: string): Promise<GoalExperienceEpisode | undefined>;
  findByGoal(goalId: string): Promise<readonly GoalExperienceEpisode[]>;
  saveIfAbsent(episode: GoalExperienceEpisode): Promise<boolean>;
}

export interface KnowledgeRepository {
  find(
    kind: KnowledgeCandidateSnapshot['kind'],
    knowledgeId: string,
  ): Promise<KnowledgeCandidateSnapshot | undefined>;
  saveCandidate(candidate: KnowledgeCandidateSnapshot): Promise<void>;
  transition(transition: KnowledgeStatusTransition): Promise<KnowledgeCandidateSnapshot>;
}

export interface CognitiveOutboxPort {
  append(event: CognitiveDomainEvent): Promise<void>;
}

export interface CognitiveRuntimeFactReader {
  readGoalFacts(goalId: string, goalVersion: number): Promise<Readonly<Record<string, unknown>>>;
}

export interface CognitiveStructuredModelStageInvoker {
  generate(
    input: Readonly<{
      stage: CognitiveModelStage;
      instruction: string;
      responseSchema: unknown;
      sourceRefs: readonly string[];
      maxAttempts: number;
      timeoutMs: number;
      taskId?: string;
    }>,
  ): Promise<Readonly<{ structuredResult: unknown; invocationId: string }>>;
}
