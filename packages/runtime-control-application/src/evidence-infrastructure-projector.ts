import {
  createCatalogEvidenceEnvelope,
  getEvidenceCatalogEntry,
  hashCanonicalEvidenceJson,
  type CanonicalEvidenceEnvelope,
  type EvidenceJsonValue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';

export const EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION = 'evidence-infrastructure/v1' as const;

export const EVIDENCE_INFRASTRUCTURE_RECORD_TYPES = Object.freeze([
  'evidence.episode_manifest',
  'evidence.quality_issue',
  'evidence.projection_issue',
  'evidence.source_checkpoint',
  'evidence.export_status',
] as const);

export type EvidenceInfrastructureRecordType =
  (typeof EVIDENCE_INFRASTRUCTURE_RECORD_TYPES)[number];
export type EvidenceInfrastructureProjectionKind =
  'episode_manifest' | 'quality_issue' | 'projection_issue' | 'source_checkpoint' | 'export_status';
export type EvidenceInfrastructureSourceRow = Readonly<Record<string, EvidenceJsonValue>>;

export interface EvidenceInfrastructureProjectionPartition {
  readonly kind: EvidenceInfrastructureProjectionKind;
  readonly recordType: EvidenceInfrastructureRecordType;
  readonly sourcePartition: string;
  readonly sourceRecordId: string;
}

export interface EvidenceInfrastructureReference {
  readonly recordType: string;
  readonly recordId: string;
}

export interface EvidenceInfrastructureSnapshot {
  readonly partition: EvidenceInfrastructureProjectionPartition;
  readonly row: EvidenceInfrastructureSourceRow;
  readonly occurredAt: string;
  readonly references: readonly EvidenceInfrastructureReference[];
  readonly checkpoint?: EvidenceSourceCheckpoint;
}

export interface EvidenceInfrastructureSource {
  pendingPartitions(limit: number): Promise<readonly EvidenceInfrastructureProjectionPartition[]>;
  load(
    partition: EvidenceInfrastructureProjectionPartition,
  ): Promise<EvidenceInfrastructureSnapshot | undefined>;
}

export interface EvidenceInfrastructureWriter {
  hasRecord(recordId: string): Promise<boolean>;
  append(
    envelope: CanonicalEvidenceEnvelope,
    capturedAt: string,
    sourcePartition: string,
  ): Promise<string>;
  saveCheckpoint(checkpoint: EvidenceSourceCheckpoint): Promise<void>;
}

export interface EvidenceInfrastructureProjectionResult {
  readonly recordType: EvidenceInfrastructureRecordType;
  readonly recordId: string;
  readonly sourcePartition: string;
  readonly evidenceSequence?: string;
  readonly skipped: boolean;
}

export class EvidenceInfrastructureProjectionError extends Error {
  readonly code:
    | 'EVIDENCE_INFRASTRUCTURE_SOURCE_NOT_FOUND'
    | 'EVIDENCE_INFRASTRUCTURE_PARTITION_DRIFT'
    | 'EVIDENCE_INFRASTRUCTURE_REFERENCE_INVALID'
    | 'EVIDENCE_INFRASTRUCTURE_REFERENCE_ORPHAN'
    | 'EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID';

  constructor(code: EvidenceInfrastructureProjectionError['code'], detail?: string) {
    super(detail === undefined ? code : `${code}:${detail}`);
    this.name = 'EvidenceInfrastructureProjectionError';
    this.code = code;
  }
}

export class EvidenceInfrastructureProjector {
  readonly #source: EvidenceInfrastructureSource;
  readonly #writer: EvidenceInfrastructureWriter;
  readonly #environment: string;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(input: {
    readonly source: EvidenceInfrastructureSource;
    readonly writer: EvidenceInfrastructureWriter;
    readonly environment: string;
    readonly clock?: Readonly<{ now(): string }>;
  }) {
    this.#source = input.source;
    this.#writer = input.writer;
    this.#environment = text(input.environment, 'environment');
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async projectPartition(
    partition: EvidenceInfrastructureProjectionPartition,
  ): Promise<EvidenceInfrastructureProjectionResult> {
    assertPartition(partition);
    const snapshot = await this.#source.load(partition);
    if (snapshot === undefined) {
      throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_NOT_FOUND', partition.sourcePartition);
    }
    if (
      snapshot.partition.kind !== partition.kind ||
      snapshot.partition.recordType !== partition.recordType ||
      snapshot.partition.sourcePartition !== partition.sourcePartition ||
      snapshot.partition.sourceRecordId !== partition.sourceRecordId
    ) {
      throw failure('EVIDENCE_INFRASTRUCTURE_PARTITION_DRIFT', partition.sourcePartition);
    }

    const catalog = getEvidenceCatalogEntry(partition.recordType);
    if (catalog.recordFamily !== 'evidence' || catalog.sourceSystem !== 'runtime') {
      throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', partition.recordType);
    }
    const evidenceRefs = await this.#requiredReferences(
      catalog.expectedReferences,
      snapshot.references,
    );
    const payload = payloadFor(partition.kind, snapshot.row);
    const sourceRevision = hashCanonicalEvidenceJson(
      sourceRevisionFor(partition.kind, snapshot.row, payload),
    );
    const occurredAt = timestamp(snapshot.occurredAt, 'occurredAt');
    const recordedAt = timestamp(this.#clock.now(), 'recordedAt');
    const envelope = createCatalogEvidenceEnvelope({
      recordType: partition.recordType,
      sourceRecordId: partition.sourceRecordId,
      sourceRevision,
      environment: this.#environment,
      correlationId: correlationIdFor(partition.kind, snapshot.row),
      occurredAt,
      recordedAt,
      observationGeneration: 1,
      evidenceRefs,
      artifactRefs: [],
      ...scopeFor(partition.kind, snapshot.row),
      payload,
    });

    if (
      snapshot.checkpoint?.projectorVersion === EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION &&
      snapshot.checkpoint.lastSourceRecordId === partition.sourceRecordId &&
      snapshot.checkpoint.lastSourceRevision === sourceRevision &&
      snapshot.checkpoint.lastPayloadHash === envelope.payloadHash
    ) {
      return Object.freeze({
        recordType: partition.recordType,
        recordId: envelope.recordId,
        sourcePartition: partition.sourcePartition,
        skipped: true,
      });
    }

    const evidenceSequence = await this.#writer.append(
      envelope,
      recordedAt,
      partition.sourcePartition,
    );
    await this.#writer.saveCheckpoint({
      sourceFamily: 'evidence',
      sourcePartition: partition.sourcePartition,
      lastOccurredAt: occurredAt,
      lastSourceRecordId: partition.sourceRecordId,
      lastSourceRevision: sourceRevision,
      lastPayloadHash: envelope.payloadHash,
      lastProjectedAt: recordedAt,
      projectorVersion: EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION,
    });
    return Object.freeze({
      recordType: partition.recordType,
      recordId: envelope.recordId,
      sourcePartition: partition.sourcePartition,
      evidenceSequence,
      skipped: false,
    });
  }

  async #requiredReferences(
    expectedTypes: readonly string[],
    references: readonly EvidenceInfrastructureReference[],
  ): Promise<readonly string[]> {
    const expected = new Set(expectedTypes);
    const byType = new Map<string, EvidenceInfrastructureReference[]>();
    for (const reference of references) {
      if (!expected.has(reference.recordType)) {
        throw failure('EVIDENCE_INFRASTRUCTURE_REFERENCE_INVALID', reference.recordType);
      }
      const selected = byType.get(reference.recordType) ?? [];
      selected.push(reference);
      byType.set(reference.recordType, selected);
    }
    for (const expectedType of expectedTypes) {
      if ((byType.get(expectedType)?.length ?? 0) !== 1) {
        throw failure('EVIDENCE_INFRASTRUCTURE_REFERENCE_INVALID', expectedType);
      }
    }
    const recordIds = [...new Set(references.map((reference) => text(reference.recordId, 'ref')))];
    if (recordIds.length !== references.length) {
      throw failure('EVIDENCE_INFRASTRUCTURE_REFERENCE_INVALID', 'duplicate');
    }
    for (const recordId of recordIds) {
      if (!(await this.#writer.hasRecord(recordId))) {
        throw failure('EVIDENCE_INFRASTRUCTURE_REFERENCE_ORPHAN', recordId);
      }
    }
    return Object.freeze(recordIds.sort());
  }
}

