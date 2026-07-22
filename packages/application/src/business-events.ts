import type {
  BusinessEventContinuityRecord,
  BusinessEventEnvelope,
  BusinessEventInboxRecord,
  BusinessEventRelationProjection,
  BusinessEventSubscription,
} from '../../domain/src/index.js';
import {
  createBusinessEventContinuityRecord,
  createBusinessEventEnvelope,
  createBusinessEventInboxRecord,
  createBusinessEventRelationProjection,
  createBusinessEventSubscription,
} from '../../domain/src/index.js';

import type { Clock } from './ports.js';

export interface BusinessEventsRuntimePort {
  discover(input: BusinessEventsConnection): Promise<Readonly<{ profileVersion: '1.0' }>>;
  run(
    input: BusinessEventsConnection &
      (
        | Readonly<{ cursor: Readonly<{ streamId: string; afterSequence: string }> }>
        | Readonly<{ startPosition: 'earliest_available' }>
      ) &
      Readonly<{
        onAck(ack: BusinessEventsRuntimeAck): Promise<void>;
        onEvent(event: BusinessEventEnvelope): Promise<void>;
        onContinuity(continuity: BusinessEventsRuntimeContinuity): Promise<void>;
      }>,
  ): Promise<void>;
  resolveRelatedTasks(
    input: BusinessEventsConnection &
      Readonly<{
        streamId: string;
        eventId: string;
        limit: number;
        projectionToken?: string;
        afterTaskId?: string;
      }>,
  ): Promise<BusinessEventsRuntimeRelationPage>;
}

export interface BusinessEventsConnection {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface BusinessEventsRuntimeAck {
  readonly streamId: string;
  readonly generationStatus: 'current' | 'replayable_closed';
  readonly acceptedAfterSequence: string;
  readonly currentSequence: string;
}

export interface BusinessEventsRuntimeContinuity {
  readonly previousStreamId: string;
  readonly newStreamId: string;
  readonly reasonCode: BusinessEventContinuityRecord['reasonCode'];
  readonly affectedSourceIds: readonly string[];
  readonly gapDetectedAt: string;
  readonly lastReplayableSequence: string;
  readonly lastContinuousSequence?: string;
}

export interface BusinessEventsRuntimeRelationPage {
  readonly streamId: string;
  readonly eventId: string;
  readonly projectionToken: string;
  readonly items: readonly string[];
  readonly total: number;
  readonly nextAfterTaskId?: string;
}

export interface BusinessEventRuntimeRepository {
  saveBusinessEventSubscription(subscription: BusinessEventSubscription): Promise<void>;
  findCurrentBusinessEventSubscription(
    providerId: string,
  ): Promise<BusinessEventSubscription | undefined>;
  findLatestBusinessEventSubscription(
    providerId: string,
  ): Promise<BusinessEventSubscription | undefined>;
  transitionBusinessEventSubscription(
    subscriptionId: string,
    status: BusinessEventSubscription['status'],
    updatedAt: string,
    lastReplayableSequence?: string,
  ): Promise<void>;
  recordBusinessEventContinuity(
    record: BusinessEventContinuityRecord,
  ): Promise<Readonly<{ created: boolean }>>;
  admitBusinessEvent(record: BusinessEventInboxRecord): Promise<Readonly<{ created: boolean }>>;
  claimBusinessEventInbox(limit: number): Promise<readonly BusinessEventInboxRecord[]>;
  markBusinessEventProcessed(inboxId: string, processedAt: string): Promise<void>;
  markBusinessEventFailed(inboxId: string, errorCode: string, retryable: boolean): Promise<void>;
  saveBusinessEventRelationProjection(projection: BusinessEventRelationProjection): Promise<void>;
}

export interface BusinessEventSubscriptionRunResult {
  readonly providerId: string;
  readonly subscriptionId: string;
  readonly streamId: string;
  readonly generation: number;
  readonly admitted: number;
  readonly duplicates: number;
  readonly continuityControls: number;
  readonly status: BusinessEventSubscription['status'];
}

export class BusinessEventSubscriptionService {
  readonly #runtime: BusinessEventsRuntimePort;
  readonly #repository: BusinessEventRuntimeRepository;
  readonly #clock: Clock;
  readonly #nextSubscriptionId: () => string;
  readonly #nextInboxId: () => string;
  readonly #nextContinuityId: () => string;
  readonly #hash: (value: unknown) => string;
  readonly #onContinuity:
    ((record: BusinessEventContinuityRecord, providerId: string) => Promise<void>) | undefined;

