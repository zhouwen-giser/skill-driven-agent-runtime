import {
  createSelectedTaskOperation,
  hashCanonicalEvidenceJson,
  type McpTaskExecutionProfile,
  type McpToolExecutionSemantics,
  type SelectedTaskOperation,
} from '../../domain/src/index.js';

import type {
  GovernedControlConfirmation,
  GovernedControlConfirmationConsumption,
  GovernedControlDispatchReceipt,
  GovernedControlInvocation,
  GovernedControlInvocationAuthorityPort,
} from './governed-control-authority.js';

const CONTROL_APPROVER_ROLE = 'physical_control_approver';
const MAX_CONFIRMATION_TTL_MS = 15 * 60 * 1_000;
const ACTIVE_ATTEMPT_STATUSES = new Set(['prepared', 'running', 'waiting']);
const TERMINAL_TASK_PHASES = new Set(['completed', 'failed', 'canceled']);
const PHYSICAL_CONTROL_RISK_LEVELS = new Set(['medium', 'high', 'critical']);
const SHA256 = /^[0-9a-f]{64}$/u;
const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/u;

export interface GovernedControlConfirmationExactScope {
  readonly confirmationId: string;
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

export interface UgvGovernedControlAuthoritySnapshot {
  /** Persisted with the immutable Plan; never reconstructed from the invocation request. */
  readonly selectedTaskOperation: SelectedTaskOperation;
  readonly task: Readonly<{
    taskId: string;
    phase: string;
    planId: string;
    selectedSkillId: string;
    selectedSkillVersion: number;
  }>;
  readonly capability: Readonly<{
    capabilityId: string;
    capabilityVersion: number;
    status: string;
    riskLevel: string;
    supportedModes: readonly string[];
    implementationSkillId: string;
    implementationSkillVersion: number;
    dispatchMaximum: number;
  }>;
  readonly binding: Readonly<{
    capabilityBindingId: string;
    capabilityId: string;
    capabilityVersion: number;
    providerBindingId: string;
    providerBindingRevision: number;
    selectedTaskOperationSnapshotHash: `sha256:${string}`;
    bindingHash: string;
  }>;
  readonly attempt: Readonly<{
    capabilityAttemptId: string;
    status: string;
    planId: string;
    skillVersionRefs: readonly string[];
    providerBindingRefs: readonly string[];
  }>;
  readonly plan: Readonly<{
    planId: string;
    definitionHash: string;
    confirmationStatus: string;
    selectedTaskOperationSnapshotHash: `sha256:${string}`;
  }>;
  readonly skill: Readonly<{
    skillId: string;
    skillVersion: number;
    currentVersion: number;
    status: string;
    validationPassed: boolean;
    packageChecksum: string;
    capabilities: readonly string[];
    runtimePolicy: Readonly<{
      autoConfirmPlan: boolean;
      maxMcpCalls: number;
    }>;
    outcome: Readonly<{
      effects: readonly string[];
      evidence: readonly string[];
      finalPositionHardGate: boolean;
      rejectSuccessWithoutRequiredEvidence: boolean;
    }>;
  }>;
  readonly providerBinding: Readonly<{
    bindingId: string;
    revision: number;
    status: string;
    availability: string;
    availabilityValidUntil: string;
    providerId: string;
    providerType: string;
    providerVersion: string;
    manifestHash: string;
    serverId: string;
    catalogRevision: string;
    catalogChecksum: string;
  }>;
  readonly catalog: Readonly<{
    providerId: string;
    providerType: string;
    providerVersion: string;
    manifestHash: string;
    serverId: string;
    discoverySnapshotId: string;
    catalogRevision: string;
    catalogChecksum: string;
    navigate: UgvGovernedControlCatalogOperation;
    finalStateRead: UgvGovernedControlCatalogOperation;
  }>;
  readonly readiness: Readonly<{
    checkPhase: 'pre_invocation';
    disposition: string;
    guardAction: string;
    confirmationRequired: boolean;
    providerBindingId: string;
    providerBindingRevision: number;
    serverId: string;
    providerId: string;
    operationName: string;
    resourceId: string;
    argumentsHash: `sha256:${string}`;
    selectedTaskOperationSnapshotHash: `sha256:${string}`;
    catalogRevision: string;
    catalogChecksum: string;
    toolRevision: number;
    availability: string;
    riskLevel: string;
    checkedAt: string;
    validUntil: string;
  }>;
}

export interface UgvGovernedControlCatalogOperation {
  readonly operationName: string;
  readonly toolRevision: number;
  readonly inputSchemaHash: `sha256:${string}`;
  readonly outputSchemaHash: `sha256:${string}`;
  readonly executionSemantics: McpToolExecutionSemantics;
  readonly taskExecutionProfile: McpTaskExecutionProfile;
}

/** Profile implementation supplied by the Server composition root; persistence never imports it. */
export interface UgvGovernedControlInputAdapterPort {
  adapt(inputSnapshot: unknown): Readonly<{
    providerArguments: Readonly<Record<string, unknown>>;
    argumentsHash: `sha256:${string}`;
  }>;
}

export interface UgvGovernedControlIssueAuthorityReader {
  loadForIssue(taskId: string): Promise<UgvGovernedControlAuthoritySnapshot | undefined>;
}

export interface UgvGovernedControlDispatchAuthoritySnapshot extends UgvGovernedControlAuthoritySnapshot {
  readonly confirmation: GovernedControlConfirmation;
}

export interface UgvGovernedControlDispatchAuthorityReader {
  /** This read must refresh current Binding/Catalog and exact-argument readiness. */
  loadForPreInvocation(
    input: Readonly<{
      taskId: string;
      capabilityAttemptId: string;
    }>,
  ): Promise<UgvGovernedControlDispatchAuthoritySnapshot | undefined>;
}

export interface UgvGovernedControlConfirmationIssueInput extends Omit<
  GovernedControlConfirmation,
  | 'confirmationId'
  | 'confirmedAt'
  | 'revokedAt'
  | 'revokedBy'
  | 'consumedInvocationId'
  | 'consumedDispatchHash'
  | 'consumedAt'
> {
  readonly selectedTaskOperationSnapshotHash: `sha256:${string}`;
}

/** Profile-only issuer. Its deterministic identity makes a lost response safely retryable. */
export class UgvGovernedControlConfirmationService {
  readonly #store: GovernedControlConfirmationOnceStore;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      store: GovernedControlConfirmationOnceStore;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
  }

