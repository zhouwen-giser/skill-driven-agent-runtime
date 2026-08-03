import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  canonicalizeEvidenceJson,
  hashCanonicalEvidenceJson,
  type CanonicalEvidenceEnvelope,
  type EpisodeEvidenceManifest,
  type EvidenceExportConfiguration,
  type EvidenceIssueCode,
  type EvidenceJsonValue,
  type EvidenceProjectionIssue,
  type EvidenceQualityIssue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';

export type EvidencePersistenceErrorCode =
  | 'EVIDENCE_CONFIGURATION_CONFLICT'
  | 'EVIDENCE_CONFIGURATION_STALE'
  | 'EVIDENCE_OUTBOX_HIGH_WATERMARK'
  | 'EVIDENCE_PAYLOAD_HASH_CONFLICT'
  | 'EVIDENCE_SOURCE_IDENTITY_CONFLICT'
  | 'EVIDENCE_LEASE_NOT_OWNED'
  | 'EVIDENCE_ACK_INVALID'
  | 'EVIDENCE_CHECKPOINT_REGRESSION';

export class EvidencePersistenceError extends Error {
  readonly code: EvidencePersistenceErrorCode;

  constructor(code: EvidencePersistenceErrorCode, message: string) {
    super(message);
    this.name = 'EvidencePersistenceError';
    this.code = code;
  }
}

export interface StoredEvidenceRecord {
  readonly sequence: string;
  readonly sourcePartition: string;
  readonly envelope: CanonicalEvidenceEnvelope;
  readonly deliveryAttempts: number;
  readonly nextAttemptAt: string;
}

export interface EvidenceExportLease {
  readonly exportId: string;
  readonly sourcePartition: string;
  readonly owner: string;
  readonly token: string;
  readonly fencingToken: string;
  readonly expiresAt: string;
}

