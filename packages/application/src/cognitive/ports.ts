import type { ZodType } from 'zod';

import type {
  CognitiveDomainEvent,
  CognitiveModelStage,
  CognitiveSourceRef,
  CognitiveRuntimeFeatureFlags,
  ExperienceDeadLetter,
  ExperienceExtraction,
  ExperienceExtractorKind,
  ExperienceObservation,
  ExperienceReflection,
  ExperienceJob,
  GenericTaskUnderstandingRevision,
  GoalExperienceEpisode,
  InteractiveSessionSnapshot,
  GoalContractCandidateSnapshot,
  InteractiveGoalSessionSnapshot,
  InteractiveGoalTurn,
  InteractivePlanningSessionSnapshot,
  InteractivePlanningTurn,
  KnowledgeCandidateSnapshot,
  KnowledgeCandidateIdentity,
  KnowledgeKind,
  KnowledgeStatusTransition,
  PlanningCorrectionFact,
  PlanningInteractionEpisode,
  PublicCapabilityCardSnapshot,
  RuntimeCapabilitySummarySnapshot,
  SkillVersion,
  TaskTypeDefinitionSnapshot,
  UserGoalPlanCandidateSnapshot,
  UserGoalPlan,
} from '../../../domain/src/index.js';

export type ExperienceObservationPartition =
  'contract' | 'plan' | 'attempt' | 'outcome' | 'recovery' | 'correction';

export interface KnowledgeSemanticSimilarityPort {
  compare(left: string, right: string): Promise<number>;
}

export interface ExperienceExtractorInput {
  readonly observationId: string;
  readonly episodes: readonly GoalExperienceEpisode[];
  readonly partitions: Readonly<Record<ExperienceObservationPartition, unknown>>;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly previousObservations: readonly ExperienceObservation[];
}

export interface ExperienceExtractor<T> {
  readonly id: ExperienceExtractorKind;
  readonly schema: ZodType<T>;
  readonly modelTier: 'fast' | 'reasoning';
  readonly requiredPartitions: readonly ExperienceObservationPartition[];
  extract(input: ExperienceExtractorInput): Promise<ExperienceExtraction>;
}

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

export interface PlanningCorrectionRepository {
  findByIdempotencyKey(
    taskId: string,
    idempotencyKey: string,
  ): Promise<PlanningCorrectionFact | undefined>;
  saveIfAbsent(
    fact: PlanningCorrectionFact,
  ): Promise<Readonly<{ fact: PlanningCorrectionFact; inserted: boolean }>>;
  listByTask(taskId: string): Promise<readonly PlanningCorrectionFact[]>;
  listUserScoped(userId: string): Promise<readonly PlanningCorrectionFact[]>;
  listTenantScoped(tenantId: string): Promise<readonly PlanningCorrectionFact[]>;
  saveEpisode(episode: PlanningInteractionEpisode): Promise<boolean>;
  listEpisodes(taskId: string): Promise<readonly PlanningInteractionEpisode[]>;
}

export interface PlanningInteractionEpisodeBuilderPort {
  build(
    input: Readonly<{
      taskId: string;
      outcomeRef?: string;
      counterexampleRefs?: readonly string[];
    }>,
  ): Promise<PlanningInteractionEpisode>;
}

export interface PlanningPreferenceProjectionPort {
  projectLowRisk(fact: PlanningCorrectionFact): Promise<unknown>;
  deleteUserScope(
    userId: string,
    facts: readonly PlanningCorrectionFact[],
    actorId: string,
  ): Promise<number>;
}

export interface PlanningInteractionTaskSource {
  findById(taskId: string): Promise<
    | Readonly<{
        taskId: string;
        userId: string;
        requestText: string;
        requestMetadata: Readonly<Record<string, unknown>>;
        goalId?: string;
        goalVersion?: number;
      }>
    | undefined
  >;
}