  async issueOnce(
    input: UgvGovernedControlConfirmationIssueInput,
  ): Promise<GovernedControlConfirmationIssueResult> {
    assertTrustedHuman(input);
    assertConfirmationScope(input);
    const confirmedAt = parseTimestamp(this.#clock.now(), 'UGV_GOVERNED_CONTROL_CLOCK_INVALID');
    const expiresAt = parseTimestamp(
      input.expiresAt,
      'UGV_GOVERNED_CONTROL_CONFIRMATION_EXPIRY_INVALID',
    );
    if (expiresAt <= confirmedAt || expiresAt - confirmedAt > MAX_CONFIRMATION_TTL_MS)
      fail(
        'UGV_GOVERNED_CONTROL_CONFIRMATION_EXPIRY_INVALID',
        'UGV confirmation must expire after issuance and within fifteen minutes.',
      );
    assertConfirmationHashes(input);
    const confirmationId = ugvGovernedControlConfirmationId(input);
    const confirmation = freezeConfirmation({
      ...input,
      confirmationId,
      confirmedAt: new Date(confirmedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    });
    return this.#store.issueOnce(confirmation);
  }

  findExact(
    input: UgvGovernedControlConfirmationIssueInput,
  ): Promise<GovernedControlConfirmation | undefined> {
    assertTrustedHuman(input);
    assertConfirmationScope(input);
    assertConfirmationHashes(input);
    return this.#store.findExact(
      exactScope({ ...input, confirmationId: ugvGovernedControlConfirmationId(input) }),
    );
  }
}

export type UgvGovernedControlInvocation = GovernedControlInvocation;

export interface UgvGovernedControlConfirmationConsumer {
  consumeConfirmation(
    input: GovernedControlConfirmationConsumption,
  ): Promise<GovernedControlConfirmation | undefined>;
}

/** Read-only evidence boundary for the one confirmation consumed by a Provider invocation. */
export interface GovernedControlConsumedConfirmationReader {
  findConsumedByInvocation(invocationId: string): Promise<GovernedControlConfirmation | undefined>;
}

/** Server composition owns environment/control-plane policy; the profile never reads env itself. */
export interface UgvProfileSideEffectGate {
  assertAuthorized(
    input: Readonly<{
      taskId: string;
      mode: 'live' | 'simulation';
      simulationId?: string;
      selectedSnapshotHash: `sha256:${string}`;
    }>,
  ): Promise<void>;
}

/** Exact UGV profile guard run immediately before the Provider transport is crossed. */
export class UgvGovernedControlInvocationAuthorizer implements GovernedControlInvocationAuthorityPort {
  readonly #authority: UgvGovernedControlDispatchAuthorityReader;
  readonly #confirmations: UgvGovernedControlConfirmationConsumer;
  readonly #simulationSideEffectGate: UgvProfileSideEffectGate | undefined;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      authority: UgvGovernedControlDispatchAuthorityReader;
      confirmations: UgvGovernedControlConfirmationConsumer;
      simulationSideEffectGate?: UgvProfileSideEffectGate;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#authority = dependencies.authority;
    this.#confirmations = dependencies.confirmations;
    this.#simulationSideEffectGate = dependencies.simulationSideEffectGate;
    this.#clock = dependencies.clock;
  }

