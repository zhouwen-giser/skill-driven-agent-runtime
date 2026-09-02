import {
  classifyProviderBusinessOutcome,
  createWorkflowContinuationAttempt,
  transitionWorkflowContinuationAttempt,
  type RemoteTaskBinding,
  type RemoteTaskControlEvent,
  type WorkflowExternalWaitResolution,
  type WorkflowInstance,
  type WorkflowContinuationAttempt,
  type WorkflowContinuationSnapshot,
} from '../../domain/src/index.js';

import type {
  Clock,
  ContextSerialGate,
  RemoteTaskRepository,
  RemoteTaskContinuationJob,
  RemoteTaskContinuationQueue,
  WorkflowContinuationRepository,
} from './ports.js';
import type { WorkflowExecutionService } from './workflow-execution.js';

export type RemoteTaskContinuationProcessResult =
  | Readonly<{ disposition: 'input_activated' | 'input_deferred' }>
  | Readonly<{ disposition: 'not_claimed' }>
  | Readonly<{ disposition: 'stale'; instance?: WorkflowInstance }>
  | Readonly<{
      disposition: 'callback_deferred';
      workflowControlId: string;
      instance: WorkflowInstance;
      errorCode: string;
    }>
  | Readonly<{ disposition: 'uncertain'; errorCode: string }>
  | Readonly<{
      disposition: 'continued';
      workflowControlId: string;
      instance: WorkflowInstance;
    }>;

export class RemoteTaskContinuationService {
  readonly #continuations: WorkflowContinuationRepository;
  readonly #remoteTasks: Pick<RemoteTaskRepository, 'findById'>;
  readonly #execution: Pick<WorkflowExecutionService, 'get' | 'continueExternal'>;
  readonly #serial: ContextSerialGate;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextClaimToken(): string; nextAttemptId(): string }>;
  readonly #claimLeaseMs: number;
  readonly #failTask: (taskId: string, errorCode: string, summary: string) => Promise<void>;
  readonly #onContinued:
    | ((
        input: Readonly<{
          snapshot: WorkflowContinuationSnapshot;
          instance: WorkflowInstance;
          continuationAttemptId: string;
        }>,
      ) => Promise<void>)
    | undefined;
  readonly #inputRequired:
    | Readonly<{
        process(
          event: RemoteTaskContinuationJob,
        ): Promise<'activated' | 'deferred' | 'not_claimed'>;
      }>
    | undefined;

  constructor(
    dependencies: Readonly<{
      continuations: WorkflowContinuationRepository;
      remoteTasks: Pick<RemoteTaskRepository, 'findById'>;
      execution: Pick<WorkflowExecutionService, 'get' | 'continueExternal'>;
      serial: ContextSerialGate;
      clock: Clock;
      ids: Readonly<{ nextClaimToken(): string; nextAttemptId(): string }>;
      failTask(taskId: string, errorCode: string, summary: string): Promise<void>;
      claimLeaseMs?: number;
      onContinued?: (
        input: Readonly<{
          snapshot: WorkflowContinuationSnapshot;
          instance: WorkflowInstance;
          continuationAttemptId: string;
        }>,
      ) => Promise<void>;
      inputRequired?: Readonly<{
        process(
          event: RemoteTaskContinuationJob,
        ): Promise<'activated' | 'deferred' | 'not_claimed'>;
      }>;
    }>,
  ) {
    this.#continuations = dependencies.continuations;
    this.#remoteTasks = dependencies.remoteTasks;
    this.#execution = dependencies.execution;
    this.#serial = dependencies.serial;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#failTask = dependencies.failTask;
    this.#claimLeaseMs = dependencies.claimLeaseMs ?? 30_000;
    this.#onContinued = dependencies.onContinued;
    this.#inputRequired = dependencies.inputRequired;
  }

  async process(event: RemoteTaskContinuationJob): Promise<RemoteTaskContinuationProcessResult> {
    if (event.eventType === 'task.input_required') {
      const result = await this.#inputRequired?.process(event);
      return {
        disposition: result === 'activated' ? 'input_activated' : 'input_deferred',
      };
    }
    const binding = await this.#remoteTasks.findById(event.bindingId);
    if (binding === undefined) return { disposition: 'not_claimed' };
    return this.#serial.run(binding.contextId, () => this.#processSerial(event, binding));
  }

