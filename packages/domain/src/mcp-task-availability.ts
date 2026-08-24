import { DomainError } from './errors.js';
import type { McpProviderProtocolMode, McpTaskExecutionProfile } from './mcp-frozen-protocol.js';

export type McpTaskAvailabilityCheckMode = 'required' | 'best_effort';

/** Registered operation projection used for Skill Task Type resolution. */
interface McpTaskOperationCandidateBase {
  readonly providerId: string;
  readonly operationName: string;
  readonly attributes: readonly string[];
}

export type McpTaskOperationCandidate = McpTaskOperationCandidateBase &
  Readonly<{
    protocolMode: 'frozen_v1';
    taskExecutionProfile: McpTaskExecutionProfile;
    taskNotifications: boolean;
  }>;

export type McpTaskOperationDefinition = Readonly<{
  protocolMode: McpProviderProtocolMode;
  taskExecutionProfile: McpTaskExecutionProfile;
  taskNotifications: boolean;
}>;

export type TaskExecutionStart =
  | Readonly<{ mode: 'immediate'; startToleranceMs: number }>
  | Readonly<{ mode: 'scheduled'; scheduledAt: string; startToleranceMs: number }>;

export interface TaskExecutionTiming {
  readonly start: TaskExecutionStart;
  readonly maxElapsedMs: number | null;
}

/**
 * Protocol-neutral dispatch data for one MCP Task-producing Tool call. The MCP adapter owns the
 * concrete `_meta` mapping; the Domain owns the bounded identity and timing snapshot.
 */
export interface McpTaskCallProfile {
  readonly profileVersion: '1.0';
  readonly idempotencyKey?: string | undefined;
  readonly timing?: TaskExecutionTiming | undefined;
  readonly reservationRef?: string | undefined;
}

export function createMcpTaskCallProfile(input: McpTaskCallProfile): McpTaskCallProfile {
  const raw: unknown = input;
  if (!isRecord(raw)) invalidTaskCallProfile();
  const actualKeys = Object.keys(raw);
  const allowedKeys = ['profileVersion', 'idempotencyKey', 'timing', 'reservationRef'];
  if (actualKeys.some((key) => !allowedKeys.includes(key)) || raw['profileVersion'] !== '1.0')
    invalidTaskCallProfile();
  const idempotencyKey = raw['idempotencyKey'];
  if (idempotencyKey !== undefined && !boundedString(idempotencyKey)) invalidTaskCallProfile();
  const reservationRef = raw['reservationRef'];
  if (reservationRef !== undefined && !boundedString(reservationRef)) invalidTaskCallProfile();
  const timing = raw['timing'] === undefined ? undefined : snapshotTaskCallTiming(raw['timing']);
  return Object.freeze({
    profileVersion: '1.0',
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(timing === undefined ? {} : { timing }),
    ...(reservationRef === undefined ? {} : { reservationRef }),
  });
}

interface ResolvedMcpTaskExecutionBase {
  readonly availabilityCheck: McpTaskAvailabilityCheckMode;
  readonly timing?: TaskExecutionTiming | undefined;
  readonly reservationRef?: string | undefined;
}

export type ResolvedMcpTaskExecution = ResolvedMcpTaskExecutionBase &
  Readonly<{ protocolMode: 'frozen_v1' }>;

export type TaskOperationAvailability = 'available' | 'restricted' | 'disabled' | 'unknown';
export type TaskAvailabilityRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type TaskReservationMode = 'none' | 'best_effort' | 'guaranteed';
export type TaskAvailabilityPossibleEffect =
  | 'task_preemption'
  | 'task_pause'
  | 'start_rejection'
  | 'start_window_missed'
  | 'deadline_reached'
  | 'partial_completion';

export interface TaskAvailableWindow {
  readonly startTime: string;
  readonly endTime: string;
}

export type TaskAvailabilityArguments =
  | Readonly<{ unresolved: false; value: Readonly<Record<string, unknown>> }>
  | Readonly<{
      unresolved: true;
      knownArguments: Readonly<Record<string, unknown>>;
      unresolvedPaths: readonly string[];
    }>;

export interface TaskAvailabilityCheckRequest {
  readonly nodeId: string;
  readonly operationName: string;
  readonly arguments: TaskAvailabilityArguments;
  readonly timing?: TaskExecutionTiming | undefined;
}

export interface TaskAvailabilityCheckResult {
  readonly nodeId: string;
  readonly operationName: string;
  readonly availability: TaskOperationAvailability;
  readonly riskLevel: TaskAvailabilityRiskLevel;
  readonly reasonCode?: string | undefined;
  readonly description?: string | undefined;
  readonly validUntil?: string | undefined;
  readonly earliestStartTime?: string | undefined;
  readonly nextAvailableWindows: readonly TaskAvailableWindow[];
  readonly estimatedDelayMs?: number | undefined;
  readonly reservationMode: TaskReservationMode;
  readonly reservationRef?: string | undefined;
  readonly possibleEffects: readonly TaskAvailabilityPossibleEffect[];
}

export type TaskAvailabilityReadResult =
  | Readonly<{
      kind: 'results';
      protocolRevision: string;
      availabilitySchemaRevision: string;
      results: readonly TaskAvailabilityCheckResult[];
    }>
  | Readonly<{ kind: 'provider_unreachable'; errorCode: string }>
  | Readonly<{ kind: 'capability_missing'; errorCode: string }>
  | Readonly<{ kind: 'provider_protocol'; errorCode: string }>
  | Readonly<{ kind: 'contract_invalid'; errorCode: string }>;