  async authorizeAndConsume(
    input: UgvGovernedControlInvocation,
  ): Promise<GovernedControlDispatchReceipt> {
    const invocationId = required(input.invocationId, 'invocationId');
    if (!PREFIXED_SHA256.test(input.dispatchHash))
      fail(
        'UGV_GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID',
        'UGV dispatch requires a canonical sha256 dispatch hash.',
      );
    let snapshot: UgvGovernedControlDispatchAuthoritySnapshot | undefined;
    try {
      snapshot = await this.#authority.loadForPreInvocation({
        taskId: required(input.taskId, 'taskId'),
        capabilityAttemptId: required(input.capabilityAttemptId, 'capabilityAttemptId'),
      });
    } catch {
      fail(
        'UGV_GOVERNED_CONTROL_CURRENT_AUTHORITY_DRIFT',
        'Current persisted, Binding, Catalog, or readiness authority could not be refreshed.',
      );
    }
    if (snapshot === undefined)
      fail(
        'UGV_GOVERNED_CONTROL_AUTHORITY_NOT_FOUND',
        'No persisted Selected Task operation and current UGV authority exist.',
      );
    const now = parseTimestamp(this.#clock.now(), 'UGV_GOVERNED_CONTROL_CLOCK_INVALID');
    assertUgvGovernedControlAuthority(snapshot, 'pre_invocation', now);
    const selected = snapshot.selectedTaskOperation;
    const argumentsHash = hashCanonicalEvidenceJson(input.arguments);
    if (
      (input.executionContext === undefined
        ? selected.execution.mode === 'live'
        : input.executionContext.mode !== selected.execution.mode ||
          input.executionContext.simulationId !== selected.execution.simulationId ||
          (selected.execution.mode === 'live' && 'simulationId' in input.executionContext)) ||
      input.taskId !== snapshot.task.taskId ||
      input.capabilityAttemptId !== snapshot.attempt.capabilityAttemptId ||
      input.providerBindingId !== selected.providerBinding.bindingId ||
      input.serverId !== selected.server.serverId ||
      input.toolName !== selected.operation.operationName ||
      hashCanonicalEvidenceJson(input.executionSemantics) !==
        hashCanonicalEvidenceJson(selected.operation.executionSemantics) ||
      argumentsHash !== selected.argumentsHash
    )
      fail(
        'UGV_GOVERNED_CONTROL_ARGUMENTS_TAMPERED',
        'Dispatch identity or adapted navigate arguments differ from persisted selection.',
      );
    try {
      if (this.#simulationSideEffectGate === undefined)
        fail(
          'UGV_GOVERNED_CONTROL_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED',
          'No server-side UGV side-effect gate is configured.',
        );
      await this.#simulationSideEffectGate.assertAuthorized({
        taskId: snapshot.task.taskId,
        mode: selected.execution.mode,
        ...(selected.execution.simulationId === undefined
          ? {}
          : { simulationId: selected.execution.simulationId }),
        selectedSnapshotHash: selected.snapshotHash,
      });
    } catch {
      fail(
        'UGV_GOVERNED_CONTROL_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED',
        'Server-side UGV side effects are disabled or bound to a different run.',
      );
    }
    assertUgvConfirmation(snapshot, now);
    const consumedAt = new Date(now).toISOString();
    const consumed = await this.#confirmations.consumeConfirmation({
      confirmationId: snapshot.confirmation.confirmationId,
      taskId: snapshot.task.taskId,
      capabilityBindingId: snapshot.binding.capabilityBindingId,
      capabilityAttemptId: snapshot.attempt.capabilityAttemptId,
      providerBindingId: selected.providerBinding.bindingId,
      serverId: selected.server.serverId,
      toolName: selected.operation.operationName,
      argumentsHash: unprefixedHash(selected.argumentsHash),
      invocationId,
      dispatchHash: input.dispatchHash,
      consumedAt,
    });
    if (
      consumed?.consumedInvocationId !== invocationId ||
      consumed.consumedDispatchHash !== input.dispatchHash ||
      consumed.consumedAt === undefined
    )
      fail(
        'UGV_GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED',
        'The exact UGV confirmation was revoked, expired, or already consumed.',
      );
    return Object.freeze({
      confirmationId: consumed.confirmationId,
      providerBindingId: consumed.providerBindingId,
      argumentsHash: consumed.argumentsHash,
      invocationId: consumed.consumedInvocationId,
      dispatchHash: consumed.consumedDispatchHash,
      consumedAt: consumed.consumedAt,
    });
  }
}

