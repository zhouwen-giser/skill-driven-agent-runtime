import { transitionTask, type AgentTask, type TaskPhase } from '../../domain/src/index.js';

import type {
  AgentTaskRepository,
  Clock,
  IdentifierGenerator,
  RuntimeEventPublisher,
} from './ports.js';
import { TaskApplicationError } from './task-service.js';

export interface PlanPreparationProcessorDependencies {
  readonly tasks: AgentTaskRepository;
  readonly events: RuntimeEventPublisher;
  readonly clock: Clock;
  readonly ids: IdentifierGenerator;
}

/** EP-01 lifecycle increment: advances a queued task to the mandatory confirmation boundary. */
export class PlanPreparationProcessor {
  readonly #dependencies: PlanPreparationProcessorDependencies;

  constructor(dependencies: PlanPreparationProcessorDependencies) {
    this.#dependencies = dependencies;
  }

  async process(input: Readonly<{ taskId: string; contextId: string }>): Promise<void> {
    let task = await this.#dependencies.tasks.findById(input.taskId);
    if (task === undefined)
      throw new TaskApplicationError('TASK_NOT_FOUND', `Task ${input.taskId} was not found.`);
    if (task.contextId !== input.contextId) throw new Error('TASK_CONTEXT_MISMATCH');
    const steps: readonly Readonly<{ phase: TaskPhase; message: string }>[] = [
      { phase: 'context_loading', message: 'Context loaded.' },
      { phase: 'goal_deliberation', message: 'Goal deliberation completed.' },
      { phase: 'skill_resolution', message: 'Candidate skills resolved.' },
      { phase: 'planning', message: 'Plan prepared.' },
      { phase: 'awaiting_plan_confirmation', message: 'Plan confirmation required.' },
    ];
    for (const step of steps) task = await this.#transition(task, step.phase, step.message);
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
