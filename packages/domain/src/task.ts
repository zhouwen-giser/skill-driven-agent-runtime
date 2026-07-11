import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

export type TaskPhase =
  | 'queued'
  | 'context_loading'
  | 'goal_deliberation'
  | 'skill_resolution'
  | 'planning'
  | 'awaiting_plan_confirmation'
  | 'awaiting_user_input'
  | 'paused'
  | 'executing'
  | 'evaluating'
  | 'capability_gap'
  | 'completed'
  | 'canceled'
  | 'failed';

export type TaskTerminalPhase = Extract<TaskPhase, 'completed' | 'canceled' | 'failed'>;

export interface TaskOutput {
  readonly text: string;
  readonly structured: unknown;
}

export interface AgentTask {
  readonly taskId: string;
  readonly contextId: string;
  readonly userId: string;
  readonly requestText: string;
  readonly requestMetadata: Readonly<Record<string, unknown>>;
  readonly phase: TaskPhase;
  readonly phaseMessage: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly output?: TaskOutput;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAgentTaskInput {
  readonly taskId: string;
  readonly contextId: string;
  readonly userId: string;
  readonly requestText: string;
  readonly requestMetadata: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
}

const allowedTransitions: Readonly<Record<TaskPhase, readonly TaskPhase[]>> = {
  queued: ['context_loading', 'canceled', 'failed'],
  context_loading: ['goal_deliberation', 'canceled', 'failed'],
  goal_deliberation: ['skill_resolution', 'awaiting_user_input', 'canceled', 'failed'],
  skill_resolution: ['planning', 'capability_gap', 'canceled', 'failed'],
  planning: ['awaiting_plan_confirmation', 'executing', 'canceled', 'failed'],
  awaiting_plan_confirmation: ['planning', 'executing', 'canceled', 'failed'],
  awaiting_user_input: ['goal_deliberation', 'canceled', 'failed'],
  paused: ['executing', 'planning', 'canceled', 'failed'],
  executing: ['paused', 'evaluating', 'awaiting_user_input', 'canceled', 'failed'],
  evaluating: ['planning', 'completed', 'awaiting_user_input', 'canceled', 'failed'],
  capability_gap: ['skill_resolution', 'canceled', 'failed'],
  completed: [],
  canceled: [],
  failed: [],
};

export function createAgentTask(input: CreateAgentTaskInput): AgentTask {
  return {
    taskId: requireIdentifier(input.taskId, 'TASK_ID_REQUIRED'),
    contextId: requireIdentifier(input.contextId, 'CONTEXT_ID_REQUIRED'),
    userId: input.userId,
    requestText: input.requestText,
    requestMetadata: input.requestMetadata,
    phase: 'queued',
    phaseMessage: 'Task queued.',
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function transitionTask(
  task: AgentTask,
  phase: TaskPhase,
  phaseMessage: string,
  timestamp: string,
): AgentTask {
  if (!allowedTransitions[task.phase].includes(phase)) {
    throw new DomainError(
      'TASK_PHASE_TRANSITION_INVALID',
      'Task phase transition is not allowed.',
      {
        taskId: task.taskId,
        from: task.phase,
        to: phase,
      },
    );
  }
  return { ...task, phase, phaseMessage, updatedAt: timestamp };
}

export function completeTask(task: AgentTask, output: TaskOutput, timestamp: string): AgentTask {
  const completed = transitionTask(task, 'completed', 'Task completed.', timestamp);
  return { ...completed, output };
}

export function failTask(task: AgentTask, errorCode: string, timestamp: string): AgentTask {
  const failed = transitionTask(task, 'failed', 'Task failed.', timestamp);
  return { ...failed, errorCode };
}

export function isTerminalTaskPhase(phase: TaskPhase): phase is TaskTerminalPhase {
  return phase === 'completed' || phase === 'canceled' || phase === 'failed';
}
