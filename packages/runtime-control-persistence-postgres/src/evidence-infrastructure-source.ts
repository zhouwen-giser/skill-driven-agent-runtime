import type { Pool, PoolClient } from 'pg';

import {
  getEvidenceCatalogEntry,
  type EvidenceJsonValue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import {
  EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION,
  evidenceInfrastructureSourcePartition,
  type EvidenceInfrastructureProjectionKind,
  type EvidenceInfrastructureProjectionPartition,
  type EvidenceInfrastructureRecordType,
  type EvidenceInfrastructureReference,
  type EvidenceInfrastructureSnapshot,
  type EvidenceInfrastructureSource,
  type EvidenceInfrastructureSourceRow,
} from '../../runtime-control-application/src/index.js';

interface PartitionRow {
  readonly kind: EvidenceInfrastructureProjectionKind;
  readonly record_type: EvidenceInfrastructureRecordType;
  readonly source_record_id: string;
}

interface ReferenceRow {
  readonly record_type: string;
  readonly record_id: string;
}

export class PostgresEvidenceInfrastructureSource implements EvidenceInfrastructureSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async pendingPartitions(
    limit: number,
  ): Promise<readonly EvidenceInfrastructureProjectionPartition[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Evidence infrastructure pending limit must be between 1 and 1000.');
    }
    const result = await this.#pool.query<PartitionRow>(pendingPartitionsSql, [
      EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION,
      limit,
    ]);
    return Object.freeze(result.rows.map(toPartition));
  }

  async load(
    partition: EvidenceInfrastructureProjectionPartition,
  ): Promise<EvidenceInfrastructureSnapshot | undefined> {
    const expectedPartition = evidenceInfrastructureSourcePartition(
      partition.kind,
      partition.sourceRecordId,
    );
    if (expectedPartition !== partition.sourcePartition) {
      throw new Error('Evidence infrastructure partition identity drift.');
    }
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = await loadSourceRow(client, partition);
      if (row === undefined) {
        await client.query('COMMIT');
        return undefined;
      }
      const references = await loadReferences(client, partition.recordType, row);
      const checkpointRow = await oneRow(
        client,
        `SELECT to_jsonb(checkpoint_row) AS value
         FROM evidence_source_checkpoint checkpoint_row
         WHERE checkpoint_row.source_family='evidence'
           AND checkpoint_row.source_partition=$1`,
        [partition.sourcePartition],
      );
      await client.query('COMMIT');
      return Object.freeze({
        partition,
        row,
        occurredAt: occurredAt(partition.kind, row),
        references,
        ...(checkpointRow === undefined ? {} : { checkpoint: toCheckpoint(checkpointRow) }),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

const pendingPartitionsSql = `WITH candidate AS (
  SELECT 'episode_manifest'::text AS kind,'evidence.episode_manifest'::text AS record_type,
         manifest.manifest_id AS source_record_id,0 AS priority,manifest.recomputed_at AS observed_at
  FROM episode_evidence_manifest manifest
  UNION ALL
  SELECT 'source_checkpoint','evidence.source_checkpoint',
         length(checkpoint.source_family)::text || ':' || checkpoint.source_family || ':' ||
           length(checkpoint.source_partition)::text || ':' || checkpoint.source_partition,
         1,checkpoint.last_projected_at
  FROM evidence_source_checkpoint checkpoint
  WHERE checkpoint.last_source_record_id IS NOT NULL
    AND (checkpoint.last_projected_at IS NOT NULL OR checkpoint.last_occurred_at IS NOT NULL)
    AND NOT (
      checkpoint.source_family='evidence'
      AND (
        checkpoint.projector_version=$1
        OR checkpoint.source_partition LIKE 'v141:evidence-infrastructure:%'
      )
    )
  UNION ALL
  SELECT 'quality_issue','evidence.quality_issue',issue.issue_id,2,
         issue.last_observed_at
  FROM evidence_quality_issue issue
  UNION ALL
  SELECT 'projection_issue','evidence.projection_issue',issue.issue_id,3,
         issue.last_observed_at
  FROM evidence_projection_issue issue
  WHERE issue.projector_version<>$1
  UNION ALL
  SELECT 'export_status','evidence.export_status',batch.batch_id,4,
         COALESCE(ack.acknowledged_at,batch.recorded_at)
  FROM evidence_export_batch batch
  LEFT JOIN evidence_export_ack ack ON ack.batch_id=batch.batch_id
  WHERE batch.observation_generation=1
    AND (ack.ack_id IS NULL OR ack.observation_generation=1)
    AND EXISTS (
      SELECT 1 FROM evidence_outbox source_record
      WHERE source_record.sequence BETWEEN batch.first_sequence AND batch.last_sequence
        AND source_record.observation_generation=0
    )
), normalized AS (
  SELECT candidate.*,
    'v141:evidence-infrastructure:' || candidate.kind || ':' ||
      length(candidate.source_record_id)::text || ':' || candidate.source_record_id
      AS source_partition
  FROM candidate
)
SELECT normalized.kind,normalized.record_type,normalized.source_record_id
FROM normalized
LEFT JOIN evidence_source_checkpoint projector_checkpoint
  ON projector_checkpoint.source_family='evidence'
 AND projector_checkpoint.source_partition=normalized.source_partition
LEFT JOIN LATERAL (
  SELECT MAX(issue.last_observed_at) AS last_observed_at,
         BOOL_AND(issue.retryable) AS retryable
  FROM evidence_projection_issue issue
  WHERE issue.source_partition=normalized.source_partition
    AND issue.projector_version=$1
    AND issue.resolved_at IS NULL
) retry_issue ON TRUE
WHERE (
  projector_checkpoint.source_partition IS NULL
  OR projector_checkpoint.projector_version IS DISTINCT FROM $1
  OR projector_checkpoint.last_projected_at IS NULL
  OR projector_checkpoint.last_projected_at < normalized.observed_at
)
  AND (
    retry_issue.last_observed_at IS NULL
    OR (
      retry_issue.retryable
      AND retry_issue.last_observed_at + INTERVAL '5 seconds' <= clock_timestamp()
    )
  )
ORDER BY
  CASE WHEN retry_issue.last_observed_at IS NULL THEN 0 ELSE 1 END,
  CASE WHEN projector_checkpoint.projector_version IS DISTINCT FROM $1 THEN 0 ELSE 1 END,
  projector_checkpoint.last_projected_at NULLS FIRST,
  normalized.priority,normalized.observed_at,normalized.source_record_id
LIMIT $2`;

async function loadSourceRow(
  client: PoolClient,
  partition: EvidenceInfrastructureProjectionPartition,
): Promise<EvidenceInfrastructureSourceRow | undefined> {
  switch (partition.kind) {
    case 'episode_manifest':
      return oneRow(
        client,
        `SELECT to_jsonb(manifest_row) || jsonb_build_object(
           'last_evidence_sequence_text',manifest_row.last_evidence_sequence::text
         ) AS value
         FROM episode_evidence_manifest manifest_row
         WHERE manifest_row.manifest_id=$1`,
        [partition.sourceRecordId],
      );
    case 'quality_issue':
      return oneRow(
        client,
        `SELECT to_jsonb(issue_row) AS value
         FROM evidence_quality_issue issue_row
         WHERE issue_row.issue_id=$1`,
        [partition.sourceRecordId],
      );
    case 'projection_issue':
      return oneRow(
        client,
        `SELECT to_jsonb(issue_row) AS value
         FROM evidence_projection_issue issue_row
         WHERE issue_row.issue_id=$1 AND issue_row.projector_version<>$2`,
        [partition.sourceRecordId, EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION],
      );
    case 'source_checkpoint': {
      const identity = parseCheckpointSourceRecordId(partition.sourceRecordId);
      return oneRow(
        client,
        `SELECT to_jsonb(checkpoint_row) AS value
         FROM evidence_source_checkpoint checkpoint_row
         WHERE checkpoint_row.source_family=$1 AND checkpoint_row.source_partition=$2
           AND (checkpoint_row.last_projected_at IS NOT NULL OR checkpoint_row.last_occurred_at IS NOT NULL)
           AND NOT (
             checkpoint_row.source_family='evidence'
             AND (
               checkpoint_row.projector_version=$3
               OR checkpoint_row.source_partition LIKE 'v141:evidence-infrastructure:%'
             )
           )`,
        [
          identity.sourceFamily,
          identity.sourcePartition,
          EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION,
        ],
      );
    }
    case 'export_status':
      return oneRow(
        client,
        `SELECT to_jsonb(batch_row) || jsonb_build_object(
           'batch_ledger_sequence_text',batch_row.ledger_sequence::text,
           'first_sequence_text',batch_row.first_sequence::text,
           'last_sequence_text',batch_row.last_sequence::text,
           'ack_id',ack_row.ack_id,
           'ack_ledger_sequence_text',ack_row.ledger_sequence::text,
           'acknowledged_sequence_text',ack_row.acknowledged_sequence::text,
           'ack_disposition',ack_row.ack_disposition,
           'error_code',ack_row.error_code,
           'acknowledged_at',ack_row.acknowledged_at
         ) AS value
         FROM evidence_export_batch batch_row
         LEFT JOIN evidence_export_ack ack_row ON ack_row.batch_id=batch_row.batch_id
         WHERE batch_row.batch_id=$1
           AND batch_row.observation_generation=1
           AND (ack_row.ack_id IS NULL OR ack_row.observation_generation=1)
           AND EXISTS (
             SELECT 1 FROM evidence_outbox source_record
             WHERE source_record.sequence BETWEEN batch_row.first_sequence AND batch_row.last_sequence
               AND source_record.observation_generation=0
           )`,
        [partition.sourceRecordId],
      );
  }
}

async function loadReferences(
  client: PoolClient,
  recordType: EvidenceInfrastructureRecordType,
  row: EvidenceInfrastructureSourceRow,
): Promise<readonly EvidenceInfrastructureReference[]> {
  const expected = getEvidenceCatalogEntry(recordType).expectedReferences;
  const references: ReferenceRow[] = [];
  for (const expectedType of expected) {
    let result: readonly ReferenceRow[];
    if (expectedType === 'runtime.run_seal') {
      result = await referenceRows(
        client,
        `SELECT record_type,record_id FROM evidence_outbox
         WHERE record_type='runtime.run_seal' AND source_record_id=$1
         ORDER BY sequence DESC LIMIT 1`,
        [requiredText(row['terminal_outcome_id'], 'terminal_outcome_id')],
      );
    } else if (expectedType === 'evidence.episode_manifest') {
      const episodeId = optionalText(row['episode_id']);
      result =
        episodeId === undefined
          ? []
          : await referenceRows(
              client,
              `SELECT evidence.record_type,evidence.record_id
               FROM episode_evidence_manifest manifest
               JOIN evidence_outbox evidence
                 ON evidence.record_type='evidence.episode_manifest'
                AND evidence.source_record_id=manifest.manifest_id
               WHERE manifest.episode_id=$1
               ORDER BY evidence.sequence DESC LIMIT 1`,
              [episodeId],
            );
    } else if (expectedType === 'evidence.source_checkpoint') {
      result = await referenceRows(
        client,
        `SELECT record_type,record_id FROM evidence_outbox
         WHERE record_type='evidence.source_checkpoint'
           AND payload->>'sourcePartition'=$1
         ORDER BY sequence DESC LIMIT 1`,
        [requiredText(row['source_partition'], 'source_partition')],
      );
    } else if (expectedType === 'node_control.telemetry_delivery') {
      result = await referenceRows(
        client,
        `SELECT record_type,record_id FROM evidence_outbox
         WHERE record_type='node_control.telemetry_delivery'
           AND source_record_id=$1
         ORDER BY sequence DESC LIMIT 1`,
        [requiredText(row['batch_id'], 'batch_id')],
      );
    } else {
      throw new Error(`Unsupported Evidence infrastructure reference type: ${expectedType}`);
    }
    references.push(...result);
  }
  return Object.freeze(
    references.map((reference) =>
      Object.freeze({ recordType: reference.record_type, recordId: reference.record_id }),
    ),
  );
}

async function oneRow(
  client: PoolClient,
  sql: string,
  parameters: readonly unknown[],
): Promise<EvidenceInfrastructureSourceRow | undefined> {
  const result = await client.query<{ value: EvidenceInfrastructureSourceRow }>(sql, [
    ...parameters,
  ]);
  const row = result.rows[0]?.value;
  return row === undefined ? undefined : Object.freeze(row);
}

async function referenceRows(
  client: PoolClient,
  sql: string,
  parameters: readonly unknown[],
): Promise<readonly ReferenceRow[]> {
  const result = await client.query<ReferenceRow>(sql, [...parameters]);
  return Object.freeze(result.rows.map((row) => Object.freeze(row)));
}

function toPartition(row: PartitionRow): EvidenceInfrastructureProjectionPartition {
  return Object.freeze({
    kind: row.kind,
    recordType: row.record_type,
    sourceRecordId: row.source_record_id,
    sourcePartition: evidenceInfrastructureSourcePartition(row.kind, row.source_record_id),
  });
}

function occurredAt(
  kind: EvidenceInfrastructureProjectionKind,
  row: EvidenceInfrastructureSourceRow,
): string {
  if (kind === 'episode_manifest') return requiredText(row['recomputed_at'], 'recomputed_at');
  if (kind === 'quality_issue' || kind === 'projection_issue') {
    return requiredText(row['last_observed_at'], 'last_observed_at');
  }
  if (kind === 'source_checkpoint') {
    return (
      optionalText(row['last_projected_at']) ??
      requiredText(row['last_occurred_at'], 'last_occurred_at')
    );
  }
  return optionalText(row['acknowledged_at']) ?? requiredText(row['recorded_at'], 'recorded_at');
}

function checkpointSourceRecordId(sourceFamily: string, sourcePartition: string): string {
  return `${String(sourceFamily.length)}:${sourceFamily}:${String(sourcePartition.length)}:${sourcePartition}`;
}

function parseCheckpointSourceRecordId(value: string): {
  readonly sourceFamily: string;
  readonly sourcePartition: string;
} {
  const firstSeparator = value.indexOf(':');
  if (firstSeparator < 1) throw new Error('Evidence checkpoint source identity invalid.');
  const familyLength = Number(value.slice(0, firstSeparator));
  const familyStart = firstSeparator + 1;
  const familyEnd = familyStart + familyLength;
  if (!Number.isSafeInteger(familyLength) || familyLength < 1 || value[familyEnd] !== ':') {
    throw new Error('Evidence checkpoint source identity invalid.');
  }
  const secondSeparator = value.indexOf(':', familyEnd + 1);
  if (secondSeparator < 0) throw new Error('Evidence checkpoint source identity invalid.');
  const partitionLength = Number(value.slice(familyEnd + 1, secondSeparator));
  const sourceFamily = value.slice(familyStart, familyEnd);
  const sourcePartition = value.slice(secondSeparator + 1);
  if (
    !Number.isSafeInteger(partitionLength) ||
    partitionLength < 1 ||
    sourcePartition.length !== partitionLength ||
    checkpointSourceRecordId(sourceFamily, sourcePartition) !== value
  ) {
    throw new Error('Evidence checkpoint source identity invalid.');
  }
  return Object.freeze({ sourceFamily, sourcePartition });
}

function requiredText(value: EvidenceJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim() !== value) {
    throw new Error(`Evidence infrastructure source field invalid: ${field}`);
  }
  return value;
}

function optionalText(value: EvidenceJsonValue | undefined): string | undefined {
  return value === undefined || value === null ? undefined : requiredText(value, 'optionalText');
}

function toCheckpoint(row: EvidenceInfrastructureSourceRow): EvidenceSourceCheckpoint {
  const lastPayloadHash = optionalText(row['last_payload_hash']);
  const lastOccurredAt = optionalText(row['last_occurred_at']);
  const lastSourceRecordId = optionalText(row['last_source_record_id']);
  const lastSourceRevision = optionalText(row['last_source_revision']);
  const lastProjectedAt = optionalText(row['last_projected_at']);
  if (lastPayloadHash !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(lastPayloadHash)) {
    throw new Error('Evidence infrastructure projector checkpoint hash invalid.');
  }
  return Object.freeze({
    sourceFamily: requiredText(row['source_family'], 'source_family'),
    sourcePartition: requiredText(row['source_partition'], 'source_partition'),
    ...(lastOccurredAt === undefined ? {} : { lastOccurredAt }),
    ...(lastSourceRecordId === undefined ? {} : { lastSourceRecordId }),
    ...(lastSourceRevision === undefined ? {} : { lastSourceRevision }),
    ...(lastPayloadHash === undefined
      ? {}
      : { lastPayloadHash: lastPayloadHash as `sha256:${string}` }),
    ...(lastProjectedAt === undefined ? {} : { lastProjectedAt }),
    projectorVersion: requiredText(row['projector_version'], 'projector_version'),
  });
}
