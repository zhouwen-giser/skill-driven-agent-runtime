import { DomainError } from './errors.js';
import type {
  InternalToolResult,
  McpTaskStatus,
  RemoteTaskProviderSubstate,
  RemoteTaskSnapshot,
} from './mcp-task.js';
import type { TaskExecutionTiming } from './mcp-task-availability.js';
import type { McpProtocolContractSnapshot, McpTaskBehavior } from './mcp-frozen-protocol.js';
import {
  createRuntimeExecutionContext,
  type RuntimeExecutionContext,
} from './runtime-execution.js';

export type RemoteTaskLocalState =
  | 'polling'
  | 'cancel_observing'
  | 'awaiting_input'
  | 'terminal_event_pending'
  | 'terminal_event_claimed'
  | 'reentered'
  | 'closed'
  | 'quarantined';

export type RemoteTaskCancellationDeliveryStatus = 'requested' | 'acknowledged' | 'uncertain';

export type RemoteTaskCancellationProviderTerminalStatus = Extract<
  McpTaskStatus,
  'completed' | 'failed' | 'cancelled'
>;

export interface RemoteTaskCancellationRequest {
  readonly requestId: string;
  readonly bindingId: string;
  readonly idempotencyKey: string;
  readonly source: 'task' | 'goal' | 'workflow' | 'management' | 'compensation';
  readonly reasonCode: string;
  readonly summary: string;
  readonly deliveryStatus: RemoteTaskCancellationDeliveryStatus;
  readonly providerTerminalStatus?: RemoteTaskCancellationProviderTerminalStatus;
  readonly protocolRevision?: string;
  readonly acknowledgedAt?: string;
  readonly resolvedAt?: string;
  readonly claimToken?: string;
  readonly claimedAt?: string;
  readonly claimExpiresAt?: string;
  readonly attemptCount: number;
  readonly lastSafeErrorCode?: string;
  readonly requestedAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type RemoteTaskCancellationAttemptStatus =
  | 'acknowledged'
  | 'provider_unreachable'
  | 'contract_invalid'
  | 'provider_protocol'
  | 'stale_terminal';

export interface RemoteTaskCancellationAttempt {
  readonly attemptId: string;
  readonly requestId: string;
  readonly bindingId: string;
  readonly expectedRequestVersion: number;
  readonly protocolRevision: string;
  readonly status: RemoteTaskCancellationAttemptStatus;
  readonly errorCode?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export type RemoteTaskObservationType =
  | 'task.accepted'
  | 'task.snapshot'
  | 'task.scheduled'
  | 'task.started'
  | 'task.paused'
  | 'task.resumed'
  | 'task.progress'
  | 'task.heartbeat'
  | 'provider_unreachable'
  | 'schema_invalid';

export type RemoteTaskObservationSource = 'admission' | 'poll' | 'notification' | 'reconciliation';

export type RemoteTaskControlEventType =
  'task.input_required' | 'task.completed' | 'task.failed' | 'task.cancelled';

export type RemoteTaskControlEventStatus = 'pending' | 'claimed' | 'processed' | 'failed';

export interface RemoteTaskBinding {
  readonly bindingId: string;
  readonly serverId: string;
  readonly operationName: string;
  readonly remoteTaskId: string;
  readonly agentTaskId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly workflowPlanId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly workflowInstanceId: string;
  readonly workflowNodeId: string;
  readonly workflowNodeRunId: string;
  readonly parentWorkflowInstanceId?: string;
  readonly parentSkillCallId?: string;
  readonly mcpInvocationId: string;
  readonly protocolStatus: McpTaskStatus;
  readonly protocolRevision: string;
  readonly tasksSchemaRevision: string;
  readonly protocolContract: McpProtocolContractSnapshot;
  readonly taskBehavior?: McpTaskBehavior;
  readonly runtimeRevision?: string;
  readonly providerRevision?: string;
  readonly taskTtlMs?: number;
  readonly taskExpiresAt?: string;
  readonly providerSubstate?: RemoteTaskProviderSubstate;
  readonly remoteRevision?: string;
  readonly localState: RemoteTaskLocalState;
  readonly requestedTiming?: TaskExecutionTiming;
  readonly executionContext: RuntimeExecutionContext;
  readonly credentialRevision: string;
  readonly sessionRevision: string;
  readonly lastProviderUpdatedAt: string;
  readonly pollIntervalMs: number;
  readonly nextPollAt?: string;
  readonly pollAttempt: number;
  readonly providerFailureCount: number;
  readonly pollClaimToken?: string;
  readonly pollClaimedAt?: string;
  readonly pollClaimExpiresAt?: string;
  readonly resultSnapshot?: InternalToolResult;
  readonly errorSnapshot?: RemoteTaskFailureSnapshot;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly invalidatedAt?: string;
  readonly terminalAt?: string;
  readonly version: number;
}

export interface RemoteTaskFailureSnapshot {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface RemoteTaskAdmission {
  readonly bindingId: string;
  readonly serverId: string;
  readonly operationName: string;
  readonly remoteTaskId: string;
  readonly agentTaskId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly workflowPlanId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly workflowInstanceId: string;
  readonly workflowNodeId: string;
  readonly workflowNodeRunId: string;
  readonly parentWorkflowInstanceId?: string;
  readonly parentSkillCallId?: string;
  readonly mcpInvocationId: string;
  readonly protocolStatus: McpTaskStatus;
  readonly protocolRevision: string;
  readonly tasksSchemaRevision: string;
  readonly protocolContract?: McpProtocolContractSnapshot;
  readonly taskBehavior?: McpTaskBehavior;
  readonly runtimeRevision?: string;
  readonly providerRevision?: string;
  readonly taskTtlMs?: number;
  readonly taskExpiresAt?: string;
  readonly providerSubstate?: RemoteTaskProviderSubstate;
  readonly remoteRevision?: string;
  readonly requestedTiming?: TaskExecutionTiming;
  readonly executionContext: RuntimeExecutionContext;
  readonly credentialRevision: string;
  readonly sessionRevision: string;
  readonly lastProviderUpdatedAt: string;
  readonly pollIntervalMs: number;
  readonly nextPollAt?: string;
  readonly createdAt: string;
}

export interface RemoteTaskObservation {
  readonly observationId: string;
  readonly bindingId: string;
  readonly sequence: number;
  readonly type: RemoteTaskObservationType;
  readonly source: RemoteTaskObservationSource;
  readonly providerEventId?: string;
  readonly remoteRevision?: string;
  readonly runtimeRevision?: string;
  readonly providerRevision?: string;
  readonly subscriptionId?: string;
  readonly payload: unknown;
  readonly accepted: boolean;
  readonly rejectionReason?: 'stale_provider_revision' | 'binding_closed';
  readonly observedAt: string;
}

export interface RemoteTaskControlEvent {
  readonly eventId: string;
  readonly bindingId: string;
  readonly type: RemoteTaskControlEventType;
  readonly remoteRevision?: string;
  readonly runtimeRevision?: string;
  readonly resultHash: string;
  readonly payload: unknown;
  readonly status: RemoteTaskControlEventStatus;
  readonly createdAt: string;
  readonly claimedAt?: string;
  readonly processedAt?: string;
  readonly errorCode?: string;
}

export type RemoteTaskProtocolAttemptStatus =
  'succeeded' | 'provider_unreachable' | 'contract_invalid' | 'provider_protocol';

export interface RemoteTaskProtocolAttempt {
  readonly attemptId: string;
  readonly bindingId: string;
  readonly method: 'tasks/get';
  readonly expectedBindingVersion: number;
  readonly protocolRevision: string;
  readonly status: RemoteTaskProtocolAttemptStatus;
  readonly errorCode?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export function createRemoteTaskBinding(input: RemoteTaskAdmission): RemoteTaskBinding {
  const identityFields = [
    input.bindingId,
    input.serverId,
    input.operationName,
    input.remoteTaskId,
    input.agentTaskId,
    input.contextId,
    input.goalId,
    input.workflowPlanId,
    input.workflowDefinitionId,
    input.workflowInstanceId,
    input.workflowNodeId,
    input.workflowNodeRunId,
    input.mcpInvocationId,
    input.protocolRevision,
    input.tasksSchemaRevision,
    input.credentialRevision,
    input.sessionRevision,
  ];
  if (identityFields.some((value) => value.trim() === '')) {
    throw new DomainError(
      'REMOTE_TASK_BINDING_INVALID',
      'Remote Task binding identity fields must be non-empty.',
    );
  }
  if (
    !Number.isInteger(input.goalVersion) ||
    input.goalVersion < 1 ||
    !Number.isInteger(input.workflowDefinitionVersion) ||
    input.workflowDefinitionVersion < 1
  ) {
    throw new DomainError(
      'REMOTE_TASK_BINDING_INVALID',
      'Remote Task Goal and Workflow definition versions must be positive integers.',
    );
  }
  if (!Number.isInteger(input.pollIntervalMs) || input.pollIntervalMs < 100) {
    throw new DomainError(
      'REMOTE_TASK_POLL_INTERVAL_INVALID',
      'Remote Task polling interval must be an integer of at least 100 milliseconds.',
    );
  }
  // tools/call is admission evidence, not an authoritative tasks/get snapshot.
  // Every accepted remote Task therefore enters one initial poll before its
  // observed Provider status is projected into awaiting/terminal local state.
  const localState = 'polling' as const;
  const protocolContract =
    input.protocolContract ??
    Object.freeze({
      mode: 'legacy_v11' as const,
      protocolVersion: input.protocolRevision,
      baselineSha256: 'legacy-v11-historical',
    });
  if (protocolContract.mode === 'frozen_v1') {
    if (input.taskBehavior === undefined || input.runtimeRevision === undefined)
      throw new DomainError(
        'REMOTE_TASK_FROZEN_AUTHORITY_REQUIRED',
        'Frozen Remote Task admission requires taskBehavior and runtimeRevision.',
      );
  }
  if ((input.taskTtlMs === undefined) !== (input.taskExpiresAt === undefined))
    throw new DomainError(
      'REMOTE_TASK_TTL_EXPIRY_MISMATCH',
      'Remote Task TTL and expiry must be supplied together.',
    );
  return Object.freeze({
    ...input,
    protocolContract,
    executionContext: createRuntimeExecutionContext(input.executionContext),
    localState,
    nextPollAt: input.nextPollAt ?? input.createdAt,
    pollAttempt: 0,
    providerFailureCount: 0,
    version: 1,
    updatedAt: input.createdAt,
  });
}

export function localStateForStatus(status: McpTaskStatus): RemoteTaskLocalState {
  switch (status) {
    case 'working':
      return 'polling';
    case 'input_required':
      return 'awaiting_input';
    case 'completed':
    case 'failed':
    case 'cancelled':
      return 'terminal_event_pending';
  }
}

export function controlEventTypeForStatus(
  status: Exclude<McpTaskStatus, 'working'>,
): RemoteTaskControlEventType {
  switch (status) {
    case 'input_required':
      return 'task.input_required';
    case 'completed':
      return 'task.completed';
    case 'failed':
      return 'task.failed';
    case 'cancelled':
      return 'task.cancelled';
  }
}

export function isRemoteTaskTerminal(status: McpTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function isRemoteTaskObservationActive(binding: RemoteTaskBinding): boolean {
  return (
    binding.terminalAt === undefined &&
    (binding.localState === 'polling' || binding.localState === 'cancel_observing') &&
    (binding.invalidatedAt === undefined || binding.localState === 'cancel_observing')
  );
}

export function createRemoteTaskCancellationRequest(
  input: Omit<
    RemoteTaskCancellationRequest,
    'deliveryStatus' | 'attemptCount' | 'updatedAt' | 'version'
  >,
): RemoteTaskCancellationRequest {
  const identifiers = [
    input.requestId,
    input.bindingId,
    input.idempotencyKey,
    input.reasonCode,
    input.summary,
  ];
  if (identifiers.some((value) => value.trim() === ''))
    throw new DomainError(
      'REMOTE_TASK_CANCELLATION_INVALID',
      'Remote Task cancellation identity and display fields must be non-empty.',
    );
  if (input.summary.length > 2_048 || input.reasonCode.length > 128)
    throw new DomainError(
      'REMOTE_TASK_CANCELLATION_INVALID',
      'Remote Task cancellation display fields exceed their bounded size.',
    );
  return Object.freeze({
    ...input,
    deliveryStatus: 'requested',
    attemptCount: 0,
    updatedAt: input.requestedAt,
    version: 1,
  });
}

export function resultSnapshotFromRemoteTask(
  snapshot: RemoteTaskSnapshot,
): InternalToolResult | undefined {
  return snapshot.status === 'completed' ? snapshot.result : undefined;
}

export function errorSnapshotFromRemoteTask(
  snapshot: RemoteTaskSnapshot,
): RemoteTaskFailureSnapshot | undefined {
  return snapshot.status === 'failed' ? snapshot.error : undefined;
}
