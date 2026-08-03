import { describe, expect, it } from 'vitest';

import {
  createCatalogEvidenceEnvelope,
  type EvidenceBatchAcknowledgement,
  type EvidenceBatchRequest,
  type EvidenceExportStatus,
  type ManagedEvidenceExportConfiguration,
} from '../../domain/src/index.js';
import {
  RuntimeEvidenceExportService,
  type EvidenceDeliveryLease,
  type EvidenceExportRecord,
  type EvidenceExportTransport,
  type RuntimeEvidenceExportStore,
} from '../src/index.js';

const configuration: ManagedEvidenceExportConfiguration = Object.freeze({
  exportId: 'primary-evidence-export',
  endpointRef: 'https://evidence.example.test/ingest',
  sourceId: 'runtime-node-1',
  nodeId: 'node-1',
  credentialRef: 'env:TEST_EVIDENCE_TOKEN',
  includedFamilies: [
    'runtime',
    'skill',
    'mcp_task',
    'capability',
    'experience',
    'replay',
    'artifact',
    'node_control',
    'evidence',
  ] as const,
  batchPolicy: { maxRecords: 10, maxBytes: 262_144, flushIntervalMs: 1_000 },
  retryPolicy: { baseDelayMs: 100, maxDelayMs: 300_000 },
  outboxPolicy: { maxPendingRecords: 100, retentionDays: 30 },
  redactionProfile: 'strict_internal_v1',
  artifactMode: 'reference',
  status: 'draft',
  revision: 1,
  applyMode: 'hot_reload',
});

describe('RuntimeEvidenceExportService', () => {
  it('preserves Active/LKG and degrades only export delivery when the endpoint is unavailable', async () => {
    const store = new MemoryEvidenceStore();
    const transport = new MemoryEvidenceTransport();
    transport.failProbe = true;
    const service = runtimeService(store, transport);

    await expect(service.apply(configuration)).resolves.toMatchObject({
      status: 'succeeded',
      result: { activeRevision: 1, deliveryStatus: 'degraded' },
    });
    expect(store.active).toMatchObject({ revision: 1, status: 'active' });
    await expect(service.status()).resolves.toMatchObject({
      status: 'degraded',
      lastErrorCode: 'EVIDENCE_ENDPOINT_UNAVAILABLE',
    });
  });

  it('retains endpoint failures and advances only an explicit partial ACK after exact send marking', async () => {
    const store = new MemoryEvidenceStore();
    const transport = new MemoryEvidenceTransport();
    const service = runtimeService(store, transport);
    await service.apply(configuration);
    store.records = [record('1', 'task-1'), record('2', 'task-2')];
    transport.failSend = true;

    await expect(service.drain()).resolves.toMatchObject({ delivered: 0 });
    expect(store.records).toHaveLength(2);
    expect(store.errorCode).toBe('EVIDENCE_ENDPOINT_UNAVAILABLE');

    transport.failSend = false;
    transport.ack = '1';
    await expect(service.drain()).resolves.toMatchObject({ delivered: 1 });
    expect(store.markedSent).toEqual(['1', '2']);
    expect(store.records.map((item) => item.sequence)).toEqual(['2']);
    expect(store.lastAck).toBe('1');
    expect(transport.lastBatch).toMatchObject({
      contractVersion: 'sdar.evidence/v1',
      firstSequence: '1',
      lastSequence: '2',
    });
  });

  it('rejects an ACK outside the exact sent batch and leaves records pending', async () => {
    const store = new MemoryEvidenceStore();
    const transport = new MemoryEvidenceTransport();
    const service = runtimeService(store, transport);
    await service.apply(configuration);
    store.records = [record('10', 'task-10')];
    transport.ack = '11';

    await expect(service.drain()).resolves.toMatchObject({ delivered: 0 });
    expect(store.records).toHaveLength(1);
    expect(store.errorCode).toBe('EVIDENCE_ACK_INVALID');
    expect(store.markedSent).toEqual([]);
  });
});

const now = '2026-08-04T00:00:00.000Z';