export class PostgresEvidenceStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findActiveConfiguration(): Promise<EvidenceExportConfiguration | undefined> {
    const result = await this.#pool.query<{ definition: EvidenceExportConfiguration }>(
      'SELECT definition FROM evidence_export_configuration WHERE is_active',
    );
    return result.rows[0]?.definition;
  }

  async applyConfiguration(
    configuration: EvidenceExportConfiguration,
    appliedAt: string,
  ): Promise<void> {
    const checksum = hashCanonicalEvidenceJson(configuration).slice('sha256:'.length);
    await withTransaction(this.#pool, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('runtime.evidence-export'))`);
      const existing = await client.query<{ checksum: string }>(
        `SELECT checksum::text FROM evidence_export_configuration
         WHERE export_id=$1 AND revision=$2`,
        [configuration.exportId, configuration.revision],
      );
      if (existing.rows[0] !== undefined && existing.rows[0].checksum !== checksum) {
        throw new EvidencePersistenceError(
          'EVIDENCE_CONFIGURATION_CONFLICT',
          'Evidence export configuration revision content is immutable.',
        );
      }
      const active = await client.query<{ revision: string }>(
        'SELECT revision::text FROM evidence_export_configuration WHERE is_active',
      );
      if (
        active.rows[0] !== undefined &&
        BigInt(active.rows[0].revision) > BigInt(configuration.revision)
      ) {
        throw new EvidencePersistenceError(
          'EVIDENCE_CONFIGURATION_STALE',
          'Evidence export configuration revision regressed.',
        );
      }
      await client.query(
        'UPDATE evidence_export_configuration SET is_active=false,is_lkg=false WHERE is_active OR is_lkg',
      );
      await client.query(
        `INSERT INTO evidence_export_configuration(
           export_id,revision,definition,checksum,applied_at,is_active,is_lkg)
         VALUES ($1,$2,$3::jsonb,$4,$5,true,true)
         ON CONFLICT (export_id,revision) DO UPDATE SET
           applied_at=EXCLUDED.applied_at,is_active=true,is_lkg=true`,
        [
          configuration.exportId,
          configuration.revision,
          canonicalizeEvidenceJson(configuration),
          checksum,
          appliedAt,
        ],
      );
    });
  }

  async append(
    envelope: CanonicalEvidenceEnvelope,
    capturedAt: string,
    sourcePartition: string,
  ): Promise<string> {
    try {
      return await withTransaction(this.#pool, (client) =>
        this.appendWithinTransaction(client, envelope, capturedAt, sourcePartition),
      );
    } catch (error) {
      if (
        error instanceof EvidencePersistenceError &&
        error.code === 'EVIDENCE_OUTBOX_HIGH_WATERMARK'
      ) {
        await this.#recordHighWatermark(capturedAt);
      }
      throw error;
    }
  }

  async appendWithinTransaction(
    client: PoolClient,
    envelope: CanonicalEvidenceEnvelope,
    capturedAt: string,
    sourcePartition: string,
  ): Promise<string> {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `evidence.record:${envelope.recordId}`,
    ]);
    const existing = await client.query<{ sequence: string; payload_hash: string }>(
      'SELECT sequence::text,payload_hash::text FROM evidence_outbox WHERE record_id=$1',
      [envelope.recordId],
    );
    const existingRow = existing.rows[0];
    if (existingRow !== undefined) {
      if (existingRow.payload_hash !== envelope.payloadHash) {
        throw new EvidencePersistenceError(
          'EVIDENCE_PAYLOAD_HASH_CONFLICT',
          `Evidence record ${envelope.recordId} already exists with a different payload hash.`,
        );
      }
      return existingRow.sequence;
    }

    await this.#assertBelowHighWatermark(client, envelope.evaluationRole);
    try {
      const inserted = await client.query<{ sequence: string }>(
        `INSERT INTO evidence_outbox(
           record_id,record_family,record_type,schema_name,schema_version,
           source_system,source_table,source_record_id,source_revision,source_partition,
           tenant_id,user_scope_id,project_id,environment,task_id,context_id,episode_id,run_id,
           goal_id,goal_version,plan_id,plan_version,skill_execution_id,capability_binding_id,
           remote_task_binding_id,node_id,correlation_id,causation_id,delivery_guarantee,
           evaluation_role,occurred_at,recorded_at,evidence_refs,artifact_refs,payload,payload_hash,
           captured_at,next_attempt_at)
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
           $29,$30,$31,$32,$33::jsonb,$34::jsonb,$35::jsonb,$36,$37,$37)
         RETURNING sequence::text`,
        [
          envelope.recordId,
          envelope.recordFamily,
          envelope.recordType,
          envelope.schemaName,
          envelope.schemaVersion,
          envelope.sourceSystem,
          envelope.sourceTable,
          envelope.sourceRecordId,
          envelope.sourceRevision,
          sourcePartition,
          envelope.tenantId ?? null,
          envelope.userScopeId ?? null,
          envelope.projectId ?? null,
          envelope.environment,
          envelope.taskId ?? null,
          envelope.contextId ?? null,
          envelope.episodeId ?? null,
          envelope.runId ?? null,
          envelope.goalId ?? null,
          envelope.goalVersion ?? null,
          envelope.planId ?? null,
          envelope.planVersion ?? null,
          envelope.skillExecutionId ?? null,
          envelope.capabilityBindingId ?? null,
          envelope.remoteTaskBindingId ?? null,
          envelope.nodeId ?? null,
          envelope.correlationId,
          envelope.causationId ?? null,
          envelope.deliveryGuarantee,
          envelope.evaluationRole,
          envelope.occurredAt,
          envelope.recordedAt,
          JSON.stringify(envelope.evidenceRefs),
          JSON.stringify(envelope.artifactRefs),
          canonicalizeEvidenceJson(envelope.payload),
          envelope.payloadHash,
          capturedAt,
        ],
      );
      const sequence = inserted.rows[0]?.sequence;
      if (sequence === undefined) throw new Error('EVIDENCE_OUTBOX_INSERT_RETURNED_NO_SEQUENCE');
      return sequence;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const source = await client.query<{ record_id: string; payload_hash: string }>(
        `SELECT record_id,payload_hash::text FROM evidence_outbox
         WHERE source_system=$1 AND source_table=$2 AND source_record_id=$3
           AND source_revision=$4 AND schema_name=$5 AND schema_version=$6`,
        [
          envelope.sourceSystem,
          envelope.sourceTable,
          envelope.sourceRecordId,
          envelope.sourceRevision,
          envelope.schemaName,
          envelope.schemaVersion,
        ],
      );
      const conflicting = source.rows[0];
      throw new EvidencePersistenceError(
        conflicting?.payload_hash === envelope.payloadHash &&
          conflicting.record_id !== envelope.recordId
          ? 'EVIDENCE_SOURCE_IDENTITY_CONFLICT'
          : 'EVIDENCE_PAYLOAD_HASH_CONFLICT',
        'The immutable evidence source identity conflicts with an existing record.',
      );
    }
  }

  async pending(
    sourcePartition: string,
    limit: number,
    observedAt: string,
  ): Promise<readonly StoredEvidenceRecord[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 1_000));
    const result = await this.#pool.query<EvidenceOutboxRow>(
      `SELECT evidence_outbox.*,evidence_outbox.sequence::text AS sequence_text,
         evidence_outbox.delivery_attempts::integer AS delivery_attempts_value
       FROM evidence_outbox
       WHERE source_partition=$1 AND acknowledged_at IS NULL AND next_attempt_at<=$2
       ORDER BY evidence_outbox.sequence LIMIT $3`,
      [sourcePartition, observedAt, boundedLimit],
    );
    return Object.freeze(result.rows.map(toStoredEvidenceRecord));
  }

  async acquireLease(input: {
    readonly exportId: string;
    readonly sourcePartition: string;
    readonly owner: string;
    readonly token: string;
    readonly acquiredAt: string;
    readonly expiresAt: string;
  }): Promise<EvidenceExportLease> {
    return withTransaction(this.#pool, async (client) => {
      await client.query(
        `INSERT INTO evidence_export_state(export_id,source_partition,observed_at)
         VALUES ($1,$2,$3) ON CONFLICT (export_id,source_partition) DO NOTHING`,
        [input.exportId, input.sourcePartition, input.acquiredAt],
      );
      const state = await client.query<{
        lease_owner: string | null;
        lease_expires_at: Date | string | null;
      }>(
        `SELECT lease_owner,lease_expires_at FROM evidence_export_state
         WHERE export_id=$1 AND source_partition=$2 FOR UPDATE`,
        [input.exportId, input.sourcePartition],
      );
      const current = state.rows[0];
      if (current === undefined) throw new Error('EVIDENCE_EXPORT_STATE_MISSING');
      if (
        current.lease_owner !== null &&
        current.lease_owner !== input.owner &&
        current.lease_expires_at !== null &&
        new Date(current.lease_expires_at).getTime() > new Date(input.acquiredAt).getTime()
      ) {
        throw new EvidencePersistenceError(
          'EVIDENCE_LEASE_NOT_OWNED',
          'Evidence export partition already has a live lease.',
        );
      }
      const updated = await client.query<{ fencing_token: string }>(
        `UPDATE evidence_export_state SET status='exporting',lease_owner=$3,lease_token=$4,
           lease_expires_at=$5,fencing_token=fencing_token+1,observed_at=$6
         WHERE export_id=$1 AND source_partition=$2 RETURNING fencing_token::text`,
        [
          input.exportId,
          input.sourcePartition,
          input.owner,
          input.token,
          input.expiresAt,
          input.acquiredAt,
        ],
      );
      return Object.freeze({
        exportId: input.exportId,
        sourcePartition: input.sourcePartition,
        owner: input.owner,
        token: input.token,
        fencingToken: required(updated.rows[0]?.fencing_token, 'EVIDENCE_FENCE_MISSING'),
        expiresAt: input.expiresAt,
      });
    });
  }

  async markSent(
    lease: EvidenceExportLease,
    sequences: readonly string[],
    observedAt: string,
  ): Promise<void> {
    if (sequences.length === 0 || new Set(sequences).size !== sequences.length) {
      throw new EvidencePersistenceError(
        'EVIDENCE_ACK_INVALID',
        'Evidence sent batch must contain unique sequences.',
      );
    }
    await withTransaction(this.#pool, async (client) => {
      const state = await client.query(
        `SELECT 1 FROM evidence_export_state
         WHERE export_id=$1 AND source_partition=$2 AND lease_owner=$3 AND lease_token=$4
           AND fencing_token=$5::bigint AND lease_expires_at>$6 FOR UPDATE`,
        [
          lease.exportId,
          lease.sourcePartition,
          lease.owner,
          lease.token,
          lease.fencingToken,
          observedAt,
        ],
      );
      if (state.rowCount !== 1) throw leaseNotOwned();
      const marked = await client.query(
        `UPDATE evidence_outbox SET sent_export_id=$1,sent_fencing_token=$2::bigint,sent_at=$3
         WHERE source_partition=$4 AND sequence=ANY($5::bigint[]) AND acknowledged_at IS NULL`,
        [lease.exportId, lease.fencingToken, observedAt, lease.sourcePartition, sequences],
      );
      if (marked.rowCount !== sequences.length) {
        throw new EvidencePersistenceError(
          'EVIDENCE_ACK_INVALID',
          'Evidence sent batch contains a missing, acknowledged, or cross-partition sequence.',
        );
      }
      const lastSequence = sequences.reduce((maximum, sequence) =>
        BigInt(sequence) > BigInt(maximum) ? sequence : maximum,
      );
      await client.query(
        `UPDATE evidence_export_state SET last_sent_sequence=GREATEST(
           COALESCE(last_sent_sequence,0),$1::bigint),observed_at=$2
         WHERE export_id=$3 AND source_partition=$4`,
        [lastSequence, observedAt, lease.exportId, lease.sourcePartition],
      );
    });
  }

  async acknowledge(
    lease: EvidenceExportLease,
    lastAcknowledgedSequence: string,
    acknowledgedAt: string,
  ): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      const state = await client.query<{
        last_sent_sequence: string | null;
        last_acknowledged_sequence: string | null;
      }>(
        `SELECT last_sent_sequence::text,last_acknowledged_sequence::text
         FROM evidence_export_state
         WHERE export_id=$1 AND source_partition=$2 AND lease_owner=$3 AND lease_token=$4
           AND fencing_token=$5::bigint AND lease_expires_at>$6 FOR UPDATE`,
        [
          lease.exportId,
          lease.sourcePartition,
          lease.owner,
          lease.token,
          lease.fencingToken,
          acknowledgedAt,
        ],
      );
      const row = state.rows[0];
      if (row === undefined) throw leaseNotOwned();
      const acknowledged = BigInt(lastAcknowledgedSequence);
      const sent = row.last_sent_sequence === null ? -1n : BigInt(row.last_sent_sequence);
      const previous =
        row.last_acknowledged_sequence === null ? -1n : BigInt(row.last_acknowledged_sequence);
      if (acknowledged > sent || acknowledged < previous) {
        throw new EvidencePersistenceError(
          'EVIDENCE_ACK_INVALID',
          'Evidence ACK exceeded the sent boundary or regressed.',
        );
      }
      const skipped = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM evidence_outbox
         WHERE source_partition=$1 AND sequence<=$2::bigint AND acknowledged_at IS NULL
           AND (sent_export_id IS DISTINCT FROM $3 OR sent_fencing_token IS DISTINCT FROM $4::bigint)`,
        [lease.sourcePartition, lastAcknowledgedSequence, lease.exportId, lease.fencingToken],
      );
      if (skipped.rows[0]?.count !== '0') {
        throw new EvidencePersistenceError(
          'EVIDENCE_ACK_INVALID',
          'Evidence ACK cannot skip a sequence that was not sent by the current fenced lease.',
        );
      }
      await client.query(
        `UPDATE evidence_outbox SET acknowledged_at=$1,last_error_code=NULL
         WHERE source_partition=$2 AND sequence<=$3::bigint AND acknowledged_at IS NULL
           AND sent_export_id=$4 AND sent_fencing_token=$5::bigint`,
        [
          acknowledgedAt,
          lease.sourcePartition,
          lastAcknowledgedSequence,
          lease.exportId,
          lease.fencingToken,
        ],
      );
      await client.query(
        `UPDATE evidence_export_state SET last_acknowledged_sequence=$1,
           last_acknowledged_at=$2,last_error_code=NULL,last_error_at=NULL,observed_at=$2
         WHERE export_id=$3 AND source_partition=$4`,
        [lastAcknowledgedSequence, acknowledgedAt, lease.exportId, lease.sourcePartition],
      );
    });
  }

  async saveCheckpoint(checkpoint: EvidenceSourceCheckpoint): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      const existing = await client.query<CheckpointRow>(
        `SELECT * FROM evidence_source_checkpoint
         WHERE source_family=$1 AND source_partition=$2 FOR UPDATE`,
        [checkpoint.sourceFamily, checkpoint.sourcePartition],
      );
      if (checkpointRegressed(existing.rows[0], checkpoint)) {
        throw new EvidencePersistenceError(
          'EVIDENCE_CHECKPOINT_REGRESSION',
          'Evidence source checkpoint cannot move backwards.',
        );
      }
      await client.query(
        `INSERT INTO evidence_source_checkpoint(
           source_family,source_partition,last_occurred_at,last_source_record_id,
           last_source_revision,last_payload_hash,last_projected_at,projector_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (source_family,source_partition) DO UPDATE SET
           last_occurred_at=EXCLUDED.last_occurred_at,
           last_source_record_id=EXCLUDED.last_source_record_id,
           last_source_revision=EXCLUDED.last_source_revision,
           last_payload_hash=EXCLUDED.last_payload_hash,
           last_projected_at=EXCLUDED.last_projected_at,
           projector_version=EXCLUDED.projector_version`,
        [
          checkpoint.sourceFamily,
          checkpoint.sourcePartition,
          checkpoint.lastOccurredAt ?? null,
          checkpoint.lastSourceRecordId ?? null,
          checkpoint.lastSourceRevision ?? null,
          checkpoint.lastPayloadHash ?? null,
          checkpoint.lastProjectedAt ?? null,
          checkpoint.projectorVersion,
        ],
      );
    });
  }

  async recordProjectionIssue(
    issue: EvidenceProjectionIssue,
    evaluationRole: 'required' | 'supporting' | 'diagnostic',
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO evidence_projection_issue(
         issue_id,issue_code,severity,evaluation_role,record_type,record_id,episode_id,
         source_system,source_table,source_record_id,source_partition,projector_version,
         retryable,detail,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
       ON CONFLICT (issue_id) DO NOTHING`,
      [
        issue.issueId,
        issue.issueCode,
        issue.severity,
        evaluationRole,
        issue.recordType ?? null,
        issue.recordId ?? null,
        issue.episodeId ?? null,
        issue.sourceSystem,
        issue.sourceTable,
        issue.sourceRecordId,
        issue.sourcePartition,
        issue.projectorVersion,
        issue.retryable,
        canonicalizeEvidenceJson(issue.detail),
        issue.createdAt,
      ],
    );
  }

  async recordQualityIssue(issue: EvidenceQualityIssue): Promise<void> {
    await this.#pool.query(
      `INSERT INTO evidence_quality_issue(
         issue_id,issue_code,severity,record_type,record_id,episode_id,source_system,
         source_table,source_record_id,detail,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
       ON CONFLICT (issue_id) DO NOTHING`,
      [
        issue.issueId,
        issue.issueCode,
        issue.severity,
        issue.recordType ?? null,
        issue.recordId ?? null,
        issue.episodeId ?? null,
        issue.sourceSystem,
        issue.sourceTable,
        issue.sourceRecordId,
        canonicalizeEvidenceJson(issue.detail),
        issue.createdAt,
      ],
    );
  }

  async deadLetter(
    sequence: string,
    issueCode: EvidenceIssueCode,
    detail: Readonly<Record<string, EvidenceJsonValue>>,
    failedAt: string,
  ): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      const record = await client.query<{
        record_id: string;
        delivery_attempts: number;
      }>(
        `SELECT record_id,delivery_attempts::integer FROM evidence_outbox
         WHERE sequence=$1::bigint FOR UPDATE`,
        [sequence],
      );
      const row = record.rows[0];
      if (row === undefined) throw new Error('EVIDENCE_DEAD_LETTER_RECORD_MISSING');
      const attempts = Math.max(1, row.delivery_attempts);
      await client.query(
        `UPDATE evidence_outbox SET delivery_attempts=$1,last_error_code=$2
         WHERE sequence=$3::bigint`,
        [attempts, issueCode, sequence],
      );
      await client.query(
        `INSERT INTO evidence_dead_letter(
           dead_letter_id,sequence,record_id,issue_code,attempts,detail,failed_at)
         VALUES ($1,$2::bigint,$3,$4,$5,$6::jsonb,$7)
         ON CONFLICT (sequence) DO UPDATE SET
           issue_code=EXCLUDED.issue_code,attempts=EXCLUDED.attempts,
           detail=EXCLUDED.detail,failed_at=EXCLUDED.failed_at`,
        [
          `dead-letter:${sequence}`,
          sequence,
          row.record_id,
          issueCode,
          attempts,
          canonicalizeEvidenceJson(detail),
          failedAt,
        ],
      );
    });
  }

  async saveManifest(manifest: EpisodeEvidenceManifest): Promise<void> {
    await this.#pool.query(
      `INSERT INTO episode_evidence_manifest(
         manifest_id,episode_id,task_id,terminal_outcome_id,expected_required_records,
         projected_required_records,pending_required_records,failed_required_records,
         expected_families,completed_families,missing_families,source_coverage,
         last_evidence_sequence,status,quality_issue_ids,created_at,sealed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,
         $13::bigint,$14,$15::jsonb,$16,$17)
       ON CONFLICT (manifest_id) DO UPDATE SET
         projected_required_records=EXCLUDED.projected_required_records,
         pending_required_records=EXCLUDED.pending_required_records,
         failed_required_records=EXCLUDED.failed_required_records,
         completed_families=EXCLUDED.completed_families,
         missing_families=EXCLUDED.missing_families,source_coverage=EXCLUDED.source_coverage,
         last_evidence_sequence=EXCLUDED.last_evidence_sequence,status=EXCLUDED.status,
         quality_issue_ids=EXCLUDED.quality_issue_ids,sealed_at=EXCLUDED.sealed_at`,
      [
        manifest.manifestId,
        manifest.episodeId,
        manifest.taskId,
        manifest.terminalOutcomeId,
        manifest.expectedRequiredRecords,
        manifest.projectedRequiredRecords,
        manifest.pendingRequiredRecords,
        manifest.failedRequiredRecords,
        JSON.stringify(manifest.expectedFamilies),
        JSON.stringify(manifest.completedFamilies),
        JSON.stringify(manifest.missingFamilies),
        canonicalizeEvidenceJson(manifest.sourceCoverage),
        manifest.lastEvidenceSequence,
        manifest.status,
        JSON.stringify(manifest.qualityIssueIds),
        manifest.createdAt,
        manifest.sealedAt ?? null,
      ],
    );
  }

  async #assertBelowHighWatermark(client: PoolClient, evaluationRole: string): Promise<void> {
    const active = await client.query<{ export_id: string; max_pending: string }>(
      `SELECT export_id,
         COALESCE(definition->'outboxPolicy'->>'maxPendingRecords','10000') AS max_pending
       FROM evidence_export_configuration WHERE is_active`,
    );
    const configuration = active.rows[0];
    if (configuration === undefined) return;
    const count = await client.query<{ pending: string }>(
      'SELECT count(*)::text AS pending FROM evidence_outbox WHERE acknowledged_at IS NULL',
    );
    if (BigInt(count.rows[0]?.pending ?? '0') < BigInt(configuration.max_pending)) return;
    throw new EvidencePersistenceError(
      'EVIDENCE_OUTBOX_HIGH_WATERMARK',
      `${evaluationRole} evidence capture reached the configured durable high watermark.`,
    );
  }

  async #recordHighWatermark(observedAt: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO evidence_export_state(
         export_id,source_partition,status,last_error_code,last_error_at,observed_at)
       SELECT export_id,'all','high_watermark','EVIDENCE_OUTBOX_HIGH_WATERMARK',$1,$1
       FROM evidence_export_configuration WHERE is_active
       ON CONFLICT (export_id,source_partition) DO UPDATE SET
         status='high_watermark',last_error_code='EVIDENCE_OUTBOX_HIGH_WATERMARK',
         last_error_at=EXCLUDED.last_error_at,observed_at=EXCLUDED.observed_at`,
      [observedAt],
    );
  }
}

interface EvidenceOutboxRow extends QueryResultRow {
  readonly sequence_text: string;
  readonly source_partition: string;
  readonly record_id: string;
  readonly record_family: CanonicalEvidenceEnvelope['recordFamily'];
  readonly record_type: string;
  readonly schema_name: string;
  readonly schema_version: number;
  readonly source_system: CanonicalEvidenceEnvelope['sourceSystem'];
  readonly source_table: string;
  readonly source_record_id: string;
  readonly source_revision: string;
  readonly tenant_id: string | null;
  readonly user_scope_id: string | null;
  readonly project_id: string | null;
  readonly environment: string;
  readonly task_id: string | null;
  readonly context_id: string | null;
  readonly episode_id: string | null;
  readonly run_id: string | null;
  readonly goal_id: string | null;
  readonly goal_version: number | null;
  readonly plan_id: string | null;
  readonly plan_version: number | null;
  readonly skill_execution_id: string | null;
  readonly capability_binding_id: string | null;
  readonly remote_task_binding_id: string | null;
  readonly node_id: string | null;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly delivery_guarantee: CanonicalEvidenceEnvelope['deliveryGuarantee'];
  readonly evaluation_role: CanonicalEvidenceEnvelope['evaluationRole'];
  readonly occurred_at: Date | string;
  readonly recorded_at: Date | string;
  readonly evidence_refs: readonly string[];
  readonly artifact_refs: readonly string[];
  readonly payload: EvidenceJsonValue;
  readonly payload_hash: `sha256:${string}`;
  readonly delivery_attempts_value: number;
  readonly next_attempt_at: Date | string;
}

interface CheckpointRow extends QueryResultRow {
  readonly last_occurred_at: Date | string | null;
  readonly last_source_record_id: string | null;
  readonly last_source_revision: string | null;
}

function toStoredEvidenceRecord(row: EvidenceOutboxRow): StoredEvidenceRecord {
  const optional = compact({
    tenantId: row.tenant_id,
    userScopeId: row.user_scope_id,
    projectId: row.project_id,
    taskId: row.task_id,
    contextId: row.context_id,
    episodeId: row.episode_id,
    runId: row.run_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    planId: row.plan_id,
    planVersion: row.plan_version,
    skillExecutionId: row.skill_execution_id,
    capabilityBindingId: row.capability_binding_id,
    remoteTaskBindingId: row.remote_task_binding_id,
    nodeId: row.node_id,
    causationId: row.causation_id,
  });
  return Object.freeze({
    sequence: row.sequence_text,
    sourcePartition: row.source_partition,
    envelope: Object.freeze({
      contractVersion: 'sdar.evidence/v1',
      schemaName: row.schema_name,
      schemaVersion: 1,
      recordFamily: row.record_family,
      recordType: row.record_type,
      recordId: row.record_id,
      sourceSystem: row.source_system,
      sourceTable: row.source_table,
      sourceRecordId: row.source_record_id,
      sourceRevision: row.source_revision,
      environment: row.environment,
      correlationId: row.correlation_id,
      occurredAt: iso(row.occurred_at),
      recordedAt: iso(row.recorded_at),
      deliveryGuarantee: row.delivery_guarantee,
      evaluationRole: row.evaluation_role,
      evidenceSequence: row.sequence_text,
      evidenceRefs: Object.freeze([...row.evidence_refs]),
      artifactRefs: Object.freeze([...row.artifact_refs]),
      payloadHash: row.payload_hash,
      payload: structuredClone(row.payload),
      ...optional,
    }),
    deliveryAttempts: row.delivery_attempts_value,
    nextAttemptAt: iso(row.next_attempt_at),
  });
}

function checkpointRegressed(
  existing: CheckpointRow | undefined,
  next: EvidenceSourceCheckpoint,
): boolean {
  if (!existing?.last_occurred_at) return false;
  if (next.lastOccurredAt === undefined) return true;
  const timeDelta =
    new Date(next.lastOccurredAt).getTime() - new Date(existing.last_occurred_at).getTime();
  if (timeDelta !== 0) return timeDelta < 0;
  const idDelta = (next.lastSourceRecordId ?? '').localeCompare(
    existing.last_source_record_id ?? '',
  );
  if (idDelta !== 0) return idDelta < 0;
  return (next.lastSourceRevision ?? '').localeCompare(existing.last_source_revision ?? '') < 0;
}

function compact(
  values: Readonly<Record<string, string | number | null>>,
): Readonly<Record<string, string | number>> {
  return Object.fromEntries(Object.entries(values).filter((entry) => entry[1] !== null)) as Record<
    string,
    string | number
  >;
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function leaseNotOwned(): EvidencePersistenceError {
  return new EvidencePersistenceError(
    'EVIDENCE_LEASE_NOT_OWNED',
    'Evidence export lease is expired, fenced, or owned by another worker.',
  );
}

function required(value: string | undefined, code: string): string {
  if (value === undefined) throw new Error(code);
  return value;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
