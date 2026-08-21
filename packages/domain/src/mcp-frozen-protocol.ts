import { DomainError } from './errors.js';
import type { InternalToolResult, McpTaskStatus } from './mcp-task.js';

export type McpProviderProtocolMode = 'frozen_v1';
export type McpTaskBehavior = 'synchronous_only' | 'server_directed' | 'task_required';

export interface McpProviderCatalogIdentity {
  readonly providerId: string;
  readonly providerType: string;
  readonly providerVersion: string;
  readonly manifestHash: string;
}

export interface McpTaskExecutionProfile {
  readonly profileVersion: '1.0';
  readonly taskBehavior: McpTaskBehavior;
  readonly availability: 'not_supported' | 'dynamic';
  readonly supportsScheduling: boolean;
  readonly supportsMaxElapsed: boolean;
  /** Additive lifecycle declaration. Older Frozen V1 Runtimes may omit it. */
  readonly supportsCancellation?: boolean | undefined;
  /** Additive lifecycle declaration. Older Frozen V1 Runtimes may omit it. */
  readonly supportsPauseResume?: boolean | undefined;
  readonly supportsObservations: boolean;
  readonly supportsInputRequired: boolean;
  readonly idempotency: 'none' | 'client_request_key' | 'server_managed' | 'unknown';
}

export interface McpProtocolContractSnapshot {
  readonly mode: McpProviderProtocolMode;
  readonly protocolVersion: string;
  readonly baselineSha256: string;
  readonly tasksSchemaSha256?: string | undefined;
  readonly taskExecutionProfileVersion?: '1.0' | undefined;
  readonly evidenceProfileVersion?: '1.0' | undefined;
  readonly serverDiscoverySnapshotId?: string | undefined;
}

export interface McpProtocolDiscoverySnapshot {
  readonly snapshotId: string;
  readonly serverId: string;
  readonly protocolMode: McpProviderProtocolMode;
  readonly protocolVersion: string;
  readonly baselineSha256: string;
  readonly supportedVersions: readonly string[];
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly serverInfo: Readonly<Record<string, unknown>>;
  /** Validated Provider manifest identity advertised by server/discover. */
  readonly providerCatalog?: McpProviderCatalogIdentity;
  readonly taskNotifications: boolean;
  readonly discoveredAt: string;
  readonly validUntil?: string | undefined;
  readonly toolRevision: number;
}

export type FrozenTaskOutcomeKind = 'synchronous_success' | 'pre_admission_error' | 'task';

export function validateFrozenTaskBehaviorOutcome(
  behavior: McpTaskBehavior,
  outcome: FrozenTaskOutcomeKind,
): void {
  const mismatch =
    (behavior === 'synchronous_only' && outcome === 'task') ||
    (behavior === 'task_required' && outcome === 'synchronous_success');
  if (mismatch)
    throw new DomainError(
      'TASK_BEHAVIOR_PROFILE_MISMATCH',
      `Frozen Tool taskBehavior ${behavior} does not permit ${outcome}.`,
    );
}

export type FrozenTaskAvailabilityArguments =
  | Readonly<{ state: 'complete'; value: unknown }>
  | Readonly<{
      state: 'partial';
      knownValue: unknown;
      unresolvedPaths: readonly string[];
    }>;

export interface FrozenTaskAvailabilityCheckRequest {
  readonly requestId: string;
  readonly operationName: string;
  readonly arguments: FrozenTaskAvailabilityArguments;
  readonly timing: Readonly<{
    start:
      | Readonly<{ mode: 'immediate'; startToleranceMs: number }>
      | Readonly<{ mode: 'scheduled'; scheduledAt: string; startToleranceMs: number }>;
    maxElapsedMs: number | null;
  }>;
}

export interface FrozenTaskAvailabilityResult {
  readonly requestId: string;
  readonly operationName: string;
  readonly availability: 'available' | 'restricted' | 'disabled' | 'unknown';
  readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
  readonly reasonCode?: string | undefined;
  readonly description?: string | undefined;
  readonly validUntil?: string | undefined;
  readonly earliestStartTime?: string | undefined;
  readonly nextAvailableWindows: readonly Readonly<{ startTime: string; endTime: string }>[];
  readonly estimatedDelayMs?: number | undefined;
  readonly reservationMode: 'none' | 'best_effort' | 'guaranteed';
  readonly reservationRef?: string | undefined;
  readonly possibleEffects: readonly (
    | 'task_preemption'
    | 'task_pause'
    | 'start_rejection'
    | 'start_window_missed'
    | 'deadline_reached'
    | 'partial_completion'
  )[];
}

export type FrozenTaskReadinessAttribute =
  | `task_behavior:${McpTaskBehavior}`
  | 'availability:dynamic'
  | 'scheduling'
  | 'max_elapsed'
  | 'cancellation'
  | 'pause_resume'
  | 'observations'
  | 'input_required'
  | 'idempotency:client_request_key'
  | 'idempotency:server_managed'
  | 'task_notifications';

export function frozenTaskReadinessAttributes(
  profile: McpTaskExecutionProfile,
  taskNotifications: boolean,
): readonly FrozenTaskReadinessAttribute[] {
  const attributes: FrozenTaskReadinessAttribute[] = [`task_behavior:${profile.taskBehavior}`];
  if (profile.availability === 'dynamic') attributes.push('availability:dynamic');
  if (profile.supportsScheduling) attributes.push('scheduling');
  if (profile.supportsMaxElapsed) attributes.push('max_elapsed');
  if (profile.supportsCancellation === true) attributes.push('cancellation');
  if (profile.supportsPauseResume === true) attributes.push('pause_resume');
  if (profile.supportsObservations) attributes.push('observations');
  if (profile.supportsInputRequired) attributes.push('input_required');
  if (profile.idempotency === 'client_request_key')
    attributes.push('idempotency:client_request_key');
  if (profile.idempotency === 'server_managed') attributes.push('idempotency:server_managed');
  if (taskNotifications) attributes.push('task_notifications');
  return Object.freeze(attributes);
}

