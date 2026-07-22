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
  'capability_gap' | 'completed' | 'canceled' | 'failed' | 'invalidated'
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
  readonly skillSelectionId?: string;
  readonly userGoalPlanId?: string;
  readonly skillGoalId?: string;
  readonly skillAttemptId?: string;
  readonly skillExecutionContractId?: string;
  readonly skillInputResolutionId?: string;
  readonly temporarySkillId?: string;
  readonly output?: TaskOutput;
  readonly capabilityGap?: TaskCapabilityGap;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function bindTaskPlan(
  task: AgentTask,
  input: Readonly<{
    goalId: string;
    goalVersion: number;
    planId: string;
    skillInputResolutionId?: string;
    timestamp: string;
  }>,
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
    ...(input.skillInputResolutionId === undefined
      ? {}
      : {
          skillInputResolutionId: requireIdentifier(
            input.skillInputResolutionId,
            'SKILL_INPUT_RESOLUTION_ID_REQUIRED',
          ),
        }),
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
  input: Readonly<{
    skillId: string;
    skillVersion: number;
    selectionId: string;
    userGoalPlanId?: string;
    skillGoalId?: string;
    skillAttemptId?: string;
    timestamp: string;
  }>,
): AgentTask {
  if (task.phase !== 'skill_resolution')
    throw new DomainError(
      'TASK_PHASE_TRANSITION_INVALID',
      'A selected Skill can be bound only during Skill resolution.',
    );
  if (!Number.isInteger(input.skillVersion) || input.skillVersion < 1)
    throw new DomainError('SKILL_VERSION_INVALID', 'Selected Skill version must be positive.');
  const executionBinding = [input.userGoalPlanId, input.skillGoalId, input.skillAttemptId];
  if (
    executionBinding.some((value) => value !== undefined) &&
    executionBinding.some((value) => value === undefined)
  )
    throw new DomainError(
      'SKILL_ATTEMPT_INVALID',
      'User Goal Plan, Skill Goal and Skill Attempt bindings must be attached together.',
    );
  return {
    ...withoutSkillInputResolution(task),
    selectedSkillId: requireIdentifier(input.skillId, 'SKILL_ID_REQUIRED'),
    selectedSkillVersion: input.skillVersion,
    skillSelectionId: requireIdentifier(input.selectionId, 'SKILL_SELECTION_ID_REQUIRED'),
    ...(input.userGoalPlanId === undefined
      ? {}
      : {
          userGoalPlanId: requireIdentifier(input.userGoalPlanId, 'USER_GOAL_PLAN_INVALID'),
          skillGoalId: requireIdentifier(input.skillGoalId ?? '', 'SKILL_ATTEMPT_INVALID'),
          skillAttemptId: requireIdentifier(input.skillAttemptId ?? '', 'SKILL_ATTEMPT_INVALID'),
        }),
    updatedAt: input.timestamp,
  };
}

export function bindTaskSkillExecutionContract(
  task: AgentTask,
  input: Readonly<{ executionContractId: string; timestamp: string }>,
): AgentTask {
  if (task.skillAttemptId === undefined || task.selectedSkillId === undefined)
    throw new DomainError(
      'SKILL_ATTEMPT_INVALID',
      'A Skill execution contract requires an existing Skill Attempt binding.',
    );
  return {
    ...task,
    skillExecutionContractId: requireIdentifier(input.executionContractId, 'SKILL_ATTEMPT_INVALID'),
    updatedAt: input.timestamp,
  };
}

export function bindTaskReplacement(
  task: AgentTask,
  input: Readonly<{
    planId: string;
    skillId: string;
    skillVersion: number;
    timestamp: string;
  }>,
): AgentTask {
  if (task.phase !== 'planning')
    throw new DomainError(
      'TASK_PHASE_TRANSITION_INVALID',
      'A replacement Skill and plan can be bound only while planning.',
    );
  if (!Number.isInteger(input.skillVersion) || input.skillVersion < 1)
    throw new DomainError('SKILL_VERSION_INVALID', 'Replacement Skill version must be positive.');
  return {
    ...withoutSkillInputResolution(task),
    planId: requireIdentifier(input.planId, 'WORKFLOW_PLAN_ID_REQUIRED'),
    selectedSkillId: requireIdentifier(input.skillId, 'SKILL_ID_REQUIRED'),
    selectedSkillVersion: input.skillVersion,
    updatedAt: input.timestamp,
  };
}

