import { createHash } from 'node:crypto';
import type { McpToolExecutionSemantics } from '../../domain/src/index.js';

const CONTROL_APPROVER_ROLE = 'physical_control_approver';

const MAX_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;

export const HARD_DENIED_CONTROL_TOOLS = Object.freeze(['vehicle_fire_weapon'] as const);

export type GovernedControlAuthorityKind = 'physical_control' | 'emergency_stop' | 'weapon_control';

export interface GovernedControlConfirmation {
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
  readonly confirmedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly consumedInvocationId?: string;
  readonly consumedDispatchHash?: string;
  readonly consumedAt?: string;
}

export interface GovernedControlConfirmationConsumption {
  readonly confirmationId: string;
  readonly taskId: string;
  readonly capabilityBindingId: string;
  readonly capabilityAttemptId: string;
  readonly providerBindingId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly argumentsHash: string;
  readonly invocationId: string;
  readonly dispatchHash: string;
  readonly consumedAt: string;
}

export interface GovernedControlConfirmationStore {
  saveConfirmation(confirmation: GovernedControlConfirmation): Promise<GovernedControlConfirmation>;
  revokeConfirmation(
    confirmationId: string,
    revokedBy: string,
    revokedAt: string,
  ): Promise<GovernedControlConfirmation | undefined>;
}

export class GovernedControlConfirmationService {
  readonly #store: GovernedControlConfirmationStore;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #ids: Readonly<{ nextConfirmationId(): string }>;