function payloadFor(
  kind: EvidenceInfrastructureProjectionKind,
  row: EvidenceInfrastructureSourceRow,
): EvidenceInfrastructureSourceRow {
  switch (kind) {
    case 'episode_manifest':
      return Object.freeze({
        manifestId: textValue(row, 'manifest_id'),
        revision: positive(row, 'revision'),
        policyVersion: textValue(row, 'policy_version'),
        episodeId: textValue(row, 'episode_id'),
        taskId: textValue(row, 'task_id'),
        terminalOutcomeId: textValue(row, 'terminal_outcome_id'),
        expectedRequiredRecords: nonNegative(row, 'expected_required_records'),
        projectedRequiredRecords: nonNegative(row, 'projected_required_records'),
        pendingRequiredRecords: nonNegative(row, 'pending_required_records'),
        failedRequiredRecords: nonNegative(row, 'failed_required_records'),
        expectedFamilies: stringArray(row, 'expected_families'),
        completedFamilies: stringArray(row, 'completed_families'),
        missingFamilies: stringArray(row, 'missing_families'),
        sourceCoverage: objectValue(row, 'source_coverage'),
        lastEvidenceSequence: decimal(
          row['last_evidence_sequence_text'] ?? row['last_evidence_sequence'],
        ),
        status: textValue(row, 'status'),
        qualityIssueIds: stringArray(row, 'quality_issue_ids'),
        sourceSnapshotHash: hash(row, 'source_snapshot_hash'),
        createdAt: timestampValue(row, 'created_at'),
        recomputedAt: timestampValue(row, 'recomputed_at'),
        sealedAt: nullableTimestamp(row['sealed_at']),
      });
    case 'quality_issue':
      return Object.freeze({
        issueId: textValue(row, 'issue_id'),
        revision: positive(row, 'revision'),
        issueCode: textValue(row, 'issue_code'),
        ruleId: nullableText(row['rule_id']),
        severity: textValue(row, 'severity'),
        episodeId: nullableText(row['episode_id']),
        recordType: nullableText(row['record_type']),
        recordId: nullableText(row['record_id']),
        sourceSystem: textValue(row, 'source_system'),
        sourceTable: textValue(row, 'source_table'),
        sourceRecordId: textValue(row, 'source_record_id'),
        detail: objectValue(row, 'detail'),
        createdAt: timestampValue(row, 'created_at'),
        resolvedAt: nullableTimestamp(row['resolved_at']),
      });
    case 'projection_issue':
      return Object.freeze({
        issueId: textValue(row, 'issue_id'),
        revision: positive(row, 'revision'),
        issueCode: textValue(row, 'issue_code'),
        severity: textValue(row, 'severity'),
        evaluationRole: textValue(row, 'evaluation_role'),
        recordType: nullableText(row['record_type']),
        recordId: nullableText(row['record_id']),
        episodeId: nullableText(row['episode_id']),
        sourceSystem: textValue(row, 'source_system'),
        sourceTable: textValue(row, 'source_table'),
        sourceRecordId: textValue(row, 'source_record_id'),
        sourcePartition: textValue(row, 'source_partition'),
        projectorVersion: textValue(row, 'projector_version'),
        retryable: booleanValue(row, 'retryable'),
        detail: objectValue(row, 'detail'),
        createdAt: timestampValue(row, 'created_at'),
        resolvedAt: nullableTimestamp(row['resolved_at']),
      });
    case 'source_checkpoint':
      return Object.freeze({
        sourceFamily: textValue(row, 'source_family'),
        sourcePartition: textValue(row, 'source_partition'),
        lastOccurredAt: nullableTimestamp(row['last_occurred_at']),
        lastSourceRecordId: nullableText(row['last_source_record_id']),
        lastSourceRevision: nullableText(row['last_source_revision']),
        lastPayloadHash: nullableHash(row['last_payload_hash']),
        lastProjectedAt: nullableTimestamp(row['last_projected_at']),
        projectorVersion: textValue(row, 'projector_version'),
      });
    case 'export_status': {
      const disposition = nullableText(row['ack_disposition']);
      return Object.freeze({
        exportId: textValue(row, 'export_id'),
        sourcePartition: textValue(row, 'source_partition'),
        batchId: textValue(row, 'batch_id'),
        configurationRevision: positive(row, 'configuration_revision'),
        firstSequence: decimal(row['first_sequence_text'] ?? row['first_sequence']),
        lastSequence: decimal(row['last_sequence_text'] ?? row['last_sequence']),
        batchHash: hash(row, 'batch_hash'),
        recordCount: positive(row, 'record_count'),
        attemptNo: positive(row, 'attempt_no'),
        status:
          disposition === null
            ? 'attempted'
            : disposition === 'rejected'
              ? 'rejected'
              : 'acknowledged',
        recordedAt: timestampValue(row, 'recorded_at'),
        ackId: nullableText(row['ack_id']),
        acknowledgedSequence: nullableDecimal(row['acknowledged_sequence_text']),
        ackDisposition: disposition,
        errorCode: nullableText(row['error_code']),
        acknowledgedAt: nullableTimestamp(row['acknowledged_at']),
        observedAt: nullableTimestamp(row['acknowledged_at']) ?? timestampValue(row, 'recorded_at'),
      });
    }
  }
}

