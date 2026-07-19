import { DomainError } from './errors.js';

export type McpProviderProtocolMode = 'legacy_v11' | 'frozen_v1';
export type McpTaskBehavior = 'synchronous_only' | 'server_directed' | 'task_required';

export interface McpTaskExecutionProfile {
  readonly profileVersion: '1.0';
  readonly taskBehavior: McpTaskBehavior;
  readonly availability: 'not_supported' | 'dynamic';
  readonly supportsScheduling: boolean;
  readonly supportsMaxElapsed: boolean;
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

export interface FrozenTaskObservationMeta {
  readonly profileVersion: '1.0';
  readonly runtimeRevision: string;
  readonly providerRevision?: string | undefined;
  readonly eventId?: string | undefined;
  readonly observedAt?: string | undefined;
  readonly substate?: string | undefined;
  readonly progress?: Readonly<{ percent: number }> | undefined;
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