export interface FrozenTaskObservationMeta {
  readonly profileVersion: '1.0';
  readonly runtimeRevision: string;
  readonly providerRevision?: string | undefined;
  readonly eventId?: string | undefined;
  readonly observedAt?: string | undefined;
  readonly substate?: string | undefined;
  readonly progress?: Readonly<{ percent: number }> | undefined;
}

export interface FrozenRemoteTaskBase {
  readonly protocolMode: 'frozen_v1';
  readonly taskId: string;
  readonly status: McpTaskStatus;
  readonly statusMessage?: string | undefined;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly ttlMs: number | null;
  readonly expiresAt?: string | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly observation: FrozenTaskObservationMeta;
}

export interface FrozenRemoteTaskCreated extends FrozenRemoteTaskBase {
  readonly resultType: 'task';
}

export type FrozenDetailedRemoteTask =
  | (FrozenRemoteTaskBase & Readonly<{ resultType: 'complete'; status: 'working' }>)
  | (FrozenRemoteTaskBase &
      Readonly<{
        resultType: 'complete';
        status: 'input_required';
        inputRequests: Readonly<Record<string, unknown>>;
      }>)
  | (FrozenRemoteTaskBase &
      Readonly<{ resultType: 'complete'; status: 'completed'; result: InternalToolResult }>)
  | (FrozenRemoteTaskBase &
      Readonly<{
        resultType: 'complete';
        status: 'failed';
        error: Readonly<{ code: number; message: string; data?: unknown }>;
      }>)
  | (FrozenRemoteTaskBase & Readonly<{ resultType: 'complete'; status: 'cancelled' }>);

export type FrozenTaskInvocationOutcome =
  | Readonly<{ kind: 'immediate'; result: InternalToolResult }>
  | Readonly<{
      kind: 'remote_task';
      created: FrozenRemoteTaskCreated;
      reconciled: FrozenDetailedRemoteTask;
    }>;

export interface FrozenTaskOperationAck {
  readonly resultType: 'complete';
  readonly meaning: 'input_update_received' | 'cancellation_intent_received';
}

const RUNTIME_REVISION_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

export function validateRuntimeRevision(value: string): string {
  if (!RUNTIME_REVISION_PATTERN.test(value))
    throw new DomainError(
      'MCP_RUNTIME_REVISION_INVALID',
      'runtimeRevision must be a canonical unsigned decimal string.',
    );
  return value;
}

export function compareRuntimeRevisions(left: string, right: string): -1 | 0 | 1 {
  const leftValue = BigInt(validateRuntimeRevision(left));
  const rightValue = BigInt(validateRuntimeRevision(right));
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function frozenTaskObservationDedupeKey(taskId: string, runtimeRevision: string): string {
  const normalizedTaskId = taskId.trim();
  if (normalizedTaskId === '')
    throw new DomainError('TASK_ID_REQUIRED', 'Task ID is required for observation dedupe.');
  return `${normalizedTaskId}\u0000${validateRuntimeRevision(runtimeRevision)}`;
}

export type ProviderEvidencePayloadRef =
  | Readonly<{ kind: 'structured_content'; jsonPointer: string }>
  | Readonly<{ kind: 'uri'; uri: string; mediaType?: string; sha256?: string }>;

export interface ProviderEvidenceItem {
  readonly evidenceId: string;
  readonly evidenceType: string;
  readonly observedAt: string;
  readonly subjectRef?: string | undefined;
  readonly producer?: readonly string[] | undefined;
  readonly payloadRef: ProviderEvidencePayloadRef;
}

export interface SkillEvidenceMatch {
  readonly requirementId: string;
  readonly evidenceType: string;
  readonly required: boolean;
  readonly hardGate: boolean;
  readonly satisfied: boolean;
  readonly evidenceId?: string | undefined;
  readonly observedAt?: string | undefined;
  readonly payloadRef?: ProviderEvidencePayloadRef | undefined;
  readonly resolvedValue?: unknown;
  readonly runtimeRevision?: string | undefined;
}

export function createProviderEvidenceItem(input: ProviderEvidenceItem): ProviderEvidenceItem {
  if ('requirementId' in input)
    throw new DomainError(
      'PROVIDER_EVIDENCE_REQUIREMENT_ID_FORBIDDEN',
      'Provider evidence must not contain the SDAR-local requirementId.',
    );
  if (input.evidenceId.trim() === '' || input.evidenceType.trim() === '')
    throw new DomainError(
      'PROVIDER_EVIDENCE_ITEM_INVALID',
      'Provider evidence requires evidenceId and evidenceType.',
    );
  if (!Number.isFinite(Date.parse(input.observedAt)))
    throw new DomainError(
      'PROVIDER_EVIDENCE_ITEM_INVALID',
      'Provider evidence observedAt must be an RFC 3339 timestamp.',
    );
  return Object.freeze({
    ...input,
    evidenceId: input.evidenceId.trim(),
    evidenceType: input.evidenceType.trim(),
    ...(input.producer === undefined ? {} : { producer: Object.freeze([...input.producer]) }),
    payloadRef: Object.freeze({ ...input.payloadRef }),
  });
}
