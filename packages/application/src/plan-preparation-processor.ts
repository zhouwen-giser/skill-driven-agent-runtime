import {
  bindTaskGoal,
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
import type { SkillSelectionService } from './skill-selection.js';
import { TaskApplicationError } from './task-service.js';

export interface PlanPreparationProcessorDependencies {
  readonly tasks: AgentTaskRepository;
  readonly events: RuntimeEventPublisher;
  readonly clock: Clock;
  readonly ids: IdentifierGenerator;
  readonly decisions: Pick<StructuredTaskDecisionService, 'decideIntent' | 'formulateGoal'>;
  readonly goals: Pick<GoalService, 'create'>;
  readonly skillSelection: Pick<SkillSelectionService, 'select'>;
  readonly nextGoalId: () => string;
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
    const goalDecision = await this.#dependencies.decisions.formulateGoal({
      requestText: task.requestText,
    });
    if (goalDecision.requiresInput) {
      await this.#transition(
        task,
        'awaiting_user_input',
        goalDecision.clarificationQuestion ?? 'Additional Goal input is required.',
      );
      return;
    }
    const goal = await this.#dependencies.goals.create({
      goalId: this.#dependencies.nextGoalId(),
      contextId: task.contextId,
      title: goalDecision.title,
      description: goalDecision.description,
      constraints: goalDecision.constraints,
      successCriteria: goalDecision.successCriteria,
    });
    task = bindTaskGoal(task, {
      goalId: goal.goalId,
      goalVersion: goal.version,
      timestamp: this.#dependencies.clock.now(),
    });
    await this.#dependencies.tasks.save(task);
    const selection = await this.#dependencies.skillSelection.select(goal.description);
    task = await this.#transition(
      task,
      'skill_resolution',
      `LLM selected ${selection.selectedSkillId}@${String(selection.selectedSkillVersion)}: ${selection.decisionSummary}`,
    );
    task = await this.#transition(task, 'planning', 'Workflow planning required.');
    await this.#transition(task, 'awaiting_plan_confirmation', 'Plan confirmation required.');
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