export function bindTaskTemporarySkill(
  task: AgentTask,
  input: Readonly<{
    temporarySkillId: string;
    userGoalPlanId?: string;
    skillGoalId?: string;
    skillAttemptId?: string;
    timestamp: string;
  }>,
): AgentTask {
  if (task.phase !== 'skill_resolution')
    throw new DomainError(
      'TASK_PHASE_TRANSITION_INVALID',
      'A Temporary Skill can be bound only during Skill resolution.',
    );
  const hasRuntimeBinding =
    input.userGoalPlanId !== undefined ||
    input.skillGoalId !== undefined ||
    input.skillAttemptId !== undefined;
  if (
    hasRuntimeBinding &&
    (input.userGoalPlanId === undefined ||
      input.skillGoalId === undefined ||
      input.skillAttemptId === undefined)
  )
    throw new DomainError(
      'TASK_USER_GOAL_RUNTIME_BINDING_INCOMPLETE',
      'Temporary Skill runtime binding requires plan, Skill Goal and Attempt identity together.',
    );
  return {
    ...withoutSkillInputResolution(task),
    temporarySkillId: requireIdentifier(input.temporarySkillId, 'TEMPORARY_SKILL_ID_REQUIRED'),
    ...(input.userGoalPlanId === undefined
      ? {}
      : {
          userGoalPlanId: requireIdentifier(input.userGoalPlanId, 'USER_GOAL_PLAN_ID_REQUIRED'),
          skillGoalId: requireIdentifier(input.skillGoalId ?? '', 'SKILL_GOAL_ID_REQUIRED'),
          skillAttemptId: requireIdentifier(
            input.skillAttemptId ?? '',
            'SKILL_ATTEMPT_ID_REQUIRED',
          ),
        }),
    updatedAt: input.timestamp,
  };
}

function withoutSkillInputResolution(task: AgentTask): AgentTask {
  const unboundTask = { ...task };
  delete unboundTask.skillInputResolutionId;
  delete unboundTask.skillExecutionContractId;
  return unboundTask;
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
  skill_resolution: ['planning', 'awaiting_user_input', 'capability_gap', 'canceled', 'failed'],
  planning: [
    'awaiting_plan_confirmation',
    'awaiting_user_input',
    'executing',
    'canceled',
    'failed',
  ],
  awaiting_plan_confirmation: ['planning', 'executing', 'canceled', 'failed'],
  awaiting_user_input: ['goal_deliberation', 'planning', 'executing', 'canceled', 'failed'],
  paused: ['executing', 'planning', 'canceled', 'failed'],
  executing: [
    'paused',
    'planning',
    'awaiting_plan_confirmation',
    'evaluating',
    'awaiting_user_input',
    'capability_gap',
    'canceled',
    'failed',
    'skill_resolution',
  ],
  evaluating: [
    'skill_resolution',
    'planning',
    'completed',
    'awaiting_user_input',
    'capability_gap',
    'canceled',
    'failed',
  ],
  capability_gap: [],
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
  if (
    capabilityGap.evaluationSummary.trim() === '' ||
    capabilityGap.missingCapability.trim() === '' ||
    capabilityGap.suggestedToolContract.name.trim() === '' ||
    capabilityGap.suggestedToolContract.description.trim() === ''
  )
    throw new DomainError(
      'TASK_CAPABILITY_GAP_EVIDENCE_INVALID',
      'Capability-gap terminal evidence requires non-empty displayable fields.',
    );
  const terminal = transitionTask(
    task,
    'capability_gap',
    `Required capability is unavailable: ${capabilityGap.missingCapability}`,
    timestamp,
  );
  return { ...terminal, capabilityGap, errorCode: 'CAPABILITY_GAP' };
}

export function failTask(task: AgentTask, errorCode: string, timestamp: string): AgentTask {
  const failed = transitionTask(task, 'failed', 'Task failed.', timestamp);
  return { ...failed, errorCode };
}

export function isTerminalTaskPhase(phase: TaskPhase): phase is TaskTerminalPhase {
  return (
    phase === 'capability_gap' ||
    phase === 'completed' ||
    phase === 'canceled' ||
    phase === 'failed' ||
    phase === 'invalidated'
  );
}