  constructor(
    dependencies: Readonly<{
      store: GovernedControlConfirmationStore;
      clock: Readonly<{ now(): string }>;
      ids: Readonly<{ nextConfirmationId(): string }>;
    }>,
  ) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async issue(
    input: Omit<
      GovernedControlConfirmation,
      | 'confirmationId'
      | 'confirmedAt'
      | 'revokedAt'
      | 'revokedBy'
      | 'consumedInvocationId'
      | 'consumedDispatchHash'
      | 'consumedAt'
      | 'authorityKind'
    > &
      Readonly<{ authorityKind?: GovernedControlAuthorityKind }>,
  ): Promise<GovernedControlConfirmation> {
    const authorityKind = input.authorityKind ?? 'physical_control';
    assertTrustedHumanActor({ ...input, authorityKind });
    const scope = {
      taskId: required(input.taskId, 'taskId'),
      capabilityBindingId: required(input.capabilityBindingId, 'capabilityBindingId'),
      capabilityId: required(input.capabilityId, 'capabilityId'),
      capabilityAttemptId: required(input.capabilityAttemptId, 'capabilityAttemptId'),
      planId: required(input.planId, 'planId'),
      skillId: required(input.skillId, 'skillId'),
      providerBindingId: required(input.providerBindingId, 'providerBindingId'),
      serverId: required(input.serverId, 'serverId'),
      toolName: required(input.toolName, 'toolName'),
      actorId: required(input.actorId, 'actorId'),
      authenticationMethod: required(input.authenticationMethod, 'authenticationMethod'),
      reason: required(input.reason, 'reason'),
    };
    if (!Number.isInteger(input.capabilityVersion) || input.capabilityVersion < 1)
      fail(
        'GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID',
        'Control confirmation requires a positive Capability version.',
      );
    if (!Number.isInteger(input.skillVersion) || input.skillVersion < 1)
      fail(
        'GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID',
        'Control confirmation requires a positive Skill version.',
      );
    const confirmedAt = timestamp(this.#clock.now(), 'GOVERNED_CONTROL_CLOCK_INVALID');
    const expiresAt = timestamp(input.expiresAt, 'GOVERNED_CONTROL_CONFIRMATION_EXPIRY_INVALID');
    if (expiresAt <= confirmedAt || expiresAt - confirmedAt > MAX_CONFIRMATION_TTL_MS)
      fail(
        'GOVERNED_CONTROL_CONFIRMATION_EXPIRY_INVALID',
        'Control confirmation must expire after issuance and within fifteen minutes.',
      );
    if (!/^[a-f0-9]{64}$/u.test(input.planHash))
      fail(
        'GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID',
        'Control confirmation requires an exact immutable plan hash.',
      );
    if (!/^[a-f0-9]{64}$/u.test(input.argumentsHash))
      fail(
        'GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID',
        'Control confirmation requires an exact immutable arguments hash.',
      );
    const confirmation = freezeConfirmation({
      ...input,
      authorityKind,
      ...scope,
      confirmationId: required(this.#ids.nextConfirmationId(), 'confirmationId'),
      confirmedAt: new Date(confirmedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    });
    return this.#store.saveConfirmation(confirmation);
  }

  revoke(
    input: Readonly<{
      confirmationId: string;
      actorId: string;
      actorKind: 'human';
      authenticationMethod: string;
      actorRoles: readonly string[];
      authorityKind?: GovernedControlAuthorityKind;
    }>,
  ): Promise<GovernedControlConfirmation | undefined> {
    assertTrustedHumanActor(input);
    return this.#store.revokeConfirmation(
      required(input.confirmationId, 'confirmationId'),
      required(input.actorId, 'actorId'),
      this.#clock.now(),
    );
  }
}

export interface GovernedControlRuntimeAuthoritySnapshot {
  readonly task: Readonly<{
    taskId: string;
    phase: string;
    planId: string;
    selectedSkillId: string;
    selectedSkillVersion: number;
  }>;
  readonly binding: Readonly<{
    bindingId: string;
    capabilityId: string;
    capabilityVersion: number;
    inputSnapshot: unknown;
    constraintSnapshot: readonly Readonly<Record<string, unknown>>[];
    evidenceRequirementSnapshot: readonly Readonly<Record<string, unknown>>[];
    initialImplementationRefs: readonly string[];
    bindingHash: string;
  }>;
  readonly attempt: Readonly<{
    attemptId: string;
    status: string;
    planId?: string;
    skillVersionRefs: readonly string[];
    providerBindingRefs: readonly string[];
  }>;
  readonly plan: Readonly<{
    planId: string;
    confirmationStatus: string;
    definitionHash: string;
  }>;
  readonly skill: Readonly<{
    skillId: string;
    skillVersion: number;
    currentVersion: number;
    status: string;
    validationPassed: boolean;
    capabilities: readonly string[];
    toolPolicy: Readonly<Record<string, unknown>>;
    runtimePolicy: Readonly<Record<string, unknown>>;
    outcomeSpecification?: Readonly<Record<string, unknown>>;
  }>;
  readonly readiness: Readonly<{
    readinessId: string;
    workflowPlanId: string;
    checkPhase: string;
    dslHash: string;
    disposition: string;
    guardAction: string;
    confirmationRequired: boolean;
    serverId: string;
    operationName: string;
    argumentsHash: string;
    availability: string;
    riskLevel: string;
    validUntil?: string;
    checkedAt: string;
  }>;
  readonly confirmation: GovernedControlConfirmation;
}

export interface GovernedControlAuthorityStore {
  load(
    input: Readonly<{
      taskId: string;
      capabilityAttemptId: string;
      providerBindingId: string;
      serverId: string;
      toolName: string;
      argumentsHash: string;
      readinessArgumentsHash: string;
    }>,
  ): Promise<GovernedControlRuntimeAuthoritySnapshot | undefined>;
  consumeConfirmation(
    input: GovernedControlConfirmationConsumption,
  ): Promise<GovernedControlConfirmation | undefined>;
}

export interface CurrentGovernedCapabilityAuthority {
  readonly definition: Readonly<Record<string, unknown>>;
  readonly implementationBindings: readonly Readonly<Record<string, unknown>>[];
}

export interface CurrentGovernedCapabilityAuthorityPort {
  load(capabilityId: string, version: number): Promise<CurrentGovernedCapabilityAuthority>;
}

export interface GovernedControlInvocation {
  readonly invocationId: string;
  readonly dispatchHash: string;
  readonly taskId: string;
  readonly capabilityAttemptId: string;
  readonly providerBindingId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly executionSemantics: McpToolExecutionSemantics;
}

export interface GovernedControlDispatchReceipt {
  readonly confirmationId: string;
  readonly providerBindingId: string;
  readonly argumentsHash: string;
  readonly invocationId: string;
  readonly dispatchHash: string;
  readonly consumedAt: string;
}

export interface GovernedControlInvocationAuthorityPort {
  authorizeAndConsume(input: GovernedControlInvocation): Promise<GovernedControlDispatchReceipt>;
}

export interface WeaponControlEvidenceAuthorityPort {
  assertReady(
    input: Readonly<{
      taskId: string;
      capabilityAttemptId: string;
      providerBindingId: string;
      serverId: string;
      toolName: string;
      arguments: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<void>;
}

function assertTrustedHumanActor(
  input: Readonly<{
    actorId: string;
    actorKind: string;
    authenticationMethod: string;
    actorRoles: readonly string[];
    authorityKind?: GovernedControlAuthorityKind;
  }>,
): void {
  const actorId = required(input.actorId, 'actorId');
  const authorityKind = input.authorityKind ?? 'physical_control';
  const requiredRole =
    authorityKind === 'weapon_control'
      ? 'weapon_control_approver'
      : authorityKind === 'emergency_stop'
        ? 'physical_control_emergency_operator'
        : CONTROL_APPROVER_ROLE;
  if (
    input.actorKind !== 'human' ||
    required(input.authenticationMethod, 'authenticationMethod') === 'none' ||
    !input.actorRoles.includes(requiredRole) ||
    /^(?:agent|assistant|llm|model):/iu.test(actorId)
  )
    fail(
      'GOVERNED_CONTROL_CONFIRMATION_ACTOR_UNTRUSTED',
      'High-risk confirmation requires an authenticated human control approver.',
    );
}

function freezeConfirmation(input: GovernedControlConfirmation): GovernedControlConfirmation {
  return Object.freeze({ ...input, actorRoles: Object.freeze([...input.actorRoles]) });
}

function timestamp(value: string, code: GovernedControlAuthorityErrorCode): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code, 'Governed control timestamp is invalid.');
  return parsed;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '')
    fail('GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID', `${field} is required.`);
  return normalized;
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}

export function governedControlSnapshotHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export type GovernedControlAuthorityErrorCode =
  | 'GOVERNED_CONTROL_AUTHORITY_NOT_FOUND'
  | 'GOVERNED_CONTROL_ARGUMENTS_OUT_OF_BOUNDS'
  | 'GOVERNED_CONTROL_CAPABILITY_NOT_CURRENT'
  | 'GOVERNED_CONTROL_CLOCK_INVALID'
  | 'GOVERNED_CONTROL_CONFIRMATION_ACTOR_UNTRUSTED'
  | 'GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED'
  | 'GOVERNED_CONTROL_CONFIRMATION_EXPIRY_INVALID'
  | 'GOVERNED_CONTROL_CONFIRMATION_INVALID'
  | 'GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID'
  | 'GOVERNED_CONTROL_CONFIRMATION_TIME_INVALID'
  | 'GOVERNED_CONTROL_CONSTRAINTS_INVALID'
  | 'GOVERNED_CONTROL_READINESS_STALE'
  | 'GOVERNED_CONTROL_READINESS_TIME_INVALID'
  | 'GOVERNED_CONTROL_RUNTIME_AUTHORITY_INVALID'
  | 'GOVERNED_CONTROL_SEMANTICS_NOT_EXPLICIT'
  | 'GOVERNED_CONTROL_TOOL_HARD_DENIED'
  | 'WEAPON_CONTROL_STRICT_EVIDENCE_REQUIRED';

export class GovernedControlAuthorityError extends Error {
  constructor(
    readonly code: GovernedControlAuthorityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GovernedControlAuthorityError';
  }
}

function fail(code: GovernedControlAuthorityErrorCode, message: string): never {
  throw new GovernedControlAuthorityError(code, message);
}
