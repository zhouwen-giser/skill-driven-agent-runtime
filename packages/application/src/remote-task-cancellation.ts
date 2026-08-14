import {
  createRemoteTaskCancellationRequest,
  isRemoteTaskTerminal,
  type RemoteTaskCancellationAttempt,
  type RemoteTaskCancellationAttemptStatus,
  type RemoteTaskCancellationRequest,
} from '../../domain/src/index.js';

import type {
  Clock,
  ContextSerialGate,
  RemoteTaskCancellationJob,
  RemoteTaskCancellationQueue,
  RemoteTaskCancellationRepository,
  RemoteTaskCancellationSender,
  RemoteTaskRepository,
} from './ports.js';

export interface RemoteTaskCancellationIds {
  nextRequestId(): string;
  nextAttemptId(): string;
  nextClaimToken(): string;
}

export class RemoteTaskCancellationService {
  readonly #remoteTasks: Pick<RemoteTaskRepository, 'findById'>;
  readonly #cancellations: RemoteTaskCancellationRepository;
  readonly #queue: RemoteTaskCancellationQueue;
  readonly #clock: Clock;
  readonly #ids: RemoteTaskCancellationIds;

  constructor(
    dependencies: Readonly<{
      remoteTasks: Pick<RemoteTaskRepository, 'findById'>;
      cancellations: RemoteTaskCancellationRepository;
      queue: RemoteTaskCancellationQueue;
      clock: Clock;
      ids: RemoteTaskCancellationIds;
    }>,
  ) {
    this.#remoteTasks = dependencies.remoteTasks;
    this.#cancellations = dependencies.cancellations;
    this.#queue = dependencies.queue;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async request(
    input: Readonly<{
      bindingId: string;
      idempotencyKey: string;
      source: RemoteTaskCancellationRequest['source'];
      reasonCode: string;
      summary: string;
    }>,
  ): Promise<
    Readonly<{
      request?: RemoteTaskCancellationRequest;
      disposition: 'requested' | 'missing' | 'stale' | 'terminal' | 'closed' | 'unsupported';
      deliveryScheduled: boolean;
    }>
  > {
    const binding = await this.#remoteTasks.findById(input.bindingId);
    if (binding === undefined) return { disposition: 'missing', deliveryScheduled: false };
    if (isRemoteTaskTerminal(binding.protocolStatus))
      return { disposition: 'terminal', deliveryScheduled: false };
    if (binding.taskCancellation !== 'task_cancel')
      return { disposition: 'unsupported', deliveryScheduled: false };
    const requestedAt = this.#clock.now();
    const result = await this.#cancellations.requestCancellation(
      createRemoteTaskCancellationRequest({
        requestId: this.#ids.nextRequestId(),
        bindingId: binding.bindingId,
        idempotencyKey: input.idempotencyKey,
        source: input.source,
        reasonCode: input.reasonCode,
        summary: input.summary,
        requestedAt,
      }),
      binding.version,
    );
    if (!result.requested) return { disposition: result.reason, deliveryScheduled: false };
    let deliveryScheduled = false;
    if (
      result.request.providerTerminalStatus === undefined &&
      result.request.deliveryStatus === 'requested'
    )
      try {
        await this.#queue.enqueue({
          requestId: result.request.requestId,
          expectedVersion: result.request.version,
        });
        deliveryScheduled = true;
      } catch {
        // PostgreSQL is authoritative; the reconciler repairs this explicit enqueue gap.
      }
    return { disposition: 'requested', request: result.request, deliveryScheduled };
  }
}

export type RemoteTaskCancellationProcessResult =
  'missing' | 'stale' | 'resolved' | 'acknowledged' | 'uncertain' | 'unsupported';

export class RemoteTaskCancellationWorker {
  readonly #remoteTasks: Pick<RemoteTaskRepository, 'findById'>;
  readonly #cancellations: RemoteTaskCancellationRepository;
  readonly #sender: RemoteTaskCancellationSender;
  readonly #serial: ContextSerialGate;
  readonly #clock: Clock;
  readonly #ids: Pick<RemoteTaskCancellationIds, 'nextAttemptId' | 'nextClaimToken'>;
  readonly #claimLeaseMs: number;

  constructor(
    dependencies: Readonly<{
      remoteTasks: Pick<RemoteTaskRepository, 'findById'>;
      cancellations: RemoteTaskCancellationRepository;
      sender: RemoteTaskCancellationSender;
      serial: ContextSerialGate;
      clock: Clock;
      ids: Pick<RemoteTaskCancellationIds, 'nextAttemptId' | 'nextClaimToken'>;
      claimLeaseMs?: number;
    }>,
  ) {
    this.#remoteTasks = dependencies.remoteTasks;
    this.#cancellations = dependencies.cancellations;
    this.#sender = dependencies.sender;
    this.#serial = dependencies.serial;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#claimLeaseMs = dependencies.claimLeaseMs ?? 30_000;
  }