  async #processSerial(
    event: RemoteTaskContinuationJob,
    binding: RemoteTaskBinding,
  ): Promise<RemoteTaskContinuationProcessResult> {
    const claimedAt = this.#clock.now();
    const claimToken = this.#ids.nextClaimToken();
    const claimed = await this.#continuations.claimControl({
      eventId: event.eventId,
      claimToken,
      claimedAt,
      expiresAt: addMilliseconds(claimedAt, this.#claimLeaseMs),
    });
    if (claimed === undefined) return { disposition: 'not_claimed' };
    if (claimed.bindingId !== binding.bindingId || claimed.type !== event.eventType) {
      await this.#continuations.finishControl({
        eventId: event.eventId,
        claimToken,
        status: 'failed',
        processedAt: this.#clock.now(),
        errorCode: 'REMOTE_TASK_CONTROL_REFERENCE_MISMATCH',
      });
      throw new RemoteTaskContinuationError(
        'REMOTE_TASK_CONTROL_REFERENCE_MISMATCH',
        'The queued remote Task control reference does not match PostgreSQL authority.',
      );
    }
    const existingAttempt = await this.#continuations.findLatestAttemptByEvent(event.eventId);
    if (existingAttempt !== undefined)
      return this.#recoverAttempt(claimed, binding, existingAttempt, claimToken);
    const snapshot = await this.#continuations.findCurrentByBinding(binding.bindingId);
    if (snapshot === undefined) {
      await this.#continuations.finishControl({
        eventId: event.eventId,
        claimToken,
        status: 'processed',
        processedAt: this.#clock.now(),
      });
      return { disposition: 'stale' };
    }
    let attempt = createWorkflowContinuationAttempt({
      attemptId: this.#ids.nextAttemptId(),
      eventId: event.eventId,
      snapshotId: snapshot.snapshotId,
      continuationId: snapshot.continuationId,
      workflowInstanceId: snapshot.workflowInstanceId,
      snapshotStateVersion: snapshot.stateVersion,
      claimToken,
      status: 'claimed',
      createdAt: claimedAt,
    });
    await this.#continuations.saveAttempt(attempt);
    const instance = await this.#execution.get(snapshot.workflowInstanceId);
    const wait = snapshot.waitingNodeRuns.find(
      (candidate) =>
        candidate.kind === 'remote_task' &&
        candidate.sourceId === binding.bindingId &&
        candidate.nodeId === binding.workflowNodeId &&
        candidate.nodeRunId === binding.workflowNodeRunId,
    );
    if (!continuationAuthorityMatches(binding, snapshot, instance) || wait === undefined) {
      attempt = transitionWorkflowContinuationAttempt(attempt, 'stale', this.#clock.now());
      await this.#continuations.updateAttempt(attempt, 'claimed');
      await this.#continuations.finishControl({
        eventId: event.eventId,
        claimToken,
        status: 'processed',
        processedAt: this.#clock.now(),
      });
      return { disposition: 'stale', ...(instance === undefined ? {} : { instance }) };
    }
    attempt = transitionWorkflowContinuationAttempt(attempt, 'running', this.#clock.now());
    await this.#continuations.updateAttempt(attempt, 'claimed');
    return this.#executeAttempt(
      claimed,
      snapshot,
      attempt,
      claimToken,
      wait.waitId,
      wait.nodeRunId,
    );
  }

  async #executeAttempt(
    control: RemoteTaskControlEvent,
    snapshot: WorkflowContinuationSnapshot,
    runningAttempt: WorkflowContinuationAttempt,
    claimToken: string,
    waitId: string,
    nodeRunId: string,
  ): Promise<RemoteTaskContinuationProcessResult> {
    let continued: WorkflowInstance;
    try {
      continued = await this.#execution.continueExternal({
        instanceId: snapshot.workflowInstanceId,
        resolution: resolutionFromControlEvent(control, waitId, nodeRunId),
        continuationAttemptId: runningAttempt.attemptId,
      });
    } catch (error: unknown) {
      const errorCode = normalizedCode(error);
      await this.#failTask(
        snapshot.agentTaskId,
        errorCode,
        'Remote Task terminal evidence could not continue the durable Workflow; the local Task and binding were quarantined without replaying the Provider call.',
      );
      const failedAttempt = transitionWorkflowContinuationAttempt(
        runningAttempt,
        'failed',
        this.#clock.now(),
        errorCode,
      );
      await this.#continuations.updateAttempt(failedAttempt, 'running');
      await this.#continuations.finishControl({
        eventId: control.eventId,
        claimToken,
        status: 'failed',
        processedAt: this.#clock.now(),
        errorCode,
        bindingDisposition: 'quarantined',
      });
      throw error;
    }
    const completedAttempt = terminalAttemptForInstance(
      runningAttempt,
      continued,
      this.#clock.now(),
    );
    await this.#continuations.updateAttempt(completedAttempt, 'running');
    return this.#deliverContinuation(control, snapshot, continued, completedAttempt, claimToken);
  }

  async #recoverAttempt(
    control: RemoteTaskControlEvent,
    binding: RemoteTaskBinding,
    attempt: WorkflowContinuationAttempt,
    claimToken: string,
  ): Promise<RemoteTaskContinuationProcessResult> {
    const [snapshot, instance] = await Promise.all([
      this.#continuations.findById(attempt.snapshotId),
      this.#execution.get(attempt.workflowInstanceId),
    ]);
    if (
      snapshot === undefined ||
      instance === undefined ||
      !continuationIdentityMatches(binding, snapshot, instance)
    ) {
      const errorCode = 'REMOTE_TASK_CONTINUATION_RECOVERY_AUTHORITY_MISMATCH';
      await this.#failTask(
        binding.agentTaskId,
        errorCode,
        'Remote Task continuation recovery authority no longer matches the durable Workflow state; the local Task was failed without replaying the continuation.',
      );
      await this.#continuations.finishControl({
        eventId: control.eventId,
        claimToken,
        status: 'failed',
        processedAt: this.#clock.now(),
        errorCode,
      });
      return {
        disposition: 'uncertain',
        errorCode,
      };
    }
    if (attempt.status === 'claimed') {
      const wait = snapshot.waitingNodeRuns.find(
        (candidate) =>
          candidate.kind === 'remote_task' &&
          candidate.sourceId === binding.bindingId &&
          candidate.nodeId === binding.workflowNodeId &&
          candidate.nodeRunId === binding.workflowNodeRunId,
      );
      if (instance.status !== 'waiting_external' || wait === undefined) {
        const stale = transitionWorkflowContinuationAttempt(attempt, 'stale', this.#clock.now());
        await this.#continuations.updateAttempt(stale, 'claimed');
        await this.#continuations.finishControl({
          eventId: control.eventId,
          claimToken,
          status: 'processed',
          processedAt: this.#clock.now(),
        });
        return { disposition: 'stale', instance };
      }
      const running = transitionWorkflowContinuationAttempt(attempt, 'running', this.#clock.now());
      await this.#continuations.updateAttempt(running, 'claimed');
      return this.#executeAttempt(
        control,
        snapshot,
        running,
        claimToken,
        wait.waitId,
        wait.nodeRunId,
      );
    }
    if (attempt.status === 'running') {
      const currentSnapshot = await this.#continuations.findCurrent(instance.instanceId);
      const graphCommitObserved =
        instance.status !== 'waiting_external' ||
        (currentSnapshot !== undefined &&
          currentSnapshot.snapshotId !== snapshot.snapshotId &&
          currentSnapshot.stateVersion > attempt.snapshotStateVersion);
      if (!graphCommitObserved) {
        const errorCode = 'WORKFLOW_EXTERNAL_CONTINUATION_OUTCOME_UNCERTAIN';
        await this.#failTask(
          binding.agentTaskId,
          errorCode,
          'The remote Task terminal result was claimed, but no durable Workflow continuation outcome exists; the local Task was failed without replaying the continuation.',
        );
        const failed = transitionWorkflowContinuationAttempt(
          attempt,
          'failed',
          this.#clock.now(),
          errorCode,
        );
        await this.#continuations.updateAttempt(failed, 'running');
        await this.#continuations.finishControl({
          eventId: control.eventId,
          claimToken,
          status: 'failed',
          processedAt: this.#clock.now(),
          errorCode,
        });
        return { disposition: 'uncertain', errorCode };
      }
      const recovered = terminalAttemptForInstance(attempt, instance, this.#clock.now());
      await this.#continuations.updateAttempt(recovered, 'running');
      return this.#deliverContinuation(control, snapshot, instance, recovered, claimToken);
    }
    if (attempt.status === 'stale') {
      await this.#continuations.finishControl({
        eventId: control.eventId,
        claimToken,
        status: 'processed',
        processedAt: this.#clock.now(),
      });
      return { disposition: 'stale', instance };
    }
    return this.#deliverContinuation(control, snapshot, instance, attempt, claimToken);
  }

  async #deliverContinuation(
    control: RemoteTaskControlEvent,
    snapshot: WorkflowContinuationSnapshot,
    instance: WorkflowInstance,
    attempt: WorkflowContinuationAttempt,
    claimToken: string,
  ): Promise<RemoteTaskContinuationProcessResult> {
    try {
      await this.#onContinued?.({
        snapshot,
        instance,
        continuationAttemptId: attempt.attemptId,
      });
    } catch (error: unknown) {
      const errorCode = normalizedCode(error);
      if (errorCode === 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED') {
        await this.#failTask(
          snapshot.agentTaskId,
          errorCode,
          'The frozen Capability rejected the remote terminal result; the local Task and binding were quarantined without replaying the Provider call.',
        );
        await this.#continuations.finishControl({
          eventId: control.eventId,
          claimToken,
          status: 'failed',
          processedAt: this.#clock.now(),
          errorCode,
          bindingDisposition: 'quarantined',
        });
        return { disposition: 'uncertain', errorCode };
      }
      await this.#continuations.deferControl({
        eventId: control.eventId,
        claimToken,
        errorCode,
      });
      return {
        disposition: 'callback_deferred',
        workflowControlId: snapshot.workflowControlId,
        instance,
        errorCode,
      };
    }
    await this.#continuations.finishControl({
      eventId: control.eventId,
      claimToken,
      status: 'processed',
      processedAt: this.#clock.now(),
      bindingDisposition: 'reentered',
    });
    return {
      disposition: 'continued',
      workflowControlId: snapshot.workflowControlId,
      instance,
    };
  }
}

