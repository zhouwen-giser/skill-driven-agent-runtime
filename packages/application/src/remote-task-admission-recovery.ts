import { createHash } from 'node:crypto';

import type {
  WorkflowContinuationSnapshot,
  McpInvocation,
  McpProtocolContractSnapshot,
  McpTaskBehavior,
  McpToolCancellation,
  RemoteTaskBinding,
  RemoteTaskAuthoritySnapshot,
  RemoteTaskCreated,
  RemoteTaskSnapshot,
  RuntimeExecutionContext,
  TaskExecutionTiming,
} from '../../domain/src/index.js';
import { compareRuntimeRevisions } from '../../domain/src/index.js';

import type {
  Clock,
  RemoteTaskRepository,
  WorkflowContinuationRepository,
  WorkflowExternalWaitCheckpointCompleteness,
} from './ports.js';
import type { RemoteTaskAdmissionService } from './remote-task-polling.js';

export type RemoteTaskAdmissionIntentStatus =
  'prepared' | 'dispatching' | 'receipt_recorded' | 'materialized' | 'uncertain' | 'closed';

/** Frozen local authority needed to rebuild admission without redispatching the Provider call. */
export interface RemoteTaskAdmissionEnvelope {
  readonly bindingId: string;
  readonly serverId: string;
  readonly operationName: string;
  readonly agentTaskId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly workflowPlanId: string;
  readonly skillGoalId?: string;
  readonly skillAttemptId?: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly workflowInstanceId: string;
  readonly workflowNodeId: string;
  readonly workflowNodeRunId: string;
  readonly parentWorkflowInstanceId?: string;
  readonly parentSkillCallId?: string;
  readonly mcpInvocationId: string;
  readonly requestedTiming?: TaskExecutionTiming;
  readonly executionContext: RuntimeExecutionContext;
  readonly createdAt: string;
}

export interface RemoteTaskAdmissionReceipt {
  readonly remoteTask: RemoteTaskCreated;
  readonly reconciledTask?: RemoteTaskSnapshot;
  readonly credentialRevision: string;
  readonly sessionRevision: string;
  readonly protocolContract: McpProtocolContractSnapshot;
  readonly taskBehavior: McpTaskBehavior;
  readonly taskCancellation: McpToolCancellation;
  readonly authoritySnapshot: RemoteTaskAuthoritySnapshot;
  readonly continuation: Readonly<{
    snapshot: WorkflowContinuationSnapshot;
    completeness: WorkflowExternalWaitCheckpointCompleteness;
  }>;
}

