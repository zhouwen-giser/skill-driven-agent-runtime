import { randomUUID } from 'node:crypto';

import {
  activeEvidenceExportConfiguration,
  canonicalizeEvidenceJson,
  hashCanonicalEvidenceJson,
  shouldRecordEvidenceExportObservation,
  type EvidenceBatchAcknowledgement,
  type EvidenceBatchRequest,
  type CanonicalEvidenceEnvelope,
  type EvidenceExportAckLedgerEntry,
  type EvidenceExportBatchLedgerEntry,
  type EvidenceExportStatus,
  type ManagedEvidenceExportConfiguration,
} from '../../domain/src/index.js';
import {
  createManagementOperation,
  transitionManagementOperation,
  type ManagementOperation,
} from '../../node-control-domain/src/index.js';

export interface EvidenceExportRecord {
  readonly sequence: string;
  readonly sourcePartition: string;
  readonly envelope: CanonicalEvidenceEnvelope;
  readonly deliveryAttempts: number;
  readonly nextAttemptAt: string;
}

export interface EvidenceDeliveryLease {
  readonly exportId: string;
  readonly sourcePartition: string;
  readonly owner: string;
  readonly token: string;
  readonly fencingToken: string;
  readonly expiresAt: string;
}

export interface RuntimeEvidenceExportStore {
  findActive(): Promise<ManagedEvidenceExportConfiguration | undefined>;
  apply(configuration: ManagedEvidenceExportConfiguration, observedAt: string): Promise<void>;
  recordProbe(
    exportId: string,
    result: Readonly<{ errorCode?: string }>,
    observedAt: string,
  ): Promise<void>;
  nextPendingPartition(observedAt: string): Promise<string | undefined>;
  acquireLease(input: {
    readonly exportId: string;
    readonly sourcePartition: string;
    readonly owner: string;
    readonly token: string;
    readonly acquiredAt: string;
    readonly expiresAt: string;
  }): Promise<EvidenceDeliveryLease>;
  pending(
    sourcePartition: string,
    limit: number,
    observedAt: string,
  ): Promise<readonly EvidenceExportRecord[]>;
  markSent(
    lease: EvidenceDeliveryLease,
    sequences: readonly string[],
    observedAt: string,
  ): Promise<void>;
  recordBatchAttempt(input: {
    readonly lease: EvidenceDeliveryLease;
    readonly batch: EvidenceBatchRequest;
    readonly recordedAt: string;
  }): Promise<EvidenceExportBatchLedgerEntry>;
  recordAcknowledgement(input: {
    readonly lease: EvidenceDeliveryLease;
    readonly batch: EvidenceExportBatchLedgerEntry;
    readonly acknowledgedSequence: string | null;
    readonly ackDisposition: EvidenceExportAckLedgerEntry['ackDisposition'];
    readonly errorCode: string | null;
    readonly acknowledgedAt: string;
  }): Promise<EvidenceExportAckLedgerEntry>;
  acknowledge(
    lease: EvidenceDeliveryLease,
    lastSequence: string,
    acknowledgedAt: string,
  ): Promise<void>;
  recordDeliveryFailure(
    sourcePartition: string,
    sequences: readonly string[],
    errorCode: string,
    configuration: ManagedEvidenceExportConfiguration,
    failedAt: string,
  ): Promise<void>;
  status(observedAt: string): Promise<EvidenceExportStatus>;
}

export interface EvidenceExportTransport {
  probe(configuration: ManagedEvidenceExportConfiguration): Promise<void>;
  send(
    configuration: ManagedEvidenceExportConfiguration,
    batch: EvidenceBatchRequest,
  ): Promise<EvidenceBatchAcknowledgement>;
}

export class RuntimeEvidenceExportService {
  readonly #store: RuntimeEvidenceExportStore;
  readonly #transport: EvidenceExportTransport;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #actorId: string;
  readonly #workerId: string;

  constructor(
    dependencies: Readonly<{
      store: RuntimeEvidenceExportStore;
      transport: EvidenceExportTransport;
      clock: Readonly<{ now(): string }>;
      actorId: string;
      workerId?: string;
    }>,
  ) {
    this.#store = dependencies.store;
    this.#transport = dependencies.transport;
    this.#clock = dependencies.clock;
    this.#actorId = dependencies.actorId;
    this.#workerId = dependencies.workerId ?? `${dependencies.actorId}:${randomUUID()}`;
  }