export function assertUgvGovernedControlAuthority(
  authority: UgvGovernedControlAuthoritySnapshot,
  phase: 'issue' | 'pre_invocation',
  now: number,
): void {
  const selected = revalidateSelectedTaskOperation(authority.selectedTaskOperation);
  const expectedSkillRef = 'skill:embodied.move_to:1';
  const navigate = authority.catalog.navigate;
  const finalState = authority.catalog.finalStateRead;
  const planStatusValid =
    phase === 'issue'
      ? ['awaiting_confirmation', 'confirmed'].includes(authority.plan.confirmationStatus)
      : authority.plan.confirmationStatus === 'confirmed';
  if (
    authority.task.taskId.trim() === '' ||
    TERMINAL_TASK_PHASES.has(authority.task.phase) ||
    (phase === 'pre_invocation' && authority.task.phase !== 'executing') ||
    authority.task.planId !== authority.plan.planId ||
    authority.task.selectedSkillId !== selected.skill.skillId ||
    authority.task.selectedSkillVersion !== selected.skill.version ||
    authority.capability.capabilityId !== selected.task.semanticTaskType ||
    authority.capability.capabilityVersion < 1 ||
    authority.capability.status !== 'published' ||
    !PHYSICAL_CONTROL_RISK_LEVELS.has(authority.capability.riskLevel) ||
    !authority.capability.supportedModes.includes('plan_confirmed') ||
    !authority.capability.supportedModes.includes('remote_task') ||
    authority.capability.implementationSkillId !== selected.skill.skillId ||
    authority.capability.implementationSkillVersion !== selected.skill.version ||
    authority.capability.dispatchMaximum !== 1 ||
    authority.binding.capabilityBindingId.trim() === '' ||
    authority.binding.capabilityId !== authority.capability.capabilityId ||
    authority.binding.capabilityVersion !== authority.capability.capabilityVersion ||
    authority.binding.providerBindingId !== selected.providerBinding.bindingId ||
    authority.binding.providerBindingRevision !== selected.providerBinding.revision ||
    authority.binding.selectedTaskOperationSnapshotHash !== selected.snapshotHash ||
    !SHA256.test(authority.binding.bindingHash) ||
    authority.attempt.capabilityAttemptId.trim() === '' ||
    !ACTIVE_ATTEMPT_STATUSES.has(authority.attempt.status) ||
    authority.attempt.planId !== authority.plan.planId ||
    !sameStrings(authority.attempt.skillVersionRefs, [expectedSkillRef]) ||
    !sameStrings(authority.attempt.providerBindingRefs, [selected.providerBinding.bindingId]) ||
    !planStatusValid ||
    !SHA256.test(authority.plan.definitionHash) ||
    authority.plan.selectedTaskOperationSnapshotHash !== selected.snapshotHash ||
    authority.skill.skillId !== selected.skill.skillId ||
    authority.skill.skillVersion !== selected.skill.version ||
    authority.skill.currentVersion !== selected.skill.version ||
    authority.skill.status !== 'enabled' ||
    !authority.skill.validationPassed ||
    authority.skill.packageChecksum !== selected.skill.packageChecksum ||
    !authority.skill.capabilities.includes(selected.task.semanticTaskType) ||
    authority.skill.runtimePolicy.autoConfirmPlan ||
    authority.skill.runtimePolicy.maxMcpCalls !== 8 ||
    !sameStrings(authority.skill.outcome.effects, ['effect.final_position']) ||
    !sameStrings(authority.skill.outcome.evidence, ['evidence.final_position']) ||
    !authority.skill.outcome.finalPositionHardGate ||
    !authority.skill.outcome.rejectSuccessWithoutRequiredEvidence
  )
    currentAuthorityInvalid();
  assertCurrentProviderAndCatalog(authority, selected, navigate, finalState, now);
  assertCurrentReadiness(authority, selected, now);
}