export interface RemoteTaskAdmissionIntent {
  readonly intentId: string;
  readonly invocationId: string;
  readonly taskId: string;
  readonly capabilityAttemptId?: string;
  readonly contextId: string;
  readonly serverId: string;
  readonly operationName: string;
  readonly argumentsHash: string;
  readonly envelope: RemoteTaskAdmissionEnvelope;
  readonly status: RemoteTaskAdmissionIntentStatus;
  readonly dispatchHash?: string;
  readonly dispatchedAt?: string;
  readonly dispatchAuthoritySnapshot?: RemoteTaskAuthoritySnapshot;
  readonly receipt?: RemoteTaskAdmissionReceipt;
  readonly receiptRecordedAt?: string;
  readonly materializedBindingId?: string;
  readonly materializedSnapshotId?: string;
  readonly materializedAt?: string;
  readonly reasonCode?: string;
  readonly closedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * Read-only development observation of the Provider-return/admission boundary.
 *
 * The two raw payloads deliberately remain `unknown`: this projection reports the
 * bytes admitted into Runtime persistence without promoting any Provider claim to
 * Runtime authority. The cross-repository binding contract is resolved elsewhere.
 */
export interface RemoteTaskAdmissionObservation {
  readonly observationKind: 'runtime_remote_task_admission';
  readonly authorityInference: 'none';
  readonly runtimeLocalIdentity: Readonly<{
    intentId: string;
    invocationId: string;
    bindingId: string;
    taskId: string;
    capabilityAttemptId?: string;
    contextId: string;
    serverId: string;
    operationName: string;
    localEnvelope: unknown;
  }>;
  /** Exact JSON value recorded on the MCP invocation, or null before receipt recording. */
  readonly rawAdmissionResponse: unknown;
  /** Exact Runtime recovery receipt JSON, kept separate from the Provider response. */
  readonly rawAdmissionReceipt: unknown;
  readonly journal: Readonly<{
    status: RemoteTaskAdmissionIntentStatus;
    version: number;
    dispatchHash?: string;
    recordedInvocationId?: string;
    materializedBindingId?: string;
    reasonCode?: string;
    createdAt: string;
    updatedAt: string;
    receiptRecordedAt?: string;
  }>;
}

export interface RemoteTaskAdmissionObservationQuery {
  listByAgentTaskId(agentTaskId: string): Promise<readonly RemoteTaskAdmissionObservation[]>;
}

export type RemoteTaskAdmissionIntentMutation =
  | Readonly<{ applied: true; intent: RemoteTaskAdmissionIntent }>
  | Readonly<{
      applied: false;
      reason: 'missing' | 'stale' | 'closed' | 'conflict';
      intent?: RemoteTaskAdmissionIntent;
    }>;

export interface RemoteTaskAdmissionIntentStore {
  prepare(
    intent: RemoteTaskAdmissionIntent,
  ): Promise<Readonly<{ intent: RemoteTaskAdmissionIntent; created: boolean }>>;
  markDispatching(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      dispatchHash: string;
      authoritySnapshot: RemoteTaskAuthoritySnapshot;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation>;
  recordRemoteReceiptAndInvocation(
    intentId: string,
    invocation: McpInvocation,
    receipt: RemoteTaskAdmissionReceipt,
    at: string,
  ): Promise<RemoteTaskAdmissionIntentMutation>;
  markMaterialized(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      bindingId: string;
      snapshotId: string;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation>;
  findByBindingId(bindingId: string): Promise<RemoteTaskAdmissionIntent | undefined>;
  markUncertain(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      reasonCode: string;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation>;
  closeReceiptAsUncertain(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      reasonCode: string;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation>;
  replaceContinuation(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      continuation: RemoteTaskAdmissionReceipt['continuation'];
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation>;
  close(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      reasonCode: string;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation>;
  listRecoverable(limit: number): Promise<readonly RemoteTaskAdmissionIntent[]>;
}

export class RemoteTaskAdmissionRecoveryService {
  readonly #store: RemoteTaskAdmissionIntentStore;
  readonly #admission: RemoteTaskAdmissionService | undefined;
  readonly #remoteTasks: RemoteTaskRepository | undefined;
  readonly #continuations: WorkflowContinuationRepository | undefined;
  readonly #clock: Clock | undefined;
  readonly #failTask:
    ((taskId: string, errorCode: string, summary: string) => Promise<void>) | undefined;
  readonly #nextObservationId: (() => string) | undefined;
  readonly #nextControlEventId: (() => string) | undefined;

  constructor(
    dependencies:
      | RemoteTaskAdmissionIntentStore
      | Readonly<{
          store: RemoteTaskAdmissionIntentStore;
          admission: RemoteTaskAdmissionService;
          remoteTasks: RemoteTaskRepository;
          continuations: WorkflowContinuationRepository;
          clock: Clock;
          failTask(taskId: string, errorCode: string, summary: string): Promise<void>;
          nextObservationId(): string;
          nextControlEventId(): string;
        }>,
  ) {
    if ('listRecoverable' in dependencies) {
      this.#store = dependencies;
      this.#admission = undefined;
      this.#remoteTasks = undefined;
      this.#continuations = undefined;
      this.#clock = undefined;
      this.#failTask = undefined;
      this.#nextObservationId = undefined;
      this.#nextControlEventId = undefined;
      return;
    }
    this.#store = dependencies.store;
    this.#admission = dependencies.admission;
    this.#remoteTasks = dependencies.remoteTasks;
    this.#continuations = dependencies.continuations;
    this.#clock = dependencies.clock;
    this.#failTask = dependencies.failTask;
    this.#nextObservationId = dependencies.nextObservationId;
    this.#nextControlEventId = dependencies.nextControlEventId;
  }

  listRecoverable(limit: number): Promise<readonly RemoteTaskAdmissionIntent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new Error('REMOTE_TASK_ADMISSION_RECOVERY_LIMIT_INVALID');
    return this.#store.listRecoverable(limit);
  }

  async reconcile(
    limit = 100,
    mode: 'startup' | 'periodic' = 'startup',
  ): Promise<
    Readonly<{
      examined: number;
      materialized: number;
      uncertain: number;
      closedPrepared: number;
    }>
  > {
    if (
      this.#admission === undefined ||
      this.#remoteTasks === undefined ||
      this.#continuations === undefined ||
      this.#clock === undefined ||
      this.#failTask === undefined ||
      this.#nextObservationId === undefined ||
      this.#nextControlEventId === undefined
    )
      throw new Error('REMOTE_TASK_ADMISSION_RECOVERY_NOT_COMPOSED');
    const intents = await this.listRecoverable(limit);
    let materialized = 0;
    let uncertain = 0;
    let closedPrepared = 0;
    for (const intent of intents) {
      const at = this.#clock.now();
      if (mode === 'periodic') {
        if (intent.status !== 'receipt_recorded') continue;
        const active = await this.#continuations.findCurrentByBinding(intent.envelope.bindingId);
        if (active === undefined) continue;
      }
      if (intent.status === 'prepared') {
        const closed = await this.#store.close({
          intentId: intent.intentId,
          invocationId: intent.invocationId,
          reasonCode: 'REMOTE_TASK_ADMISSION_NOT_DISPATCHED',
          at,
        });
        if (closed.applied) closedPrepared += 1;
        continue;
      }
      if (intent.status === 'dispatching') {
        await this.#failTask(
          intent.taskId,
          'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
          'The Provider call may have created a remote Task, but no durable receipt exists; the call will not be replayed.',
        );
        const mutation = await this.#store.markUncertain({
          intentId: intent.intentId,
          invocationId: intent.invocationId,
          reasonCode: 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
          at,
        });
        if (mutation.applied) {
          uncertain += 1;
        }
        continue;
      }
      if (intent.status !== 'receipt_recorded' || intent.receipt === undefined) continue;
      const remote = intent.receipt.remoteTask;
      const runtimeRevision = remote.runtimeRevision;
      const rawAuthority: unknown = intent.receipt.authoritySnapshot;
      if (
        remote.protocolMode !== 'frozen_v1' ||
        runtimeRevision === undefined ||
        typeof rawAuthority !== 'object' ||
        rawAuthority === null
      ) {
        await this.#failTask(
          intent.taskId,
          'REMOTE_TASK_ADMISSION_RECEIPT_AUTHORITY_INVALID',
          'The persisted remote Task receipt does not contain the frozen Runtime authority required for recovery.',
        );
        const mutation = await this.#store.closeReceiptAsUncertain({
          intentId: intent.intentId,
          invocationId: intent.invocationId,
          reasonCode: 'REMOTE_TASK_ADMISSION_RECEIPT_AUTHORITY_INVALID',
          at,
        });
        if (mutation.applied) {
          uncertain += 1;
        }
        continue;
      }
      const taskExpiresAt =
        remote.ttlMs === null
          ? undefined
          : (remote.expiresAt ??
            new Date(Date.parse(remote.createdAt) + remote.ttlMs).toISOString());
      const admitted = await this.#admission.admit({
        ...intent.envelope,
        remoteTaskId: remote.remoteTaskId,
        ...(remote.providerIdentity === undefined
          ? {}
          : { providerIdentity: remote.providerIdentity }),
        admissionTask: remote,
        createdAt: intent.receiptRecordedAt ?? at,
        protocolStatus: remote.status,
        protocolRevision: remote.protocolRevision,
        tasksSchemaRevision: remote.tasksSchemaRevision,
        protocolContract: intent.receipt.protocolContract,
        taskBehavior: intent.receipt.taskBehavior,
        taskCancellation: intent.receipt.taskCancellation,
        runtimeRevision,
        ...(remote.providerRevision === undefined
          ? {}
          : { providerRevision: remote.providerRevision }),
        ...(remote.ttlMs === null || taskExpiresAt === undefined
          ? {}
          : { taskTtlMs: remote.ttlMs, taskExpiresAt }),
        ...(remote.providerObservation?.substate === undefined
          ? {}
          : { providerSubstate: remote.providerObservation.substate }),
        ...(remote.providerObservation?.remoteRevision === undefined
          ? {}
          : { remoteRevision: remote.providerObservation.remoteRevision }),
        authoritySnapshot: intent.receipt.authoritySnapshot,
        credentialRevision: intent.receipt.credentialRevision,
        sessionRevision: intent.receipt.sessionRevision,
        lastProviderUpdatedAt: remote.lastUpdatedAt,
        pollIntervalMs: Math.max(100, remote.pollIntervalMs ?? 1_000),
      });
      const reconciled = intent.receipt.reconciledTask;
      let staleVerifiedSnapshot: WorkflowContinuationSnapshot | undefined;
      if (reconciled !== undefined) {
        const snapshot = await this.#remoteTasks.recordExternalSnapshot({
          bindingId: admitted.binding.bindingId,
          expectedVersion: admitted.binding.version,
          snapshot: reconciled,
          observationId: this.#nextObservationId(),
          source: 'reconciliation',
          ...(reconciled.status === 'working'
            ? {}
            : {
                controlEventId: this.#nextControlEventId(),
                resultHash: canonicalHash(reconciled),
              }),
          observedAt: at,
        });
        if (!snapshot.applied && snapshot.reason === 'stale') {
          const current = await this.#remoteTasks.findById(admitted.binding.bindingId);
          if (current === undefined)
            throw new Error('REMOTE_TASK_ADMISSION_RECOVERY_STALE_BINDING_MISSING');
          if (!matchesRecoveredBindingIdentity(intent, current))
            throw new Error('REMOTE_TASK_ADMISSION_RECOVERY_STALE_BINDING_CONFLICT');
          if (!isRecoveredBindingOpen(current))
            throw new Error('REMOTE_TASK_ADMISSION_RECOVERY_STALE_BINDING_CLOSED');
          if (
            current.runtimeRevision === undefined ||
            reconciled.runtimeRevision === undefined ||
            compareRuntimeRevisions(current.runtimeRevision, reconciled.runtimeRevision) < 0
          )
            throw new Error('REMOTE_TASK_ADMISSION_RECOVERY_STALE_REVISION_OLDER');
          staleVerifiedSnapshot = await this.#continuations.findCurrentByBinding(current.bindingId);
          if (
            staleVerifiedSnapshot === undefined ||
            !matchesRecoveredContinuation(intent, staleVerifiedSnapshot, current.bindingId)
          )
            throw new Error('REMOTE_TASK_ADMISSION_RECOVERY_CONTINUATION_CONFLICT');
        } else if (!snapshot.applied && snapshot.reason !== 'closed') {
          throw new Error(
            `REMOTE_TASK_ADMISSION_RECOVERY_SNAPSHOT_${snapshot.reason.toUpperCase()}`,
          );
        }
      }
      let activeSnapshot =
        staleVerifiedSnapshot ??
        (await this.#continuations.findCurrentByBinding(admitted.binding.bindingId));
      if (activeSnapshot === undefined) {
        if (intent.receipt.continuation.completeness === 'requires_graph_merge') {
          await this.#failTask(
            intent.taskId,
            'REMOTE_TASK_ADMISSION_CONTINUATION_INCOMPLETE',
            'The remote Task receipt is durable, but its parallel Workflow state was not fully merged before restart; the Provider call will not be replayed.',
          );
          const mutation = await this.#store.closeReceiptAsUncertain({
            intentId: intent.intentId,
            invocationId: intent.invocationId,
            reasonCode: 'REMOTE_TASK_ADMISSION_CONTINUATION_INCOMPLETE',
            at,
          });
          if (mutation.applied) uncertain += 1;
          continue;
        }
        await this.#continuations.saveSnapshot(intent.receipt.continuation.snapshot);
        activeSnapshot = await this.#continuations.findCurrentByBinding(admitted.binding.bindingId);
      }
      if (
        activeSnapshot === undefined ||
        !matchesRecoveredContinuation(intent, activeSnapshot, admitted.binding.bindingId)
      )
        throw new Error('REMOTE_TASK_ADMISSION_RECOVERY_CONTINUATION_CONFLICT');
      const mutation = await this.#store.markMaterialized({
        intentId: intent.intentId,
        invocationId: intent.invocationId,
        bindingId: admitted.binding.bindingId,
        snapshotId: activeSnapshot.snapshotId,
        at,
      });
      if (!mutation.applied)
        throw new Error(
          `REMOTE_TASK_ADMISSION_RECOVERY_MATERIALIZE_${mutation.reason.toUpperCase()}`,
        );
      materialized += 1;
    }
    return { examined: intents.length, materialized, uncertain, closedPrepared };
  }
}

