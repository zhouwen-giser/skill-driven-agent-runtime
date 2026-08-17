import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  COGNITIVE_SCHEMA_VERSION,
  createCognitiveSourceRef,
  createInteractiveGoalSessionSnapshot,
  createInteractiveGoalTurn,
  type CandidateUserGoalCompletionContract,
  type GenericTaskUnderstandingRevision,
  type GoalContractCandidateSnapshot,
  type InteractiveGoalAction,
  type InteractiveGoalSessionSnapshot,
  type PlanningCorrectionType,
  type PlanningPreferenceCategory,
} from '../../../domain/src/index.js';
import { GoalContractCandidateFactory } from './goal-contract-candidate-factory.js';
import {
  MissingDimensionQuestionService,
  type MissingDimensionQuestion,
} from './missing-dimension-question-service.js';
import type {
  CognitiveStructuredModelStageInvoker,
  InteractiveGoalMutationResult,
  InteractiveGoalRepository,
  TaskUnderstandingRepository,
} from './ports.js';
import type {
  PlanningCorrectionObserver,
  PlanningCorrectionRecordInput,
} from './planning-correction-service.js';

const MeaningfulContractTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(
    (value) => /[\p{L}\p{N}]/u.test(value),
    'Goal Contract text must contain at least one letter or number.',
  );

const ContractOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(512),
    description: z.string().trim().min(1).max(8192),
    constraints: z.array(MeaningfulContractTextSchema).max(64),
    successCriteria: z.array(MeaningfulContractTextSchema).min(1).max(64),
  })
  .strict();

const PatchSchema = ContractOutputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one Goal Contract field must be patched.',
);