  constructor(
    input: Readonly<{
      runtime: BusinessEventsRuntimePort;
      repository: BusinessEventRuntimeRepository;
      clock: Clock;
      nextSubscriptionId(): string;
      nextInboxId(): string;
      nextContinuityId(): string;
      hash(value: unknown): string;
      onContinuity?(record: BusinessEventContinuityRecord, providerId: string): Promise<void>;
    }>,
  ) {
    this.#runtime = input.runtime;
    this.#repository = input.repository;
    this.#clock = input.clock;
    this.#nextSubscriptionId = input.nextSubscriptionId;
    this.#nextInboxId = input.nextInboxId;
    this.#nextContinuityId = input.nextContinuityId;
    this.#hash = input.hash;
    this.#onContinuity = input.onContinuity;
  }

  async run(
    input: BusinessEventsConnection &
      Readonly<{
        providerId: string;
        onConnected?(): void;
      }>,
  ): Promise<BusinessEventSubscriptionRunResult> {
    await this.#runtime.discover(input);
    const latest = await this.#repository.findLatestBusinessEventSubscription(input.providerId);
    let active: BusinessEventSubscription | undefined;
    let admitted = 0;
    let duplicates = 0;
    let continuityControls = 0;
    await this.#runtime.run({
      ...input,
      ...(latest === undefined || latest.status === 'reset_required' || latest.status === 'retired'
        ? { startPosition: 'earliest_available' as const }
        : {
            cursor: {
              streamId: latest.streamId,
              afterSequence: latest.lastDurablyAdmittedSequence,
            },
          }),
      onAck: async (ack) => {
        const timestamp = this.#clock.now();
        if (latest !== undefined && latest.streamId !== ack.streamId && latest.status === 'current')
          await this.#repository.transitionBusinessEventSubscription(
            latest.subscriptionId,
            'reset_required',
            timestamp,
          );
        active = createBusinessEventSubscription({
          subscriptionId:
            latest?.streamId === ack.streamId ? latest.subscriptionId : this.#nextSubscriptionId(),
          providerId: input.providerId,
          streamId: ack.streamId,
          generation:
            latest?.streamId === ack.streamId ? latest.generation : (latest?.generation ?? 0) + 1,
          status: ack.generationStatus === 'current' ? 'current' : 'draining_closed',
          lastDurablyAdmittedSequence:
            latest?.streamId === ack.streamId
              ? latest.lastDurablyAdmittedSequence
              : ack.acceptedAfterSequence,
          lastProcessedSequence:
            latest?.streamId === ack.streamId ? latest.lastProcessedSequence : '0',
          ...(ack.generationStatus === 'replayable_closed'
            ? { lastReplayableSequence: ack.currentSequence }
            : {}),
          createdAt: latest?.streamId === ack.streamId ? latest.createdAt : timestamp,
          updatedAt: timestamp,
        });
        await this.#repository.saveBusinessEventSubscription(active);
        input.onConnected?.();
      },
      onEvent: async (eventInput) => {
        if (active?.streamId !== eventInput.streamId)
          throw businessEventRuntimeError(
            'BUSINESS_EVENTS_ACK_AUTHORITY_MISSING',
            'Business Event cannot be admitted before its stream Ack is durable.',
          );
        const event = createBusinessEventEnvelope(eventInput);
        const result = await this.#repository.admitBusinessEvent(
          createBusinessEventInboxRecord({
            inboxId: this.#nextInboxId(),
            subscriptionId: active.subscriptionId,
            eventId: event.eventId,
            sequence: event.sequence,
            envelopeHash: this.#hash(event),
            envelope: event,
            status: 'admitted',
            admittedAt: this.#clock.now(),
          }),
        );
        if (result.created) admitted += 1;
        else duplicates += 1;
      },
      onContinuity: async (continuity) => {
        if (active?.streamId !== continuity.previousStreamId)
          throw businessEventRuntimeError(
            'BUSINESS_EVENTS_CONTINUITY_AUTHORITY_MISSING',
            'Continuity does not close the active acknowledged generation.',
          );
        const record = createBusinessEventContinuityRecord({
          continuityId: this.#nextContinuityId(),
          subscriptionId: active.subscriptionId,
          ...continuity,
          createdAt: this.#clock.now(),
        });
        const result = await this.#repository.recordBusinessEventContinuity(record);
        if (result.created) {
          continuityControls += 1;
          await this.#onContinuity?.(record, input.providerId);
        }
        const retiredAt = this.#clock.now();
        await this.#repository.transitionBusinessEventSubscription(
          active.subscriptionId,
          'retired',
          retiredAt,
          continuity.lastReplayableSequence,
        );
        active = createBusinessEventSubscription({
          ...active,
          status: 'retired',
          lastReplayableSequence: continuity.lastReplayableSequence,
          updatedAt: retiredAt,
        });
      },
    });
    if (active === undefined)
      throw businessEventRuntimeError(
        'BUSINESS_EVENTS_ACK_AUTHORITY_MISSING',
        'Business Events stream ended without a durable Ack.',
      );
    return {
      providerId: input.providerId,
      subscriptionId: active.subscriptionId,
      streamId: active.streamId,
      generation: active.generation,
      admitted,
      duplicates,
      continuityControls,
      status: active.status,
    };
  }
}