export class RemoteTaskContinuationReconciler {
  readonly #continuations: Pick<WorkflowContinuationRepository, 'listInbox'>;
  readonly #queue: RemoteTaskContinuationQueue;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      continuations: Pick<WorkflowContinuationRepository, 'listInbox'>;
      queue: RemoteTaskContinuationQueue;
      clock: Clock;
    }>,
  ) {
    this.#continuations = dependencies.continuations;
    this.#queue = dependencies.queue;
    this.#clock = dependencies.clock;
  }

  async reconcile(limit = 100): Promise<
    Readonly<{
      examined: number;
      scheduled: number;
      alreadyScheduled: number;
      deferredInput: number;
    }>
  > {
    const events = await this.#continuations.listInbox(this.#clock.now(), limit);
    let scheduled = 0;
    let alreadyScheduled = 0;
    const deferredInput = 0;
    for (const event of events) {
      const state = await this.#queue.state(event.eventId);
      if (state === 'scheduled' || state === 'active') {
        alreadyScheduled += 1;
        continue;
      }
      await this.#queue.enqueue({
        eventId: event.eventId,
        bindingId: event.bindingId,
        eventType: event.type,
      });
      scheduled += 1;
    }
    return { examined: events.length, scheduled, alreadyScheduled, deferredInput };
  }
}