function matchesRecoveredBindingIdentity(
  intent: RemoteTaskAdmissionIntent,
  binding: RemoteTaskBinding,
): boolean {
  const receipt = intent.receipt;
  if (receipt === undefined) return false;
  const envelope = intent.envelope;
  return (
    binding.bindingId === envelope.bindingId &&
    binding.serverId === envelope.serverId &&
    binding.operationName === envelope.operationName &&
    binding.remoteTaskId === receipt.remoteTask.remoteTaskId &&
    binding.agentTaskId === envelope.agentTaskId &&
    binding.contextId === envelope.contextId &&
    binding.goalId === envelope.goalId &&
    binding.goalVersion === envelope.goalVersion &&
    binding.workflowPlanId === envelope.workflowPlanId &&
    binding.skillGoalId === envelope.skillGoalId &&
    binding.skillAttemptId === envelope.skillAttemptId &&
    binding.workflowDefinitionId === envelope.workflowDefinitionId &&
    binding.workflowDefinitionVersion === envelope.workflowDefinitionVersion &&
    binding.workflowInstanceId === envelope.workflowInstanceId &&
    binding.workflowNodeId === envelope.workflowNodeId &&
    binding.workflowNodeRunId === envelope.workflowNodeRunId &&
    binding.parentWorkflowInstanceId === envelope.parentWorkflowInstanceId &&
    binding.parentSkillCallId === envelope.parentSkillCallId &&
    binding.mcpInvocationId === envelope.mcpInvocationId &&
    binding.protocolRevision === receipt.remoteTask.protocolRevision &&
    binding.tasksSchemaRevision === receipt.remoteTask.tasksSchemaRevision &&
    canonicalHash(binding.protocolContract) === canonicalHash(receipt.protocolContract) &&
    binding.taskBehavior === receipt.taskBehavior &&
    binding.taskCancellation === receipt.taskCancellation &&
    canonicalHash(binding.requestedTiming ?? null) ===
      canonicalHash(envelope.requestedTiming ?? null) &&
    canonicalHash(binding.executionContext) === canonicalHash(envelope.executionContext) &&
    canonicalHash(binding.authoritySnapshot) === canonicalHash(receipt.authoritySnapshot) &&
    binding.credentialRevision === receipt.credentialRevision &&
    binding.sessionRevision === receipt.sessionRevision
  );
}