function sourceRevisionFor(
  kind: EvidenceInfrastructureProjectionKind,
  row: EvidenceInfrastructureSourceRow,
  payload: EvidenceInfrastructureSourceRow,
): EvidenceJsonValue {
  switch (kind) {
    case 'episode_manifest':
      return { manifestId: payload['manifestId'] ?? null, revision: payload['revision'] ?? null };
    case 'quality_issue':
    case 'projection_issue':
      return { issueId: payload['issueId'] ?? null, revision: payload['revision'] ?? null };
    case 'source_checkpoint':
      return payload;
    case 'export_status':
      return {
        batchId: payload['batchId'] ?? null,
        batchLedgerSequence: decimal(row['batch_ledger_sequence_text']),
        ackId: payload['ackId'] ?? null,
        ackLedgerSequence: nullableDecimal(row['ack_ledger_sequence_text']),
      };
  }
}

function correlationIdFor(
  kind: EvidenceInfrastructureProjectionKind,
  row: EvidenceInfrastructureSourceRow,
): string {
  if (kind === 'episode_manifest') return textValue(row, 'episode_id');
  if (kind === 'quality_issue' || kind === 'projection_issue') {
    return nullableText(row['episode_id']) ?? textValue(row, 'issue_id');
  }
  if (kind === 'source_checkpoint') {
    return `${textValue(row, 'source_family')}:${textValue(row, 'source_partition')}`;
  }
  return textValue(row, 'batch_id');
}