export function ugvGovernedControlConfirmationId(
  input: UgvGovernedControlConfirmationIssueInput,
): string {
  const digest = hashCanonicalEvidenceJson({
    profileId: 'ugv-agent-profile',
    selectedTaskOperationSnapshotHash: input.selectedTaskOperationSnapshotHash,
    taskId: input.taskId,
    capabilityBindingId: input.capabilityBindingId,
    capabilityId: input.capabilityId,
    capabilityVersion: input.capabilityVersion,
    capabilityAttemptId: input.capabilityAttemptId,
    planId: input.planId,
    planHash: input.planHash,
    skillId: input.skillId,
    skillVersion: input.skillVersion,
    providerBindingId: input.providerBindingId,
    serverId: input.serverId,
    toolName: input.toolName,
    argumentsHash: input.argumentsHash,
    actorId: input.actorId,
    actorKind: input.actorKind,
    authenticationMethod: input.authenticationMethod,
    actorRoles: [...input.actorRoles].sort(),
    reason: input.reason,
  });
  return `ugv-control-${digest.slice('sha256:'.length)}`;
}

export function exactScope(
  input: GovernedControlConfirmationExactScope,
): GovernedControlConfirmationExactScope {
  return Object.freeze({ ...input, actorRoles: Object.freeze([...input.actorRoles]) });
}

export function confirmationExactScope(
  confirmation: GovernedControlConfirmation,
): GovernedControlConfirmationExactScope {
  return exactScope(confirmation);
}

