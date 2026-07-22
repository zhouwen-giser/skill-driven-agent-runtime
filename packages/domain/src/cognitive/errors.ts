import { DomainError, type DomainErrorCode } from '../errors.js';

export type CognitiveDomainErrorCode =
  | Extract<DomainErrorCode, `COGNITIVE_${string}`>
  | 'CAPABILITY_SUMMARY_INVALID'
  | 'CAPABILITY_INDEX_INVALID'
  | 'CAPABILITY_CARD_INVALID'
  | 'TASK_UNDERSTANDING_INVALID'
  | 'INTERACTIVE_SESSION_INVALID'
  | 'PLANNING_CORRECTION_INVALID'
  | 'PLANNING_INTERACTION_EPISODE_INVALID'
  | 'EXPERIENCE_EPISODE_INVALID'
  | 'EXPERIENCE_JOB_INVALID'
  | 'KNOWLEDGE_CANDIDATE_INVALID'
  | 'KNOWLEDGE_PROMOTION_FORBIDDEN';

export class CognitiveDomainError extends DomainError {
  constructor(
    code: CognitiveDomainErrorCode,
    message: string,
    details: Readonly<Record<string, string>> = {},
  ) {
    super(code, message, details);
    this.name = 'CognitiveDomainError';
  }
}
