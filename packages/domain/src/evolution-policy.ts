import { DomainError } from './errors.js';

export interface EvolutionPolicy {
  readonly successThreshold: number;
  readonly updatedAt: string;
}

export type EvolutionTriggerDecision =
  'below_threshold' | 'candidate_created' | 'candidate_existing';

export interface EvolutionTriggerRecord {
  readonly triggerId: string;
  readonly capabilityFingerprint: string;
  readonly experienceId: string;
  readonly successfulExperienceCount: number;
  readonly configuredThreshold: number;
  readonly decision: EvolutionTriggerDecision;
  readonly candidateId?: string;
  readonly createdAt: string;
}

export function createEvolutionPolicy(
  successThreshold: number,
  updatedAt: string,
): EvolutionPolicy {
  if (!Number.isInteger(successThreshold) || successThreshold < 2) {
    throw new DomainError(
      'EVOLUTION_SUCCESS_THRESHOLD_INVALID',
      'Evolution success threshold must be an integer of at least two.',
    );
  }
  return { successThreshold, updatedAt };
}