function scopeFor(
  kind: EvidenceInfrastructureProjectionKind,
  row: EvidenceInfrastructureSourceRow,
): Readonly<{ episodeId?: string; taskId?: string }> {
  if (kind === 'episode_manifest') {
    return { episodeId: textValue(row, 'episode_id'), taskId: textValue(row, 'task_id') };
  }
  if (kind === 'quality_issue' || kind === 'projection_issue') {
    const episodeId = nullableText(row['episode_id']);
    return episodeId === null ? {} : { episodeId };
  }
  return {};
}

function assertPartition(partition: EvidenceInfrastructureProjectionPartition): void {
  const expected = recordTypeFor(partition.kind);
  if (
    partition.recordType !== expected ||
    text(partition.sourceRecordId, 'sourceRecordId') !== partition.sourceRecordId ||
    evidenceInfrastructureSourcePartition(partition.kind, partition.sourceRecordId) !==
      partition.sourcePartition
  ) {
    throw failure('EVIDENCE_INFRASTRUCTURE_PARTITION_DRIFT', partition.sourcePartition);
  }
}

export function evidenceInfrastructureSourcePartition(
  kind: EvidenceInfrastructureProjectionKind,
  sourceRecordId: string,
): string {
  const id = text(sourceRecordId, 'sourceRecordId');
  return `v141:evidence-infrastructure:${kind}:${String(id.length)}:${id}`;
}