export interface ProviderSubscriptionHealth {
  readonly providerId: string;
  readonly state: 'connecting' | 'healthy' | 'degraded' | 'stopped';
  readonly reconnects: number;
  readonly admitted: number;
  readonly duplicates: number;
  readonly lastErrorCode?: string;
  readonly updatedAt: string;
}

export class ProviderSubscriptionCoordinator {
  readonly #subscriptions: BusinessEventSubscriptionService;
  readonly #clock: Clock;
  readonly #reconnectDelayMs: number;
  readonly #active = new Map<string, AbortController>();
  readonly #health = new Map<string, ProviderSubscriptionHealth>();

  constructor(
    input: Readonly<{
      subscriptions: BusinessEventSubscriptionService;
      clock: Clock;
      reconnectDelayMs?: number;
    }>,
  ) {
    this.#subscriptions = input.subscriptions;
    this.#clock = input.clock;
    this.#reconnectDelayMs = input.reconnectDelayMs ?? 1_000;
  }

  start(
    input: Omit<BusinessEventsConnection, 'signal'> & Readonly<{ providerId: string }>,
  ): 'started' | 'already_running' {
    if (this.#active.has(input.providerId)) return 'already_running';
    const controller = new AbortController();
    this.#active.set(input.providerId, controller);
    this.#health.set(input.providerId, {
      providerId: input.providerId,
      state: 'connecting',
      reconnects: 0,
      admitted: 0,
      duplicates: 0,
      updatedAt: this.#clock.now(),
    });
    void this.#loop(input, controller);
    return 'started';
  }

  health(providerId: string): ProviderSubscriptionHealth | undefined {
    return this.#health.get(providerId);
  }

  close(providerId?: string): void {
    const targets =
      providerId === undefined
        ? [...this.#active.entries()]
        : [...this.#active.entries()].filter(([id]) => id === providerId);
    for (const [id, controller] of targets) {
      controller.abort();
      this.#active.delete(id);
      const previous = this.#health.get(id);
      if (previous !== undefined)
        this.#health.set(id, { ...previous, state: 'stopped', updatedAt: this.#clock.now() });
    }
  }

  async #loop(
    input: Omit<BusinessEventsConnection, 'signal'> & Readonly<{ providerId: string }>,
    controller: AbortController,
  ): Promise<void> {
    while (!controller.signal.aborted) {
      const previous = this.#health.get(input.providerId);
      try {
        const result = await this.#subscriptions.run({
          ...input,
          signal: controller.signal,
          onConnected: () => {
            const connected = this.#health.get(input.providerId);
            this.#health.set(input.providerId, {
              providerId: input.providerId,
              state: 'healthy',
              reconnects: connected?.reconnects ?? 0,
              admitted: connected?.admitted ?? 0,
              duplicates: connected?.duplicates ?? 0,
              updatedAt: this.#clock.now(),
            });
          },
        });
        this.#health.set(input.providerId, {
          providerId: input.providerId,
          state: 'healthy',
          reconnects: previous?.reconnects ?? 0,
          admitted: (previous?.admitted ?? 0) + result.admitted,
          duplicates: (previous?.duplicates ?? 0) + result.duplicates,
          updatedAt: this.#clock.now(),
        });
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') break;
        this.#health.set(input.providerId, {
          providerId: input.providerId,
          state: 'degraded',
          reconnects: (previous?.reconnects ?? 0) + 1,
          admitted: previous?.admitted ?? 0,
          duplicates: previous?.duplicates ?? 0,
          lastErrorCode: runtimeErrorCode(error),
          updatedAt: this.#clock.now(),
        });
      }
      await abortableDelay(this.#reconnectDelayMs, controller.signal);
    }
    if (this.#active.get(input.providerId) === controller) this.#active.delete(input.providerId);
  }
}