  async apply(input: ManagedEvidenceExportConfiguration): Promise<ManagementOperation> {
    const configuration = activeEvidenceExportConfiguration(input);
    const occurredAt = this.#clock.now();
    const digest = hashCanonicalEvidenceJson(configuration).slice('sha256:'.length);
    const accepted = createManagementOperation(
      {
        operationId: `runtime-evidence-apply-${configuration.exportId}-${String(configuration.revision)}`,
        operationType: 'evidence-export.apply',
        target: {
          type: 'evidence_export_configuration',
          id: configuration.exportId,
          revision: configuration.revision,
        },
        actorId: this.#actorId,
        reason: 'Apply exact Canonical Evidence Export configuration revision.',
        idempotencyKeyHash: hashCanonicalEvidenceJson({
          exportId: configuration.exportId,
          revision: configuration.revision,
          digest,
        }).slice('sha256:'.length),
        inputHash: digest,
      },
      occurredAt,
    );
    const running = transitionManagementOperation(accepted, 'running', occurredAt);
    const previous = await this.#store.findActive();
    if (configuration.applyMode === 'restart_required' && previous !== undefined) {
      return transitionManagementOperation(running, 'failed', this.#clock.now(), {
        errorCode: 'EVIDENCE_EXPORT_RESTART_REQUIRED',
        result: { activeRevision: previous.revision },
      });
    }
    await this.#store.apply(configuration, occurredAt);
    let probe: 'healthy' | 'degraded' = 'healthy';
    try {
      await this.#transport.probe(configuration);
      await this.#store.recordProbe(configuration.exportId, {}, this.#clock.now());
    } catch (error) {
      probe = 'degraded';
      await this.#store.recordProbe(
        configuration.exportId,
        { errorCode: safeEvidenceExportError(error, 'EVIDENCE_ENDPOINT_UNAVAILABLE') },
        this.#clock.now(),
      );
    }
    return transitionManagementOperation(running, 'succeeded', this.#clock.now(), {
      result: { activeRevision: configuration.revision, deliveryStatus: probe },
    });
  }

  status(): Promise<EvidenceExportStatus> {
    return this.#store.status(this.#clock.now());
  }

  async drain(): Promise<
    Readonly<{ delivered: number; status: EvidenceExportStatus; attemptedPartition?: string }>
  > {
    const configuration = await this.#store.findActive();
    if (configuration === undefined)
      return Object.freeze({ delivered: 0, status: await this.status() });
    const observedAt = this.#clock.now();
    const sourcePartition = await this.#store.nextPendingPartition(observedAt);
    if (sourcePartition === undefined)
      return Object.freeze({ delivered: 0, status: await this.status() });
    const lease = await this.#store.acquireLease({
      exportId: configuration.exportId,
      sourcePartition,
      owner: this.#workerId,
      token: randomUUID(),
      acquiredAt: observedAt,
      expiresAt: new Date(new Date(observedAt).getTime() + 60_000).toISOString(),
    });
    const pending = await this.#store.pending(
      sourcePartition,
      configuration.batchPolicy.maxRecords,
      observedAt,
    );
    if (pending.length === 0) {
      return Object.freeze({
        delivered: 0,
        status: await this.status(),
        attemptedPartition: sourcePartition,
      });
    }
    let sequences = pending.map((record) => record.sequence);
    try {
      const records = boundedRecords(configuration, pending);
      sequences = records.map((record) => record.sequence);
      const batch = createBatch(configuration, records);
      const recordsExportObservation = shouldRecordEvidenceExportObservation(
        records.map((record) => record.envelope),
      );
      const batchLedger = recordsExportObservation
        ? await this.#store.recordBatchAttempt({ lease, batch, recordedAt: this.#clock.now() })
        : undefined;
      const acknowledgement = await this.#transport.send(configuration, batch);
      await this.#store.markSent(lease, sequences, this.#clock.now());
      const acknowledgementClassification = classifyAcknowledgement(batch, acknowledgement);
      const acknowledgedAt = this.#clock.now();
      if (acknowledgementClassification.disposition === 'rejected') {
        if (batchLedger !== undefined) {
          await this.#store.recordAcknowledgement({
            lease,
            batch: batchLedger,
            acknowledgedSequence: null,
            ackDisposition: 'rejected',
            errorCode: 'EVIDENCE_ACK_INVALID',
            acknowledgedAt,
          });
        }
        throw Object.assign(new Error(acknowledgementClassification.reason), {
          code: 'EVIDENCE_ACK_INVALID',
        });
      }
      if (batchLedger === undefined) {
        await this.#store.acknowledge(
          lease,
          acknowledgement.lastAcknowledgedSequence,
          acknowledgedAt,
        );
      } else {
        await this.#store.recordAcknowledgement({
          lease,
          batch: batchLedger,
          acknowledgedSequence: acknowledgement.lastAcknowledgedSequence,
          ackDisposition: acknowledgementClassification.disposition,
          errorCode: null,
          acknowledgedAt,
        });
      }
      return Object.freeze({
        delivered: records.filter(
          (record) => BigInt(record.sequence) <= BigInt(acknowledgement.lastAcknowledgedSequence),
        ).length,
        status: await this.status(),
        attemptedPartition: sourcePartition,
      });
    } catch (error) {
      await this.#store.recordDeliveryFailure(
        sourcePartition,
        sequences,
        safeEvidenceExportError(error, 'EVIDENCE_ENDPOINT_UNAVAILABLE'),
        configuration,
        this.#clock.now(),
      );
      return Object.freeze({
        delivered: 0,
        status: await this.status(),
        attemptedPartition: sourcePartition,
      });
    }
  }
}