function runtimeService(store: RuntimeEvidenceExportStore, transport: EvidenceExportTransport) {
  return new RuntimeEvidenceExportService({
    store,
    transport,
    clock: { now: () => now },
    actorId: 'runtime-test',
    workerId: 'worker-1',
  });
}

function record(sequence: string, taskId: string): EvidenceExportRecord {
  const envelope = createCatalogEvidenceEnvelope({
    recordType: 'runtime.episode',
    sourceRecordId: taskId,
    sourceRevision: '1',
    environment: 'test',
    correlationId: taskId,
    occurredAt: now,
    recordedAt: now,
    taskId,
    contextId: `context-${taskId}`,
    episodeId: taskId,
    evidenceSequence: sequence,
    payload: { episodeId: taskId, taskId, status: 'completed' },
  });
  return Object.freeze({
    sequence,
    sourcePartition: 'runtime:episodes',
    envelope,
    deliveryAttempts: 0,
    nextAttemptAt: now,
  });
}

class MemoryEvidenceTransport implements EvidenceExportTransport {
  failProbe = false;
  failSend = false;
  ack: string | undefined;
  lastBatch: EvidenceBatchRequest | undefined;

  probe(): Promise<void> {
    if (this.failProbe)
      return Promise.reject(
        Object.assign(new Error('offline'), { code: 'EVIDENCE_ENDPOINT_UNAVAILABLE' }),
      );
    return Promise.resolve();
  }

  send(
    _configuration: ManagedEvidenceExportConfiguration,
    batch: EvidenceBatchRequest,
  ): Promise<EvidenceBatchAcknowledgement> {
    this.lastBatch = batch;
    if (this.failSend)
      return Promise.reject(
        Object.assign(new Error('offline'), { code: 'EVIDENCE_ENDPOINT_UNAVAILABLE' }),
      );
    return Promise.resolve(
      Object.freeze({ lastAcknowledgedSequence: this.ack ?? batch.lastSequence }),
    );
  }
}

class MemoryEvidenceStore implements RuntimeEvidenceExportStore {
  active?: ManagedEvidenceExportConfiguration;
  records: EvidenceExportRecord[] = [];
  errorCode: string | undefined;
  lastAck: string | undefined;
  markedSent: string[] = [];

  findActive(): Promise<ManagedEvidenceExportConfiguration | undefined> {
    return Promise.resolve(this.active);
  }

  apply(configuration: ManagedEvidenceExportConfiguration): Promise<void> {
    this.active = configuration;
    this.errorCode = undefined;
    return Promise.resolve();
  }

  recordProbe(_exportId: string, result: Readonly<{ errorCode?: string }>): Promise<void> {
    this.errorCode = result.errorCode;
    return Promise.resolve();
  }

  nextPendingPartition(): Promise<string | undefined> {
    return Promise.resolve(this.records.length === 0 ? undefined : 'runtime:episodes');
  }

  acquireLease(input: {
    readonly exportId: string;
    readonly sourcePartition: string;
    readonly owner: string;
    readonly token: string;
    readonly expiresAt: string;
  }): Promise<EvidenceDeliveryLease> {
    return Promise.resolve(Object.freeze({ ...input, fencingToken: '1' }));
  }

  pending(_sourcePartition: string, limit: number): Promise<readonly EvidenceExportRecord[]> {
    return Promise.resolve(this.records.slice(0, limit));
  }

  markSent(_lease: EvidenceDeliveryLease, sequences: readonly string[]): Promise<void> {
    this.markedSent = [...sequences];
    return Promise.resolve();
  }

  acknowledge(_lease: EvidenceDeliveryLease, lastSequence: string): Promise<void> {
    this.lastAck = lastSequence;
    this.records = this.records.filter((item) => BigInt(item.sequence) > BigInt(lastSequence));
    this.errorCode = undefined;
    return Promise.resolve();
  }

  recordDeliveryFailure(
    _sourcePartition: string,
    _sequences: readonly string[],
    errorCode: string,
  ): Promise<void> {
    this.errorCode = errorCode;
    return Promise.resolve();
  }

  status(observedAt: string): Promise<EvidenceExportStatus> {
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
