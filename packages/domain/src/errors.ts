export type DomainErrorCode =
  | 'MCP_ENDPOINT_INVALID'
  | 'MCP_SERVER_ID_REQUIRED'
  | 'MCP_SERVER_NAME_REQUIRED'
  | 'MCP_TOOL_NAME_REQUIRED'
  | 'MCP_TOOL_ENHANCEMENT_INVALID'
  | 'MCP_TOOL_REVISION_INVALID'
  | 'CONTEXT_ID_REQUIRED'
  | 'GOAL_CONTEXT_MISMATCH'
  | 'GOAL_ID_REQUIRED'
  | 'GOAL_VERSION_INVALID'
  | 'SKILL_DRAFT_ID_REQUIRED'
  | 'SKILL_DESCRIPTION_REQUIRED'
  | 'SKILL_ENABLE_REQUIRES_VALIDATION'
  | 'SKILL_ID_REQUIRED'
  | 'SKILL_TOOL_POLICY_OVERLAP'
  | 'SKILL_VERSION_INVALID'
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