export interface BusinessEventProcessor {
  process(record: BusinessEventInboxRecord): Promise<void>;
}

export class BusinessEventIngressWorker {
  readonly #repository: BusinessEventRuntimeRepository;
  readonly #processor: BusinessEventProcessor;
  readonly #clock: Clock;

  constructor(
    input: Readonly<{
      repository: BusinessEventRuntimeRepository;
      processor: BusinessEventProcessor;
      clock: Clock;
    }>,
  ) {
    this.#repository = input.repository;
    this.#processor = input.processor;
    this.#clock = input.clock;
  }

  async runOnce(limit = 32): Promise<Readonly<{ processed: number; failed: number }>> {
    const records = await this.#repository.claimBusinessEventInbox(limit);
    let processed = 0;
    let failed = 0;
    for (const record of records) {
      try {
        await this.#processor.process(record);
        await this.#repository.markBusinessEventProcessed(record.inboxId, this.#clock.now());
        processed += 1;
      } catch (error: unknown) {
        const retryable = !(error instanceof BusinessEventTerminalProcessingError);
        await this.#repository.markBusinessEventFailed(
          record.inboxId,
          runtimeErrorCode(error),
          retryable,
        );
        failed += 1;
      }
    }
    return { processed, failed };
  }
}

export class BusinessEventRelationResolver {
  readonly #runtime: BusinessEventsRuntimePort;
  readonly #repository: BusinessEventRuntimeRepository;
  readonly #clock: Clock;
  readonly #nextProjectionId: () => string;
  readonly #hash: (value: unknown) => string;

  constructor(
    input: Readonly<{
      runtime: BusinessEventsRuntimePort;
      repository: BusinessEventRuntimeRepository;
      clock: Clock;
      nextProjectionId(): string;
      hash(value: unknown): string;
    }>,
  ) {
    this.#runtime = input.runtime;
    this.#repository = input.repository;
    this.#clock = input.clock;
    this.#nextProjectionId = input.nextProjectionId;
    this.#hash = input.hash;
  }