export function recordTypeFor(
  kind: EvidenceInfrastructureProjectionKind,
): EvidenceInfrastructureRecordType {
  return `evidence.${kind}`;
}

function textValue(row: EvidenceInfrastructureSourceRow, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
  return text(value, field);
}

function text(value: string, field: string): string {
  const clean = value.trim();
  if (clean === '' || clean !== value || clean.length > 4096) {
    throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
  }
  return clean;
}

function nullableText(value: EvidenceJsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID');
  return text(value, 'nullableText');
}

function positive(row: EvidenceInfrastructureSourceRow, field: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
  }
  return value;
}

function nonNegative(row: EvidenceInfrastructureSourceRow, field: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
  }
  return value;
}

function booleanValue(row: EvidenceInfrastructureSourceRow, field: string): boolean {
  const value = row[field];
  if (typeof value !== 'boolean') throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
  return value;
}

function objectValue(
  row: EvidenceInfrastructureSourceRow,
  field: string,
): Readonly<Record<string, EvidenceJsonValue>> {
  const value = row[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
  }
  return value as Readonly<Record<string, EvidenceJsonValue>>;
}

function stringArray(row: EvidenceInfrastructureSourceRow, field: string): readonly string[] {
  const value = row[field];
  if (!Array.isArray(value)) throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
  return Object.freeze(
    value.map((entry) => {
      if (typeof entry !== 'string') throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
      return text(entry, field);
    }),
  );
}

function timestampValue(row: EvidenceInfrastructureSourceRow, field: string): string {
  return timestamp(textValue(row, field), field);
}

function nullableTimestamp(value: EvidenceJsonValue | undefined): string | null {
  const selected = nullableText(value);
  return selected === null ? null : timestamp(selected, 'timestamp');
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
  }
  return parsed.toISOString();
}

function decimal(value: EvidenceJsonValue | undefined): string {
  const selected = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof selected !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(selected)) {
    throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', 'decimal');
  }
  return selected;
}

function nullableDecimal(value: EvidenceJsonValue | undefined): string | null {
  return value === undefined || value === null ? null : decimal(value);
}

function hash(row: EvidenceInfrastructureSourceRow, field: string): `sha256:${string}` {
  const value = textValue(row, field);
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', field);
  }
  return value as `sha256:${string}`;
}

function nullableHash(value: EvidenceJsonValue | undefined): `sha256:${string}` | null {
  const selected = nullableText(value);
  if (selected === null) return null;
  if (!/^sha256:[0-9a-f]{64}$/u.test(selected)) {
    throw failure('EVIDENCE_INFRASTRUCTURE_SOURCE_INVALID', 'hash');
  }
  return selected as `sha256:${string}`;
}

function failure(
  code: EvidenceInfrastructureProjectionError['code'],
  detail?: string,
): EvidenceInfrastructureProjectionError {
  return new EvidenceInfrastructureProjectionError(code, detail);
}
