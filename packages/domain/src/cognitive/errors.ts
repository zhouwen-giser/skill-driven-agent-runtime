import { DomainError, type DomainErrorCode } from '../errors.js';

export type CognitiveDomainErrorCode =
  | Extract<DomainErrorCode, `COGNITIVE_${string}`>
  | 'CAPABILITY_SUMMARY_INVALID'
  | 'TASK_UNDERSTANDING_INVALID'
  | 'INTERACTIVE_SESSION_INVALID'
  | 'EXPERIENCE_EPISODE_INVALID'
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
