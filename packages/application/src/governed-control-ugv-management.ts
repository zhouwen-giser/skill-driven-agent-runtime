import type { GovernedControlConfirmation } from './governed-control-authority.js';
import type { GovernedControlPrincipal } from './governed-control-management.js';
import {
  assertUgvGovernedControlAuthority,
  type GovernedControlConfirmationIssueResult,
  type UgvGovernedControlConfirmationService,
  type UgvGovernedControlAuthoritySnapshot,
  type UgvGovernedControlIssueAuthorityReader,
} from './governed-control-ugv-authority.js';

const CONTROL_APPROVER_ROLE = 'physical_control_approver';
const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1_000;
const MAX_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;

/**
 * Profile-aware management boundary. Requests name only the Task and human decision; every control
 * dimension comes from persisted SelectedTaskOperation plus refreshed Runtime authority.
 */
export class UgvGovernedControlManagementService {
  readonly #authority: UgvGovernedControlIssueAuthorityReader;
  readonly #confirmations: Pick<UgvGovernedControlConfirmationService, 'issueOnce'>;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      authority: UgvGovernedControlIssueAuthorityReader;
      confirmations: Pick<UgvGovernedControlConfirmationService, 'issueOnce'>;
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
      authority: UgvGovernedControlAuthoritySnapshot;
      replayed: boolean;
    }>
  > {
    requireHumanConfirmationAuthority(input.principal);
    const taskId = required(input.taskId, 'TASK_ID');
    const reason = required(input.reason, 'REASON');
    const ttlMs = input.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_CONFIRMATION_TTL_MS)
      throw new UgvGovernedControlManagementError(
        'UGV_GOVERNED_CONTROL_CONFIRMATION_TTL_INVALID',
        400,
      );
    let authority: UgvGovernedControlAuthoritySnapshot | undefined;
    try {
      authority = await this.#authority.loadForIssue(taskId);
    } catch {
      throw new UgvGovernedControlManagementError(
        'UGV_GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID',
        409,
      );
    }
    if (authority === undefined)
      throw new UgvGovernedControlManagementError('UGV_GOVERNED_CONTROL_TASK_NOT_FOUND', 404);
    const now = timestamp(this.#clock.now());
    try {
      assertUgvGovernedControlAuthority(authority, 'issue', now);
    } catch {
      throw new UgvGovernedControlManagementError(
        'UGV_GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID',
        409,
      );
    }
    if (authority.task.taskId !== taskId)
      throw new UgvGovernedControlManagementError(
        'UGV_GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID',
        409,
      );

    const selected = authority.selectedTaskOperation;
    const result: GovernedControlConfirmationIssueResult = await this.#confirmations.issueOnce({
      taskId,
      capabilityBindingId: authority.binding.capabilityBindingId,
      capabilityId: authority.capability.capabilityId,
      capabilityVersion: authority.capability.capabilityVersion,
      capabilityAttemptId: authority.attempt.capabilityAttemptId,
      planId: authority.plan.planId,
      planHash: authority.plan.definitionHash,
      skillId: selected.skill.skillId,
      skillVersion: selected.skill.version,
      providerBindingId: selected.providerBinding.bindingId,
      serverId: selected.server.serverId,
      toolName: selected.operation.operationName,
      argumentsHash: selected.argumentsHash.slice('sha256:'.length),
      selectedTaskOperationSnapshotHash: selected.snapshotHash,
      actorId: input.principal.actorId,
      actorKind: 'human',
      authenticationMethod: input.principal.authenticationMethod,
      actorRoles: Object.freeze([CONTROL_APPROVER_ROLE]),
      reason,
      expiresAt: new Date(now + ttlMs).toISOString(),
    });
    return Object.freeze({
      confirmation: result.confirmation,
      authority,
      replayed: result.replayed,
    });
  }
}

export type UgvGovernedControlManagementErrorCode =
  | 'UGV_GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID'
  | 'UGV_GOVERNED_CONTROL_CLOCK_INVALID'
  | 'UGV_GOVERNED_CONTROL_CONFIRMATION_TTL_INVALID'
  | 'UGV_GOVERNED_CONTROL_PERMISSION_DENIED'
  | 'UGV_GOVERNED_CONTROL_REASON_REQUIRED'
  | 'UGV_GOVERNED_CONTROL_TASK_ID_REQUIRED'
  | 'UGV_GOVERNED_CONTROL_TASK_NOT_FOUND';

export class UgvGovernedControlManagementError extends Error {
  constructor(
    readonly code: UgvGovernedControlManagementErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = 'UgvGovernedControlManagementError';
  }
}

function requireHumanConfirmationAuthority(principal: GovernedControlPrincipal): void {
  if (
    principal.kind !== 'human' ||
    principal.actorId.trim() === '' ||
    principal.authenticationMethod.trim() === '' ||
    principal.authenticationMethod === 'none' ||
    !principal.permissions.has('physical_control.confirm') ||
    /^(?:agent|assistant|llm|model):/iu.test(principal.actorId)
  )
    throw new UgvGovernedControlManagementError('UGV_GOVERNED_CONTROL_PERMISSION_DENIED', 403);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new UgvGovernedControlManagementError('UGV_GOVERNED_CONTROL_CLOCK_INVALID', 500);
  return parsed;
}

function required(value: string, field: 'TASK_ID' | 'REASON'): string {
  const normalized = value.trim();
  if (normalized === '')
    throw new UgvGovernedControlManagementError(`UGV_GOVERNED_CONTROL_${field}_REQUIRED`, 400);
  return normalized;
}
