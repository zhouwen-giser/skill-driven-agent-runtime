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
  | 'failed'
  | 'invalidated';

export type TaskTerminalPhase = Extract<
  TaskPhase,
  'completed' | 'canceled' | 'failed' | 'invalidated'
>;

export interface TaskOutput {
  readonly text: string;
  readonly structured: unknown;
}

export interface TaskCapabilityGap {
  readonly evaluationSummary: string;
  readonly missingCapability: string;
  readonly suggestedToolContract: Readonly<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>;
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
  readonly planId?: string;
  readonly selectedSkillId?: string;
  readonly selectedSkillVersion?: number;
  readonly output?: TaskOutput;
  readonly capabilityGap?: TaskCapabilityGap;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function bindTaskPlan(
  task: AgentTask,
  input: Readonly<{ goalId: string; goalVersion: number; planId: string; timestamp: string }>,
): AgentTask {
  if (task.phase !== 'awaiting_plan_confirmation' && task.phase !== 'planning')
    throw new DomainError(
      'TASK_PHASE_TRANSITION_INVALID',
      'A plan can be attached only while planning or awaiting confirmation.',
    );
  return {
    ...task,
    goalId: requireIdentifier(input.goalId, 'GOAL_ID_REQUIRED'),
    goalVersion: input.goalVersion,
    planId: requireIdentifier(input.planId, 'WORKFLOW_PLAN_ID_REQUIRED'),
    updatedAt: input.timestamp,
  };
}

export function bindTaskGoal(
  task: AgentTask,
  input: Readonly<{ goalId: string; goalVersion: number; timestamp: string }>,
): AgentTask {
  if (task.phase !== 'goal_deliberation')
    throw new DomainError(
      'TASK_PHASE_TRANSITION_INVALID',
      'A Goal can be bound only during Goal deliberation.',
    );
  return {
    ...task,
    goalId: requireIdentifier(input.goalId, 'GOAL_ID_REQUIRED'),
    goalVersion: input.goalVersion,
    updatedAt: input.timestamp,
  };
}

export function bindTaskSkill(
  task: AgentTask,
  input: Readonly<{ skillId: string; skillVersion: number; timestamp: string }>,
): AgentTask {
  if (task.phase !== 'skill_resolution')
    throw new DomainError(
      'TASK_PHASE_TRANSITION_INVALID',
      'A selected Skill can be bound only during Skill resolution.',
    );
  if (!Number.isInteger(input.skillVersion) || input.skillVersion < 1)
    throw new DomainError('SKILL_VERSION_INVALID', 'Selected Skill version must be positive.');
  return {
    ...task,
    selectedSkillId: requireIdentifier(input.skillId, 'SKILL_ID_REQUIRED'),
    selectedSkillVersion: input.skillVersion,
    updatedAt: input.timestamp,
  };
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
  executing: [
    'paused',
    'planning',
    'evaluating',
    'awaiting_user_input',
    'capability_gap',
    'canceled',
    'failed',
  ],
  evaluating: [
    'planning',
    'completed',
    'awaiting_user_input',
    'capability_gap',
    'canceled',
    'failed',
  ],
  capability_gap: ['skill_resolution', 'canceled', 'failed'],
  completed: [],
  canceled: [],
  failed: [],
  invalidated: [],
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

export function recordTaskCapabilityGap(
  task: AgentTask,
  capabilityGap: TaskCapabilityGap,
  timestamp: string,
): AgentTask {
  const waiting = transitionTask(
    task,
    'capability_gap',
    `Required capability is unavailable: ${capabilityGap.missingCapability}`,
    timestamp,
  );
  return { ...waiting, capabilityGap };
}

export function failTask(task: AgentTask, errorCode: string, timestamp: string): AgentTask {
  const failed = transitionTask(task, 'failed', 'Task failed.', timestamp);
  return { ...failed, errorCode };
}

export function isTerminalTaskPhase(phase: TaskPhase): phase is TaskTerminalPhase {
  return (
    phase === 'completed' || phase === 'canceled' || phase === 'failed' || phase === 'invalidated'
  );
}
