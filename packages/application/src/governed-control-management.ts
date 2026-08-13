import type {
  GovernedControlConfirmation,
  GovernedControlConfirmationService,
} from './governed-control-authority.js';

const CONTROL_APPROVER_ROLE = 'physical_control_approver';
const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1_000;
const MAX_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;

export type GovernedControlPermission = 'physical_control.confirm' | 'physical_control.revoke';

export interface GovernedControlPrincipal {
  readonly actorId: string;
  readonly kind: 'human' | 'service';
  readonly authenticationMethod: string;
  readonly permissions: ReadonlySet<GovernedControlPermission>;
  readonly requestId: string;
  readonly sourceIp?: string;
}

export interface GovernedControlPrincipalResolver {
  resolve(
    input: Readonly<{
      authorization?: string;
      requestId: string;
      sourceIp?: string;
    }>,
  ): Promise<GovernedControlPrincipal>;
}

/**
 * Immutable authority projected from Runtime-owned state. Callers never supply
 * any of these fields through the management request body.
 */
export interface GovernedControlIssueAuthority {
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
  readonly arguments: unknown;
  readonly argumentsHash: string;
}

export interface GovernedControlManagementAuthorityReader {
  issueAuthority(taskId: string): Promise<GovernedControlIssueAuthority | undefined>;
  revocationAuthority(
    taskId: string,
    confirmationId: string,
  ): Promise<GovernedControlRevocationAuthority | undefined>;
}

export interface GovernedControlRevocationAuthority {
  readonly taskId: string;
  readonly confirmationId: string;
  readonly revokedAt?: string;
  readonly consumedAt?: string;
}

export class GovernedControlManagementService {
  readonly #authority: GovernedControlManagementAuthorityReader;
  readonly #confirmations: Pick<GovernedControlConfirmationService, 'issue' | 'revoke'>;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      authority: GovernedControlManagementAuthorityReader;
      confirmations: Pick<GovernedControlConfirmationService, 'issue' | 'revoke'>;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#authority = dependencies.authority;
    this.#confirmations = dependencies.confirmations;
    this.#clock = dependencies.clock;
  }

  async issue(
    input: Readonly<{
      taskId: string;
      reason: string;
      ttlMs?: number;
      principal: GovernedControlPrincipal;
    }>,
  ): Promise<
    Readonly<{
      confirmation: GovernedControlConfirmation;
      authority: GovernedControlIssueAuthority;
    }>
  > {
    requirePermission(input.principal, 'physical_control.confirm');
    const taskId = required(input.taskId, 'taskId');
    const reason = required(input.reason, 'reason');
    const authority = await this.#authority.issueAuthority(taskId);
    if (authority === undefined)
      throw new GovernedControlManagementError('GOVERNED_CONTROL_TASK_NOT_FOUND', 404);
    if (authority.taskId !== taskId)
      throw new GovernedControlManagementError('GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID', 409);

    const ttlMs = input.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_CONFIRMATION_TTL_MS)
      throw new GovernedControlManagementError('GOVERNED_CONTROL_CONFIRMATION_TTL_INVALID', 400);
    const now = Date.parse(this.#clock.now());
    if (!Number.isFinite(now))
      throw new GovernedControlManagementError('GOVERNED_CONTROL_CLOCK_INVALID', 500);

    // Keep every consumed admission dimension in this server-derived command.
    // The confirmation persistence contract may store these fields directly;
    // older compatible implementations still receive the exact frozen binding.
    const issuance = {
      taskId: authority.taskId,
      capabilityBindingId: authority.capabilityBindingId,
      capabilityId: authority.capabilityId,
      capabilityVersion: authority.capabilityVersion,
      capabilityAttemptId: authority.capabilityAttemptId,
      planId: authority.planId,
      planHash: authority.planHash,
      skillId: authority.skillId,
      skillVersion: authority.skillVersion,
      providerBindingId: authority.providerBindingId,
      serverId: authority.serverId,
      toolName: authority.toolName,
      argumentsHash: authority.argumentsHash,
      actorId: input.principal.actorId,
      actorKind: 'human',
      authenticationMethod: input.principal.authenticationMethod,
      actorRoles: Object.freeze([CONTROL_APPROVER_ROLE]),
      reason,
      expiresAt: new Date(now + ttlMs).toISOString(),
    } as const;
    const confirmation = await this.#confirmations.issue(issuance);
    return Object.freeze({ confirmation, authority });
  }

  async revoke(
    input: Readonly<{
      taskId: string;
      confirmationId: string;
      reason: string;
      principal: GovernedControlPrincipal;
    }>,
  ): Promise<GovernedControlConfirmation> {
    requirePermission(input.principal, 'physical_control.revoke');
    const taskId = required(input.taskId, 'taskId');
    const confirmationId = required(input.confirmationId, 'confirmationId');
    required(input.reason, 'reason');
    const authority = await this.#authority.revocationAuthority(taskId, confirmationId);
    if (authority === undefined)
      throw new GovernedControlManagementError('GOVERNED_CONTROL_CONFIRMATION_NOT_FOUND', 404);
    if (authority.revokedAt !== undefined || authority.consumedAt !== undefined)
      throw new GovernedControlManagementError('GOVERNED_CONTROL_CONFIRMATION_NOT_REVOCABLE', 409);
    const confirmation = await this.#confirmations.revoke({
      confirmationId,
      actorId: input.principal.actorId,
      actorKind: 'human',
      authenticationMethod: input.principal.authenticationMethod,
      actorRoles: Object.freeze([CONTROL_APPROVER_ROLE]),
    });
    if (confirmation === undefined) {
      const current = await this.#authority.revocationAuthority(taskId, confirmationId);
      throw new GovernedControlManagementError(
        current === undefined
          ? 'GOVERNED_CONTROL_CONFIRMATION_NOT_FOUND'
          : 'GOVERNED_CONTROL_CONFIRMATION_NOT_REVOCABLE',
        current === undefined ? 404 : 409,
      );
    }
    return confirmation;
  }
}

export class GovernedControlManagementError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'GovernedControlManagementError';
    this.code = code;
    this.status = status;
  }
}

function requirePermission(
  principal: GovernedControlPrincipal,
  permission: GovernedControlPermission,
): void {
  if (
    principal.kind !== 'human' ||
    principal.actorId.trim() === '' ||
    principal.authenticationMethod.trim() === '' ||
    principal.authenticationMethod === 'none' ||
    !principal.permissions.has(permission) ||
    /^(?:agent|assistant|llm|model):/iu.test(principal.actorId)
  )
    throw new GovernedControlManagementError('GOVERNED_CONTROL_PERMISSION_DENIED', 403);
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '')
    throw new GovernedControlManagementError(
      `GOVERNED_CONTROL_${field.replaceAll(/(?=[A-Z])/gu, '_').toUpperCase()}_REQUIRED`,
      400,
    );
  return normalized;
}
