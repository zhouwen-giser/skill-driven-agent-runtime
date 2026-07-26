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
  | 'EXPERIENCE_OBSERVATION_INVALID'
  | 'EXPERIENCE_REFLECTION_INVALID'
  | 'KNOWLEDGE_DELTA_INVALID'
  | 'KNOWLEDGE_CANDIDATE_INVALID'
  | 'KNOWLEDGE_PROMOTION_FORBIDDEN'
  | 'TASK_TYPE_INVALID'
  | 'CAPABILITY_PATTERN_INVALID';

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