export interface InteractiveGoalActionInput {
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly action: InteractiveGoalAction;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface InteractiveGoalSessionView {
  readonly outcome: 'started' | InteractiveGoalMutationResult['outcome'];
  readonly session: InteractiveGoalSessionSnapshot;
  readonly question?: MissingDimensionQuestion;
  readonly candidate?: GoalContractCandidateSnapshot;
}

export class InteractiveGoalSessionService {
  readonly #repository: InteractiveGoalRepository;
  readonly #understandings: TaskUnderstandingRepository;
  readonly #reviseUnderstanding: (
    input: Readonly<{
      current: GenericTaskUnderstandingRevision;
      answer: unknown;
      question?: MissingDimensionQuestion;
    }>,
  ) => Promise<GenericTaskUnderstandingRevision>;
  readonly #model: CognitiveStructuredModelStageInvoker;
  readonly #questions: MissingDimensionQuestionService;
  readonly #candidates: GoalContractCandidateFactory;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #ids: Readonly<{
    nextSessionId(): string;
    nextTurnId(): string;
    nextCandidateId(): string;
  }>;
  readonly #budgets: Readonly<{
    maxClarificationRounds: number;
    maxContractRevisions: number;
    maxElapsedMs: number;
  }>;
  readonly #interactions: PlanningCorrectionObserver | undefined;
  readonly #modelTimeoutMs: number;

  constructor(
    dependencies: Readonly<{
      repository: InteractiveGoalRepository;
      understandings: TaskUnderstandingRepository;
      reviseUnderstanding(
        input: Readonly<{
          current: GenericTaskUnderstandingRevision;
          answer: unknown;
          question?: MissingDimensionQuestion;
        }>,
      ): Promise<GenericTaskUnderstandingRevision>;
      model: CognitiveStructuredModelStageInvoker;
      questions?: MissingDimensionQuestionService;
      candidates?: GoalContractCandidateFactory;
      clock: Readonly<{ now(): string }>;
      ids: Readonly<{
        nextSessionId(): string;
        nextTurnId(): string;
        nextCandidateId(): string;
      }>;
      budgets: Readonly<{
        maxClarificationRounds: number;
        maxContractRevisions: number;
        maxElapsedMs: number;
      }>;
      interactions?: PlanningCorrectionObserver;
      modelTimeoutMs?: number;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#understandings = dependencies.understandings;
    this.#reviseUnderstanding = dependencies.reviseUnderstanding;
    this.#model = dependencies.model;
    this.#questions = dependencies.questions ?? new MissingDimensionQuestionService();
    this.#candidates = dependencies.candidates ?? new GoalContractCandidateFactory();
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#budgets = dependencies.budgets;
    this.#interactions = dependencies.interactions;
    this.#modelTimeoutMs = dependencies.modelTimeoutMs ?? 30_000;
    if (
      !Number.isSafeInteger(this.#modelTimeoutMs) ||
      this.#modelTimeoutMs < 1 ||
      this.#modelTimeoutMs > 300_000
    )
      throw new Error('GOAL_CONTRACT_MODEL_TIMEOUT_INVALID');
  }

  async start(input: Readonly<{ taskId: string }>): Promise<InteractiveGoalSessionView> {
    const existing = await this.#repository.findByTask(input.taskId);
    if (existing !== undefined) return this.#view('duplicate', existing);
    const understanding = await this.#understandings.findCurrent(input.taskId);
    if (understanding === undefined) throw new Error('TASK_UNDERSTANDING_REQUIRED');
    const timestamp = this.#clock.now();
    const candidate =
      understanding.disposition === 'contract_candidate'
        ? await this.#generateCandidate(this.#ids.nextSessionId(), 1, understanding, timestamp)
        : undefined;
    const sessionId = candidate?.sessionId ?? this.#ids.nextSessionId();
    const session = createInteractiveGoalSessionSnapshot({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      sessionId,
      taskId: input.taskId,
      state:
        candidate !== undefined
          ? 'goal_review'
          : understanding.disposition === 'rejected'
            ? 'rejected'
            : 'understand',
      version: 1,
      currentUnderstandingId: understanding.understandingId,
      ...(candidate === undefined
        ? {}
        : {
            currentCandidateId: candidate.candidateId,
            currentCandidateRevision: candidate.revision,
          }),
      clarificationRounds: 0,
      revisionCount: candidate === undefined ? 0 : 1,
      maxClarificationRounds: this.#budgets.maxClarificationRounds,
      maxRevisions: this.#budgets.maxContractRevisions,
      maxElapsedMs: this.#budgets.maxElapsedMs,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const persisted = await this.#repository.start(session, candidate);
    const persistedCandidate =
      candidate?.candidateId === persisted.currentCandidateId
        ? candidate
        : await this.#currentCandidate(persisted);
    return this.#view(
      persisted.sessionId === session.sessionId ? 'started' : 'duplicate',
      persisted,
      persistedCandidate,
    );
  }

  async getByTask(taskId: string): Promise<InteractiveGoalSessionView | undefined> {
    const session = await this.#repository.findByTask(taskId);
    return session === undefined
      ? undefined
      : this.#view('duplicate', session, await this.#currentCandidate(session));
  }

  async applyAction(input: InteractiveGoalActionInput): Promise<InteractiveGoalSessionView> {
    const duplicate = await this.#repository.findTurnByIdempotencyKey(
      input.sessionId,
      input.idempotencyKey,
    );
    if (duplicate !== undefined) {
      const session = await this.#requiredSession(input.sessionId);
      await this.#interactions?.recordInteraction(session.taskId);
      return this.#view('duplicate', session, await this.#currentCandidate(session));
    }
    const session = await this.#requiredSession(input.sessionId);
    if (session.version !== input.expectedVersion) return this.#view('conflict', session);
    if (isTerminal(session.state)) throw new Error('INTERACTIVE_GOAL_SESSION_TERMINAL');
    const understanding = await this.#requiredUnderstanding(session.taskId);
    const turns = await this.#repository.listTurns(session.sessionId);
    const currentCandidate = await this.#currentCandidate(session);
    const timestamp = this.#clock.now();
    const overElapsedBudget =
      Date.parse(timestamp) - Date.parse(session.createdAt) >= session.maxElapsedMs;
    let nextUnderstanding = understanding;
    let candidate: GoalContractCandidateSnapshot | undefined;
    let state = session.state;
    let clarificationRounds = session.clarificationRounds;
    let revisionCount = session.revisionCount;
    const question = this.#questions.nextQuestion(understanding, turns);

    if (overElapsedBudget) {
      state = 'budget_exhausted';
    } else if (input.action === 'answer' || input.action === 'restart_understanding') {
      if (session.state !== 'understand') throw new Error('INTERACTIVE_GOAL_ACTION_NOT_ALLOWED');
      if (clarificationRounds >= session.maxClarificationRounds) {
        state = 'budget_exhausted';
      } else {
        const answer =
          input.action === 'answer'
            ? requiredPayload(input.payload, 'answer')
            : requiredPayload(input.payload, 'requestText');
        nextUnderstanding = await this.#reviseUnderstanding({
          current: understanding,
          answer,
          ...(question === undefined ? {} : { question }),
        });
        clarificationRounds += 1;
        if (nextUnderstanding.disposition === 'contract_candidate') {
          if (revisionCount >= session.maxRevisions) state = 'budget_exhausted';
          else {
            revisionCount += 1;
            candidate = await this.#generateCandidate(
              session.sessionId,
              revisionCount,
              nextUnderstanding,
              timestamp,
            );
            state = 'goal_review';
          }
        } else if (nextUnderstanding.disposition === 'rejected') state = 'rejected';
        else if (
          this.#questions.nextQuestion(nextUnderstanding, [...turns, provisionalTurn(question)]) ===
          undefined
        ) {
          state = 'budget_exhausted';
        }
      }
    } else if (input.action === 'patch') {
      if (session.state !== 'goal_review' || currentCandidate === undefined)
        throw new Error('INTERACTIVE_GOAL_ACTION_NOT_ALLOWED');
      if (revisionCount >= session.maxRevisions) state = 'budget_exhausted';
      else {
        revisionCount += 1;
        candidate = this.#candidates.patch(
          currentCandidate,
          normalizePatch(PatchSchema.parse(input.payload['patch'])),
          {
            candidateId: this.#ids.nextCandidateId(),
            sessionId: session.sessionId,
            revision: revisionCount,
            status: 'candidate',
            contract: currentCandidate.contract,
            sourceRefs: currentCandidate.sourceRefs,
            modelInvocationId: currentCandidate.modelInvocationId,
            createdAt: timestamp,
          },
        );
        state = 'goal_review';
      }
    } else if (input.action === 'accept') {
      if (session.state !== 'goal_review' || currentCandidate === undefined)
        throw new Error('INTERACTIVE_GOAL_ACTION_NOT_ALLOWED');
      candidate = this.#candidates.transition(currentCandidate, 'confirmed');
      state = 'confirmed';
    } else if (input.action === 'reject') {
      if (currentCandidate !== undefined)
        candidate = this.#candidates.transition(currentCandidate, 'rejected');
      state = 'rejected';
    } else state = 'canceled';

    const turn = createInteractiveGoalTurn({
      turnId: this.#ids.nextTurnId(),
      sessionId: session.sessionId,
      ordinal: turns.length + 1,
      expectedSessionVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      action: input.action,
      actorId: input.actorId,
      payload: input.payload,
      binding: {
        understandingRevision: understanding.revision,
        ...(question?.dimensionId === undefined ? {} : { dimensionId: question.dimensionId }),
        ...(question?.criterionId === undefined ? {} : { criterionId: question.criterionId }),
        ...(question?.blockingReason === undefined
          ? {}
          : { blockingReason: question.blockingReason }),
      },
      createdAt: timestamp,
    });
    const nextSession = createInteractiveGoalSessionSnapshot({
      ...session,
      state,
      version: session.version + 1,
      currentUnderstandingId: nextUnderstanding.understandingId,
      ...candidateIdentity(candidate, currentCandidate),
      clarificationRounds,
      revisionCount,
      updatedAt: timestamp,
    });
    const result = await this.#repository.apply({
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      turn,
      nextSession,
      ...(candidate === undefined ? {} : { candidate }),
    });
    if (result.outcome === 'applied' && this.#interactions !== undefined) {
      const correction = goalCorrectionInput({
        input,
        session,
        turn,
        understanding,
        nextUnderstanding,
        ...(currentCandidate === undefined ? {} : { currentCandidate }),
        ...(candidate === undefined ? {} : { candidate }),
        ...(question === undefined ? {} : { question }),
      });
      if (correction === undefined) await this.#interactions.recordInteraction(session.taskId);
      else await this.#interactions.record(correction);
    }
    return this.#view(
      result.outcome,
      result.session,
      'candidate' in result ? result.candidate : await this.#currentCandidate(result.session),
    );
  }

  async #generateCandidate(
    sessionId: string,
    revision: number,
    understanding: GenericTaskUnderstandingRevision,
    createdAt: string,
  ): Promise<GoalContractCandidateSnapshot> {
    const baseInstruction = {
      policy: 'Produce a candidate only. User confirmation is required before Goal creation.',
      taskUnderstanding: understanding,
    } as const;
    let response: Awaited<ReturnType<CognitiveStructuredModelStageInvoker['generate']>> | undefined;
    let contract: CandidateUserGoalCompletionContract | undefined;
    let lastError: z.ZodError | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const instruction = JSON.stringify({
        ...baseInstruction,
        ...(lastError === undefined
          ? {}
          : {
              correctionRequired: true,
              validationErrors: lastError.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              })),
              correctionPolicy:
                'Return a complete replacement object. Every constraints and successCriteria item must be a meaningful sentence containing at least one letter or number.',
            }),
      });
      response = await this.#model.generate({
        stage: 'goal_contract_generation',
        instruction,
        responseSchema: ContractOutputSchema.toJSONSchema(),
        sourceRefs: understanding.sourceRefs.map((source) => source.sourceRefId),
        maxAttempts: 1,
        timeoutMs: this.#modelTimeoutMs,
        taskId: understanding.taskId,
      });
      const parsed = ContractOutputSchema.safeParse(response.structuredResult);
      if (parsed.success) {
        contract = parsed.data;
        break;
      }
      lastError = parsed.error;
    }
    if (response === undefined || contract === undefined) {
      throw new Error(`GOAL_CONTRACT_MODEL_OUTPUT_INVALID:${lastError?.message ?? 'unknown'}`);
    }
    const sourceRefs = [
      ...understanding.sourceRefs,
      createCognitiveSourceRef({
        schemaVersion: COGNITIVE_SCHEMA_VERSION,
        sourceRefId: `source.model.${createHash('sha256').update(response.invocationId).digest('hex').slice(0, 24)}`,
        sourceKind: 'model_invocation',
        sourceId: response.invocationId,
        sourceRevision: 1,
        authority: 'model_candidate',
        dataClassification: 'internal',
        capturedAt: createdAt,
      }),
    ];
    return this.#candidates.create({
      candidateId: this.#ids.nextCandidateId(),
      sessionId,
      revision,
      status: 'candidate',
      contract,
      sourceRefs,
      modelInvocationId: response.invocationId,
      createdAt,
    });
  }

  async #requiredSession(sessionId: string): Promise<InteractiveGoalSessionSnapshot> {
    const session = await this.#repository.find(sessionId);
    if (session === undefined) throw new Error('INTERACTIVE_GOAL_SESSION_NOT_FOUND');
    return session;
  }

  async #requiredUnderstanding(taskId: string): Promise<GenericTaskUnderstandingRevision> {
    const understanding = await this.#understandings.findCurrent(taskId);
    if (understanding === undefined) throw new Error('TASK_UNDERSTANDING_REQUIRED');
    return understanding;
  }

  async #currentCandidate(
    session: InteractiveGoalSessionSnapshot,
  ): Promise<GoalContractCandidateSnapshot | undefined> {
    if (session.currentCandidateId === undefined) return undefined;
    return (await this.#repository.listCandidates(session.sessionId)).find(
      (candidate) => candidate.candidateId === session.currentCandidateId,
    );
  }

  async #view(
    outcome: InteractiveGoalSessionView['outcome'],
    session: InteractiveGoalSessionSnapshot,
    candidate?: GoalContractCandidateSnapshot,
  ): Promise<InteractiveGoalSessionView> {
    const understanding =
      session.state === 'understand'
        ? await this.#understandings.findCurrent(session.taskId)
        : undefined;
    const question =
      understanding === undefined
        ? undefined
        : this.#questions.nextQuestion(
            understanding,
            await this.#repository.listTurns(session.sessionId),
          );
    return {
      outcome,
      session,
      ...(question === undefined ? {} : { question }),
      ...(candidate === undefined ? {} : { candidate }),
    };
  }
}

