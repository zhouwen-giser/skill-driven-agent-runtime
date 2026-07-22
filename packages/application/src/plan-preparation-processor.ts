import {
  bindTaskPlan,
  bindTaskGoal,
  bindTaskSkill,
  bindTaskSkillExecutionContract,
  bindTaskTemporarySkill,
  createGoalExecutionContract,
  transitionTask,
  type AgentTask,
  type GoalExecutionContract,
  type TaskPhase,
  type SkillAttempt,
  type SkillGoal,
  type SkillVersion,
} from '../../domain/src/index.js';

import type {
  AgentTaskRepository,
  Clock,
  IdentifierGenerator,
  RuntimeEventPublisher,
  TaskInputRepository,
  SkillRepository,
} from './ports.js';
import type { GoalService } from './goal-service.js';
import type { StructuredTaskDecisionService } from './model-decisions.js';
import type { GoalInputInferenceService } from './goal-input-inference.js';
import { TaskApplicationError } from './task-service.js';
import type { SkillInputResolutionService } from './skill-input-resolution.js';
import { skillInputResolutionQuestion } from './skill-input-resolution.js';
import type {
  CognitiveEntryRoute,
  GenericTaskUnderstandingService,
  UnderstandGenericTaskInput,
} from './cognitive/index.js';

export interface PlanPreparationProcessorDependencies {
  readonly tasks: AgentTaskRepository;
  readonly events: RuntimeEventPublisher;
  readonly clock: Clock;
  readonly ids: IdentifierGenerator;
  readonly decisions: Pick<
    StructuredTaskDecisionService,
    'decideGoalContinuity' | 'decideIntent' | 'formulateGoal'
  >;
  readonly goals: Pick<
    GoalService,
    'create' | 'get' | 'findActiveByContextId' | 'findLatestByContextId'
  >;
  readonly skills: Pick<SkillRepository, 'findVersion'>;
  readonly skillInputs: Pick<SkillInputResolutionService, 'resolve'>;
  readonly userGoalPlanning: Readonly<{
    plan(
      input: Readonly<{ goal: Awaited<ReturnType<GoalService['get']>> }>,
    ): Promise<Readonly<{ plan: { planId: string } }>>;
    findReusablePlan(
      goalId: string,
      goalVersion: number,
    ): Promise<Readonly<{ plan: { planId: string } }> | undefined>;
  }>;
  readonly skillGoalScheduler: Readonly<{
    dispatchReady(
      planId: string,
      agentTaskId?: string,
    ): Promise<
      readonly (
        | Readonly<{
            kind: 'selected';
            attempt: SkillAttempt;
            skill: SkillVersion;
            selectionRecordId?: string;
          }>
        | Readonly<{
            kind: 'capability_gap';
            attempt: SkillAttempt;
            skillGoal: SkillGoal;
          }>
      )[]
    >;
    findAttempt(attemptId: string): Promise<SkillAttempt | undefined>;
    createExecutionContract(
      input: Readonly<{
        attempt: SkillAttempt;
        skill: SkillVersion;
        resolvedInput: unknown;
        selectionRecordId?: string;
      }>,
    ): Promise<
      Readonly<{
        attempt: SkillAttempt;
        contract: { executionContractId: string };
      }>
    >;
  }>;
  readonly temporarySkillSelection?: Readonly<{
    resolve(
      goalContract: GoalExecutionContract,
      task: AgentTask,
    ): Promise<Readonly<{ temporarySkillId: string; name: string; decisionSummary: string }>>;
  }>;
  readonly nextGoalId: () => string;
  readonly nextGoalTransitionId: () => string;
  readonly inputInference: Pick<GoalInputInferenceService, 'resolve'>;
  readonly taskInputs: Pick<
    TaskInputRepository,
    'findAttempt' | 'findResponseForAttempt' | 'listResponses' | 'updateAttempt'
  >;
  readonly requestTaskInput: (
    taskId: string,
    question: string,
    origin: Readonly<{ source: 'goal_deliberation' | 'skill_input_resolution' }>,
  ) => Promise<unknown>;
  readonly workflowContinuation: Readonly<{
    continueAfterInput(
      input: Readonly<{
        taskId: string;
        inputRequestId: string;
        controlId?: string;
        controlRoundIndex?: number;
        content: unknown;
      }>,
    ): Promise<unknown>;
  }>;
  readonly remoteTaskInput?: Readonly<{
    submitAnswer(inputRequestId: string, inputResponses: unknown): Promise<void>;
  }>;
  readonly taskPlanning: Readonly<{
    prepare(
      input: Readonly<{
        task: AgentTask;
        goalId: string;
        goalVersion: number;
        goalDescription: string;
        goalContract: GoalExecutionContract;
        skillId?: string;
        skillVersion?: number;
        temporarySkillId?: string;
        skillInputResolution?: Readonly<{
          resolutionId: string;
          structuredInput: unknown;
          sourceRefs: readonly string[];
        }>;
        skillGoalId?: string;
        skillAttemptId?: string;
      }>,
    ): Promise<Readonly<{ planId: string; autoConfirmed: boolean }>>;
    executeAuto(
      input: Readonly<{ taskId: string; planId: string; executionInput: unknown }>,
    ): Promise<void>;
  }>;
  readonly taskUnderstanding?: Readonly<{
    route(input: Readonly<{ requestText: string }>): CognitiveEntryRoute;
    understand(
      input: Pick<UnderstandGenericTaskInput, 'taskId' | 'contextId' | 'requestText'>,
    ): ReturnType<GenericTaskUnderstandingService['understand']>;
  }>;
}

