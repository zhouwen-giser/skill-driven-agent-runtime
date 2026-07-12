export interface TaskWaitPolicy {
  readonly timeoutSeconds: number;
  readonly updatedAt: string;
}

export function createTaskWaitPolicy(timeoutSeconds: number, updatedAt: string): TaskWaitPolicy {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
    throw new DomainError(
      'TASK_WAIT_TIMEOUT_INVALID',
      'Task wait timeout must be a positive integer number of seconds.',
    );
  }
  return { timeoutSeconds, updatedAt };
}
import { DomainError } from './errors.js';
