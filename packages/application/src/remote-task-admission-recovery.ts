import { createHash } from 'node:crypto';

import type {
  McpLogicalInvocationIdentity,
  WorkflowContinuationSnapshot,
  McpInvocation,
  McpInvocationOutcome,
  McpProtocolContractSnapshot,
  McpTaskCallProfile,
  McpTaskBehavior,
  McpToolCancellation,
  RemoteTaskBinding,
  RemoteTaskProviderExecutionLink,
  RemoteTaskAuthoritySnapshot,
  RemoteTaskCreated,
  RemoteTaskSnapshot,
  RuntimeExecutionContext,
  TaskExecutionTiming,
} from '../../domain/src/index.js';
import {
  compareRuntimeRevisions,
  createRemoteTaskProviderExecutionLink,
} from '../../domain/src/index.js';

import type {
  Clock,
  RemoteTaskRepository,
  WorkflowContinuationRepository,
  WorkflowExternalWaitCheckpointCompleteness,
} from './ports.js';
import type { RemoteTaskAdmissionService } from './remote-task-polling.js';

export type RemoteTaskAdmissionIntentStatus =
  'prepared' | 'dispatching' | 'receipt_recorded' | 'materialized' | 'uncertain' | 'closed';

export interface RemoteTaskReconciliationSeed {
  readonly schemaVersion: 'sdar.remote-task-reconciliation-seed/v1';
  readonly logicalIdentity: McpLogicalInvocationIdentity;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly executionContext: RuntimeExecutionContext;
  readonly taskCallProfile?: McpTaskCallProfile;
  readonly continuation?: RemoteTaskAdmissionReceipt['continuation'];
}

export interface RemoteTaskReconciliationContract extends Omit<
  RemoteTaskReconciliationSeed,
  'schemaVersion'
> {
  readonly schemaVersion: 'sdar.remote-task-reconciliation-contract/v1';
  readonly providerId: string;
  readonly protocolContract: McpProtocolContractSnapshot;
  readonly taskBehavior: McpTaskBehavior;
  readonly taskCancellation: McpToolCancellation;
  readonly authoritySnapshot: RemoteTaskAuthoritySnapshot;
  readonly credentialRevision: string;
  readonly sessionRevision: string;
}

export type RemoteTaskExactReconciliationResult =
  | Readonly<{
      status: 'found_exact';
      outcome: Extract<McpInvocationOutcome, { kind: 'remote_task' }>;
      externalExecutionId?: string;
      deviceMissionId?: string;
    }>
  | Readonly<{
      status: 'not_found' | 'conflict' | 'unavailable' | 'deferred';
      safeErrorCode: string;
    }>;

