import type { McpProviderProtocolMode, McpTaskExecutionProfile } from './mcp-frozen-protocol.js';

export type McpTaskExecutionMode = 'allow_task' | 'require_task';
export type McpTaskAvailabilityCheckMode = 'required' | 'best_effort';

/** Narrow V1.1 projection of `io.sdar/taskExecution` discovery metadata. */
export interface McpTaskOperationSemantics {
  readonly execution: 'synchronous' | 'task_capable' | 'task_required' | 'unknown';
  readonly availability: 'not_supported' | 'dynamic';
  readonly supportsScheduling: boolean;
  readonly supportsMaxElapsed: boolean;
  readonly supportsObservations: boolean;
  readonly cancellation: 'unsupported' | 'cooperative' | 'task_cancel' | 'unknown';
  readonly revision: '1.0';
}

/** Registered operation projection used for Skill Task Type resolution. */
interface McpTaskOperationCandidateBase {
  readonly providerId: string;
  readonly operationName: string;
  readonly attributes: readonly string[];
}

export type McpTaskOperationCandidate =
  | (McpTaskOperationCandidateBase &
      Readonly<{
        protocolMode?: 'legacy_v11' | undefined;
        semantics: McpTaskOperationSemantics;
      }>)
  | (McpTaskOperationCandidateBase &
      Readonly<{
        protocolMode: 'frozen_v1';
        taskExecutionProfile: McpTaskExecutionProfile;
        taskNotifications: boolean;
      }>);

export type McpTaskOperationDefinition =
  | Readonly<{
      protocolMode?: 'legacy_v11' | undefined;
      semantics: McpTaskOperationSemantics;
    }>
  | Readonly<{
      protocolMode: Extract<McpProviderProtocolMode, 'frozen_v1'>;
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

interface ResolvedMcpTaskExecutionBase {
  readonly availabilityCheck: McpTaskAvailabilityCheckMode;
  readonly timing?: TaskExecutionTiming | undefined;
  readonly reservationRef?: string | undefined;
}

export type ResolvedMcpTaskExecution =
  | (ResolvedMcpTaskExecutionBase &
      Readonly<{ protocolMode?: 'legacy_v11' | undefined; mode: McpTaskExecutionMode }>)
  | (ResolvedMcpTaskExecutionBase & Readonly<{ protocolMode: 'frozen_v1'; mode?: undefined }>);

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