  async process(job: RemoteTaskCancellationJob): Promise<RemoteTaskCancellationProcessResult> {
    const request = await this.#cancellations.findCancellation(job.requestId);
    if (request === undefined) return 'missing';
    const binding = await this.#remoteTasks.findById(request.bindingId);
    if (binding === undefined) return 'missing';
    return this.#serial.run(binding.contextId, async () => {
      const current = await this.#cancellations.findCancellation(job.requestId);
      if (current === undefined) return 'missing';
      if (current.version !== job.expectedVersion) return 'stale';
      if (current.providerTerminalStatus !== undefined) return 'resolved';
      const claimedAt = this.#clock.now();
      const claimToken = this.#ids.nextClaimToken();
      const claim = await this.#cancellations.claimCancellation({
        requestId: current.requestId,
        expectedVersion: current.version,
        claimToken,
        claimedAt,
        expiresAt: addMilliseconds(claimedAt, this.#claimLeaseMs),
      });
      if (!claim.claimed) return claim.reason === 'resolved' ? 'resolved' : 'stale';
      const startedAt = this.#clock.now();
      if (binding.taskCancellation !== 'task_cancel') {
        const completedAt = this.#clock.now();
        const errorCode = 'MCP_TASK_CANCEL_UNSUPPORTED';
        const attempt = cancellationAttempt({
          attemptId: this.#ids.nextAttemptId(),
          request: claim.request,
          protocolRevision: binding.protocolRevision,
          status: 'provider_protocol',
          errorCode,
          startedAt,
          completedAt,
        });
        const mutation = await this.#cancellations.recordCancellationUncertain({
          requestId: claim.request.requestId,
          expectedVersion: claim.request.version,
          claimToken,
          attempt,
          errorCode,
          observedAt: completedAt,
        });
        return mutation.applied
          ? 'unsupported'
          : mutation.reason === 'resolved'
            ? 'resolved'
            : 'stale';
      }
      try {
        const ack = await this.#sender.cancelRemoteTask({
          serverId: binding.serverId,
          remoteTaskId: binding.remoteTaskId,
          executionContext: binding.executionContext,
        });
        const completedAt = this.#clock.now();
        const attempt = cancellationAttempt({
          attemptId: this.#ids.nextAttemptId(),
          request: claim.request,
          protocolRevision: ack.protocolRevision,
          status: 'acknowledged',
          startedAt,
          completedAt,
        });
        const mutation = await this.#cancellations.recordCancellationAcknowledged({
          requestId: claim.request.requestId,
          expectedVersion: claim.request.version,
          claimToken,
          attempt,
          acknowledgedAt: completedAt,
          protocolRevision: ack.protocolRevision,
        });
        return mutation.applied
          ? 'acknowledged'
          : mutation.reason === 'resolved'
            ? 'resolved'
            : 'stale';
      } catch (error: unknown) {
        const completedAt = this.#clock.now();
        const classified = classifyCancellationFailure(error);
        const attempt = cancellationAttempt({
          attemptId: this.#ids.nextAttemptId(),
          request: claim.request,
          protocolRevision: binding.protocolRevision,
          status: classified.status,
          errorCode: classified.errorCode,
          startedAt,
          completedAt,
        });
        const mutation = await this.#cancellations.recordCancellationUncertain({
          requestId: claim.request.requestId,
          expectedVersion: claim.request.version,
          claimToken,
          attempt,
          errorCode: classified.errorCode,
          observedAt: completedAt,
        });
        return mutation.applied
          ? 'uncertain'
          : mutation.reason === 'resolved'
            ? 'resolved'
            : 'stale';
      }
    });
  }
}

export class RemoteTaskCancellationReconciler {
  readonly #cancellations: Pick<RemoteTaskCancellationRepository, 'listRequiringDelivery'>;
  readonly #queue: RemoteTaskCancellationQueue;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      cancellations: Pick<RemoteTaskCancellationRepository, 'listRequiringDelivery'>;
      queue: RemoteTaskCancellationQueue;
      clock: Clock;
    }>,
  ) {
    this.#cancellations = dependencies.cancellations;
    this.#queue = dependencies.queue;
    this.#clock = dependencies.clock;
  }

  async reconcile(limit = 100): Promise<Readonly<{ examined: number; scheduled: number }>> {
    const requests = await this.#cancellations.listRequiringDelivery(this.#clock.now(), limit);
    let scheduled = 0;
    for (const request of requests) {
      const state = await this.#queue.state(request.requestId, request.version);
      if (state === 'scheduled' || state === 'active') continue;
      await this.#queue.enqueue({ requestId: request.requestId, expectedVersion: request.version });
      scheduled += 1;
    }
    return { examined: requests.length, scheduled };
  }
}

function cancellationAttempt(
  input: Readonly<{
    attemptId: string;
    request: RemoteTaskCancellationRequest;
    protocolRevision: string;
    status: RemoteTaskCancellationAttemptStatus;
    errorCode?: string;
    startedAt: string;
    completedAt: string;
  }>,
): RemoteTaskCancellationAttempt {
  const durationMs = Date.parse(input.completedAt) - Date.parse(input.startedAt);
  return {
    attemptId: input.attemptId,
    requestId: input.request.requestId,
    bindingId: input.request.bindingId,
    expectedRequestVersion: input.request.version,
    protocolRevision: input.protocolRevision,
    status: input.status,
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0,
  };
}

function classifyCancellationFailure(error: unknown): Readonly<{
  status: Extract<
    RemoteTaskCancellationAttemptStatus,
    'provider_unreachable' | 'contract_invalid' | 'provider_protocol'
  >;
  errorCode: string;
}> {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'MCP_TASK_CANCEL_PROVIDER_UNREACHABLE';
  if (code === 'MCP_TASK_RESPONSE_INVALID' || code === 'MCP_TASK_RESPONSE_TOO_LARGE')
    return { status: 'contract_invalid', errorCode: code };
  if (
    code === 'MCP_TASK_CAPABILITY_REQUIRED' ||
    code === 'MCP_TASK_PROTOCOL_REVISION_UNSUPPORTED' ||
    code === 'MCP_SERVER_NOT_FOUND'
  )
    return { status: 'provider_protocol', errorCode: code };
  return { status: 'provider_unreachable', errorCode: 'MCP_TASK_CANCEL_PROVIDER_UNREACHABLE' };
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new Error('REMOTE_TASK_CANCELLATION_CLOCK_INVALID');
  return new Date(parsed + milliseconds).toISOString();
}