export interface RemoteTaskReconciliationAttempt {
  readonly attemptId: string;
  readonly intentId: string;
  readonly logicalInvocationId: string;
  readonly expectedIntentVersion: number;
  readonly attemptNumber: number;
  readonly sourceContract: 'sdar.smpp-diagnostics/v1+frozen-mcp-v1';
  readonly requestHash: string;
  readonly status: RemoteTaskExactReconciliationResult['status'];
  readonly remoteTaskId?: string;
  readonly externalExecutionId?: string;
  readonly identityValidated: boolean;
  readonly safeErrorCode?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly resultHash: string;
  readonly version: 1;
}

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
  /** Missing only for a legacy receipt persisted before migration 0160. */
  readonly authoritySnapshot?: RemoteTaskAuthoritySnapshot;
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
  readonly logicalIdentity?: McpLogicalInvocationIdentity;
  readonly reconciliationSeed?: RemoteTaskReconciliationSeed;
  readonly reconciliationContract?: RemoteTaskReconciliationContract;
  readonly envelope: RemoteTaskAdmissionEnvelope;
  readonly status: RemoteTaskAdmissionIntentStatus;
  readonly dispatchHash?: string;
  readonly dispatchedAt?: string;
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
      reconciliationContract?: RemoteTaskReconciliationContract;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation>;
  recordRemoteReceiptAndInvocation(
    intentId: string,
    invocation: McpInvocation,
    receipt: RemoteTaskAdmissionReceipt,
    at: string,
  ): Promise<RemoteTaskAdmissionIntentMutation>;
  recordReconciledReceiptAndInvocation(
    input: Readonly<{
      intentId: string;
      logicalInvocationId: string;
      invocation: McpInvocation;
      receipt: RemoteTaskAdmissionReceipt;
      at: string;
    }>,
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

export interface RemoteTaskReconciliationAttemptStore {
  append(attempt: RemoteTaskReconciliationAttempt): Promise<RemoteTaskReconciliationAttempt>;
  nextAttemptNumber(intentId: string): Promise<number>;
  listByIntentId(intentId: string): Promise<readonly RemoteTaskReconciliationAttempt[]>;
}

export interface RemoteTaskProviderExecutionLinkStore {
  save(link: RemoteTaskProviderExecutionLink): Promise<RemoteTaskProviderExecutionLink>;
  findByBindingId(bindingId: string): Promise<RemoteTaskProviderExecutionLink | undefined>;
}

export interface ReconciledRemoteTaskAdmission {
  readonly result: RemoteTaskExactReconciliationResult;
  readonly invocation?: McpInvocation;
  readonly receipt?: RemoteTaskAdmissionReceipt;
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
  readonly #reconcileUncertain:
    ((intent: RemoteTaskAdmissionIntent) => Promise<ReconciledRemoteTaskAdmission>) | undefined;
  readonly #reconciliationAttempts: RemoteTaskReconciliationAttemptStore | undefined;
  readonly #providerExecutionLinks: RemoteTaskProviderExecutionLinkStore | undefined;
  readonly #markWorkflowWaitingExternal:
    ((intent: RemoteTaskAdmissionIntent) => Promise<void>) | undefined;

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
          reconcileUncertain?: (
            intent: RemoteTaskAdmissionIntent,
          ) => Promise<ReconciledRemoteTaskAdmission>;
          reconciliationAttempts?: RemoteTaskReconciliationAttemptStore;
          providerExecutionLinks?: RemoteTaskProviderExecutionLinkStore;
          markWorkflowWaitingExternal?: (intent: RemoteTaskAdmissionIntent) => Promise<void>;
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
      this.#reconcileUncertain = undefined;
      this.#reconciliationAttempts = undefined;
      this.#providerExecutionLinks = undefined;
      this.#markWorkflowWaitingExternal = undefined;
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
    this.#reconcileUncertain = dependencies.reconcileUncertain;
    this.#reconciliationAttempts = dependencies.reconciliationAttempts;
    this.#providerExecutionLinks = dependencies.providerExecutionLinks;
    this.#markWorkflowWaitingExternal = dependencies.markWorkflowWaitingExternal;
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
    for (const recoveredIntent of intents) {
      let intent = recoveredIntent;
      let reconciliationResult: RemoteTaskExactReconciliationResult | undefined;
      const at = this.#clock.now();
      if (mode === 'periodic') {
        if (intent.status === 'receipt_recorded') {
          const active = await this.#continuations.findCurrentByBinding(intent.envelope.bindingId);
          if (active === undefined) continue;
        } else if (intent.status !== 'uncertain') continue;
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
        const mutation = await this.#store.markUncertain({
          intentId: intent.intentId,
          invocationId: intent.invocationId,
          reasonCode: 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
          at,
        });
        if (mutation.applied) {
          uncertain += 1;
          intent = mutation.intent;
        }
      }
      if (intent.status === 'uncertain') {
        if (
          this.#reconcileUncertain === undefined ||
          this.#reconciliationAttempts === undefined ||
          intent.logicalIdentity === undefined ||
          intent.reconciliationContract === undefined
        ) {
          await this.#failTask(
            intent.taskId,
            'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
            'The Provider call may have created a remote Task, but exact reconciliation authority is unavailable; the call will not be replayed.',
          );
          continue;
        }
        const startedAt = this.#clock.now();
        const attemptNumber = await this.#reconciliationAttempts.nextAttemptNumber(intent.intentId);
        const reconciled = await this.#reconcileUncertain(intent);
        const completedAt = this.#clock.now();
        reconciliationResult = reconciled.result;
        const attempt: RemoteTaskReconciliationAttempt = {
          attemptId: `remote-reconcile-${canonicalHash({ intentId: intent.intentId, attemptNumber })}`,
          intentId: intent.intentId,
          logicalInvocationId: intent.logicalIdentity.logicalInvocationId,
          expectedIntentVersion: intent.version,
          attemptNumber,
          sourceContract: 'sdar.smpp-diagnostics/v1+frozen-mcp-v1',
          requestHash: `sha256:${canonicalHash(intent.reconciliationContract)}`,
          status: reconciled.result.status,
          ...(reconciled.result.status !== 'found_exact'
            ? { safeErrorCode: reconciled.result.safeErrorCode }
            : {
                remoteTaskId: reconciled.result.outcome.task.remoteTaskId,
                ...(reconciled.result.externalExecutionId === undefined
                  ? {}
                  : { externalExecutionId: reconciled.result.externalExecutionId }),
              }),
          identityValidated: reconciled.result.status === 'found_exact',
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          resultHash: `sha256:${canonicalHash(reconciled.result)}`,
          version: 1,
        };
        await this.#reconciliationAttempts.append(attempt);
        if (
          reconciled.result.status !== 'found_exact' ||
          reconciled.invocation === undefined ||
          reconciled.receipt === undefined
        ) {
          await this.#failTask(
            intent.taskId,
            `REMOTE_TASK_RECONCILIATION_${reconciled.result.status.toUpperCase()}`,
            'The ambiguous Provider dispatch could not be matched to exactly one original Task; no redispatch occurred.',
          );
          continue;
        }
        const recorded = await this.#store.recordReconciledReceiptAndInvocation({
          intentId: intent.intentId,
          logicalInvocationId: intent.logicalIdentity.logicalInvocationId,
          invocation: reconciled.invocation,
          receipt: reconciled.receipt,
          at: completedAt,
        });
        if (!recorded.applied)
          throw new Error(`REMOTE_TASK_RECONCILED_RECEIPT_${recorded.reason.toUpperCase()}`);
        intent = recorded.intent;
      }
      if (intent.status !== 'receipt_recorded' || intent.receipt === undefined) continue;
      const remote = intent.receipt.remoteTask;
      const runtimeRevision = remote.runtimeRevision;
      if (
        remote.protocolMode !== 'frozen_v1' ||
        runtimeRevision === undefined ||
        intent.receipt.authoritySnapshot === undefined
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
      await this.#markWorkflowWaitingExternal?.(intent);
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
      if (
        this.#providerExecutionLinks !== undefined &&
        intent.logicalIdentity !== undefined &&
        intent.reconciliationContract !== undefined
      ) {
        const exactResult =
          reconciliationResult?.status === 'found_exact' ? reconciliationResult : undefined;
        await this.#providerExecutionLinks.save(
          createRemoteTaskProviderExecutionLink({
            bindingId: admitted.binding.bindingId,
            logicalInvocationId: intent.logicalIdentity.logicalInvocationId,
            remoteTaskId: remote.remoteTaskId,
            providerId: intent.reconciliationContract.providerId,
            runtimeServerId: intent.logicalIdentity.serverId,
            ...(intent.reconciliationContract.authoritySnapshot.providerBinding === undefined
              ? {}
              : {
                  providerBindingId:
                    intent.reconciliationContract.authoritySnapshot.providerBinding.bindingId,
                  providerOriginType:
                    intent.reconciliationContract.authoritySnapshot.providerBinding.originType,
                  ...(intent.reconciliationContract.authoritySnapshot.providerBinding
                    .smppSourceId === undefined
                    ? {}
                    : {
                        smppSourceId:
                          intent.reconciliationContract.authoritySnapshot.providerBinding
                            .smppSourceId,
                      }),
                  ...(intent.reconciliationContract.authoritySnapshot.providerBinding
                    .externalServerId === undefined
                    ? {}
                    : {
                        externalServerId:
                          intent.reconciliationContract.authoritySnapshot.providerBinding
                            .externalServerId,
                      }),
                }),
            operationName: intent.operationName,
            executionStatus:
              exactResult?.externalExecutionId === undefined ? 'unresolved' : 'exact',
            ...(exactResult?.externalExecutionId === undefined
              ? {}
              : { externalExecutionId: exactResult.externalExecutionId }),
            missionStatus: exactResult?.deviceMissionId === undefined ? 'unresolved' : 'exact',
            ...(exactResult?.deviceMissionId === undefined
              ? {}
              : { deviceMissionId: exactResult.deviceMissionId }),
            provenance: exactResult === undefined ? 'committed_receipt' : 'reconcile_found_exact',
            sourceContract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1',
            sourceRevision:
              intent.reconciliationContract.authoritySnapshot.providerBinding === undefined
                ? `runtime:${intent.reconciliationContract.authoritySnapshot.runtime.serverUpdatedAt}/catalog:${intent.reconciliationContract.authoritySnapshot.runtime.catalogRevision}`
                : `binding:${String(intent.reconciliationContract.authoritySnapshot.providerBinding.revision)}/catalog:${intent.reconciliationContract.authoritySnapshot.providerBinding.catalogRevision}`,
            observedAt: at,
          }),
        );
      }
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
    canonicalHash(binding.authoritySnapshot ?? null) ===
      canonicalHash(receipt.authoritySnapshot ?? null) &&
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