function isRecoveredBindingOpen(binding: RemoteTaskBinding): boolean {
  return (
    binding.invalidatedAt === undefined &&
    binding.terminalAt === undefined &&
    (binding.localState === 'polling' ||
      binding.localState === 'cancel_observing' ||
      binding.localState === 'awaiting_input')
  );
}

function matchesRecoveredContinuation(
  intent: RemoteTaskAdmissionIntent,
  snapshot: WorkflowContinuationSnapshot,
  bindingId: string,
): boolean {
  const wait = snapshot.waitingNodeRuns.find(
    (candidate) => candidate.kind === 'remote_task' && candidate.sourceId === bindingId,
  );
  return (
    snapshot.lifecycle === 'active' &&
    snapshot.agentTaskId === intent.taskId &&
    snapshot.contextId === intent.contextId &&
    snapshot.workflowPlanId === intent.envelope.workflowPlanId &&
    snapshot.workflowDefinitionId === intent.envelope.workflowDefinitionId &&
    snapshot.workflowDefinitionVersion === intent.envelope.workflowDefinitionVersion &&
    snapshot.workflowInstanceId === intent.envelope.workflowInstanceId &&
    wait?.nodeId === intent.envelope.workflowNodeId &&
    wait.nodeRunId === intent.envelope.workflowNodeRunId
  );
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
