import type { Pool, PoolClient } from 'pg';

import {
  hashCanonicalEvidenceJson,
  type EvidenceJsonValue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import type {
  NodeControlEvidenceProjectionPartition,
  NodeControlEvidenceReference,
  NodeControlEvidenceSnapshot,
  NodeControlEvidenceSource,
  NodeControlEvidenceSourceCursor,
  NodeControlEvidenceSourcePage,
  NodeControlEvidenceSourceRow,
} from '../../runtime-control-application/src/index.js';

const projectorVersion = 'node-control/v1';
const scanChunkSize = 1_000;
const maximumSequence = 9_223_372_036_854_775_807n;

type TelemetryRecordType = 'node_control.telemetry_delivery' | 'node_control.telemetry_ack';

interface PendingRow {
  readonly ledger_sequence: string;
  readonly record_type: TelemetryRecordType;
  readonly source_record_id: string;
  readonly source_revision: string;
  readonly checkpoint_record_id: string | null;
  readonly checkpoint_revision: string | null;
  readonly checkpoint_projector_version: string | null;
  readonly in_backoff: boolean;
}

interface BatchRow {
  readonly ledger_sequence: string;
  readonly batch_id: string;
  readonly export_id: string;
  readonly source_partition: string;
  readonly configuration_revision: string;
  readonly first_sequence: string;
  readonly last_sequence: string;
  readonly batch_hash: string;
  readonly record_count: number;
  readonly attempt_no: number;
  readonly status: string;
  readonly observation_generation: number;
  readonly recorded_at: Date | string;
}

interface AckRow {
  readonly ledger_sequence: string;
  readonly ack_id: string;
  readonly batch_id: string;
  readonly export_id: string;
  readonly source_partition: string;
  readonly acknowledged_sequence: string | null;
  readonly batch_hash: string;
  readonly ack_disposition: string;
  readonly error_code: string | null;
  readonly observation_generation: number;
  readonly acknowledged_at: Date | string;
  readonly delivery_attempt_no: number;
}

interface CheckpointRow {
  readonly source_family: string;
  readonly source_partition: string;
  readonly last_occurred_at: Date | string | null;
  readonly last_source_record_id: string | null;
  readonly last_source_revision: string | null;
  readonly last_payload_hash: string | null;
  readonly last_projected_at: Date | string | null;
  readonly projector_version: string;
}

export type NodeControlTelemetryEvidenceSourceErrorCode =
  | 'NODE_CONTROL_TELEMETRY_EVIDENCE_LIMIT_INVALID'
  | 'NODE_CONTROL_TELEMETRY_EVIDENCE_CURSOR_INVALID'
  | 'NODE_CONTROL_TELEMETRY_EVIDENCE_CURSOR_UNSUPPORTED'
  | 'NODE_CONTROL_TELEMETRY_EVIDENCE_PARTITION_INVALID'
  | 'NODE_CONTROL_TELEMETRY_EVIDENCE_AUTHORITY_INVALID'
  | 'NODE_CONTROL_TELEMETRY_EVIDENCE_CHECKPOINT_INVALID';

export class NodeControlTelemetryEvidenceSourceError extends Error {
  readonly code: NodeControlTelemetryEvidenceSourceErrorCode;

  constructor(code: NodeControlTelemetryEvidenceSourceErrorCode, detail: string) {
    super(`${code}:${detail}`);
    this.name = 'NodeControlTelemetryEvidenceSourceError';
    this.code = code;
  }
}

/**
 * Reads generation-one delivery observations from Runtime PostgreSQL. The mutable exporter state
 * is deliberately outside this source: only the append-only batch/ACK ledger is authoritative.
 */
export class PostgresNodeControlTelemetryEvidenceSource implements NodeControlEvidenceSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async pendingPartitions(
    limit: number,
    cursor?: NodeControlEvidenceSourceCursor,
  ): Promise<readonly NodeControlEvidenceProjectionPartition[]> {
    return (await this.pendingPage(limit, cursor)).partitions;
  }

  async pendingPage(
    limit: number,
    cursor?: NodeControlEvidenceSourceCursor,
  ): Promise<NodeControlEvidenceSourcePage> {
    boundedLimit(limit);
    const after = cursorSequence(cursor);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const page = await pendingPage(client, limit, after);
      await client.query('COMMIT');
      return page;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async load(
    partition: NodeControlEvidenceProjectionPartition,
  ): Promise<NodeControlEvidenceSnapshot | undefined> {
    validateRequestedPartition(partition);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot =
        partition.recordType === 'node_control.telemetry_delivery'
          ? await loadBatch(client, partition)
          : await loadAck(client, partition);
      if (snapshot === undefined) {
        await client.query('COMMIT');
        return undefined;
      }
      const checkpoint = await loadCheckpoint(client, partition.sourcePartition);
      await client.query('COMMIT');
      return Object.freeze({
        ...snapshot,
        ...(checkpoint === undefined ? {} : { checkpoint }),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function pendingPage(
  client: PoolClient,
  limit: number,
  after: string,
): Promise<NodeControlEvidenceSourcePage> {
  const partitions: NodeControlEvidenceProjectionPartition[] = [];
  let scanAfter = after;
  let scanned = false;

  while (partitions.length < limit) {
    const result = await client.query<PendingRow>(pendingSql, [
      scanAfter,
      projectorVersion,
      scanChunkSize,
    ]);
    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      validatePendingRow(row);
      scanAfter = row.ledger_sequence;
      scanned = true;
      // Projection issues are source-partition scoped; one poison partition must not stall the
      // independent delivery/ACK partitions behind it. A fresh drain starts from the durable
      // checkpoints and will reconsider this row after the five-second backoff.
      if (row.in_backoff) continue;
      const partition = partitionFromPending(row);
      if (!checkpointMatches(row, partition.sourceRevision)) partitions.push(partition);
      if (partitions.length === limit) break;
    }

    if (result.rows.length < scanChunkSize || partitions.length === limit) break;
  }

  return Object.freeze({
    partitions: Object.freeze(partitions),
    ...(scanned
      ? {
          nextCursor: Object.freeze({ afterObservationSequence: scanAfter }),
        }
      : {}),
  });
}

async function loadBatch(
  client: PoolClient,
  requested: NodeControlEvidenceProjectionPartition,
): Promise<NodeControlEvidenceSnapshot | undefined> {
  const result = await client.query<BatchRow>(
    `SELECT ledger_sequence::text,batch_id,export_id,source_partition,
            configuration_revision::text,first_sequence::text,last_sequence::text,
            batch_hash,record_count,attempt_no,status,observation_generation,recorded_at
       FROM evidence_export_batch
      WHERE ledger_sequence=$1::bigint AND batch_id=$2`,
    [requested.observationSequence, requested.sourceRecordId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const loaded = batchPartition(row);
  assertSamePartition(requested, loaded);

  const configurationRevision = positiveInteger(
    row.configuration_revision,
    'configuration_revision',
  );
  const firstSequence = decimal(row.first_sequence, 'first_sequence');
  const lastSequence = decimal(row.last_sequence, 'last_sequence');
  if (BigInt(firstSequence) > BigInt(lastSequence)) invalidAuthority('sequence_range');
  const batchId = text(row.batch_id, 'batch_id');
  const exportId = text(row.export_id, 'export_id');
  const attemptNo = positiveInteger(row.attempt_no, 'attempt_no');
  const recordedAt = timestamp(row.recorded_at, 'recorded_at');
  if (row.status !== 'attempted') invalidAuthority('status');
  if (row.observation_generation !== 1) invalidAuthority('observation_generation');

  const payload = frozenPayload({
    batchId,
    exportId,
    sourcePartition: text(row.source_partition, 'source_partition'),
    configurationRevision,
    firstSequence,
    lastSequence,
    batchHash: hash(row.batch_hash, 'batch_hash'),
    recordCount: positiveInteger(row.record_count, 'record_count'),
    attemptNo,
    deliveryStatus: 'attempted',
    recordedAt,
  });
  const references = Object.freeze([
    Object.freeze({
      recordType: 'node_control.telemetry_configuration',
      sourceRecordId: `${exportId}:${String(configurationRevision)}`,
      sourceRevision: configurationRevision,
    }),
  ] satisfies readonly NodeControlEvidenceReference[]);

  return Object.freeze({
    partition: loaded,
    occurredAt: recordedAt,
    payload,
    references,
    scope: Object.freeze({ correlationId: exportId }),
    observationGeneration: 1,
  });
}

async function loadAck(
  client: PoolClient,
  requested: NodeControlEvidenceProjectionPartition,
): Promise<NodeControlEvidenceSnapshot | undefined> {
  const result = await client.query<AckRow>(
    `SELECT ack.ledger_sequence::text,ack.ack_id,ack.batch_id,ack.export_id,
            ack.source_partition,ack.acknowledged_sequence::text,ack.batch_hash,
            ack.ack_disposition,ack.error_code,ack.observation_generation,
            ack.acknowledged_at,batch.attempt_no AS delivery_attempt_no
       FROM evidence_export_ack ack
       JOIN evidence_export_batch batch
         ON batch.batch_id=ack.batch_id
        AND batch.export_id=ack.export_id
        AND batch.source_partition=ack.source_partition
        AND batch.batch_hash=ack.batch_hash
      WHERE ack.ledger_sequence=$1::bigint AND ack.ack_id=$2`,
    [requested.observationSequence, requested.sourceRecordId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const loaded = ackPartition(row);
  assertSamePartition(requested, loaded);

  const ackId = text(row.ack_id, 'ack_id');
  const batchId = text(row.batch_id, 'batch_id');
  const exportId = text(row.export_id, 'export_id');
  const disposition = ackDisposition(row.ack_disposition);
  const acknowledgedSequence =
    row.acknowledged_sequence === null
      ? null
      : decimal(row.acknowledged_sequence, 'acknowledged_sequence');
  const errorCode = row.error_code === null ? null : text(row.error_code, 'error_code');
  if (disposition === 'rejected') {
    if (acknowledgedSequence !== null || errorCode === null) invalidAuthority('ack_outcome');
  } else if (acknowledgedSequence === null || errorCode !== null) {
    invalidAuthority('ack_outcome');
  }
  if (row.observation_generation !== 1) invalidAuthority('observation_generation');
  const acknowledgedAt = timestamp(row.acknowledged_at, 'acknowledged_at');
  const deliveryAttemptNo = positiveInteger(row.delivery_attempt_no, 'delivery_attempt_no');

  const payload = frozenPayload({
    ackId,
    batchId,
    exportId,
    sourcePartition: text(row.source_partition, 'source_partition'),
    acknowledgedSequence,
    batchHash: hash(row.batch_hash, 'batch_hash'),
    ackDisposition: disposition,
    errorCode,
    acknowledgedAt,
  });
  const references = Object.freeze([
    Object.freeze({
      recordType: 'node_control.telemetry_delivery',
      sourceRecordId: batchId,
      sourceRevision: deliveryAttemptNo,
    }),
  ] satisfies readonly NodeControlEvidenceReference[]);

  return Object.freeze({
    partition: loaded,
    occurredAt: acknowledgedAt,
    payload,
    references,
    scope: Object.freeze({ correlationId: exportId, causationId: batchId }),
    observationGeneration: 1,
  });
}

async function loadCheckpoint(
  client: PoolClient,
  sourcePartition: string,
): Promise<EvidenceSourceCheckpoint | undefined> {
  const result = await client.query<CheckpointRow>(
    `SELECT source_family,source_partition,last_occurred_at,last_source_record_id,
            last_source_revision,last_payload_hash,last_projected_at,projector_version
       FROM evidence_source_checkpoint
      WHERE source_family='node_control' AND source_partition=$1`,
    [sourcePartition],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  if (row.source_family !== 'node_control' || row.source_partition !== sourcePartition) {
    invalidCheckpoint('identity');
  }
  const lastSourceRecordId = nullableText(row.last_source_record_id, 'last_source_record_id');
  const lastSourceRevision = nullableHash(row.last_source_revision, 'last_source_revision');
  if ((lastSourceRecordId === undefined) !== (lastSourceRevision === undefined)) {
    invalidCheckpoint('source_cursor');
  }
  const lastPayloadHash = nullableHash(row.last_payload_hash, 'last_payload_hash');
  const lastOccurredAt = nullableTimestamp(row.last_occurred_at, 'last_occurred_at');
  const lastProjectedAt = nullableTimestamp(row.last_projected_at, 'last_projected_at');

  return Object.freeze({
    sourceFamily: 'node_control',
    sourcePartition,
    ...(lastOccurredAt === undefined ? {} : { lastOccurredAt }),
    ...(lastSourceRecordId === undefined ? {} : { lastSourceRecordId }),
    ...(lastSourceRevision === undefined ? {} : { lastSourceRevision }),
    ...(lastPayloadHash === undefined
      ? {}
      : { lastPayloadHash: lastPayloadHash as `sha256:${string}` }),
    ...(lastProjectedAt === undefined ? {} : { lastProjectedAt }),
    projectorVersion: text(row.projector_version, 'projector_version'),
  });
}

function partitionFromPending(row: PendingRow): NodeControlEvidenceProjectionPartition {
  const sourceRevision = positiveInteger(row.source_revision, 'source_revision');
  return Object.freeze({
    recordType: row.record_type,
    sourcePartition: partitionKey(row.record_type, row.source_record_id),
    sourceRecordId: text(row.source_record_id, 'source_record_id'),
    sourceRevision,
    observationSequence: decimal(row.ledger_sequence, 'ledger_sequence'),
  });
}

function batchPartition(row: BatchRow): NodeControlEvidenceProjectionPartition {
  return Object.freeze({
    recordType: 'node_control.telemetry_delivery',
    sourcePartition: partitionKey('node_control.telemetry_delivery', row.batch_id),
    sourceRecordId: text(row.batch_id, 'batch_id'),
    sourceRevision: positiveInteger(row.attempt_no, 'attempt_no'),
    observationSequence: decimal(row.ledger_sequence, 'ledger_sequence'),
  });
}

function ackPartition(row: AckRow): NodeControlEvidenceProjectionPartition {
  return Object.freeze({
    recordType: 'node_control.telemetry_ack',
    sourcePartition: partitionKey('node_control.telemetry_ack', row.ack_id),
    sourceRecordId: text(row.ack_id, 'ack_id'),
    sourceRevision: 1,
    observationSequence: decimal(row.ledger_sequence, 'ledger_sequence'),
  });
}

function validatePendingRow(row: PendingRow) {
  const recordType: unknown = row.record_type;
  if (
    recordType !== 'node_control.telemetry_delivery' &&
    recordType !== 'node_control.telemetry_ack'
  ) {
    invalidAuthority('record_type');
  }
  decimal(row.ledger_sequence, 'ledger_sequence');
  text(row.source_record_id, 'source_record_id');
  positiveInteger(row.source_revision, 'source_revision');
  if (typeof row.in_backoff !== 'boolean') invalidAuthority('in_backoff');
}

function checkpointMatches(row: PendingRow, sourceRevision: EvidenceJsonValue) {
  if (row.checkpoint_projector_version !== projectorVersion) return false;
  if (row.checkpoint_record_id !== row.source_record_id) return false;
  return row.checkpoint_revision === hashCanonicalEvidenceJson(sourceRevision);
}

function validateRequestedPartition(partition: NodeControlEvidenceProjectionPartition) {
  if (
    partition.recordType !== 'node_control.telemetry_delivery' &&
    partition.recordType !== 'node_control.telemetry_ack'
  ) {
    invalidPartition('record_type');
  }
  const sourceRecordId = text(partition.sourceRecordId, 'source_record_id');
  if (partition.sourcePartition !== partitionKey(partition.recordType, sourceRecordId)) {
    invalidPartition('source_partition');
  }
  decimal(partition.observationSequence, 'observation_sequence');
  positiveInteger(partition.sourceRevision, 'source_revision');
}

function assertSamePartition(
  requested: NodeControlEvidenceProjectionPartition,
  loaded: NodeControlEvidenceProjectionPartition,
) {
  if (
    requested.recordType !== loaded.recordType ||
    requested.sourcePartition !== loaded.sourcePartition ||
    requested.sourceRecordId !== loaded.sourceRecordId ||
    requested.observationSequence !== loaded.observationSequence ||
    hashCanonicalEvidenceJson(requested.sourceRevision) !==
      hashCanonicalEvidenceJson(loaded.sourceRevision)
  ) {
    invalidPartition('authority_drift');
  }
}

function frozenPayload(
  value: Readonly<Record<string, EvidenceJsonValue>>,
): NodeControlEvidenceSourceRow {
  return Object.freeze(value);
}

function partitionKey(recordType: TelemetryRecordType, sourceRecordId: string) {
  return `node-control:${recordType}:${sourceRecordId}`;
}

function cursorSequence(cursor: NodeControlEvidenceSourceCursor | undefined) {
  if (cursor?.lastEventId !== undefined) {
    throw new NodeControlTelemetryEvidenceSourceError(
      'NODE_CONTROL_TELEMETRY_EVIDENCE_CURSOR_UNSUPPORTED',
      'lastEventId',
    );
  }
  return decimal(cursor?.afterObservationSequence ?? '0', 'afterObservationSequence');
}

function boundedLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new NodeControlTelemetryEvidenceSourceError(
      'NODE_CONTROL_TELEMETRY_EVIDENCE_LIMIT_INVALID',
      'limit',
    );
  }
}

function positiveInteger(value: unknown, field: string) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalidAuthority(field);
  return parsed;
}

function decimal(value: string, field: string) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || BigInt(value) > maximumSequence) {
    throw new NodeControlTelemetryEvidenceSourceError(
      'NODE_CONTROL_TELEMETRY_EVIDENCE_CURSOR_INVALID',
      field,
    );
  }
  return value;
}

function text(value: string, field: string) {
  if (typeof value !== 'string' || value.trim() === '') invalidAuthority(field);
  return value;
}

function nullableText(value: string | null, field: string) {
  return value === null ? undefined : text(value, field);
}

function hash(value: string, field: string) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) invalidAuthority(field);
  return value;
}

function nullableHash(value: string | null, field: string) {
  if (value === null) return undefined;
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) invalidCheckpoint(field);
  return value;
}

function timestamp(value: Date | string, field: string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalidAuthority(field);
  return parsed.toISOString();
}

function nullableTimestamp(value: Date | string | null, field: string) {
  if (value === null) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalidCheckpoint(field);
  return parsed.toISOString();
}

function ackDisposition(value: string): 'accepted' | 'partial' | 'rejected' {
  if (value === 'accepted' || value === 'partial' || value === 'rejected') return value;
  return invalidAuthority('ack_disposition');
}

function invalidAuthority(field: string): never {
  throw new NodeControlTelemetryEvidenceSourceError(
    'NODE_CONTROL_TELEMETRY_EVIDENCE_AUTHORITY_INVALID',
    field,
  );
}

function invalidPartition(field: string): never {
  throw new NodeControlTelemetryEvidenceSourceError(
    'NODE_CONTROL_TELEMETRY_EVIDENCE_PARTITION_INVALID',
    field,
  );
}

function invalidCheckpoint(field: string): never {
  throw new NodeControlTelemetryEvidenceSourceError(
    'NODE_CONTROL_TELEMETRY_EVIDENCE_CHECKPOINT_INVALID',
    field,
  );
}

const pendingSql = `WITH candidate AS (
  SELECT batch.ledger_sequence,'node_control.telemetry_delivery'::text AS record_type,
         batch.batch_id AS source_record_id,batch.attempt_no::text AS source_revision
    FROM evidence_export_batch batch
  UNION ALL
  SELECT ack.ledger_sequence,'node_control.telemetry_ack'::text,
         ack.ack_id,'1'::text
    FROM evidence_export_ack ack
), normalized AS (
  SELECT candidate.*,
         'node-control:' || candidate.record_type || ':' || candidate.source_record_id
           AS evidence_source_partition
    FROM candidate
)
SELECT normalized.ledger_sequence::text,normalized.record_type,
       normalized.source_record_id,normalized.source_revision,
       checkpoint.last_source_record_id AS checkpoint_record_id,
       checkpoint.last_source_revision AS checkpoint_revision,
       checkpoint.projector_version AS checkpoint_projector_version,
       COALESCE(projection_issue.created_at + interval '5 seconds' > CURRENT_TIMESTAMP,false)
         AS in_backoff
  FROM normalized
  LEFT JOIN evidence_source_checkpoint checkpoint
    ON checkpoint.source_family='node_control'
   AND checkpoint.source_partition=normalized.evidence_source_partition
  LEFT JOIN LATERAL (
    SELECT issue.created_at
      FROM evidence_projection_issue issue
     WHERE issue.source_system='runtime'
       AND issue.source_partition=normalized.evidence_source_partition
       AND issue.projector_version=$2
       AND issue.retryable
       AND issue.resolved_at IS NULL
     ORDER BY issue.created_at DESC,issue.issue_id
     LIMIT 1
  ) projection_issue ON true
 WHERE normalized.ledger_sequence>$1::bigint
 ORDER BY normalized.ledger_sequence
 LIMIT $3`;