function assertCurrentProviderAndCatalog(
  authority: UgvGovernedControlAuthoritySnapshot,
  selected: SelectedTaskOperation,
  navigate: UgvGovernedControlCatalogOperation,
  finalState: UgvGovernedControlCatalogOperation,
  now: number,
): void {
  const binding = authority.providerBinding;
  const catalog = authority.catalog;
  if (
    binding.bindingId !== selected.providerBinding.bindingId ||
    binding.revision !== selected.providerBinding.revision ||
    binding.status !== 'active' ||
    binding.availability !== 'available' ||
    parseTimestamp(binding.availabilityValidUntil, 'UGV_GOVERNED_CONTROL_READINESS_STALE') <= now ||
    binding.providerId !== selected.provider.providerId ||
    binding.providerType !== selected.provider.providerType ||
    binding.providerVersion !== selected.provider.providerVersion ||
    binding.manifestHash !== selected.provider.manifestHash ||
    binding.serverId !== selected.server.serverId ||
    binding.catalogRevision !== selected.server.catalogRevision ||
    binding.catalogChecksum !== selected.server.catalogChecksum ||
    catalog.providerId !== selected.provider.providerId ||
    catalog.providerType !== selected.provider.providerType ||
    catalog.providerVersion !== selected.provider.providerVersion ||
    catalog.manifestHash !== selected.provider.manifestHash ||
    catalog.serverId !== selected.server.serverId ||
    catalog.discoverySnapshotId !== selected.server.discoverySnapshotId ||
    catalog.catalogRevision !== selected.server.catalogRevision ||
    catalog.catalogChecksum !== selected.server.catalogChecksum ||
    !sameCatalogOperation(navigate, selected.operation, selected.server.toolRevision) ||
    !sameCatalogOperation(finalState, selected.finalStateRead, selected.server.toolRevision) ||
    finalState.operationName !== 'vehicle_get_state'
  )
    fail(
      'UGV_GOVERNED_CONTROL_CURRENT_AUTHORITY_DRIFT',
      'Current Provider Binding or Catalog differs from the persisted Selected Task operation.',
    );
}

function assertCurrentReadiness(
  authority: UgvGovernedControlAuthoritySnapshot,
  selected: SelectedTaskOperation,
  now: number,
): void {
  const readiness = authority.readiness;
  const checkedAt = parseTimestamp(readiness.checkedAt, 'UGV_GOVERNED_CONTROL_READINESS_STALE');
  const validUntil = parseTimestamp(readiness.validUntil, 'UGV_GOVERNED_CONTROL_READINESS_STALE');
  if (
    readiness.disposition !== 'ready' ||
    readiness.guardAction !== 'proceed' ||
    readiness.confirmationRequired ||
    readiness.providerBindingId !== selected.providerBinding.bindingId ||
    readiness.providerBindingRevision !== selected.providerBinding.revision ||
    readiness.serverId !== selected.server.serverId ||
    readiness.providerId !== selected.provider.providerId ||
    readiness.operationName !== selected.operation.operationName ||
    readiness.resourceId !== selected.resource.resourceId ||
    readiness.argumentsHash !== selected.argumentsHash ||
    readiness.selectedTaskOperationSnapshotHash !== selected.snapshotHash ||
    readiness.catalogRevision !== selected.server.catalogRevision ||
    readiness.catalogChecksum !== selected.server.catalogChecksum ||
    readiness.toolRevision !== selected.server.toolRevision ||
    readiness.availability !== 'available' ||
    !PHYSICAL_CONTROL_RISK_LEVELS.has(readiness.riskLevel) ||
    checkedAt > now ||
    validUntil <= now ||
    parseTimestamp(selected.availability.checkedAt, 'UGV_GOVERNED_CONTROL_READINESS_STALE') > now ||
    parseTimestamp(selected.selectedAt, 'UGV_GOVERNED_CONTROL_READINESS_STALE') > now
  )
    fail(
      'UGV_GOVERNED_CONTROL_READINESS_STALE',
      'Exact adapted-argument readiness is absent, stale, expired, or uncorrelated.',
    );
}