function continuationAuthorityMatches(
  binding: RemoteTaskBinding,
  snapshot: Readonly<{
    agentTaskId: string;
    contextId: string;
    goalId: string;
    goalVersion: number;
    workflowPlanId: string;
    workflowDefinitionId: string;
    workflowDefinitionVersion: number;
    workflowInstanceId: string;
  }>,
  instance: WorkflowInstance | undefined,
): instance is WorkflowInstance {
  return (
    instance?.status === 'waiting_external' &&
    continuationIdentityMatches(binding, snapshot, instance)
  );
}

function continuationIdentityMatches(
  binding: RemoteTaskBinding,
  snapshot: Readonly<{
    agentTaskId: string;
    contextId: string;
    goalId: string;
    goalVersion: number;
    workflowPlanId: string;
    workflowDefinitionId: string;
    workflowDefinitionVersion: number;
    workflowInstanceId: string;
  }>,
  instance: WorkflowInstance,
): boolean {
  return (
    binding.agentTaskId === snapshot.agentTaskId &&
    binding.contextId === snapshot.contextId &&
    binding.goalId === snapshot.goalId &&
    binding.goalVersion === snapshot.goalVersion &&
    binding.workflowPlanId === snapshot.workflowPlanId &&
    binding.workflowDefinitionId === snapshot.workflowDefinitionId &&
    binding.workflowDefinitionVersion === snapshot.workflowDefinitionVersion &&
    binding.workflowInstanceId === snapshot.workflowInstanceId &&
    instance.planId === snapshot.workflowPlanId &&
    instance.goalId === snapshot.goalId &&
    instance.goalVersion === snapshot.goalVersion
  );
}

