import { createHash } from 'node:crypto';

import {
  COGNITIVE_SCHEMA_VERSION,
  createCognitiveSourceRef,
  createPlanningInteractionEpisode,
  type CognitiveSourceRef,
  type PlanningInteractionEpisode,
} from '../../../domain/src/index.js';
import { canonicalJson } from './planning-correction-service.js';
import type {
  InteractiveGoalRepository,
  InteractivePlanningRepository,
  PlanningCorrectionRepository,
  PlanningInteractionEpisodeBuilderPort,
  PlanningInteractionTaskSource,
  TaskUnderstandingRepository,
} from './ports.js';

export class PlanningInteractionEpisodeBuilder implements PlanningInteractionEpisodeBuilderPort {
  readonly #tasks: PlanningInteractionTaskSource;
  readonly #understandings: TaskUnderstandingRepository;
  readonly #goalSessions: InteractiveGoalRepository;
  readonly #planningSessions: InteractivePlanningRepository;
  readonly #corrections: PlanningCorrectionRepository;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      tasks: PlanningInteractionTaskSource;
      understandings: TaskUnderstandingRepository;
      goalSessions: InteractiveGoalRepository;
      planningSessions: InteractivePlanningRepository;
      corrections: PlanningCorrectionRepository;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#tasks = dependencies.tasks;
    this.#understandings = dependencies.understandings;
    this.#goalSessions = dependencies.goalSessions;
    this.#planningSessions = dependencies.planningSessions;
    this.#corrections = dependencies.corrections;
    this.#clock = dependencies.clock;
  }

  async build(
    input: Readonly<{
      taskId: string;
      outcomeRef?: string;
      counterexampleRefs?: readonly string[];
    }>,
  ): Promise<PlanningInteractionEpisode> {
    const task = await this.#tasks.findById(input.taskId);
    if (task === undefined) throw new Error('PLANNING_INTERACTION_TASK_NOT_FOUND');
    const [understandings, goalSession, planningSession, corrections, priorEpisodes] =
      await Promise.all([
        this.#understandings.listRevisions(input.taskId),
        this.#goalSessions.findByTask(input.taskId),
        this.#planningSessions.findByTask(input.taskId),
        this.#corrections.listByTask(input.taskId),
        this.#corrections.listEpisodes(input.taskId),
      ]);
    const [goalTurns, goalCandidates, planningTurns, planningCandidates] = await Promise.all([
      goalSession === undefined ? [] : this.#goalSessions.listTurns(goalSession.sessionId),
      goalSession === undefined ? [] : this.#goalSessions.listCandidates(goalSession.sessionId),
      planningSession === undefined
        ? []
        : this.#planningSessions.listTurns(planningSession.sessionId),
      planningSession === undefined
        ? []
        : this.#planningSessions.listCandidates(planningSession.sessionId),
    ]);
    const initialUnderstanding = understandings[0];
    const initialGoalContract = goalCandidates[0]?.contract;
    const acceptedGoalContract = [...goalCandidates]
      .reverse()
      .find((candidate) => candidate.status === 'confirmed')?.contract;
    const initialPlan = planningCandidates[0]?.plan;
    const acceptedPlan = [...planningCandidates]
      .reverse()
      .find((candidate) => candidate.status === 'confirmed')?.plan;
    const goalId = planningSession?.goalId ?? task.goalId;
    const goalVersion = planningSession?.goalVersion ?? task.goalVersion;
    const tenantId = stringMetadata(task.requestMetadata, 'tenantId');
    const turns = [...goalTurns, ...planningTurns]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(jsonObject);
    const counterexampleRefs = [...new Set(input.counterexampleRefs ?? [])].sort();
    const snapshot = {
      taskId: task.taskId,
      userId: task.userId,
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(goalId === undefined ? {} : { goalId, goalVersion }),
      originalRequest: task.requestText,
      understandingRevisions: understandings.map(jsonObject),
      goalSession: goalSession === undefined ? undefined : jsonObject(goalSession),
      goalCandidates: goalCandidates.map(jsonObject),
      planningSession: planningSession === undefined ? undefined : jsonObject(planningSession),
      planningCandidates: planningCandidates.map(jsonObject),
      turns,
      corrections: corrections.map(jsonObject),
      ...(input.outcomeRef === undefined ? {} : { outcomeRef: input.outcomeRef }),
      counterexampleRefs,
    };
    const episodeHash = hash(snapshot);
    const inductionFingerprint = hash({
      targets: [...new Set(corrections.map((fact) => fact.target))].sort(),
      correctionTypes: [...new Set(corrections.map((fact) => fact.correctionType))].sort(),
      scopes: [...new Set(corrections.map((fact) => fact.scope))].sort(),
      goalChangedFields: goalCandidates.flatMap((candidate) => candidate.diff.changedFields).sort(),
      planChangedFields: planningCandidates
        .flatMap((candidate) => candidate.diff.changedFields)
        .sort(),
      accepted: goalSession?.state === 'confirmed' && planningSession?.state === 'confirmed',
    });
    const sources = episodeSources({
      taskId: task.taskId,
      createdAt: this.#clock.now(),
      corrections,
      ...(goalSession === undefined ? {} : { goalSessionId: goalSession.sessionId }),
      ...(planningSession === undefined
        ? {}
        : {
            planningSessionId: planningSession.sessionId,
            planningRevision: planningSession.currentCandidateRevision,
          }),
    });
    const present = [
      task.requestText.trim() !== '',
      initialUnderstanding !== undefined,
      goalSession !== undefined,
      planningSession !== undefined,
      corrections.length > 0,
      goalSession?.state === 'confirmed' || goalSession?.state === 'rejected',
      planningSession?.state === 'confirmed' || planningSession?.state === 'rejected',
      input.outcomeRef !== undefined,
    ].filter(Boolean).length;
    return createPlanningInteractionEpisode({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      episodeId: `interaction-${episodeHash.slice(-32)}`,
      taskId: task.taskId,
      ...(goalId === undefined || goalVersion === undefined ? {} : { goalId, goalVersion }),
      ...(tenantId === undefined ? {} : { tenantId }),
      userId: task.userId,
      revision: priorEpisodes.length + 1,
      originalRequest: task.requestText,
      ...(initialUnderstanding === undefined
        ? {}
        : { initialUnderstanding: jsonObject(initialUnderstanding) }),
      ...(initialGoalContract === undefined
        ? {}
        : { initialGoalContract: jsonObject(initialGoalContract) }),
      ...(initialPlan === undefined ? {} : { initialPlan: jsonObject(initialPlan) }),
      ...(acceptedGoalContract === undefined
        ? {}
        : { acceptedGoalContract: jsonObject(acceptedGoalContract) }),
      ...(acceptedPlan === undefined ? {} : { acceptedPlan: jsonObject(acceptedPlan) }),
      turns,
      correctionIds: corrections.map((fact) => fact.correctionId),
      ...(input.outcomeRef === undefined ? {} : { outcomeRef: input.outcomeRef }),
      counterexampleRefs,
      completeness: present / 8,
      inductionFingerprint,
      episodeHash,
      sourceRefs: sources,
      createdAt: this.#clock.now(),
    });
  }
}

