import { describe, expect, it } from 'vitest';

import type {
  TelemetryExportConfiguration,
  TelemetryExportStatus,
} from '../../node-control-domain/src/index.js';
import {
  RuntimeTelemetryExportService,
  type RuntimeTelemetryExportStore,
  type TelemetryExportRecord,
  type TelemetryExportTransport,
} from '../src/index.js';

const configuration: TelemetryExportConfiguration = Object.freeze({
  exportId: 'telemetry-node-1',
  endpointRef: 'https://telemetry.example.test/ingest',
  sourceId: 'runtime-node-1',
  nodeId: 'node-1',
  credentialRef: 'env:TEST_TELEMETRY_TOKEN',
  recordFamilies: Object.freeze(['runtime_event']),
  batchPolicy: Object.freeze({ maxRecords: 10 }),
  retryPolicy: Object.freeze({ maxDelaySeconds: 300 }),
  outboxPolicy: Object.freeze({ maxPendingRecords: 100 }),
  status: 'draft',
  revision: 1,
  applyMode: 'hot_reload',
});

describe('RuntimeTelemetryExportService', () => {
  it('preserves Active/LKG and degrades only export delivery when the endpoint is unavailable', async () => {
    const store = new MemoryTelemetryStore();
    const transport = new MemoryTelemetryTransport();
    transport.failProbe = true;
    const service = runtimeService(store, transport);

    await expect(service.apply(configuration)).resolves.toMatchObject({
      status: 'succeeded',
      result: { activeRevision: 1, deliveryStatus: 'degraded' },
    });
    expect(store.active).toMatchObject({ revision: 1, status: 'active' });
    await expect(service.status()).resolves.toMatchObject({
      status: 'degraded',
      lastErrorCode: 'TELEMETRY_ENDPOINT_UNAVAILABLE',
    });
  });

  it('retains a failed batch and advances only an explicit valid ACK', async () => {
    const store = new MemoryTelemetryStore();
    const transport = new MemoryTelemetryTransport();
    const service = runtimeService(store, transport);
    await service.apply(configuration);
    store.records = [
      { sequence: 1, family: 'runtime_event', occurredAt: now, payload: { taskId: 'task-1' } },
      { sequence: 2, family: 'runtime_event', occurredAt: now, payload: { taskId: 'task-2' } },
    ];
    transport.failSend = true;

    await expect(service.drain()).resolves.toMatchObject({ delivered: 0 });
    expect(store.records).toHaveLength(2);
    expect(store.errorCode).toBe('TELEMETRY_ENDPOINT_UNAVAILABLE');

    transport.failSend = false;
    await expect(service.drain()).resolves.toMatchObject({ delivered: 2 });
    expect(store.records).toHaveLength(0);
    expect(store.lastAck).toBe(2);
  });
});

const now = '2026-08-03T00:00:00.000Z';

function runtimeService(store: RuntimeTelemetryExportStore, transport: TelemetryExportTransport) {
  return new RuntimeTelemetryExportService({
    store,
    transport,
    clock: { now: () => now },
    actorId: 'runtime-test',
  });
}

class MemoryTelemetryTransport implements TelemetryExportTransport {
  failProbe = false;
  failSend = false;

  probe(): Promise<void> {
    if (this.failProbe)
      return Promise.reject(
        Object.assign(new Error('offline'), { code: 'TELEMETRY_ENDPOINT_UNAVAILABLE' }),
      );
    return Promise.resolve();
  }

  send(
    _configuration: TelemetryExportConfiguration,
    records: readonly TelemetryExportRecord[],
  ): Promise<Readonly<{ lastAcknowledgedSequence: number }>> {
    if (this.failSend)
      return Promise.reject(
        Object.assign(new Error('offline'), { code: 'TELEMETRY_ENDPOINT_UNAVAILABLE' }),
      );
    const last = records.at(-1);
    if (last === undefined) return Promise.reject(new Error('TEST_BATCH_EMPTY'));
    return Promise.resolve(Object.freeze({ lastAcknowledgedSequence: last.sequence }));
  }
}

class MemoryTelemetryStore implements RuntimeTelemetryExportStore {
  active?: TelemetryExportConfiguration;
  records: TelemetryExportRecord[] = [];
  errorCode: string | undefined;
  lastAck: number | undefined;

  findActive(): Promise<TelemetryExportConfiguration | undefined> {
    return Promise.resolve(this.active);
  }

  apply(configuration: TelemetryExportConfiguration): Promise<void> {
    this.active = configuration;
    this.errorCode = undefined;
    return Promise.resolve();
  }

  recordProbe(result: Readonly<{ errorCode?: string }>): Promise<void> {
    this.errorCode = result.errorCode;
    return Promise.resolve();
  }

  capture(): Promise<number> {
    return Promise.resolve(0);
  }

  pending(limit: number): Promise<readonly TelemetryExportRecord[]> {
    return Promise.resolve(this.records.slice(0, limit));
  }

  acknowledge(lastSequence: number): Promise<void> {
    this.lastAck = lastSequence;
    this.records = this.records.filter((record) => record.sequence > lastSequence);
    this.errorCode = undefined;
    return Promise.resolve();
  }

  recordDeliveryFailure(_sequences: readonly number[], errorCode: string): Promise<void> {
    this.errorCode = errorCode;
    return Promise.resolve();
  }

  status(observedAt: string): Promise<TelemetryExportStatus> {
    return Promise.resolve(
      Object.freeze({
        exportId: this.active?.exportId ?? 'not-configured',
        status:
          this.active === undefined
            ? 'disabled'
            : this.errorCode === undefined
              ? 'healthy'
              : 'degraded',
        ...(this.active === undefined ? {} : { activeRevision: this.active.revision }),
        ...(this.lastAck === undefined ? {} : { lastAcknowledgedSequence: this.lastAck }),
        pendingRecords: this.records.length,
        ...(this.errorCode === undefined
          ? {}
          : { lastErrorCode: this.errorCode, lastErrorAt: observedAt }),
        observedAt,
      }),
    );
  }
}