/** EP-01 lifecycle increment: advances a queued task to the mandatory confirmation boundary. */
export class PlanPreparationProcessor {
  readonly #dependencies: PlanPreparationProcessorDependencies;

  constructor(dependencies: PlanPreparationProcessorDependencies) {
    this.#dependencies = dependencies;
  }

  async process(
    input: Readonly<{
      taskId: string;
      contextId: string;
      attemptId: string;
      mode: 'initial' | 'continue_after_input';
    }>,
  ): Promise<void> {
    const task = await this.#dependencies.tasks.findById(input.taskId);
    if (task === undefined)
      throw new TaskApplicationError('TASK_NOT_FOUND', `Task ${input.taskId} was not found.`);
    if (task.contextId !== input.contextId) throw new Error('TASK_CONTEXT_MISMATCH');
    const attempt = await this.#dependencies.taskInputs.findAttempt(input.attemptId);
    if (
      attempt?.taskId !== input.taskId ||
      attempt.contextId !== input.contextId ||
      attempt.status !== 'queued' ||
      (input.mode === 'initial'
        ? attempt.reason !== 'initial'
        : attempt.reason !== 'input_response')
    )
      throw new Error('TASK_EXECUTION_ATTEMPT_INVALID');
    await this.#dependencies.taskInputs.updateAttempt(
      input.attemptId,
      'running',
      this.#dependencies.clock.now(),
    );
    try {
      if (input.mode === 'initial') await this.#prepare(task);
      else await this.#continueAfterInput(task, input.attemptId);
      await this.#dependencies.taskInputs.updateAttempt(
        input.attemptId,
        'completed',
        this.#dependencies.clock.now(),
      );
    } catch (error: unknown) {
      await this.#dependencies.taskInputs.updateAttempt(
        input.attemptId,
        'failed',
        this.#dependencies.clock.now(),
        errorCode(error),
      );
      const latest = (await this.#dependencies.tasks.findById(task.taskId)) ?? task;
      if (!['failed', 'canceled', 'completed'].includes(latest.phase))
        await this.#transition(
          latest,
          'failed',
          `Task preparation failed with ${errorCode(error)}: ${errorMessage(error)}`,
        );
      throw error;
    }
  }

  async continueUserGoalPlan(taskId: string, userGoalPlanId: string): Promise<void> {
    const task = await this.#dependencies.tasks.findById(taskId);
    if (
      task?.userGoalPlanId !== userGoalPlanId ||
      task.goalId === undefined ||
      task.goalVersion === undefined
    )
      throw new Error('USER_GOAL_PLAN_CONTINUATION_BINDING_INVALID');
    const goal = await this.#dependencies.goals.get(task.goalId);
    if (goal.version !== task.goalVersion || goal.status !== 'active')
      throw new Error('USER_GOAL_PLAN_CONTINUATION_GOAL_STALE');
    await this.#scheduleUserGoalPlan(task, goal, userGoalPlanId);
  }

  async #prepare(initialTask: AgentTask): Promise<void> {
    let task = initialTask;
    task = await this.#transition(task, 'context_loading', 'Context loaded.');
    let requestText = task.requestText;
    if (this.#dependencies.taskUnderstanding?.route({ requestText }).kind === 'generic_task') {
      const understanding = await this.#dependencies.taskUnderstanding.understand({
        taskId: task.taskId,
        contextId: task.contextId,
        requestText,
      });
      task = await this.#transition(
        task,
        'goal_deliberation',
        `Task Understanding ${understanding.disposition}: ${understanding.objective}`,
      );
      if (
        understanding.disposition === 'clarification_required' ||
        understanding.disposition === 'confirmation_required'
      ) {
        const question = understanding.missingDimensions.find(
          (dimension) => dimension.severity === 'blocking',
        )?.question;
        await this.#dependencies.requestTaskInput(
          task.taskId,
          question ?? 'Additional Task Understanding input is required.',
          { source: 'goal_deliberation' },
        );
        return;
      }
      if (understanding.disposition === 'rejected') {
        throw new Error('TASK_UNDERSTANDING_REJECTED');
      }
      requestText = understanding.objective;
    }
    const intent = await this.#dependencies.decisions.decideIntent({
      requestText,
    });
    if (task.phase !== 'goal_deliberation') {
      task = await this.#transition(
        task,
        'goal_deliberation',
        `LLM intent ${intent.intent}: ${intent.summary}`,
      );
    }
    await this.#deliberateAndPlan(task, requestText);
  }

  async #continueAfterInput(task: AgentTask, attemptId: string): Promise<void> {
    const continuation = await this.#dependencies.taskInputs.findResponseForAttempt(attemptId);
    if (continuation === undefined) throw new Error('TASK_INPUT_CONTINUATION_NOT_FOUND');
    if (continuation.request.taskId !== task.taskId)
      throw new Error('TASK_INPUT_CONTINUATION_TASK_MISMATCH');
    if (continuation.request.source !== 'goal_deliberation') {
      if (continuation.request.source === 'remote_task') {
        if (this.#dependencies.remoteTaskInput === undefined)
          throw new Error('REMOTE_TASK_INPUT_CONTINUATION_UNAVAILABLE');
        await this.#dependencies.remoteTaskInput.submitAnswer(
          continuation.request.inputRequestId,
          continuation.response.content,
        );
        return;
      }
      if (continuation.request.source === 'skill_input_resolution') {
        await this.#continueSkillInputResolution(task);
        return;
      }
      await this.#dependencies.workflowContinuation.continueAfterInput({
        taskId: task.taskId,
        inputRequestId: continuation.request.inputRequestId,
        ...(continuation.request.controlId === undefined
          ? {}
          : { controlId: continuation.request.controlId }),
        ...(continuation.request.controlRoundIndex === undefined
          ? {}
          : { controlRoundIndex: continuation.request.controlRoundIndex }),
        content: continuation.response.content,
      });
      return;
    }
    const responses = await this.#dependencies.taskInputs.listResponses(task.taskId);
    await this.#deliberateAndPlan(task, effectiveRequestText(task.requestText, responses));
  }

  async #continueSkillInputResolution(task: AgentTask): Promise<void> {
    if (
      task.goalId === undefined ||
      task.goalVersion === undefined ||
      task.selectedSkillId === undefined ||
      task.selectedSkillVersion === undefined ||
      task.skillAttemptId === undefined ||
      task.skillGoalId === undefined
    )
      throw new Error('TASK_SKILL_INPUT_IDENTITY_INCOMPLETE');
    const [goal, skill, responses] = await Promise.all([
      this.#dependencies.goals.get(task.goalId),
      this.#dependencies.skills.findVersion(task.selectedSkillId, task.selectedSkillVersion),
      this.#dependencies.taskInputs.listResponses(task.taskId),
    ]);
    if (goal.version !== task.goalVersion || skill?.status !== 'enabled')
      throw new Error('TASK_SKILL_INPUT_IDENTITY_STALE');
    const resolution = await this.#dependencies.skillInputs.resolve({
      task,
      goal,
      skill,
      supplementaryInputs: responses,
    });
    if (resolution.status === 'input_required') {
      await this.#dependencies.requestTaskInput(
        task.taskId,
        skillInputResolutionQuestion(resolution),
        { source: 'skill_input_resolution' },
      );
      return;
    }
    if (resolution.status !== 'resolved' || resolution.structuredInput === undefined)
      throw new Error('TASK_SKILL_INPUT_NOT_RESOLVED');
    const attempt = await this.#dependencies.skillGoalScheduler.findAttempt(task.skillAttemptId);
    if (attempt?.skillGoalId !== task.skillGoalId)
      throw new Error('TASK_SKILL_ATTEMPT_BINDING_STALE');
    const execution = await this.#dependencies.skillGoalScheduler.createExecutionContract({
      attempt,
      skill,
      resolvedInput: resolution.structuredInput,
      ...(task.skillSelectionId === undefined ? {} : { selectionRecordId: task.skillSelectionId }),
    });
    const boundTask = bindTaskSkillExecutionContract(task, {
      executionContractId: execution.contract.executionContractId,
      timestamp: this.#dependencies.clock.now(),
    });
    await this.#dependencies.tasks.save(boundTask);
    await this.#plan(boundTask, goal, {
      skillId: skill.skillId,
      skillVersion: skill.version,
      resolution,
      skillGoalId: attempt.skillGoalId,
      skillAttemptId: attempt.attemptId,
    });
  }

  async #deliberateAndPlan(taskAtDeliberation: AgentTask, requestText: string): Promise<void> {
    let task = taskAtDeliberation;
    let goal = await this.#dependencies.goals.findActiveByContextId(task.contextId);
    let goalSummary = 'Continuing the active Goal for this context.';
    if (goal === undefined) {
      let goalDecision = await this.#dependencies.decisions.formulateGoal({
        requestText,
      });
      if (goalDecision.requiresInput) {
        const inference = await this.#dependencies.inputInference.resolve({
          taskId: task.taskId,
          contextId: task.contextId,
          requestText,
        });
        if (inference.outcome === 'input_required') {
          await this.#dependencies.requestTaskInput(
            task.taskId,
            inference.clarificationQuestion ?? 'Additional Goal input is required.',
            { source: 'goal_deliberation' },
          );
          return;
        }
        if (inference.inferredGoal === undefined) throw new Error('INFERRED_GOAL_REQUIRED');
        goalDecision = {
          ...inference.inferredGoal,
          requiresInput: false,
        };
      }
      const previousGoal = await this.#dependencies.goals.findLatestByContextId(task.contextId);
      const continuity =
        previousGoal === undefined
          ? undefined
          : await this.#dependencies.decisions.decideGoalContinuity({
              requestText,
              previousGoal: {
                goalId: previousGoal.goalId,
                title: previousGoal.title,
                description: previousGoal.description,
                constraints: previousGoal.constraints,
                successCriteria: previousGoal.successCriteria,
                status: previousGoal.status,
              },
            });
      const nextGoalId = this.#dependencies.nextGoalId();
      goalSummary = continuity?.decisionSummary ?? 'Created the first Goal for this context.';
      goal = await this.#dependencies.goals.create({
        goalId: nextGoalId,
        contextId: task.contextId,
        title: goalDecision.title,
        description: goalDecision.description,
        constraints: goalDecision.constraints,
        successCriteria: goalDecision.successCriteria,
        ...(continuity?.relationship === 'related_successor' && previousGoal !== undefined
          ? { previousGoalId: previousGoal.goalId }
          : {}),
        ...(continuity === undefined || previousGoal === undefined
          ? {}
          : {
              transition: {
                transitionId: this.#dependencies.nextGoalTransitionId(),
                contextId: task.contextId,
                fromGoalId: previousGoal.goalId,
                toGoalId: nextGoalId,
                relationship: continuity.relationship,
                decisionSummary: continuity.decisionSummary,
                requestText,
                createdAt: this.#dependencies.clock.now(),
              },
            }),
      });
    }
    task = bindTaskGoal(task, {
      goalId: goal.goalId,
      goalVersion: goal.version,
      timestamp: this.#dependencies.clock.now(),
    });
    await this.#dependencies.tasks.save(task);
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: task.taskId,
      contextId: task.contextId,
      eventType: 'task.phase_changed',
      timestamp: this.#dependencies.clock.now(),
      summary: goalSummary,
    });
    const userGoalPlan =
      (await this.#dependencies.userGoalPlanning.findReusablePlan(goal.goalId, goal.version)) ??
      (await this.#dependencies.userGoalPlanning.plan({ goal }));
    await this.#scheduleUserGoalPlan(task, goal, userGoalPlan.plan.planId);
  }

  async #scheduleUserGoalPlan(
    initialTask: AgentTask,
    goal: Awaited<ReturnType<GoalService['get']>>,
    userGoalPlanId: string,
  ): Promise<void> {
    let task = initialTask;
    const dispatches = await this.#dependencies.skillGoalScheduler.dispatchReady(
      userGoalPlanId,
      task.taskId,
    );
    const dispatch = dispatches[0];
    if (dispatch === undefined) throw new Error('USER_GOAL_PLAN_HAS_NO_READY_SKILL_GOAL');
    if (dispatch.kind === 'capability_gap') {
      if (this.#dependencies.temporarySkillSelection === undefined)
        throw new Error('SKILL_GOAL_NO_COMPATIBLE_SKILL');
      const temporary = await this.#dependencies.temporarySkillSelection.resolve(
        createGoalExecutionContract(goal),
        task,
      );
      task = await this.#transition(
        task,
        'skill_resolution',
        `Created task-scoped Temporary Skill ${temporary.name}: ${temporary.decisionSummary}`,
      );
      task = bindTaskTemporarySkill(task, {
        temporarySkillId: temporary.temporarySkillId,
        userGoalPlanId,
        skillGoalId: dispatch.attempt.skillGoalId,
        skillAttemptId: dispatch.attempt.attemptId,
        timestamp: this.#dependencies.clock.now(),
      });
      await this.#dependencies.tasks.save(task);
      await this.#plan(task, goal, { temporarySkillId: temporary.temporarySkillId });
      return;
    }
    const selection = dispatch.skill;
    task = await this.#transition(
      task,
      'skill_resolution',
      `Scheduled ${selection.skillId}@${String(selection.version)} from User Goal Plan ${userGoalPlanId}.`,
    );
    task = bindTaskSkill(task, {
      skillId: selection.skillId,
      skillVersion: selection.version,
      selectionId: dispatch.selectionRecordId ?? dispatch.attempt.attemptId,
      userGoalPlanId,
      skillGoalId: dispatch.attempt.skillGoalId,
      skillAttemptId: dispatch.attempt.attemptId,
      timestamp: this.#dependencies.clock.now(),
    });
    await this.#dependencies.tasks.save(task);
    const skill = await this.#dependencies.skills.findVersion(selection.skillId, selection.version);
    if (skill?.status !== 'enabled') throw new Error('SELECTED_SKILL_NOT_EXECUTABLE');
    const resolution = await this.#dependencies.skillInputs.resolve({
      task,
      goal,
      skill,
      supplementaryInputs: await this.#dependencies.taskInputs.listResponses(task.taskId),
    });
    if (resolution.status === 'input_required') {
      await this.#dependencies.requestTaskInput(
        task.taskId,
        skillInputResolutionQuestion(resolution),
        { source: 'skill_input_resolution' },
      );
      return;
    }
    if (resolution.status !== 'resolved' || resolution.structuredInput === undefined)
      throw new Error('TASK_SKILL_INPUT_NOT_RESOLVED');
    const execution = await this.#dependencies.skillGoalScheduler.createExecutionContract({
      attempt: dispatch.attempt,
      skill,
      resolvedInput: resolution.structuredInput,
      ...(dispatch.selectionRecordId === undefined
        ? {}
        : { selectionRecordId: dispatch.selectionRecordId }),
    });
    task = bindTaskSkillExecutionContract(task, {
      executionContractId: execution.contract.executionContractId,
      timestamp: this.#dependencies.clock.now(),
    });
    await this.#dependencies.tasks.save(task);
    await this.#plan(task, goal, {
      skillId: skill.skillId,
      skillVersion: skill.version,
      resolution,
      skillGoalId: dispatch.attempt.skillGoalId,
      skillAttemptId: dispatch.attempt.attemptId,
    });
  }

  async #plan(
    taskBeforePlanning: AgentTask,
    goal: Awaited<ReturnType<GoalService['get']>>,
    selected:
      | Readonly<{
          skillId: string;
          skillVersion: number;
          resolution: Readonly<{
            resolutionId: string;
            structuredInput?: unknown;
            sourceRefs: readonly string[];
          }>;
          skillGoalId: string;
          skillAttemptId: string;
        }>
      | Readonly<{ temporarySkillId: string }>,
  ): Promise<void> {
    let task = taskBeforePlanning;
    if (task.phase !== 'planning')
      task = await this.#transition(task, 'planning', 'Workflow planning required.');
    const prepared = await this.#dependencies.taskPlanning.prepare({
      task,
      goalId: goal.goalId,
      goalVersion: goal.version,
      goalDescription: goal.description,
      goalContract: createGoalExecutionContract(goal),
      ...(task.skillGoalId === undefined ? {} : { skillGoalId: task.skillGoalId }),
      ...(task.skillAttemptId === undefined ? {} : { skillAttemptId: task.skillAttemptId }),
      ...('temporarySkillId' in selected
        ? { temporarySkillId: selected.temporarySkillId }
        : {
            skillId: selected.skillId,
            skillVersion: selected.skillVersion,
            skillInputResolution: {
              resolutionId: selected.resolution.resolutionId,
              structuredInput: selected.resolution.structuredInput,
              sourceRefs: selected.resolution.sourceRefs,
            },
          }),
    });
    task = bindTaskPlan(task, {
      planId: prepared.planId,
      goalId: goal.goalId,
      goalVersion: goal.version,
      ...('temporarySkillId' in selected
        ? {}
        : { skillInputResolutionId: selected.resolution.resolutionId }),
      timestamp: this.#dependencies.clock.now(),
    });
    await this.#dependencies.tasks.save(task);
    if (!prepared.autoConfirmed) {
      await this.#transition(task, 'awaiting_plan_confirmation', 'Plan confirmation required.');
      return;
    }
    task = await this.#transition(task, 'executing', 'Skill policy auto-confirmed the plan.');
    await this.#dependencies.taskPlanning.executeAuto({
      taskId: task.taskId,
      planId: prepared.planId,
      executionInput:
        'temporarySkillId' in selected
          ? await this.#temporarySkillExecutionInput(task.taskId, task.requestText)
          : selected.resolution.structuredInput,
    });
  }

  async #temporarySkillExecutionInput(taskId: string, requestText: string): Promise<unknown> {
    const responses = await this.#dependencies.taskInputs.listResponses(taskId);
    return {
      requestText,
      supplementaryInputs: responses.map((response) => ({
        inputRequestId: response.inputRequestId,
        content: response.content,
      })),
    };
  }

  async #transition(task: AgentTask, phase: TaskPhase, message: string): Promise<AgentTask> {
    const timestamp = this.#dependencies.clock.now();
    const next = transitionTask(task, phase, message, timestamp);
    await this.#dependencies.tasks.save(next);
    await this.#dependencies.events.publish({
      eventId: this.#dependencies.ids.nextId('event'),
      taskId: next.taskId,
      contextId: next.contextId,
      eventType: 'task.phase_changed',
      timestamp,
      summary: message,
    });
    return next;
  }
}

function effectiveRequestText(
  requestText: string,
  responses: readonly Readonly<{ inputRequestId: string; content: unknown }>[],
): string {
  if (responses.length === 0) return requestText;
  return `${requestText}\n\nSupplementary inputs:\n${responses
    .map(
      (response) =>
        `- ${response.inputRequestId}: ${typeof response.content === 'string' ? response.content : JSON.stringify(response.content)}`,
    )
    .join('\n')}`;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'TASK_PREPARATION_FAILED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown preparation failure.';
}