export type TaskReadinessPhase = 'planning' | 'pre_invocation';
export type DslRiskAction =
  'proceed' | 'reschedule' | 'revise_dsl' | 'request_confirmation' | 'abort';

export type DslRiskDecision =
  | Readonly<{ action: 'proceed'; acceptedRiskNodeIds: readonly string[]; summary: string }>
  | Readonly<{
      action: 'reschedule';
      nodeId: string;
      selectedStartTime: string;
      summary: string;
    }>
  | Readonly<{ action: 'revise_dsl'; summary: string }>
  | Readonly<{
      action: 'request_confirmation';
      riskNodeIds: readonly string[];
      summary: string;
    }>
  | Readonly<{ action: 'abort'; summary: string }>;

export type DslReadinessDisposition =
  'ready' | 'confirmation_required' | 'revision_required' | 'blocked';

export interface DslExecutionReadiness {
  readonly readinessId: string;
  readonly workflowPlanId: string;
  readonly planAttempt: number;
  readonly checkPhase: TaskReadinessPhase;
  readonly workflowInstanceId?: string | undefined;
  readonly workflowNodeRunId?: string | undefined;
  readonly dslHash: string;
  readonly disposition: DslReadinessDisposition;
  readonly permittedActions: readonly DslRiskAction[];
  readonly modelDecision?: DslRiskDecision | undefined;
  readonly guardAction: DslRiskAction;
  readonly guardReasonCodes: readonly string[];
  readonly confirmationRequired: boolean;
  readonly createdAt: string;
}

export interface TaskAvailabilitySnapshot {
  readonly snapshotId: string;
  readonly readinessId: string;
  readonly workflowPlanId: string;
  readonly planAttempt: number;
  readonly checkPhase: TaskReadinessPhase;
  readonly workflowInstanceId?: string | undefined;
  readonly workflowNodeRunId?: string | undefined;
  readonly nodeId: string;
  readonly serverId: string;
  readonly operationName: string;
  readonly arguments: TaskAvailabilityArguments;
  readonly argumentsHash: string;
  readonly timing?: TaskExecutionTiming | undefined;
  readonly result: TaskAvailabilityCheckResult;
  readonly sourceRevision: string;
  readonly checkedAt: string;
  readonly normalizationReasonCodes: readonly string[];
}

export function normalizeTaskTimestamp(value: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  if (match === null) throw new TaskTimingValidationError();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw new TaskTimingValidationError();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TaskTimingValidationError();
  return new Date(milliseconds).toISOString();
}

export class TaskTimingValidationError extends Error {
  readonly code = 'MCP_TASK_TIMING_INVALID' as const;
  constructor() {
    super('Timestamp must be a real RFC 3339 value with an explicit timezone.');
    this.name = 'TaskTimingValidationError';
  }
}

function snapshotTaskCallTiming(value: unknown): TaskExecutionTiming {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['start', 'maxElapsedMs'].includes(key)) ||
    !Object.hasOwn(value, 'start') ||
    !Object.hasOwn(value, 'maxElapsedMs') ||
    !isRecord(value['start'])
  )
    invalidTaskCallProfile();
  const start = value['start'];
  const maxElapsedMs = value['maxElapsedMs'];
  if (
    !Number.isSafeInteger(start['startToleranceMs']) ||
    (start['startToleranceMs'] as number) < 0 ||
    (start['startToleranceMs'] as number) > 86_400_000 ||
    (maxElapsedMs !== null &&
      (!Number.isSafeInteger(maxElapsedMs) ||
        (maxElapsedMs as number) < 1 ||
        (maxElapsedMs as number) > 31_536_000_000))
  )
    invalidTaskCallProfile();
  if (start['mode'] === 'immediate') {
    if (
      Object.keys(start).some((key) => !['mode', 'startToleranceMs'].includes(key)) ||
      !Object.hasOwn(start, 'startToleranceMs')
    )
      invalidTaskCallProfile();
    return Object.freeze({
      start: Object.freeze({
        mode: 'immediate',
        startToleranceMs: start['startToleranceMs'] as number,
      }),
      maxElapsedMs: maxElapsedMs as number | null,
    });
  }
  if (
    start['mode'] !== 'scheduled' ||
    Object.keys(start).some((key) => !['mode', 'scheduledAt', 'startToleranceMs'].includes(key)) ||
    !Object.hasOwn(start, 'scheduledAt') ||
    !Object.hasOwn(start, 'startToleranceMs') ||
    typeof start['scheduledAt'] !== 'string'
  )
    invalidTaskCallProfile();
  let scheduledAt: string;
  try {
    scheduledAt = normalizeTaskTimestamp(start['scheduledAt']);
  } catch {
    return invalidTaskCallProfile();
  }
  return Object.freeze({
    start: Object.freeze({
      mode: 'scheduled',
      scheduledAt,
      startToleranceMs: start['startToleranceMs'] as number,
    }),
    maxElapsedMs: maxElapsedMs as number | null,
  });
}

function boundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidTaskCallProfile(): never {
  throw new DomainError(
    'MCP_TASK_CALL_PROFILE_INVALID',
    'MCP Task call profile identity, timing, or reservation data is invalid.',
  );
}