function episodeSources(
  input: Readonly<{
    taskId: string;
    goalSessionId?: string;
    planningSessionId?: string;
    planningRevision?: number;
    corrections: readonly { sourceRefs: readonly CognitiveSourceRef[] }[];
    createdAt: string;
  }>,
): readonly CognitiveSourceRef[] {
  const sources: CognitiveSourceRef[] = [
    createCognitiveSourceRef({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      sourceRefId: `source.task.${digest(input.taskId)}`,
      sourceKind: 'task_request',
      sourceId: input.taskId,
      sourceRevision: 1,
      authority: 'runtime_fact',
      dataClassification: 'user_scoped',
      capturedAt: input.createdAt,
    }),
    ...input.corrections.flatMap((fact) => fact.sourceRefs),
  ];
  if (input.goalSessionId !== undefined) {
    sources.push(
      createCognitiveSourceRef({
        schemaVersion: COGNITIVE_SCHEMA_VERSION,
        sourceRefId: `source.goal.${digest(input.goalSessionId)}`,
        sourceKind: 'goal_contract',
        sourceId: input.goalSessionId,
        sourceRevision: 1,
        authority: 'user_confirmation',
        dataClassification: 'user_scoped',
        capturedAt: input.createdAt,
      }),
    );
  }
  if (input.planningSessionId !== undefined) {
    sources.push(
      createCognitiveSourceRef({
        schemaVersion: COGNITIVE_SCHEMA_VERSION,
        sourceRefId: `source.plan.${digest(input.planningSessionId)}`,
        sourceKind: 'plan_revision',
        sourceId: input.planningSessionId,
        sourceRevision: input.planningRevision ?? 1,
        authority: 'user_confirmation',
        dataClassification: 'user_scoped',
        capturedAt: input.createdAt,
      }),
    );
  }
  return Object.freeze(
    [...new Map(sources.map((source) => [source.sourceRefId, source])).values()].sort(
      (left, right) => left.sourceRefId.localeCompare(right.sourceRefId),
    ),
  );
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('PLANNING_INTERACTION_NON_OBJECT_SNAPSHOT');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function stringMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
