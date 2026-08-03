import { createHash } from 'node:crypto';

import {
  activeTelemetryExportConfiguration,
  createManagementOperation,
  transitionManagementOperation,
  type ManagementOperation,
  type TelemetryExportConfiguration,
  type TelemetryExportStatus,
} from '../../node-control-domain/src/index.js';

export interface TelemetryExportRecord {
  readonly sequence: number;
  readonly family: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RuntimeTelemetryExportStore {
  findActive(): Promise<TelemetryExportConfiguration | undefined>;
  apply(configuration: TelemetryExportConfiguration, observedAt: string): Promise<void>;
  recordProbe(result: Readonly<{ errorCode?: string }>, observedAt: string): Promise<void>;
  capture(configuration: TelemetryExportConfiguration, observedAt: string): Promise<number>;
  pending(limit: number, observedAt: string): Promise<readonly TelemetryExportRecord[]>;
  acknowledge(lastSequence: number, acknowledgedAt: string): Promise<void>;
  recordDeliveryFailure(
    sequences: readonly number[],
    errorCode: string,
    failedAt: string,
  ): Promise<void>;
  status(observedAt: string): Promise<TelemetryExportStatus>;
}

export interface TelemetryExportTransport {
  probe(configuration: TelemetryExportConfiguration): Promise<void>;
  send(
    configuration: TelemetryExportConfiguration,
    records: readonly TelemetryExportRecord[],
  ): Promise<Readonly<{ lastAcknowledgedSequence: number }>>;
}

export class RuntimeTelemetryExportService {
  readonly #store: RuntimeTelemetryExportStore;
  readonly #transport: TelemetryExportTransport;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #actorId: string;

  constructor(
    dependencies: Readonly<{
      store: RuntimeTelemetryExportStore;
      transport: TelemetryExportTransport;
      clock: Readonly<{ now(): string }>;
      actorId: string;
    }>,
  ) {
    this.#store = dependencies.store;
    this.#transport = dependencies.transport;
    this.#clock = dependencies.clock;
    this.#actorId = dependencies.actorId;
  }

  async apply(input: TelemetryExportConfiguration): Promise<ManagementOperation> {
    const configuration = activeTelemetryExportConfiguration(input);
    const occurredAt = this.#clock.now();
    const digest = sha256(JSON.stringify(configuration));
    const accepted = createManagementOperation(
      {
        operationId: `runtime-telemetry-apply-${configuration.exportId}-${String(configuration.revision)}`,
        operationType: 'telemetry-export.apply',
        target: {
          type: 'telemetry_export_configuration',
          id: configuration.exportId,
          revision: configuration.revision,
        },
        actorId: this.#actorId,
        reason: 'Apply exact Telemetry Export configuration revision.',
        idempotencyKeyHash: sha256(
          `${configuration.exportId}:${String(configuration.revision)}:${digest}`,
        ),
        inputHash: digest,
      },
      occurredAt,
    );
    const running = transitionManagementOperation(accepted, 'running', occurredAt);
    const previous = await this.#store.findActive();
    if (configuration.applyMode === 'restart_required' && previous !== undefined) {
      return transitionManagementOperation(running, 'failed', this.#clock.now(), {
        errorCode: 'TELEMETRY_EXPORT_RESTART_REQUIRED',
        result: { activeRevision: previous.revision },
      });
    }
    await this.#store.apply(configuration, occurredAt);
    let probe: 'healthy' | 'degraded' = 'healthy';
    try {
      await this.#transport.probe(configuration);
      await this.#store.recordProbe({}, this.#clock.now());
    } catch (error) {
      probe = 'degraded';
      await this.#store.recordProbe(
        { errorCode: safeTransportError(error, 'TELEMETRY_ENDPOINT_UNAVAILABLE') },
        this.#clock.now(),
      );
    }
    return transitionManagementOperation(running, 'succeeded', this.#clock.now(), {
      result: { activeRevision: configuration.revision, deliveryStatus: probe },
    });
  }

  status(): Promise<TelemetryExportStatus> {
    return this.#store.status(this.#clock.now());
  }

  async drain(): Promise<
    Readonly<{ captured: number; delivered: number; status: TelemetryExportStatus }>
  > {
    const configuration = await this.#store.findActive();
    if (configuration === undefined)
      return Object.freeze({ captured: 0, delivered: 0, status: await this.status() });
    const captured = await this.#store.capture(configuration, this.#clock.now());
    const pending = await this.#store.pending(batchSize(configuration), this.#clock.now());
    if (pending.length === 0)
      return Object.freeze({ captured, delivered: 0, status: await this.status() });
    try {
      const acknowledgement = await this.#transport.send(configuration, pending);
      const maximum = pending.at(-1)?.sequence ?? 0;
      const minimum = pending.at(0)?.sequence;
      if (minimum === undefined) throw new Error('TELEMETRY_BATCH_EMPTY');
      if (
        acknowledgement.lastAcknowledgedSequence < minimum ||
        acknowledgement.lastAcknowledgedSequence > maximum
      ) {
        throw Object.assign(new Error('Telemetry endpoint returned an invalid ACK.'), {
          code: 'TELEMETRY_ACK_INVALID',
        });
      }
      await this.#store.acknowledge(acknowledgement.lastAcknowledgedSequence, this.#clock.now());
      return Object.freeze({
        captured,
        delivered: pending.filter(
          (record) => record.sequence <= acknowledgement.lastAcknowledgedSequence,
        ).length,
        status: await this.status(),
      });
    } catch (error) {
      await this.#store.recordDeliveryFailure(
        pending.map((record) => record.sequence),
        safeTransportError(error, 'TELEMETRY_ENDPOINT_UNAVAILABLE'),
        this.#clock.now(),
      );
      return Object.freeze({ captured, delivered: 0, status: await this.status() });
    }
  }
}

function batchSize(configuration: TelemetryExportConfiguration): number {
  const value = configuration.batchPolicy?.['maxRecords'];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1_000
    ? value
    : 100;
}

function safeTransportError(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.code)
  )
    return error.code;
  return fallback;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