function assertUgvConfirmation(
  snapshot: UgvGovernedControlDispatchAuthoritySnapshot,
  now: number,
): void {
  const { confirmation, selectedTaskOperation: selected } = snapshot;
  assertTrustedHuman(confirmation);
  const confirmedAt = parseTimestamp(
    confirmation.confirmedAt,
    'UGV_GOVERNED_CONTROL_CONFIRMATION_INVALID',
  );
  const expiresAt = parseTimestamp(
    confirmation.expiresAt,
    'UGV_GOVERNED_CONTROL_CONFIRMATION_INVALID',
  );
  const issueInput: UgvGovernedControlConfirmationIssueInput = {
    ...confirmation,
    selectedTaskOperationSnapshotHash: selected.snapshotHash,
  };
  if (
    confirmation.confirmationId !== ugvGovernedControlConfirmationId(issueInput) ||
    confirmation.taskId !== snapshot.task.taskId ||
    confirmation.capabilityBindingId !== snapshot.binding.capabilityBindingId ||
    confirmation.capabilityId !== snapshot.capability.capabilityId ||
    confirmation.capabilityVersion !== snapshot.capability.capabilityVersion ||
    confirmation.capabilityAttemptId !== snapshot.attempt.capabilityAttemptId ||
    confirmation.planId !== snapshot.plan.planId ||
    confirmation.planHash !== snapshot.plan.definitionHash ||
    confirmation.skillId !== selected.skill.skillId ||
    confirmation.skillVersion !== selected.skill.version ||
    confirmation.providerBindingId !== selected.providerBinding.bindingId ||
    confirmation.serverId !== selected.server.serverId ||
    confirmation.toolName !== selected.operation.operationName ||
    confirmation.argumentsHash !== unprefixedHash(selected.argumentsHash) ||
    confirmation.revokedAt !== undefined ||
    confirmation.consumedAt !== undefined ||
    confirmedAt > now ||
    expiresAt <= now ||
    expiresAt - confirmedAt > MAX_CONFIRMATION_TTL_MS
  )
    fail(
      'UGV_GOVERNED_CONTROL_CONFIRMATION_INVALID',
      'UGV confirmation is stale, consumed, revoked, or bound to different exact authority.',
    );
}

function sameCatalogOperation(
  actual: UgvGovernedControlCatalogOperation,
  selected: Readonly<{
    operationName: string;
    inputSchemaHash: `sha256:${string}`;
    outputSchemaHash: `sha256:${string}`;
    executionSemantics: McpToolExecutionSemantics;
    taskExecutionProfile: McpTaskExecutionProfile;
  }>,
  selectedToolRevision: number,
): boolean {
  return (
    actual.operationName === selected.operationName &&
    actual.toolRevision === selectedToolRevision &&
    actual.inputSchemaHash === selected.inputSchemaHash &&
    actual.outputSchemaHash === selected.outputSchemaHash &&
    hashCanonicalEvidenceJson(actual.executionSemantics) ===
      hashCanonicalEvidenceJson(selected.executionSemantics) &&
    hashCanonicalEvidenceJson(actual.taskExecutionProfile) ===
      hashCanonicalEvidenceJson(selected.taskExecutionProfile)
  );
}

function revalidateSelectedTaskOperation(selected: SelectedTaskOperation): SelectedTaskOperation {
  try {
    const { snapshotHash, ...draft } = selected;
    const recreated = createSelectedTaskOperation(draft);
    if (recreated.snapshotHash !== snapshotHash)
      fail(
        'UGV_GOVERNED_CONTROL_SELECTED_OPERATION_INVALID',
        'Persisted Selected Task operation self-hash does not match its content.',
      );
    return recreated;
  } catch (error: unknown) {
    if (error instanceof UgvGovernedControlAuthorityError) throw error;
    fail(
      'UGV_GOVERNED_CONTROL_SELECTED_OPERATION_INVALID',
      'Persisted Selected Task operation is malformed or has been tampered with.',
    );
  }
}

function assertConfirmationHashes(input: UgvGovernedControlConfirmationIssueInput): void {
  if (
    !SHA256.test(input.planHash) ||
    !SHA256.test(input.argumentsHash) ||
    !PREFIXED_SHA256.test(input.selectedTaskOperationSnapshotHash)
  )
    fail(
      'UGV_GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID',
      'UGV confirmation requires exact Plan, adapted-arguments, and Selected snapshot hashes.',
    );
}