function goalCorrectionInput(
  input: Readonly<{
    input: InteractiveGoalActionInput;
    session: InteractiveGoalSessionSnapshot;
    turn: ReturnType<typeof createInteractiveGoalTurn>;
    understanding: GenericTaskUnderstandingRevision;
    nextUnderstanding: GenericTaskUnderstandingRevision;
    currentCandidate?: GoalContractCandidateSnapshot;
    candidate?: GoalContractCandidateSnapshot;
    question?: MissingDimensionQuestion;
  }>,
): PlanningCorrectionRecordInput | undefined {
  if (input.input.action === 'answer' || input.input.action === 'restart_understanding') {
    return {
      taskId: input.session.taskId,
      sessionId: input.session.sessionId,
      turnId: input.turn.turnId,
      idempotencyKey: `goal:${input.session.sessionId}:${input.input.idempotencyKey}`,
      actorId: input.input.actorId,
      target: 'task_understanding',
      correctionType: correctionTypeForDimension(input.question?.kind),
      ...correctionScope(input.input),
      beforeSnapshot: jsonObject(input.understanding),
      userInstruction: instructionText(
        input.input.payload[input.input.action === 'answer' ? 'answer' : 'requestText'],
      ),
      structuredPatch: {
        action: input.input.action,
        ...(input.question === undefined ? {} : { binding: input.question }),
      },
      afterSnapshot: jsonObject(input.nextUnderstanding),
      validation: {
        disposition: input.nextUnderstanding.disposition,
        stateHash: input.nextUnderstanding.stateHash,
      },
      accepted: true,
      ...preferenceCategory(input.input.payload),
      sourceRefs: input.nextUnderstanding.sourceRefs,
    };
  }
  if (
    input.input.action !== 'patch' ||
    input.currentCandidate === undefined ||
    input.candidate === undefined
  ) {
    return undefined;
  }
  const patch = jsonObject(input.input.payload['patch']);
  return {
    taskId: input.session.taskId,
    sessionId: input.session.sessionId,
    turnId: input.turn.turnId,
    idempotencyKey: `goal:${input.session.sessionId}:${input.input.idempotencyKey}`,
    actorId: input.input.actorId,
    target: 'goal_contract',
    correctionType: correctionTypeForGoalPatch(patch),
    ...correctionScope(input.input),
    beforeSnapshot: jsonObject(input.currentCandidate.contract),
    userInstruction: instructionText(input.input.payload['patch']),
    structuredPatch: patch,
    afterSnapshot: jsonObject(input.candidate.contract),
    validation: { valid: true, changedFields: input.candidate.diff.changedFields },
    accepted: true,
    ...preferenceCategory(input.input.payload),
    sourceRefs: input.candidate.sourceRefs,
  };
}