export interface GoalExperienceEpisodeRepository {
  findById(episodeId: string): Promise<GoalExperienceEpisode | undefined>;
  findByGoal(goalId: string): Promise<readonly GoalExperienceEpisode[]>;
  list(limit?: number, goalId?: string): Promise<readonly GoalExperienceEpisode[]>;
  saveIfAbsent(episode: GoalExperienceEpisode): Promise<boolean>;
}

export interface GoalExperienceEpisodeBuilderPort {
  build(input: Readonly<{ goalId: string; goalVersion: number }>): Promise<GoalExperienceEpisode>;
}

export interface CognitiveOutboxRepository {
  append(event: CognitiveDomainEvent): Promise<void>;
  dispatchTerminalEvents(limit?: number): Promise<readonly ExperienceJob[]>;
}

export interface ExperienceJobRepository {
  createEpisodeJob(event: CognitiveDomainEvent, now: string): Promise<ExperienceJob>;
  claim(
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ExperienceJob[]>;
  complete(jobId: string, workerId: string, now: string, episodeId: string): Promise<void>;
  fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    errorSummary: string,
    now: string,
    retryAt?: string,
  ): Promise<void>;
  listRequeueable(now: string, limit?: number): Promise<readonly ExperienceJob[]>;
  replayDeadLetter(deadLetterId: string, actorId: string, now: string): Promise<ExperienceJob>;
  listDeadLetters(limit?: number): Promise<readonly ExperienceDeadLetter[]>;
}

export interface ExperienceJobQueuePort {
  enqueue(jobId: string): Promise<void>;
}

export interface ObservationJobRepository {
  claimObservation(
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ExperienceJob[]>;
  completeObservation(
    jobId: string,
    workerId: string,
    now: string,
    observationId: string,
  ): Promise<void>;
  fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    errorSummary: string,
    now: string,
    retryAt?: string,
  ): Promise<void>;
  listObservationRequeueable(now: string, limit?: number): Promise<readonly ExperienceJob[]>;
}

export interface ObservationRepository {
  findById(observationId: string): Promise<ExperienceObservation | undefined>;
  findByEpisode(episodeId: string): Promise<readonly ExperienceObservation[]>;
  list(limit?: number, goalId?: string): Promise<readonly ExperienceObservation[]>;
  listPrevious(
    goalId: string,
    excludeEpisodeId: string,
    limit: number,
  ): Promise<readonly ExperienceObservation[]>;
  save(observation: ExperienceObservation): Promise<boolean>;
}

export interface ReflectionJobRepository {
  claimReflection(
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ExperienceJob[]>;
  completeReflection(
    jobId: string,
    workerId: string,
    now: string,
    reflectionId: string,
  ): Promise<void>;
  fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    errorSummary: string,
    now: string,
    retryAt?: string,
  ): Promise<void>;
  listReflectionRequeueable(now: string, limit?: number): Promise<readonly ExperienceJob[]>;
}

export interface ReflectionRepository {
  findById(reflectionId: string): Promise<ExperienceReflection | undefined>;
  findByObservation(observationId: string): Promise<ExperienceReflection | undefined>;
  list(limit?: number): Promise<readonly ExperienceReflection[]>;
  listCandidateIdentities(
    kind: KnowledgeKind,
    limit?: number,
  ): Promise<
    readonly Readonly<{
      knowledgeId: string;
      revision: number;
      fingerprint: string;
      identity: KnowledgeCandidateIdentity;
    }>[]
  >;
  findCandidate(
    kind: KnowledgeKind,
    knowledgeId: string,
  ): Promise<KnowledgeCandidateSnapshot | undefined>;
  save(reflection: ExperienceReflection): Promise<boolean>;
}

export interface TaskTypeRepository {
  findByFingerprint(fingerprint: string): Promise<TaskTypeDefinitionSnapshot | undefined>;
  list(limit?: number): Promise<readonly TaskTypeDefinitionSnapshot[]>;
  saveCandidate(candidate: TaskTypeDefinitionSnapshot): Promise<boolean>;
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
