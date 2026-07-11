export type DomainErrorCode =
  | 'CONTEXT_ID_REQUIRED'
  | 'GOAL_CONTEXT_MISMATCH'
  | 'GOAL_ID_REQUIRED'
  | 'GOAL_VERSION_INVALID'
  | 'TASK_ID_REQUIRED'
  | 'TASK_PHASE_TRANSITION_INVALID'
  | 'TASK_TERMINAL_MUTATION_FORBIDDEN'
  | 'USER_ID_INVALID';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, string>>;

  constructor(
    code: DomainErrorCode,
    message: string,
    details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