function correctionScope(input: InteractiveGoalActionInput) {
  const value = input.payload['correctionScope'];
  const scope =
    value === 'user' || value === 'tenant' || value === 'global_candidate' ? value : 'task';
  if (scope === 'user') {
    const userId = input.payload['userId'];
    return {
      scope,
      userId: typeof userId === 'string' && userId.trim() !== '' ? userId : input.actorId,
    } as const;
  }
  if (scope === 'tenant') {
    const tenantId = input.payload['tenantId'];
    if (typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new Error('PLANNING_CORRECTION_TENANT_ID_REQUIRED');
    }
    return { scope, tenantId: tenantId.trim() } as const;
  }
  return { scope } as const;
}

function preferenceCategory(payload: Readonly<Record<string, unknown>>): Readonly<{
  preferenceCategory?: PlanningPreferenceCategory;
}> {
  const value = payload['preferenceCategory'];
  return value === 'display' ||
    value === 'interaction' ||
    value === 'report_format' ||
    value === 'detailed_plan' ||
    value === 'parallel_explanation' ||
    value === 'time_expression' ||
    value === 'language'
    ? { preferenceCategory: value }
    : {};
}

function correctionTypeForDimension(
  kind: MissingDimensionQuestion['kind'] | undefined,
): PlanningCorrectionType {
  if (kind === 'target') return 'missing_target';
  if (kind === 'criteria') return 'missing_criterion';
  if (kind === 'artifact') return 'missing_artifact';
  if (kind === 'evidence') return 'missing_evidence';
  if (kind === 'priority') return 'wrong_priority';
  if (kind === 'side_effect_authorization') return 'unsafe_side_effect';
  if (kind === 'degradation_policy') return 'degradation_correction';
  return 'missing_scope';
}

