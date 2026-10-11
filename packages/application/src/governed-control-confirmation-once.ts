import type {
  GovernedControlAuthorityKind,
  GovernedControlConfirmation,
} from './governed-control-authority.js';

export interface GovernedControlConfirmationExactScope {
  readonly confirmationId: string;
  readonly authorityKind?: GovernedControlAuthorityKind;
  readonly taskId: string;
  readonly capabilityBindingId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: number;
  readonly capabilityAttemptId: string;
  readonly planId: string;
  readonly planHash: string;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly providerBindingId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly argumentsHash: string;
  readonly actorId: string;
  readonly actorKind: 'human';
  readonly authenticationMethod: string;
  readonly actorRoles: readonly string[];
  readonly reason: string;
}

export interface GovernedControlConfirmationIssueResult {
  readonly confirmation: GovernedControlConfirmation;
  readonly replayed: boolean;
}

/**
 * Additive retry-safe persistence contract. The legacy random-id `saveConfirmation` contract is
 * intentionally separate and unchanged.
 */
export interface GovernedControlConfirmationOnceStore {
  issueOnce(
    confirmation: GovernedControlConfirmation,
  ): Promise<GovernedControlConfirmationIssueResult>;
  findExact(
    scope: GovernedControlConfirmationExactScope,
  ): Promise<GovernedControlConfirmation | undefined>;
}

export class GovernedControlConfirmationIssueConflictError extends Error {
  readonly code = 'GOVERNED_CONTROL_CONFIRMATION_ISSUE_CONFLICT';

  constructor() {
    super('An idempotent confirmation identity already exists with different immutable scope.');
    this.name = 'GovernedControlConfirmationIssueConflictError';
  }
}

/** Read-only evidence boundary for the one confirmation consumed by a Provider invocation. */
export interface GovernedControlConsumedConfirmationReader {
  findConsumedByInvocation(invocationId: string): Promise<GovernedControlConfirmation | undefined>;
}

export function exactScope(
  input: GovernedControlConfirmationExactScope,
): GovernedControlConfirmationExactScope {
  return Object.freeze({
    ...input,
    authorityKind: input.authorityKind ?? 'physical_control',
    actorRoles: Object.freeze([...input.actorRoles]),
  });
}

export function confirmationExactScope(
  confirmation: GovernedControlConfirmation,
): GovernedControlConfirmationExactScope {
  return exactScope(confirmation);
}