function boundedRecords(
  configuration: ManagedEvidenceExportConfiguration,
  pending: readonly EvidenceExportRecord[],
): readonly EvidenceExportRecord[] {
  const accepted: EvidenceExportRecord[] = [];
  for (const record of pending) {
    const candidate = [...accepted, record];
    try {
      if (
        Buffer.byteLength(canonicalizeEvidenceJson(createBatch(configuration, candidate)), 'utf8') >
        configuration.batchPolicy.maxBytes
      )
        break;
    } catch (error) {
      if (
        accepted.length > 0 &&
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EVIDENCE_JSON_SIZE_EXCEEDED'
      )
        break;
      throw error;
    }
    accepted.push(record);
  }
  if (accepted.length === 0) {
    throw Object.assign(new Error('The first Evidence record exceeds batchPolicy.maxBytes.'), {
      code: 'EVIDENCE_BATCH_TOO_LARGE',
    });
  }
  return Object.freeze(accepted);
}

function createBatch(
  configuration: ManagedEvidenceExportConfiguration,
  records: readonly EvidenceExportRecord[],
): EvidenceBatchRequest {
  const first = records[0];
  const last = records.at(-1);
  if (first === undefined || last === undefined)
    throw Object.assign(new Error('Evidence batch must not be empty.'), {
      code: 'EVIDENCE_BATCH_EMPTY',
    });
  const unsigned = {
    contractVersion: 'sdar.evidence/v1' as const,
    exportId: configuration.exportId,
    sourceId: configuration.sourceId,
    nodeId: configuration.nodeId ?? configuration.sourceId,
    revision: configuration.revision,
    firstSequence: first.sequence,
    lastSequence: last.sequence,
    records: records.map((record) => record.envelope),
  };
  return Object.freeze({ ...unsigned, batchHash: hashCanonicalEvidenceJson(unsigned) });
}

function classifyAcknowledgement(
  batch: EvidenceBatchRequest,
  acknowledgement: EvidenceBatchAcknowledgement,
): Readonly<{ disposition: 'accepted' | 'partial' } | { disposition: 'rejected'; reason: string }> {
  let acknowledged: bigint;
  try {
    acknowledged = BigInt(acknowledgement.lastAcknowledgedSequence);
  } catch {
    return Object.freeze({
      disposition: 'rejected',
      reason: 'Evidence endpoint returned a non-numeric ACK.',
    });
  }
  if (acknowledged < BigInt(batch.firstSequence) || acknowledged > BigInt(batch.lastSequence)) {
    return Object.freeze({
      disposition: 'rejected',
      reason: 'Evidence endpoint returned an out-of-batch ACK.',
    });
  }
  if (
    !batch.records.some(
      (record) => record.evidenceSequence === acknowledgement.lastAcknowledgedSequence,
    )
  ) {
    return Object.freeze({
      disposition: 'rejected',
      reason: 'Evidence endpoint ACK does not identify a sent record.',
    });
  }
  return Object.freeze({
    disposition: acknowledged === BigInt(batch.lastSequence) ? 'accepted' : 'partial',
  });
}

function safeEvidenceExportError(error: unknown, fallback: string): string {
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
