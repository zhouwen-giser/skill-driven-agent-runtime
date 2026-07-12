import {
  bindTaskPlan,
  bindTaskGoal,
  bindTaskSkill,
  bindTaskTemporarySkill,
  transitionTask,
  type AgentTask,
  type TaskPhase,
} from '../../domain/src/index.js';

import type {
  AgentTaskRepository,
  Clock,
  IdentifierGenerator,
  RuntimeEventPublisher,
} from './ports.js';
import type { GoalService } from './goal-service.js';
import type { StructuredTaskDecisionService } from './model-decisions.js';
import type { GoalInputInferenceService } from './goal-input-inference.js';
import type { SkillSelectionRecord } from '../../domain/src/index.js';
import { TaskApplicationError } from './task-service.js';

export interface PlanPreparationProcessorDependencies {
  readonly tasks: AgentTaskRepository;
  readonly events: RuntimeEventPublisher;
  readonly clock: Clock;
  readonly ids: IdentifierGenerator;
  readonly decisions: Pick<
    StructuredTaskDecisionService,
    'decideGoalContinuity' | 'decideIntent' | 'formulateGoal'
  >;
  readonly goals: Pick<GoalService, 'create' | 'findActiveByContextId' | 'findLatestByContextId'>;
  readonly skillSelection: Readonly<{
    select(
      goalDescription: string,
      task: AgentTask,
    ): Promise<
      | SkillSelectionRecord
      | Readonly<{ temporarySkillId: string; name: string; decisionSummary: string }>
    >;
  }>;
  readonly nextGoalId: () => string;
  readonly nextGoalTransitionId: () => string;
  readonly inputInference: Pick<GoalInputInferenceService, 'resolve'>;
  readonly taskPlanning: Readonly<{
    prepare(
      input: Readonly<{
        task: AgentTask;
        goalId: string;
        goalVersion: number;
        goalDescription: string;
        skillId?: string;
        skillVersion?: number;
        temporarySkillId?: string;
      }>,
    ): Promise<Readonly<{ planId: string; autoConfirmed: boolean }>>;
    executeAuto(input: Readonly<{ taskId: string; planId: string }>): Promise<void>;
  }>;
}

/** EP-01 lifecycle increment: advances a queued task to the mandatory confirmation boundary. */
export class PlanPreparationProcessor {
  readonly #dependencies: PlanPreparationProcessorDependencies;

  constructor(dependencies: PlanPreparationProcessorDependencies) {
    this.#dependencies = dependencies;
  }

  async process(input: Readonly<{ taskId: string; contextId: string }>): Promise<void> {
    const task = await this.#dependencies.tasks.findById(input.taskId);
    if (task === undefined)
      throw new TaskApplicationError('TASK_NOT_FOUND', `Task ${input.taskId} was not found.`);
    if (task.contextId !== input.contextId) throw new Error('TASK_CONTEXT_MISMATCH');
    try {
      await this.#prepare(task);
    } catch (error: unknown) {
      const latest = (await this.#dependencies.tasks.findById(task.taskId)) ?? task;
      if (!['failed', 'canceled', 'completed'].includes(latest.phase))
        await this.#transition(
          latest,
          'failed',
          `Task preparation failed with ${errorCode(error)}.`,
        );
      throw error;
    }
  }

  async #prepare(initialTask: AgentTask): Promise<void> {
    let task = initialTask;
    task = await this.#transition(task, 'context_loading', 'Context loaded.');
    const intent = await this.#dependencies.decisions.decideIntent({
      requestText: task.requestText,
    });
    task = await this.#transition(
      task,
      'goal_deliberation',
      `LLM intent ${intent.intent}: ${intent.summary}`,
    );
    let goal = await this.#dependencies.goals.findActiveByContextId(task.contextId);
    let goalSummary = 'Continuing the active Goal for this context.';
    if (goal === undefined) {
      let goalDecision = await this.#dependencies.decisions.formulateGoal({
        requestText: task.requestText,
      });
      if (goalDecision.requiresInput) {
        const inference = await this.#dependencies.inputInference.resolve({
          taskId: task.taskId,
          contextId: task.contextId,
          requestText: task.requestText,
        });
        if (inference.outcome === 'input_required') {
          await this.#transition(
            task,
            'awaiting_user_input',
            inference.clarificationQuestion ?? 'Additional Goal input is required.',
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
              requestText: task.requestText,
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
                requestText: task.requestText,
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
    const selection = await this.#dependencies.skillSelection.select(goal.description, task);
    const temporary = 'temporarySkillId' in selection;
    task = await this.#transition(
      task,
      'skill_resolution',
      temporary
        ? `Created task-scoped Temporary Skill ${selection.name}: ${selection.decisionSummary}`
        : `LLM selected ${selection.selectedSkillId}@${String(selection.selectedSkillVersion)}: ${selection.decisionSummary}`,
    );
    task = temporary
      ? bindTaskTemporarySkill(task, {
          temporarySkillId: selection.temporarySkillId,
          timestamp: this.#dependencies.clock.now(),
        })
      : bindTaskSkill(task, {
          skillId: selection.selectedSkillId,
          skillVersion: selection.selectedSkillVersion,
          selectionId: selection.selectionId,
          timestamp: this.#dependencies.clock.now(),
        });
    await this.#dependencies.tasks.save(task);
    task = await this.#transition(task, 'planning', 'Workflow planning required.');
    const prepared = await this.#dependencies.taskPlanning.prepare({
      task,
      goalId: goal.goalId,
      goalVersion: goal.version,
      goalDescription: goal.description,
      ...(temporary
        ? { temporarySkillId: selection.temporarySkillId }
        : {
            skillId: selection.selectedSkillId,
            skillVersion: selection.selectedSkillVersion,
          }),
    });
    task = bindTaskPlan(task, {
      planId: prepared.planId,
      goalId: goal.goalId,
      goalVersion: goal.version,
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
    });
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

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'TASK_PREPARATION_FAILED';
}
