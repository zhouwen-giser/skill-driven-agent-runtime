import { DomainError } from './errors.js';

export const ANONYMOUS_USER_ID = 'anonymous' as const;

export function normalizeUserId(userId: string | undefined): string {
  const normalized = userId?.trim();
  if (normalized === undefined || normalized === '') return ANONYMOUS_USER_ID;
  if (normalized.length > 256) {
    throw new DomainError('USER_ID_INVALID', 'user_id must not exceed 256 characters.');
  }
  return normalized;
}

export function requireIdentifier(
  value: string,
  code:
    | 'CONTEXT_ID_REQUIRED'
    | 'GOAL_ID_REQUIRED'
    | 'MCP_SERVER_ID_REQUIRED'
    | 'MEMORY_ID_REQUIRED'
    | 'SKILL_DRAFT_ID_REQUIRED'
    | 'SKILL_ID_REQUIRED'
    | 'SKILL_RELATION_ID_REQUIRED'
    | 'SKILL_SELECTION_ID_REQUIRED'
    | 'SKILL_INPUT_RESOLUTION_ID_REQUIRED'
    | 'TASK_ID_REQUIRED'
    | 'TASK_INPUT_REQUEST_ID_REQUIRED'
    | 'TASK_ATTEMPT_ID_REQUIRED'
    | 'WORKFLOW_PLAN_ID_REQUIRED'
    | 'TEMPORARY_SKILL_ID_REQUIRED',
): string {
  const normalized = value.trim();
  if (normalized === '')
    throw new DomainError(code, `${code.replace('_REQUIRED', '').toLowerCase()} is required.`);
  return normalized;
}