function correctionTypeForGoalPatch(
  patch: Readonly<Record<string, unknown>>,
): PlanningCorrectionType {
  if ('successCriteria' in patch) return 'missing_criterion';
  if ('constraints' in patch) return 'missing_scope';
  return 'missing_target';
}

function instructionText(value: unknown): string {
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value);
  return serialized.length > 8192 ? serialized.slice(0, 8192) : serialized;
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('PLANNING_CORRECTION_SNAPSHOT_INVALID');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function requiredPayload(payload: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = payload[key];
  if (value === undefined) throw new Error(`INTERACTIVE_GOAL_${key.toUpperCase()}_REQUIRED`);
  return value;
}

function normalizePatch(
  value: z.infer<typeof PatchSchema>,
): Partial<CandidateUserGoalCompletionContract> {
  return {
    ...(value.title === undefined ? {} : { title: value.title }),
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.constraints === undefined ? {} : { constraints: value.constraints }),
    ...(value.successCriteria === undefined ? {} : { successCriteria: value.successCriteria }),
  };
}

function isTerminal(state: InteractiveGoalSessionSnapshot['state']): boolean {
  return ['confirmed', 'rejected', 'canceled', 'budget_exhausted'].includes(state);
}

function candidateIdentity(
  candidate: GoalContractCandidateSnapshot | undefined,
  current: GoalContractCandidateSnapshot | undefined,
) {
  const selected = candidate ?? current;
  return selected === undefined
    ? {}
    : { currentCandidateId: selected.candidateId, currentCandidateRevision: selected.revision };
}

function provisionalTurn(question: MissingDimensionQuestion | undefined) {
  return createInteractiveGoalTurn({
    turnId: 'turn.provisional',
    sessionId: 'session.provisional',
    ordinal: 1,
    expectedSessionVersion: 1,
    idempotencyKey: 'action.provisional',
    action: 'answer',
    actorId: 'system',
    payload: {},
    binding: {
      understandingRevision: question?.understandingRevision ?? 1,
      ...(question?.dimensionId === undefined ? {} : { dimensionId: question.dimensionId }),
    },
    createdAt: '1970-01-01T00:00:00.000Z',
  });
}
