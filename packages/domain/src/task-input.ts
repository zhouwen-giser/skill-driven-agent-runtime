import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

export type TaskInputRequestSource =
  'goal_deliberation' | 'skill_input_resolution' | 'goal_evaluation' | 'workflow';
export type TaskInputRequestStatus = 'waiting' | 'answered' | 'expired' | 'canceled';

export interface TaskInputRequest {
  readonly inputRequestId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly source: TaskInputRequestSource;
  readonly question: string;
  readonly status: TaskInputRequestStatus;
  readonly controlId?: string;
  readonly controlRoundIndex?: number;
  readonly createdAt: string;
  readonly answeredAt?: string;
}

export interface TaskInputResponse {
  readonly inputResponseId: string;
  readonly inputRequestId: string;
  readonly taskId: string;
  readonly content: unknown;
  readonly createdAt: string;
}

export type TaskExecutionAttemptReason = 'initial' | 'input_response';
export type TaskExecutionAttemptStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TaskExecutionAttempt {
  readonly attemptId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly reason: TaskExecutionAttemptReason;
  readonly status: TaskExecutionAttemptStatus;
  readonly inputRequestId?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly errorCode?: string;
}

export function createTaskInputRequest(
  input: Omit<TaskInputRequest, 'status' | 'answeredAt'>,
): TaskInputRequest {
  const question = input.question.trim();
  if (question === '')
    throw new DomainError('TASK_INPUT_QUESTION_REQUIRED', 'An input request question is required.');
  if (
    input.controlRoundIndex !== undefined &&
    (!Number.isInteger(input.controlRoundIndex) || input.controlRoundIndex < 0)
  )
    throw new DomainError(
      'TASK_INPUT_CONTROL_ROUND_INVALID',
      'An input request control round must be a non-negative integer.',
    );
  if ((input.controlId === undefined) !== (input.controlRoundIndex === undefined))
    throw new DomainError(
      'TASK_INPUT_CONTROL_ROUND_INVALID',
      'An input request must provide both control identity and control round, or neither.',
    );
  return {
    ...input,
    inputRequestId: requireIdentifier(input.inputRequestId, 'TASK_INPUT_REQUEST_ID_REQUIRED'),
    taskId: requireIdentifier(input.taskId, 'TASK_ID_REQUIRED'),
    contextId: requireIdentifier(input.contextId, 'CONTEXT_ID_REQUIRED'),
    question,
    status: 'waiting',
  };
}

export function createTaskExecutionAttempt(
  input: Omit<TaskExecutionAttempt, 'status' | 'startedAt' | 'completedAt' | 'errorCode'>,
): TaskExecutionAttempt {
  if (input.reason === 'input_response' && input.inputRequestId === undefined)
    throw new DomainError(
      'TASK_ATTEMPT_INPUT_REQUEST_REQUIRED',
      'An input-response attempt must identify its input request.',
    );
  return {
    ...input,
    attemptId: requireIdentifier(input.attemptId, 'TASK_ATTEMPT_ID_REQUIRED'),
    taskId: requireIdentifier(input.taskId, 'TASK_ID_REQUIRED'),
    contextId: requireIdentifier(input.contextId, 'CONTEXT_ID_REQUIRED'),
    status: 'queued',
  };
}
