import type {
  GovernedControlAuthorityKind,
  GovernedControlConfirmation,
  GovernedControlConfirmationService,
} from './governed-control-authority.js';
import { canonicalHash } from './mcp-task-readiness.js';

const CONTROL_APPROVER_ROLE = 'physical_control_approver';
const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1_000;
const MAX_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;

export type GovernedControlPermission =
  | 'physical_control.confirm'
  | 'physical_control.revoke'
  | 'physical_control.emergency_stop'
  | 'weapon_control.confirm'
  | 'weapon_control.revoke';

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

export interface GovernedControlConfirmationQueryRecord {
  readonly confirmation: GovernedControlConfirmation;
  readonly inputSnapshot: unknown;
}

export interface GovernedControlConfirmationQueryStore {
  listByTask(taskId: string): Promise<readonly GovernedControlConfirmationQueryRecord[]>;
}

export interface GovernedControlConfirmationView {
  readonly confirmationId: string;
  readonly authorityKind: GovernedControlAuthorityKind;
  readonly taskId: string;
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
  readonly parameters: Readonly<{
    resourceId?: string;
    targetId?: string;
    engagementMode?: 'single';
    requireConfirmation?: true;
  }>;
  readonly confirmedAt: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'consumed' | 'revoked' | 'expired';
  readonly revokedAt?: string;
  readonly consumedInvocationId?: string;
  readonly consumedAt?: string;
}

export class GovernedControlConfirmationQueryService {
  readonly #store: GovernedControlConfirmationQueryStore;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      store: GovernedControlConfirmationQueryStore;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
  }

  async list(
    input: Readonly<{ taskId: string; principal: GovernedControlPrincipal }>,
  ): Promise<Readonly<{ items: readonly GovernedControlConfirmationView[] }>> {
    requireAuthenticatedControlPrincipal(input.principal);
    const taskId = required(input.taskId, 'taskId');
    const now = Date.parse(this.#clock.now());
    if (!Number.isFinite(now))
      throw new GovernedControlManagementError('GOVERNED_CONTROL_CLOCK_INVALID', 500);
    const records = await this.#store.listByTask(taskId);
    return Object.freeze({
      items: Object.freeze(
        records.map(({ confirmation, inputSnapshot }) =>
          confirmationView(confirmation, inputSnapshot, now),
        ),
      ),
    });
  }
}

export class GovernedControlManagementService {
  readonly #authority: GovernedControlManagementAuthorityReader;
  readonly #confirmations: Pick<GovernedControlConfirmationService, 'issue' | 'revoke'>;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #authorityKind: GovernedControlAuthorityKind;
  readonly #confirmPermission: GovernedControlPermission;
  readonly #revokePermission: GovernedControlPermission;
  readonly #actorRole: string;

  constructor(
    dependencies: Readonly<{
      authority: GovernedControlManagementAuthorityReader;
      confirmations: Pick<GovernedControlConfirmationService, 'issue' | 'revoke'>;
      clock: Readonly<{ now(): string }>;
      authorityKind?: GovernedControlAuthorityKind;
    }>,
  ) {
    this.#authority = dependencies.authority;
    this.#confirmations = dependencies.confirmations;
    this.#clock = dependencies.clock;
    this.#authorityKind = dependencies.authorityKind ?? 'physical_control';
    this.#confirmPermission =
      this.#authorityKind === 'weapon_control'
        ? 'weapon_control.confirm'
        : this.#authorityKind === 'emergency_stop'
          ? 'physical_control.emergency_stop'
          : 'physical_control.confirm';
    this.#revokePermission =
      this.#authorityKind === 'weapon_control'
        ? 'weapon_control.revoke'
        : 'physical_control.revoke';
    this.#actorRole =
      this.#authorityKind === 'weapon_control'
        ? 'weapon_control_approver'
        : this.#authorityKind === 'emergency_stop'
          ? 'physical_control_emergency_operator'
          : CONTROL_APPROVER_ROLE;
  }