function assertConfirmationScope(input: UgvGovernedControlConfirmationIssueInput): void {
  for (const [field, value] of [
    ['taskId', input.taskId],
    ['capabilityBindingId', input.capabilityBindingId],
    ['capabilityId', input.capabilityId],
    ['capabilityAttemptId', input.capabilityAttemptId],
    ['planId', input.planId],
    ['skillId', input.skillId],
    ['providerBindingId', input.providerBindingId],
    ['serverId', input.serverId],
    ['toolName', input.toolName],
    ['reason', input.reason],
  ] as const)
    required(value, field);
  if (
    !Number.isSafeInteger(input.capabilityVersion) ||
    input.capabilityVersion < 1 ||
    !Number.isSafeInteger(input.skillVersion) ||
    input.skillVersion < 1
  )
    fail(
      'UGV_GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID',
      'UGV confirmation requires positive exact Capability and Skill versions.',
    );
}

function assertTrustedHuman(
  input: Readonly<{
    actorId: string;
    actorKind: string;
    authenticationMethod: string;
    actorRoles: readonly string[];
  }>,
): void {
  const actorId = required(input.actorId, 'actorId');
  if (
    input.actorKind !== 'human' ||
    required(input.authenticationMethod, 'authenticationMethod') === 'none' ||
    !sameStrings(input.actorRoles, [CONTROL_APPROVER_ROLE]) ||
    /^(?:agent|assistant|llm|model):/iu.test(actorId)
  )
    fail(
      'UGV_GOVERNED_CONTROL_CONFIRMATION_ACTOR_UNTRUSTED',
      'UGV physical control requires one authenticated human control approver.',
    );
}

function unprefixedHash(value: `sha256:${string}`): string {
  const hash = value.slice('sha256:'.length);
  if (!SHA256.test(hash))
    fail(
      'UGV_GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID',
      'UGV authority contains an invalid canonical hash.',
    );
  return hash;
}

function currentAuthorityInvalid(): never {
  fail(
    'UGV_GOVERNED_CONTROL_CURRENT_AUTHORITY_DRIFT',
    'Current Task, Capability, Binding, Plan, or Skill authority differs from persisted selection.',
  );
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((item, index) => item === expected[index])
  );
}

function freezeConfirmation(input: GovernedControlConfirmation): GovernedControlConfirmation {
  return Object.freeze({ ...input, actorRoles: Object.freeze([...input.actorRoles]) });
}

function parseTimestamp(value: string, code: UgvGovernedControlAuthorityErrorCode): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code, 'UGV governed-control timestamp is invalid.');
  return parsed;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '')
    fail('UGV_GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID', `${field} is required.`);
  return normalized;
}

export type UgvGovernedControlAuthorityErrorCode =
  | 'UGV_GOVERNED_CONTROL_ARGUMENTS_TAMPERED'
  | 'UGV_GOVERNED_CONTROL_AUTHORITY_NOT_FOUND'
  | 'UGV_GOVERNED_CONTROL_CLOCK_INVALID'
  | 'UGV_GOVERNED_CONTROL_CONFIRMATION_ACTOR_UNTRUSTED'
  | 'UGV_GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED'
  | 'UGV_GOVERNED_CONTROL_CONFIRMATION_EXPIRY_INVALID'
  | 'UGV_GOVERNED_CONTROL_CONFIRMATION_INVALID'
  | 'UGV_GOVERNED_CONTROL_CONFIRMATION_SCOPE_INVALID'
  | 'UGV_GOVERNED_CONTROL_CURRENT_AUTHORITY_DRIFT'
  | 'UGV_GOVERNED_CONTROL_READINESS_STALE'
  | 'UGV_GOVERNED_CONTROL_SELECTED_OPERATION_INVALID'
  | 'UGV_GOVERNED_CONTROL_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED';

export class UgvGovernedControlAuthorityError extends Error {
  constructor(
    readonly code: UgvGovernedControlAuthorityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UgvGovernedControlAuthorityError';
  }
}

function fail(code: UgvGovernedControlAuthorityErrorCode, message: string): never {
  throw new UgvGovernedControlAuthorityError(code, message);
}