  async resolve(
    input: BusinessEventsConnection & Readonly<{ inboxId: string; event: BusinessEventEnvelope }>,
  ): Promise<BusinessEventRelationProjection> {
    if (input.event.scope === 'task')
      return await this.#save(input.inboxId, [input.event.taskId], 1);
    if (!input.event.relationTruncated)
      return await this.#save(
        input.inboxId,
        input.event.relatedTaskIds,
        input.event.relatedTaskCount,
      );
    const taskIds = new Set<string>();
    let projectionToken: string | undefined;
    let afterTaskId: string | undefined;
    let expectedTotal: number | undefined;
    try {
      for (let page = 0; page < 16; page += 1) {
        const result = await this.#runtime.resolveRelatedTasks({
          endpoint: input.endpoint,
          headers: input.headers,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          streamId: input.event.streamId,
          eventId: input.event.eventId,
          limit: 256,
          ...(projectionToken === undefined ? {} : { projectionToken }),
          ...(afterTaskId === undefined ? {} : { afterTaskId }),
        });
        if (
          (projectionToken !== undefined && result.projectionToken !== projectionToken) ||
          (expectedTotal !== undefined && result.total !== expectedTotal)
        )
          throw new BusinessEventTerminalProcessingError(
            'BUSINESS_EVENT_RELATION_PROJECTION_STALE',
            'Relation projection changed while paging.',
          );
        projectionToken = result.projectionToken;
        expectedTotal = result.total;
        for (const taskId of result.items) taskIds.add(taskId);
        if (result.nextAfterTaskId === undefined)
          return await this.#save(
            input.inboxId,
            [...taskIds].sort(),
            result.total,
            result.projectionToken,
          );
        afterTaskId = result.nextAfterTaskId;
      }
      return await this.#saveIncomplete(
        input.inboxId,
        [...taskIds].sort(),
        expectedTotal ?? input.event.relatedTaskCount,
        projectionToken,
      );
    } catch (error: unknown) {
      const code = runtimeErrorCode(error);
      const status = code.includes('AUTHORIZATION')
        ? 'authorization_mismatch'
        : code.includes('STREAM_RESET')
          ? 'stream_reset'
          : code.includes('EXPIRED')
            ? 'expired'
            : 'incomplete';
      return this.#saveIncomplete(
        input.inboxId,
        [...taskIds].sort(),
        expectedTotal ?? input.event.relatedTaskCount,
        projectionToken,
        status,
      );
    }
  }

  async #save(
    inboxId: string,
    taskIds: readonly string[],
    total: number,
    projectionToken?: string,
  ): Promise<BusinessEventRelationProjection> {
    const sorted = [...new Set(taskIds)].sort();
    if (sorted.length !== total)
      return this.#saveIncomplete(inboxId, sorted, total, projectionToken);
    const projection = createBusinessEventRelationProjection({
      relationProjectionId: this.#nextProjectionId(),
      inboxId,
      status: 'complete',
      relationHash: this.#hash({ taskIds: sorted, total, projectionToken }),
      taskIds: sorted,
      total,
      ...(projectionToken === undefined ? {} : { projectionToken }),
      createdAt: this.#clock.now(),
    });
    await this.#repository.saveBusinessEventRelationProjection(projection);
    return projection;
  }

  async #saveIncomplete(
    inboxId: string,
    taskIds: readonly string[],
    total: number,
    projectionToken?: string,
    status: BusinessEventRelationProjection['status'] = 'incomplete',
  ): Promise<BusinessEventRelationProjection> {
    const projection = createBusinessEventRelationProjection({
      relationProjectionId: this.#nextProjectionId(),
      inboxId,
      status,
      relationHash: this.#hash({ taskIds, total, projectionToken, status }),
      taskIds,
      total,
      ...(projectionToken === undefined ? {} : { projectionToken }),
      createdAt: this.#clock.now(),
    });
    await this.#repository.saveBusinessEventRelationProjection(projection);
    return projection;
  }
}

export class BusinessEventTerminalProcessingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BusinessEventTerminalProcessingError';
    this.code = code;
  }
}

export class BusinessEventRuntimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BusinessEventRuntimeError';
    this.code = code;
  }
}

function businessEventRuntimeError(code: string, message: string): BusinessEventRuntimeError {
  return new BusinessEventRuntimeError(code, message);
}

function runtimeErrorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'BUSINESS_EVENT_PROCESSING_FAILED';
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