function terminalAttemptForInstance(
  attempt: WorkflowContinuationAttempt,
  instance: WorkflowInstance,
  completedAt: string,
): WorkflowContinuationAttempt {
  if (instance.status === 'failed' || instance.status === 'running' || instance.status === 'paused')
    return transitionWorkflowContinuationAttempt(
      attempt,
      'failed',
      completedAt,
      firstErrorCode(instance) ?? 'WORKFLOW_EXTERNAL_CONTINUATION_FAILED',
    );
  if (instance.status === 'canceled')
    return transitionWorkflowContinuationAttempt(attempt, 'canceled', completedAt);
  if (instance.status === 'waiting_external')
    return transitionWorkflowContinuationAttempt(attempt, 'waiting_external', completedAt);
  return transitionWorkflowContinuationAttempt(attempt, 'succeeded', completedAt);
}

function resolutionFromControlEvent(
  event: RemoteTaskControlEvent,
  waitId: string,
  nodeRunId: string,
): WorkflowExternalWaitResolution {
  const payload = payloadRecord(event.payload);
  if (event.type === 'task.completed') {
    if (payload['status'] !== 'completed' || !isInternalToolResult(payload['result']))
      throw new RemoteTaskContinuationError(
        'REMOTE_TASK_CONTROL_PAYLOAD_INVALID',
        'Completed remote Task control evidence does not contain a valid Tool result.',
      );
    const result = payload['result'];
    if (result.isError) classifyProviderBusinessOutcome(result);
    return { kind: 'completed', waitId, nodeRunId, result };
  }
  if (event.type === 'task.failed') {
    const error = payloadRecord(payload['error']);
    return {
      kind: 'failed',
      waitId,
      nodeRunId,
      error: {
        code: 'MCP_REMOTE_TASK_FAILED',
        message: remoteTaskFailureMessage(error),
        category: 'provider_failed',
        data: error,
      },
    };
  }
  if (event.type === 'task.cancelled')
    return {
      kind: 'failed',
      waitId,
      nodeRunId,
      error: {
        code: 'MCP_REMOTE_TASK_CANCELLED',
        message: 'The remote MCP Task was cancelled.',
        category: 'provider_cancelled',
        data: payload,
      },
    };
  throw new RemoteTaskContinuationError(
    'REMOTE_TASK_CONTROL_EVENT_NOT_TERMINAL',
    'Only terminal remote Task control events may continue a Workflow graph.',
  );
}

function remoteTaskFailureMessage(error: Readonly<Record<string, unknown>>): string {
  const data = error['data'];
  const reasonCode =
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Readonly<Record<string, unknown>>)['reasonCode']
      : undefined;
  if (typeof reasonCode === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(reasonCode))
    return reasonCode;
  return typeof error['message'] === 'string' && error['message'].trim() !== ''
    ? error['message']
    : 'The remote MCP Task failed.';
}

function payloadRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new RemoteTaskContinuationError(
      'REMOTE_TASK_CONTROL_PAYLOAD_INVALID',
      'Remote Task control evidence must be a JSON object.',
    );
  return value as Readonly<Record<string, unknown>>;
}

function isInternalToolResult(value: unknown): value is Readonly<{
  content: readonly unknown[];
  structuredContent?: unknown;
  isError: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'content' in value &&
    Array.isArray(value.content) &&
    'isError' in value &&
    typeof value.isError === 'boolean'
  );
}

function firstErrorCode(instance: WorkflowInstance): string | undefined {
  return Object.values(instance.errors)[0]?.code;
}

function normalizedCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'WORKFLOW_EXTERNAL_CONTINUATION_FAILED';
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new Error('REMOTE_TASK_CONTINUATION_CLOCK_INVALID');
  return new Date(parsed + milliseconds).toISOString();
}

export class RemoteTaskContinuationError extends Error {
  readonly code:
    | 'REMOTE_TASK_CONTROL_PAYLOAD_INVALID'
    | 'REMOTE_TASK_CONTROL_EVENT_NOT_TERMINAL'
    | 'REMOTE_TASK_CONTROL_REFERENCE_MISMATCH';

  constructor(code: RemoteTaskContinuationError['code'], message: string) {
    super(message);
    this.name = 'RemoteTaskContinuationError';
    this.code = code;
  }
}