  async issue(
    input: Readonly<{
      taskId: string;
      reason: string;
      ttlMs?: number;
      principal: GovernedControlPrincipal;
      expectedToolName?: string;
      expectedArguments?: unknown;
      expectedResourceId?: string;
    }>,
  ): Promise<
    Readonly<{
      confirmation: GovernedControlConfirmation;
      authority: GovernedControlIssueAuthority;
    }>
  > {
    requirePermission(input.principal, this.#confirmPermission);
    const taskId = required(input.taskId, 'taskId');
    const reason = required(input.reason, 'reason');
    const authority = await this.#authority.issueAuthority(taskId);
    if (authority === undefined)
      throw new GovernedControlManagementError('GOVERNED_CONTROL_TASK_NOT_FOUND', 404);
    if (authority.taskId !== taskId)
      throw new GovernedControlManagementError('GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID', 409);
    if (
      (input.expectedToolName !== undefined && authority.toolName !== input.expectedToolName) ||
      (input.expectedArguments !== undefined &&
        canonicalHash(authority.arguments) !== canonicalHash(input.expectedArguments)) ||
      (input.expectedResourceId !== undefined &&
        resourceId(authority.arguments) !== input.expectedResourceId)
    )
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
      authorityKind: this.#authorityKind,
      actorId: input.principal.actorId,
      actorKind: 'human',
      authenticationMethod: input.principal.authenticationMethod,
      actorRoles: Object.freeze([this.#actorRole]),
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
    requirePermission(input.principal, this.#revokePermission);
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
      actorRoles: Object.freeze([this.#actorRole]),
      authorityKind: this.#authorityKind,
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

function requireAuthenticatedControlPrincipal(principal: GovernedControlPrincipal): void {
  if (
    principal.kind !== 'human' ||
    principal.actorId.trim() === '' ||
    principal.authenticationMethod.trim() === '' ||
    principal.authenticationMethod === 'none' ||
    /^(?:agent|assistant|llm|model):/iu.test(principal.actorId) ||
    ![...principal.permissions].some((permission) =>
      [
        'physical_control.confirm',
        'physical_control.revoke',
        'physical_control.emergency_stop',
        'weapon_control.confirm',
        'weapon_control.revoke',
      ].includes(permission),
    )
  )
    throw new GovernedControlManagementError('GOVERNED_CONTROL_PERMISSION_DENIED', 403);
}

function confirmationView(
  confirmation: GovernedControlConfirmation,
  inputSnapshot: unknown,
  now: number,
): GovernedControlConfirmationView {
  const input = objectValue(inputSnapshot);
  const resourceId = stringValue(input?.['resourceId']);
  const targetId = stringValue(input?.['targetId']);
  const engagementMode = input?.['engagementMode'] === 'single' ? 'single' : undefined;
  const requireConfirmation = input?.['requireConfirmation'] === true ? true : undefined;
  const status =
    confirmation.revokedAt !== undefined
      ? 'revoked'
      : confirmation.consumedAt !== undefined
        ? 'consumed'
        : Date.parse(confirmation.expiresAt) <= now
          ? 'expired'
          : 'pending';
  return Object.freeze({
    confirmationId: confirmation.confirmationId,
    authorityKind: confirmation.authorityKind ?? 'physical_control',
    taskId: confirmation.taskId,
    capabilityId: confirmation.capabilityId,
    capabilityVersion: confirmation.capabilityVersion,
    capabilityAttemptId: confirmation.capabilityAttemptId,
    planId: confirmation.planId,
    planHash: confirmation.planHash,
    skillId: confirmation.skillId,
    skillVersion: confirmation.skillVersion,
    providerBindingId: confirmation.providerBindingId,
    serverId: confirmation.serverId,
    toolName: confirmation.toolName,
    argumentsHash: confirmation.argumentsHash,
    parameters: Object.freeze({
      ...(resourceId === undefined ? {} : { resourceId }),
      ...(targetId === undefined ? {} : { targetId }),
      ...(engagementMode === undefined ? {} : { engagementMode }),
      ...(requireConfirmation === undefined ? {} : { requireConfirmation }),
    }),
    confirmedAt: confirmation.confirmedAt,
    expiresAt: confirmation.expiresAt,
    status,
    ...(confirmation.revokedAt === undefined ? {} : { revokedAt: confirmation.revokedAt }),
    ...(confirmation.consumedInvocationId === undefined
      ? {}
      : { consumedInvocationId: confirmation.consumedInvocationId }),
    ...(confirmation.consumedAt === undefined ? {} : { consumedAt: confirmation.consumedAt }),
  });
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
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

function resourceId(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? typeof (value as Readonly<Record<string, unknown>>)['resourceId'] === 'string'
      ? ((value as Readonly<Record<string, unknown>>)['resourceId'] as string)
      : undefined
    : undefined;
}
