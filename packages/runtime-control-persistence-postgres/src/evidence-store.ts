import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  EPISODE_EVIDENCE_POLICY_VERSION,
  canonicalizeEvidenceJson,
  hashCanonicalEvidenceJson,
  type CanonicalEvidenceEnvelope,
  type EpisodeEvidenceManifest,
  type EpisodeEvidenceRecordPolicy,
  type EvidenceExpectedRecord,
  type EvidenceExportConfiguration,
  type EvidenceIssueCode,
  type EvidenceJsonValue,
  type EvidenceProjectionIssue,
  type EvidenceQualityRuleId,
  type EvidenceQualityIssue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';

export type EvidencePersistenceErrorCode =
  | 'EVIDENCE_CONFIGURATION_CONFLICT'
  | 'EVIDENCE_CONFIGURATION_STALE'
  | 'EVIDENCE_DELIVERY_ORIGIN_CONFLICT'
  | 'EVIDENCE_OUTBOX_HIGH_WATERMARK'
  | 'EVIDENCE_PAYLOAD_HASH_CONFLICT'
  | 'EVIDENCE_REFERENCE_NOT_FOUND'
  | 'EVIDENCE_REFERENCE_SCOPE_CONFLICT'
  | 'EVIDENCE_SOURCE_IDENTITY_CONFLICT'
  | 'EVIDENCE_LEASE_NOT_OWNED'
  | 'EVIDENCE_ACK_INVALID'
  | 'EVIDENCE_CHECKPOINT_REGRESSION'
  | 'EVIDENCE_EXPECTATION_POLICY_INVALID'
  | 'EVIDENCE_ISSUE_IDENTITY_CONFLICT'
  | 'EVIDENCE_MANIFEST_IDENTITY_CONFLICT'
  | 'EVIDENCE_MANIFEST_REVISION_CONFLICT'
  | 'EVIDENCE_MANIFEST_SNAPSHOT_CONFLICT'
  | 'EVIDENCE_RECOVERY_CONFLICT'
  | 'EVIDENCE_RECOVERY_CONFIGURATION_STALE';

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

export interface EpisodeEvidenceCoverageSnapshot {
  readonly expectedRecords: readonly EvidenceExpectedRecord[];
  readonly qualityIssues: readonly EvidenceQualityIssue[];
  readonly lastEvidenceSequence: string;
  readonly sourceSnapshotHash: `sha256:${string}`;
  readonly previousManifest?: EpisodeEvidenceManifest;
}

export interface TerminalEpisodeCoverageCandidate {
  readonly episodeId: string;
  readonly taskId: string;
  readonly terminalOutcomeId: string;
  readonly sealRequested: boolean;
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
      const origin = await client.query<{ delivery_start: string }>(
        'SELECT delivery_start FROM evidence_export_delivery_origin WHERE export_id=$1',
        [configuration.exportId],
      );
      const deliveryStart = configuration.deliveryStart ?? 'retained';
      if (origin.rows[0] !== undefined && origin.rows[0].delivery_start !== deliveryStart) {
        throw new EvidencePersistenceError(
          'EVIDENCE_DELIVERY_ORIGIN_CONFLICT',
          'An export delivery origin cannot change after first activation.',
        );
      }
      // Wait for in-flight inserts, then exclude precisely the committed prefix. Holding SHARE
      // until commit also prevents a concurrent append from falling into the activation gap.
      if (origin.rows[0] === undefined && deliveryStart === 'from_activation') {
        await client.query('LOCK TABLE evidence_outbox IN SHARE MODE');
      }
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
      if (origin.rows[0] === undefined) {
        await client.query(
          `INSERT INTO evidence_export_delivery_origin
             (export_id,first_revision,delivery_start,start_sequence,activated_at)
           SELECT $1,$2,$3,CASE WHEN $3='from_activation' THEN COALESCE(max(sequence),0) ELSE 0 END,$4
           FROM evidence_outbox`,
          [configuration.exportId, configuration.revision, deliveryStart, appliedAt],
        );
      }
      await clearHighWatermarkWithinTransaction(client, configuration.exportId, appliedAt);
    });
  }

  async hasRecord(recordId: string): Promise<boolean> {
    const result = await this.#pool.query<{ present: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM evidence_outbox WHERE record_id=$1) AS present',
      [recordId],
    );
    return result.rows[0]?.present === true;
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

    if (envelope.evidenceRefs.length > 0) {
      const references = await client.query<{
        record_id: string;
        tenant_id: string | null;
        user_scope_id: string | null;
      }>(
        `SELECT record_id,tenant_id,user_scope_id FROM evidence_outbox
         WHERE record_id=ANY($1::text[])`,
        [envelope.evidenceRefs],
      );
      const tenantId = envelope.tenantId ?? null;
      const userScopeId = envelope.userScopeId ?? null;
      if (
        references.rows.some(
          (reference) =>
            (reference.tenant_id !== null &&
              tenantId !== null &&
              reference.tenant_id !== tenantId) ||
            (userScopeId !== null &&
              reference.user_scope_id !== null &&
              reference.user_scope_id !== userScopeId),
        )
      ) {
        throw new EvidencePersistenceError(
          'EVIDENCE_REFERENCE_SCOPE_CONFLICT',
          'Evidence references cannot cross tenant or user-scope authority boundaries.',
        );
      }
    }

    const forwardReferences = await client.query<{
      record_id: string;
      tenant_id: string | null;
      user_scope_id: string | null;
    }>(
      `SELECT record_id,tenant_id,user_scope_id FROM evidence_outbox
       WHERE evidence_refs ? $1`,
      [envelope.recordId],
    );
    const tenantId = envelope.tenantId ?? null;
    const userScopeId = envelope.userScopeId ?? null;
    if (
      forwardReferences.rows.some(
        (reference) =>
          (reference.tenant_id !== null && tenantId !== null && reference.tenant_id !== tenantId) ||
          (userScopeId !== null &&
            reference.user_scope_id !== null &&
            reference.user_scope_id !== userScopeId),
      )
    ) {
      throw new EvidencePersistenceError(
        'EVIDENCE_REFERENCE_SCOPE_CONFLICT',
        'Evidence references cannot cross tenant or user-scope authority boundaries.',
      );
    }

    await this.#assertBelowHighWatermark(
      client,
      envelope.evaluationRole,
      envelope.recordFamily,
      envelope.recordType,
    );
    try {
      const inserted = await client.query<{ sequence: string }>(
        `INSERT INTO evidence_outbox(
           record_id,record_family,record_type,schema_name,schema_version,
           source_system,source_table,source_record_id,source_revision,source_partition,
           tenant_id,user_scope_id,project_id,environment,task_id,context_id,episode_id,run_id,
           goal_id,goal_version,plan_id,plan_version,skill_execution_id,capability_binding_id,
           remote_task_binding_id,node_id,correlation_id,causation_id,delivery_guarantee,
           evaluation_role,observation_generation,occurred_at,recorded_at,evidence_refs,
           artifact_refs,payload,payload_hash,captured_at,next_attempt_at)
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
           $29,$30,$31,$32,$33,$34::jsonb,$35::jsonb,$36::jsonb,$37,$38,$38)
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
          envelope.observationGeneration ?? 0,
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
         AND NOT EXISTS (
           SELECT 1 FROM evidence_dead_letter
           WHERE evidence_dead_letter.sequence=evidence_outbox.sequence
             AND evidence_dead_letter.requeued_at IS NULL)
         AND EXISTS (
           SELECT 1 FROM evidence_export_configuration configuration
           WHERE configuration.is_active
             AND evidence_outbox.sequence > evidence_delivery_start_sequence(configuration.export_id)
             AND configuration.definition->'includedFamilies' ? evidence_outbox.record_family
             AND NOT (
               evidence_outbox.evaluation_role='diagnostic'
               AND COALESCE(
                 configuration.definition->'excludedDiagnosticTypes','[]'::jsonb
               ) ? evidence_outbox.record_type
             )
         )
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
         WHERE source_partition=$4 AND sequence=ANY($5::bigint[]) AND acknowledged_at IS NULL
           AND sequence > evidence_delivery_start_sequence($1)`,
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
    await withTransaction(this.#pool, (client) =>
      this.acknowledgeWithinTransaction(client, lease, lastAcknowledgedSequence, acknowledgedAt),
    );
  }

  async acknowledgeWithinTransaction(
    client: PoolClient,
    lease: EvidenceExportLease,
    lastAcknowledgedSequence: string,
    acknowledgedAt: string,
  ): Promise<void> {
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
    const origin = await client.query<{ start_sequence: string }>(
      'SELECT evidence_delivery_start_sequence($1)::text AS start_sequence',
      [lease.exportId],
    );
    if (acknowledged <= BigInt(origin.rows[0]?.start_sequence ?? '0')) {
      throw new EvidencePersistenceError(
        'EVIDENCE_ACK_INVALID',
        'ACK is outside the delivery range.',
      );
    }
    if (acknowledged > sent || acknowledged < previous) {
      throw new EvidencePersistenceError(
        'EVIDENCE_ACK_INVALID',
        'Evidence ACK exceeded the sent boundary or regressed.',
      );
    }
    const skipped = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM evidence_outbox
         WHERE source_partition=$1 AND sequence<=$2::bigint AND acknowledged_at IS NULL
           AND sequence > evidence_delivery_start_sequence($3)
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
           AND sequence > evidence_delivery_start_sequence($4)
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
    await clearHighWatermarkWithinTransaction(client, lease.exportId, acknowledgedAt);
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
    ruleId?: EvidenceQualityRuleId,
  ): Promise<void> {
    const result = await this.#pool.query(
      `INSERT INTO evidence_projection_issue(
         issue_id,issue_code,severity,evaluation_role,record_type,record_id,episode_id,
         source_system,source_table,source_record_id,source_partition,projector_version,
         retryable,detail,created_at,rule_id,first_observed_at,last_observed_at,revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$15,$15,1)
       ON CONFLICT (issue_id) DO UPDATE SET
         issue_code=EXCLUDED.issue_code,
         severity=EXCLUDED.severity,
         evaluation_role=EXCLUDED.evaluation_role,
         record_type=EXCLUDED.record_type,
         record_id=EXCLUDED.record_id,
         episode_id=EXCLUDED.episode_id,
         retryable=EXCLUDED.retryable,
         detail=EXCLUDED.detail,
         last_observed_at=GREATEST(
           evidence_projection_issue.last_observed_at,
           EXCLUDED.last_observed_at
         ),
         revision=CASE WHEN evidence_projection_issue.resolved_at IS NULL
           AND evidence_projection_issue.issue_code=EXCLUDED.issue_code
           AND evidence_projection_issue.severity=EXCLUDED.severity
           AND evidence_projection_issue.evaluation_role=EXCLUDED.evaluation_role
           AND evidence_projection_issue.record_type IS NOT DISTINCT FROM EXCLUDED.record_type
           AND evidence_projection_issue.record_id IS NOT DISTINCT FROM EXCLUDED.record_id
           AND evidence_projection_issue.episode_id IS NOT DISTINCT FROM EXCLUDED.episode_id
           AND evidence_projection_issue.retryable=EXCLUDED.retryable
           AND evidence_projection_issue.detail=EXCLUDED.detail
           THEN evidence_projection_issue.revision ELSE evidence_projection_issue.revision+1 END,
         resolved_at=NULL
       WHERE evidence_projection_issue.rule_id IS NOT DISTINCT FROM EXCLUDED.rule_id
         AND evidence_projection_issue.source_system=EXCLUDED.source_system
         AND evidence_projection_issue.source_table=EXCLUDED.source_table
         AND evidence_projection_issue.source_record_id=EXCLUDED.source_record_id
         AND evidence_projection_issue.source_partition=EXCLUDED.source_partition
         AND evidence_projection_issue.projector_version=EXCLUDED.projector_version
       RETURNING issue_id`,
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
        ruleId ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new EvidencePersistenceError(
        'EVIDENCE_ISSUE_IDENTITY_CONFLICT',
        `Projection issue ${issue.issueId} conflicts with its immutable source identity.`,
      );
    }
  }

  async resolveProjectionIssue(input: {
    readonly issueId: string;
    readonly sourcePartition: string;
    readonly projectorVersion: string;
    readonly resolvedAt: string;
  }): Promise<void> {
    await this.#pool.query(
      `UPDATE evidence_projection_issue
       SET resolved_at=$4,last_observed_at=GREATEST(last_observed_at,$4::timestamptz),
           revision=revision+1
       WHERE issue_id=$1
         AND source_partition=$2
         AND projector_version=$3
         AND resolved_at IS NULL`,
      [input.issueId, input.sourcePartition, input.projectorVersion, input.resolvedAt],
    );
  }

  async resolveQualityIssues(input: {
    readonly episodeId: string;
    readonly recordTypePrefix: string;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }): Promise<void> {
    await this.#pool.query(
      `UPDATE evidence_quality_issue
       SET resolved_at=$4,last_observed_at=GREATEST(last_observed_at,$4::timestamptz),
           revision=revision+1
       WHERE episode_id=$1
         AND record_type LIKE $2 || '%'
         AND resolved_at IS NULL
         AND NOT (issue_id = ANY($3::text[]))`,
      [input.episodeId, input.recordTypePrefix, input.retainedIssueIds, input.resolvedAt],
    );
  }

  async resolveQualityIssue(input: {
    readonly issueId: string;
    readonly ruleId?: EvidenceQualityRuleId;
    readonly resolvedAt: string;
  }): Promise<void> {
    await this.#pool.query(
      `UPDATE evidence_quality_issue
       SET resolved_at=$3,last_observed_at=GREATEST(last_observed_at,$3::timestamptz),
           revision=revision+1
       WHERE issue_id=$1 AND rule_id IS NOT DISTINCT FROM $2::text AND resolved_at IS NULL`,
      [input.issueId, input.ruleId ?? null, validTimestamp(input.resolvedAt, 'resolvedAt')],
    );
  }

  async resolveQualityRuleIssues(input: {
    readonly ruleId: EvidenceQualityRuleId;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }): Promise<void> {
    const resolvedAt = validTimestamp(input.resolvedAt, 'resolvedAt');
    await this.#pool.query(
      `UPDATE evidence_quality_issue
       SET resolved_at=$3,last_observed_at=GREATEST(last_observed_at,$3::timestamptz),
           revision=revision+1
       WHERE rule_id=$1 AND resolved_at IS NULL
         AND NOT (issue_id=ANY($2::text[]))`,
      [input.ruleId, input.retainedIssueIds, resolvedAt],
    );
  }

  async resolveSourceQualityIssues(input: {
    readonly sourceTable: string;
    readonly sourceRecordId: string;
    readonly recordTypePrefix: string;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }): Promise<void> {
    await this.#pool.query(
      `UPDATE evidence_quality_issue
       SET resolved_at=$5,last_observed_at=GREATEST(last_observed_at,$5::timestamptz),
           revision=revision+1
       WHERE source_system='runtime'
         AND source_table=$1
         AND source_record_id=$2
         AND left(record_type,char_length($3))=$3
         AND resolved_at IS NULL
         AND NOT (issue_id = ANY($4::text[]))`,
      [
        input.sourceTable,
        input.sourceRecordId,
        input.recordTypePrefix,
        input.retainedIssueIds,
        input.resolvedAt,
      ],
    );
  }

  async recordQualityIssue(
    issue: EvidenceQualityIssue,
    ruleId?: EvidenceQualityRuleId,
  ): Promise<void> {
    const result = await this.#pool.query(
      `INSERT INTO evidence_quality_issue(
         issue_id,issue_code,severity,record_type,record_id,episode_id,source_system,
         source_table,source_record_id,detail,created_at,rule_id,first_observed_at,
         last_observed_at,revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$11,$11,1)
       ON CONFLICT (issue_id) DO UPDATE SET
         issue_code=EXCLUDED.issue_code,
         severity=EXCLUDED.severity,
         record_type=EXCLUDED.record_type,
         record_id=EXCLUDED.record_id,
         episode_id=EXCLUDED.episode_id,
         detail=EXCLUDED.detail,
         last_observed_at=CASE WHEN evidence_quality_issue.resolved_at IS NULL
           AND evidence_quality_issue.issue_code=EXCLUDED.issue_code
           AND evidence_quality_issue.severity=EXCLUDED.severity
           AND evidence_quality_issue.record_type IS NOT DISTINCT FROM EXCLUDED.record_type
           AND evidence_quality_issue.record_id IS NOT DISTINCT FROM EXCLUDED.record_id
           AND evidence_quality_issue.episode_id IS NOT DISTINCT FROM EXCLUDED.episode_id
           AND evidence_quality_issue.detail=EXCLUDED.detail
           THEN evidence_quality_issue.last_observed_at
           ELSE GREATEST(evidence_quality_issue.last_observed_at,EXCLUDED.last_observed_at) END,
         revision=CASE WHEN evidence_quality_issue.resolved_at IS NULL
           AND evidence_quality_issue.issue_code=EXCLUDED.issue_code
           AND evidence_quality_issue.severity=EXCLUDED.severity
           AND evidence_quality_issue.record_type IS NOT DISTINCT FROM EXCLUDED.record_type
           AND evidence_quality_issue.record_id IS NOT DISTINCT FROM EXCLUDED.record_id
           AND evidence_quality_issue.episode_id IS NOT DISTINCT FROM EXCLUDED.episode_id
           AND evidence_quality_issue.detail=EXCLUDED.detail
           THEN evidence_quality_issue.revision ELSE evidence_quality_issue.revision+1 END,
         resolved_at=NULL
       WHERE evidence_quality_issue.rule_id IS NOT DISTINCT FROM EXCLUDED.rule_id
         AND evidence_quality_issue.source_system=EXCLUDED.source_system
         AND evidence_quality_issue.source_table=EXCLUDED.source_table
         AND evidence_quality_issue.source_record_id=EXCLUDED.source_record_id
       RETURNING issue_id`,
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
        ruleId ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new EvidencePersistenceError(
        'EVIDENCE_ISSUE_IDENTITY_CONFLICT',
        `Quality issue ${issue.issueId} conflicts with its immutable source identity.`,
      );
    }
  }

  async refreshEpisodeExpectations(input: {
    readonly episodeId: string;
    readonly taskId: string;
    readonly policyRecords: readonly EpisodeEvidenceRecordPolicy[];
    readonly recomputedAt: string;
  }): Promise<EpisodeEvidenceCoverageSnapshot> {
    const episodeId = boundedText(input.episodeId, 'episodeId');
    const taskId = boundedText(input.taskId, 'taskId');
    const recomputedAt = validTimestamp(input.recomputedAt, 'recomputedAt');
    assertEpisodePolicy(input.policyRecords);

    return withAdvisoryRepeatableReadTransaction(
      this.#pool,
      `evidence.coverage:${episodeId}`,
      async (client) => {
        const authority = (
          await client.query<EpisodeAuthorityRow>(
            `SELECT to_jsonb(task) AS task_value,
             (SELECT to_jsonb(goal) FROM goal
               WHERE goal.goal_id=task.goal_id AND goal.version=task.goal_version) AS goal_value,
             (SELECT to_jsonb(contract) FROM user_goal_contract contract
               WHERE contract.goal_id=task.goal_id
                 AND contract.goal_version=task.goal_version) AS contract_value,
             (SELECT to_jsonb(plan) FROM user_goal_plan plan
               WHERE plan.plan_id=task.user_goal_plan_id) AS plan_value
           FROM agent_task task WHERE task.task_id=$1`,
            [taskId],
          )
        ).rows[0];
        const outbox = await client.query<ExpectationOutboxRow>(
          `SELECT
           record_type,source_record_id,source_revision,record_id,sequence::text AS sequence_text,
           sent_at,acknowledged_at
         FROM evidence_outbox
         WHERE observation_generation=0 AND record_type NOT LIKE 'evidence.%'
           AND (episode_id=$1 OR task_id=$2)
         ORDER BY record_type,source_record_id,sequence`,
          [episodeId, taskId],
        );
        const projectionIssues = await client.query<ExpectationProjectionIssueRow>(
          `SELECT record_type,source_record_id,issue_code,last_observed_at
         FROM evidence_projection_issue
         WHERE resolved_at IS NULL AND record_type IS NOT NULL
           AND record_type NOT LIKE 'evidence.%'
           AND (episode_id=$1 OR source_partition='runtime-core:' || $2)
         ORDER BY record_type,source_record_id,last_observed_at,issue_id`,
          [episodeId, taskId],
        );
        const outboxByType = groupByRecordType(outbox.rows);
        const issueByType = groupByRecordType(projectionIssues.rows);
        const authorityFacts = unconditionalAuthorityFacts(authority, taskId);
        const retainedExpectationIds: string[] = [];

        for (const policy of input.policyRecords) {
          if (policy.recordFamily === 'evidence') continue;
          const projectedRows = outboxByType.get(policy.recordType) ?? [];
          const issueRows = issueByType.get(policy.recordType) ?? [];
          const authorityFact = authorityFacts.get(policy.recordType);
          const authoritySourceId = authorityFact?.sourceRecordId;
          const sourceRecordIds = new Set<string>();
          if (authoritySourceId !== undefined) sourceRecordIds.add(authoritySourceId);
          for (const row of projectedRows) sourceRecordIds.add(row.source_record_id);
          for (const row of issueRows) sourceRecordIds.add(row.source_record_id);
          const instances: readonly (string | undefined)[] =
            sourceRecordIds.size === 0 ? [undefined] : [...sourceRecordIds].sort();

          for (const sourceRecordId of instances) {
            const projected = latestOutboxForSource(projectedRows, sourceRecordId);
            const issue = latestIssueForSource(issueRows, sourceRecordId);
            const exactAuthoritySourceId =
              authoritySourceId === sourceRecordId ? authoritySourceId : undefined;
            const exactAuthorityRevision =
              authoritySourceId === sourceRecordId ? authorityFact?.sourceRevision : undefined;
            const applicable =
              policy.requirementLevel === 'required' ||
              projected !== undefined ||
              issue !== undefined;
            const stage = expectationStage({
              ...(projected === undefined ? {} : { projected }),
              ...(issue === undefined ? {} : { issue }),
              ...(exactAuthoritySourceId === undefined
                ? {}
                : { authoritySourceId: exactAuthoritySourceId }),
              ...(exactAuthorityRevision === undefined
                ? {}
                : { authoritySourceRevision: exactAuthorityRevision }),
            });
            const expectationId = `expectation_${hashCanonicalEvidenceJson([
              EPISODE_EVIDENCE_POLICY_VERSION,
              episodeId,
              policy.recordType,
              sourceRecordId === undefined ? { sourceFactMissing: true } : { sourceRecordId },
            ]).slice('sha256:'.length)}`;
            retainedExpectationIds.push(expectationId);
            await client.query(
              `INSERT INTO evidence_expected_record(
             expectation_id,episode_id,task_id,policy_version,record_type,record_family,
             source_system,source_table,evaluation_role,requirement_level,applicable,stage,
             source_record_id,source_revision,record_id,evidence_sequence,revision,expected_at,recomputed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::bigint,1,$17,$17)
           ON CONFLICT (episode_id,policy_version,record_type,source_record_id) DO UPDATE SET
             task_id=EXCLUDED.task_id,
             record_family=EXCLUDED.record_family,
             source_system=EXCLUDED.source_system,
             source_table=EXCLUDED.source_table,
             evaluation_role=EXCLUDED.evaluation_role,
             requirement_level=EXCLUDED.requirement_level,
             applicable=EXCLUDED.applicable,
             stage=EXCLUDED.stage,
             source_record_id=EXCLUDED.source_record_id,
             source_revision=EXCLUDED.source_revision,
             record_id=EXCLUDED.record_id,
             evidence_sequence=EXCLUDED.evidence_sequence,
             revision=CASE WHEN ROW(
               evidence_expected_record.task_id,evidence_expected_record.record_family,
               evidence_expected_record.source_system,evidence_expected_record.source_table,
               evidence_expected_record.evaluation_role,evidence_expected_record.requirement_level,
               evidence_expected_record.applicable,evidence_expected_record.stage,
               evidence_expected_record.source_record_id,evidence_expected_record.source_revision,
               evidence_expected_record.record_id,
               evidence_expected_record.evidence_sequence
             ) IS DISTINCT FROM ROW(
               EXCLUDED.task_id,EXCLUDED.record_family,EXCLUDED.source_system,EXCLUDED.source_table,
               EXCLUDED.evaluation_role,EXCLUDED.requirement_level,EXCLUDED.applicable,EXCLUDED.stage,
               EXCLUDED.source_record_id,EXCLUDED.source_revision,EXCLUDED.record_id,
               EXCLUDED.evidence_sequence
             ) THEN evidence_expected_record.revision+1 ELSE evidence_expected_record.revision END,
             recomputed_at=EXCLUDED.recomputed_at`,
              [
                expectationId,
                episodeId,
                taskId,
                EPISODE_EVIDENCE_POLICY_VERSION,
                policy.recordType,
                policy.recordFamily,
                policy.sourceSystem,
                policy.sourceTable,
                policy.evaluationRole,
                policy.requirementLevel,
                applicable,
                stage,
                sourceRecordId ?? null,
                exactAuthorityRevision ?? projected?.source_revision ?? null,
                projected?.record_id ?? null,
                projected?.sequence_text ?? null,
                recomputedAt,
              ],
            );
          }
        }

        await client.query(
          `DELETE FROM evidence_expected_record
         WHERE episode_id=$1 AND policy_version=$2 AND NOT (expectation_id=ANY($3::text[]))`,
          [episodeId, EPISODE_EVIDENCE_POLICY_VERSION, retainedExpectationIds],
        );
        const expectedRecords = await listExpectedRecordsWithClient(client, episodeId);
        const qualityIssues = Object.freeze(
          [
            ...(await listOpenQualityIssuesWithClient(client, episodeId, true)),
            ...(await listOpenCoverageProjectionIssuesWithClient(client, episodeId)),
          ].sort((left, right) => left.issueId.localeCompare(right.issueId)),
        );
        const lastSequence = await client.query<{ sequence_text: string }>(
          `SELECT COALESCE(max(sequence),0)::text AS sequence_text
         FROM evidence_outbox
         WHERE observation_generation=0 AND record_type NOT LIKE 'evidence.%'
           AND (episode_id=$1 OR task_id=$2)`,
          [episodeId, taskId],
        );
        const lastEvidenceSequence = lastSequence.rows[0]?.sequence_text ?? '0';
        const expectationState = await client.query<ExpectationStateRow>(
          `SELECT expectation_id,record_type,source_record_id,source_revision,record_id,
           evidence_sequence::text AS evidence_sequence_text,applicable,stage
         FROM evidence_expected_record WHERE episode_id=$1
         ORDER BY record_type,source_record_id NULLS FIRST`,
          [episodeId],
        );
        const sourceSnapshotHash = hashCanonicalEvidenceJson({
          policyVersion: EPISODE_EVIDENCE_POLICY_VERSION,
          expectedRecords: expectationState.rows,
          qualityIssues: qualityIssues.map((issue) => ({
            issueId: issue.issueId,
            issueCode: issue.issueCode,
            severity: issue.severity,
            recordType: issue.recordType ?? null,
            recordId: issue.recordId ?? null,
            sourceSystem: issue.sourceSystem,
            sourceTable: issue.sourceTable,
            sourceRecordId: issue.sourceRecordId,
            detail: issue.detail,
          })),
          lastEvidenceSequence,
        });
        const previousManifest = await loadManifestWithClient(client, episodeId);
        return Object.freeze({
          expectedRecords,
          qualityIssues,
          lastEvidenceSequence,
          sourceSnapshotHash,
          ...(previousManifest === undefined ? {} : { previousManifest }),
        });
      },
    );
  }

  async listExpectedRecords(episodeId?: string): Promise<readonly EvidenceExpectedRecord[]> {
    return listExpectedRecordsWithClient(
      this.#pool,
      episodeId === undefined ? undefined : boundedText(episodeId, 'episodeId'),
    );
  }

  async listOpenEpisodeQualityIssues(episodeId: string): Promise<readonly EvidenceQualityIssue[]> {
    return listOpenQualityIssuesWithClient(this.#pool, boundedText(episodeId, 'episodeId'));
  }

  async loadManifest(episodeId: string): Promise<EpisodeEvidenceManifest | undefined> {
    return loadManifestWithClient(this.#pool, boundedText(episodeId, 'episodeId'));
  }

  async pendingTerminalEpisodes(
    limit: number,
  ): Promise<readonly TerminalEpisodeCoverageCandidate[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('EVIDENCE_COVERAGE_PENDING_LIMIT_INVALID');
    }
    const result = await this.#pool.query<TerminalEpisodeCoverageRow>(
      `WITH candidate AS (
         SELECT outcome.task_id AS episode_id,outcome.task_id,outcome.outcome_id,
           outcome.committed_at,manifest.recomputed_at,
           (
             (EXISTS (
               SELECT 1 FROM evidence_source_checkpoint checkpoint
               WHERE checkpoint.source_family='runtime'
                 AND checkpoint.source_partition='runtime-core:' || outcome.task_id
                 AND checkpoint.projector_version='runtime-core/v1'
             ) OR EXISTS (
               SELECT 1 FROM evidence_projection_issue issue
               WHERE issue.episode_id=outcome.task_id
                 AND issue.source_partition='runtime-core:' || outcome.task_id
                 AND issue.projector_version='runtime-core/v1'
                 AND issue.evaluation_role='required' AND issue.resolved_at IS NULL
             ))
              AND (
                NOT (
                 EXISTS (SELECT 1 FROM agent_task task WHERE task.task_id=outcome.task_id AND task.skill_selection_id IS NOT NULL)
                 OR EXISTS (SELECT 1 FROM skill_input_resolution resolution WHERE resolution.task_id=outcome.task_id)
                 OR EXISTS (SELECT 1 FROM skill_execution_record execution WHERE execution.task_id=outcome.task_id)
               ) OR EXISTS (
                 SELECT 1 FROM evidence_source_checkpoint checkpoint
                 WHERE checkpoint.source_family='skill'
                   AND checkpoint.source_partition='skill:' || outcome.task_id
                   AND checkpoint.projector_version='skill/v1'
               ) OR EXISTS (
                 SELECT 1 FROM evidence_projection_issue issue
                 WHERE issue.episode_id=outcome.task_id
                   AND issue.source_partition='skill:' || outcome.task_id
                   AND issue.projector_version='skill/v1'
                   AND issue.evaluation_role='required' AND issue.resolved_at IS NULL
               )
             )
             AND (
               NOT (
                 EXISTS (SELECT 1 FROM mcp_invocation invocation WHERE invocation.task_id=outcome.task_id)
                 OR EXISTS (SELECT 1 FROM task_capability_binding binding WHERE binding.task_id=outcome.task_id)
                 OR EXISTS (
                   SELECT 1 FROM task_availability_snapshot snapshot
                   JOIN task_execution_readiness readiness ON readiness.readiness_id=snapshot.readiness_id
                   JOIN workflow_control control ON control.current_plan_id=readiness.workflow_plan_id
                   WHERE control.task_id=outcome.task_id
                 )
               ) OR EXISTS (
                 SELECT 1 FROM evidence_source_checkpoint checkpoint
                 WHERE checkpoint.source_family='mcp-capability'
                   AND checkpoint.source_partition='mcp-capability:' || outcome.task_id
                   AND checkpoint.projector_version='1.4.1'
               ) OR EXISTS (
                 SELECT 1 FROM evidence_projection_issue issue
                 WHERE issue.episode_id=outcome.task_id
                   AND issue.source_partition='mcp-capability:' || outcome.task_id
                   AND issue.projector_version='1.4.1'
                   AND issue.evaluation_role='required' AND issue.resolved_at IS NULL
               )
             )
             AND (
               NOT (
                 EXISTS (SELECT 1 FROM goal_experience_episode episode WHERE episode.task_id=outcome.task_id)
                 OR EXISTS (SELECT 1 FROM planning_correction_fact correction WHERE correction.task_id=outcome.task_id)
                 OR EXISTS (SELECT 1 FROM planning_interaction_episode interaction WHERE interaction.task_id=outcome.task_id)
               ) OR EXISTS (
                 SELECT 1 FROM evidence_source_checkpoint checkpoint
                 WHERE checkpoint.source_family='experience'
                   AND checkpoint.source_partition='v141:experience_task:' || length(outcome.task_id)::text || ':' || outcome.task_id
                   AND checkpoint.projector_version='1.4.1-phase8.2'
               ) OR EXISTS (
                 SELECT 1 FROM evidence_projection_issue issue
                 WHERE issue.episode_id=outcome.task_id
                   AND issue.source_partition='v141:experience_task:' || length(outcome.task_id)::text || ':' || outcome.task_id
                   AND issue.projector_version='1.4.1-phase8.2'
                  AND issue.evaluation_role='required' AND issue.resolved_at IS NULL
                )
              )
              AND NOT EXISTS (
                SELECT 1 FROM evidence_projection_issue issue
                WHERE issue.resolved_at IS NULL AND issue.evaluation_role='required'
                  AND issue.projector_version IN (
                    'runtime-core/v1','skill/v1','1.4.1','1.4.1-phase8.2'
                  )
                  AND (
                    issue.episode_id=outcome.task_id
                    OR (
                      issue.episode_id IS NULL
                      AND issue.detail->>'failureStage'='source_listing'
                    )
                  )
              )
            ) AS seal_requested
         FROM runtime_terminal_outcome outcome
         LEFT JOIN episode_evidence_manifest manifest ON manifest.episode_id=outcome.task_id
         WHERE outcome.task_id IS NOT NULL AND (
           manifest.manifest_id IS NULL OR manifest.status='projecting'
           OR EXISTS (
             SELECT 1 FROM evidence_outbox evidence
             WHERE evidence.observation_generation=0
               AND evidence.record_type NOT LIKE 'evidence.%'
               AND (evidence.episode_id=outcome.task_id OR evidence.task_id=outcome.task_id)
               AND (evidence.sequence > manifest.last_evidence_sequence
                 OR evidence.sent_at > manifest.recomputed_at
                 OR evidence.acknowledged_at > manifest.recomputed_at)
           )
           OR EXISTS (
             SELECT 1 FROM evidence_quality_issue issue
             WHERE issue.episode_id=outcome.task_id AND issue.last_observed_at > manifest.recomputed_at
           )
           OR EXISTS (
             SELECT 1 FROM evidence_projection_issue issue
             WHERE (
                 issue.episode_id=outcome.task_id
                 OR (
                   issue.episode_id IS NULL
                   AND issue.evaluation_role='required'
                   AND issue.detail->>'failureStage'='source_listing'
                   AND issue.projector_version IN (
                     'runtime-core/v1','skill/v1','1.4.1','1.4.1-phase8.2'
                   )
                 )
               )
               AND issue.last_observed_at > manifest.recomputed_at
               AND (
                 (issue.resolved_at IS NULL
                   AND NOT (manifest.quality_issue_ids ? issue.issue_id))
                 OR (issue.resolved_at IS NOT NULL
                   AND (manifest.quality_issue_ids ? issue.issue_id))
               )
            )
            OR EXISTS (
              SELECT 1 FROM evidence_coverage_reconcile_target target
              JOIN evidence_recovery_run recovery
                ON recovery.recovery_run_id=target.recovery_run_id
              WHERE target.episode_id=outcome.task_id AND target.completed_at IS NULL
                AND recovery.operation='reconcile_coverage' AND recovery.status='running'
            )
         )
       )
       SELECT candidate.episode_id,candidate.task_id,candidate.outcome_id,candidate.seal_requested
       FROM candidate
       LEFT JOIN LATERAL (
         SELECT issue.retryable,issue.last_observed_at
         FROM evidence_projection_issue issue
         WHERE issue.episode_id=candidate.episode_id
           AND issue.source_partition='v141:evidence-coverage:' || length(candidate.episode_id)::text || ':' || candidate.episode_id
           AND issue.projector_version='episode-evidence-coverage/v1'
           AND issue.resolved_at IS NULL
         ORDER BY issue.last_observed_at DESC,issue.issue_id
         LIMIT 1
       ) coverage_issue ON true
       WHERE coverage_issue.last_observed_at IS NULL
          OR (coverage_issue.retryable
            AND coverage_issue.last_observed_at + interval '5 seconds' <= clock_timestamp())
       ORDER BY CASE WHEN coverage_issue.last_observed_at IS NULL THEN 0 ELSE 1 END,
         COALESCE(coverage_issue.last_observed_at + interval '5 seconds',
           candidate.recomputed_at,candidate.committed_at),candidate.outcome_id
       LIMIT $1`,
      [limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          episodeId: row.episode_id,
          taskId: row.task_id,
          terminalOutcomeId: row.outcome_id,
          sealRequested: row.seal_requested,
        }),
      ),
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
           detail=EXCLUDED.detail,failed_at=EXCLUDED.failed_at,
           requeued_at=NULL,requeued_by=NULL,requeue_reason=NULL`,
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

  async reconcileHighWatermark(exportId: string, observedAt: string): Promise<void> {
    await withTransaction(this.#pool, (client) =>
      clearHighWatermarkWithinTransaction(
        client,
        boundedText(exportId, 'exportId'),
        validTimestamp(observedAt, 'observedAt'),
      ),
    );
  }

  async saveManifest(manifest: EpisodeEvidenceManifest): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `evidence.manifest:${manifest.episodeId}`,
      ]);
      const current = await loadManifestWithClient(client, manifest.episodeId, true);
      if (current !== undefined) {
        if (
          current.manifestId !== manifest.manifestId ||
          current.taskId !== manifest.taskId ||
          current.terminalOutcomeId !== manifest.terminalOutcomeId
        ) {
          throw new EvidencePersistenceError(
            'EVIDENCE_MANIFEST_IDENTITY_CONFLICT',
            `Episode ${manifest.episodeId} already has a different immutable manifest identity.`,
          );
        }
        if (current.sourceSnapshotHash === manifest.sourceSnapshotHash) {
          if (manifestContentHash(current) === manifestContentHash(manifest)) return;
          const sealingSameSnapshot =
            current.status === 'projecting' && manifest.status !== 'projecting';
          if (!sealingSameSnapshot) {
            throw new EvidencePersistenceError(
              'EVIDENCE_MANIFEST_SNAPSHOT_CONFLICT',
              'The same evidence source snapshot produced different manifest content.',
            );
          }
        }
        if (manifest.revision !== current.revision + 1) {
          throw new EvidencePersistenceError(
            'EVIDENCE_MANIFEST_REVISION_CONFLICT',
            `Manifest revision ${String(manifest.revision)} does not follow ${String(current.revision)}.`,
          );
        }
      } else if (manifest.revision !== 1) {
        throw new EvidencePersistenceError(
          'EVIDENCE_MANIFEST_REVISION_CONFLICT',
          'The first persisted manifest revision must be 1.',
        );
      }

      const persisted = await client.query(
        `INSERT INTO episode_evidence_manifest(
           manifest_id,revision,policy_version,episode_id,task_id,terminal_outcome_id,
           expected_required_records,projected_required_records,pending_required_records,
           failed_required_records,expected_families,completed_families,missing_families,
           source_coverage,last_evidence_sequence,status,quality_issue_ids,
           source_snapshot_hash,created_at,recomputed_at,sealed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,
           $14::jsonb,$15::bigint,$16,$17::jsonb,$18,$19,$20,$21)
         ON CONFLICT (manifest_id) DO UPDATE SET
           revision=EXCLUDED.revision,policy_version=EXCLUDED.policy_version,
           expected_required_records=EXCLUDED.expected_required_records,
           projected_required_records=EXCLUDED.projected_required_records,
           pending_required_records=EXCLUDED.pending_required_records,
           failed_required_records=EXCLUDED.failed_required_records,
           expected_families=EXCLUDED.expected_families,
           completed_families=EXCLUDED.completed_families,
           missing_families=EXCLUDED.missing_families,
           source_coverage=EXCLUDED.source_coverage,
           last_evidence_sequence=EXCLUDED.last_evidence_sequence,status=EXCLUDED.status,
           quality_issue_ids=EXCLUDED.quality_issue_ids,
           source_snapshot_hash=EXCLUDED.source_snapshot_hash,
           recomputed_at=EXCLUDED.recomputed_at,sealed_at=EXCLUDED.sealed_at
         WHERE episode_evidence_manifest.episode_id=EXCLUDED.episode_id
           AND episode_evidence_manifest.task_id=EXCLUDED.task_id
           AND episode_evidence_manifest.terminal_outcome_id=EXCLUDED.terminal_outcome_id
         RETURNING manifest_id`,
        [
          manifest.manifestId,
          manifest.revision,
          manifest.policyVersion,
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
          manifest.sourceSnapshotHash,
          manifest.createdAt,
          manifest.recomputedAt,
          manifest.sealedAt ?? null,
        ],
      );
      if (persisted.rowCount !== 1) {
        throw new EvidencePersistenceError(
          'EVIDENCE_MANIFEST_IDENTITY_CONFLICT',
          `Manifest ${manifest.manifestId} already belongs to a different episode identity.`,
        );
      }
    });
  }

  async #assertBelowHighWatermark(
    client: PoolClient,
    evaluationRole: string,
    recordFamily: string,
    recordType: string,
  ): Promise<void> {
    const active = await client.query<{
      export_id: string;
      max_pending: string;
      excluded: boolean;
    }>(
      `SELECT export_id,
         COALESCE(definition->'outboxPolicy'->>'maxPendingRecords','10000') AS max_pending,
         NOT (definition->'includedFamilies' ? $1)
           OR ($2='diagnostic' AND COALESCE(
             definition->'excludedDiagnosticTypes','[]'::jsonb
           ) ? $3) AS excluded
       FROM evidence_export_configuration WHERE is_active`,
      [recordFamily, evaluationRole, recordType],
    );
    const configuration = active.rows[0];
    if (configuration === undefined || configuration.excluded) return;
    const count = await client.query<{ pending: string }>(
      `SELECT count(*)::text AS pending
       FROM evidence_outbox evidence
       JOIN evidence_export_configuration configuration ON configuration.is_active
       WHERE evidence.acknowledged_at IS NULL
         AND evidence.sequence > evidence_delivery_start_sequence(configuration.export_id)
         AND configuration.definition->'includedFamilies' ? evidence.record_family
         AND NOT (evidence.evaluation_role='diagnostic' AND COALESCE(
           configuration.definition->'excludedDiagnosticTypes','[]'::jsonb
         ) ? evidence.record_type)
         AND NOT EXISTS (
           SELECT 1 FROM evidence_dead_letter dead_letter
           WHERE dead_letter.sequence=evidence.sequence AND dead_letter.requeued_at IS NULL
         )`,
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
  readonly observation_generation: number;
  readonly occurred_at: Date | string;
  readonly recorded_at: Date | string;
  readonly evidence_refs: readonly string[];
  readonly artifact_refs: readonly string[];
  readonly payload: EvidenceJsonValue;
  readonly payload_hash: `sha256:${string}`;
  readonly delivery_attempts_value: number;
  readonly next_attempt_at: Date | string;
}

interface EpisodeAuthorityRow extends QueryResultRow {
  readonly task_value: Readonly<Record<string, EvidenceJsonValue>>;
  readonly goal_value: Readonly<Record<string, EvidenceJsonValue>> | null;
  readonly contract_value: Readonly<Record<string, EvidenceJsonValue>> | null;
  readonly plan_value: Readonly<Record<string, EvidenceJsonValue>> | null;
}

interface ExpectationOutboxRow extends QueryResultRow {
  readonly record_type: string;
  readonly source_record_id: string;
  readonly source_revision: string;
  readonly record_id: string;
  readonly sequence_text: string;
  readonly sent_at: Date | string | null;
  readonly acknowledged_at: Date | string | null;
}

interface ExpectationProjectionIssueRow extends QueryResultRow {
  readonly record_type: string;
  readonly source_record_id: string;
  readonly issue_code: EvidenceIssueCode;
  readonly last_observed_at: Date | string;
}

interface ExpectedRecordRow extends QueryResultRow {
  readonly record_type: string;
  readonly record_family: EvidenceExpectedRecord['recordFamily'];
  readonly source_system: EvidenceExpectedRecord['sourceSystem'];
  readonly source_table: string;
  readonly evaluation_role: EvidenceExpectedRecord['evaluationRole'];
  readonly requirement_level: EvidenceExpectedRecord['requirementLevel'];
  readonly applicable: boolean;
  readonly stage: EvidenceExpectedRecord['stage'];
  readonly source_record_id: string | null;
  readonly record_id: string | null;
}

interface ExpectationStateRow extends QueryResultRow {
  readonly expectation_id: string;
  readonly record_type: string;
  readonly source_record_id: string | null;
  readonly source_revision: string | null;
  readonly record_id: string | null;
  readonly evidence_sequence_text: string | null;
  readonly applicable: boolean;
  readonly stage: EvidenceExpectedRecord['stage'];
}

interface QualityIssueRow extends QueryResultRow {
  readonly issue_id: string;
  readonly revision_text: string;
  readonly issue_code: EvidenceIssueCode;
  readonly severity: EvidenceQualityIssue['severity'];
  readonly record_type: string | null;
  readonly record_id: string | null;
  readonly episode_id: string | null;
  readonly source_system: EvidenceQualityIssue['sourceSystem'];
  readonly source_table: string;
  readonly source_record_id: string;
  readonly detail: Readonly<Record<string, EvidenceJsonValue>>;
  readonly created_at: Date | string;
}

interface ManifestRow extends QueryResultRow {
  readonly manifest_id: string;
  readonly revision_text: string;
  readonly policy_version: EpisodeEvidenceManifest['policyVersion'];
  readonly episode_id: string;
  readonly task_id: string;
  readonly terminal_outcome_id: string;
  readonly expected_required_records: number;
  readonly projected_required_records: number;
  readonly pending_required_records: number;
  readonly failed_required_records: number;
  readonly expected_families: EpisodeEvidenceManifest['expectedFamilies'];
  readonly completed_families: EpisodeEvidenceManifest['completedFamilies'];
  readonly missing_families: EpisodeEvidenceManifest['missingFamilies'];
  readonly source_coverage: EpisodeEvidenceManifest['sourceCoverage'];
  readonly last_evidence_sequence_text: string;
  readonly status: EpisodeEvidenceManifest['status'];
  readonly quality_issue_ids: readonly string[];
  readonly source_snapshot_hash: EpisodeEvidenceManifest['sourceSnapshotHash'];
  readonly created_at: Date | string;
  readonly recomputed_at: Date | string;
  readonly sealed_at: Date | string | null;
}

interface TerminalEpisodeCoverageRow extends QueryResultRow {
  readonly episode_id: string;
  readonly task_id: string;
  readonly outcome_id: string;
  readonly seal_requested: boolean;
}

function groupByRecordType<T extends Readonly<{ record_type: string }>>(
  rows: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const selected = grouped.get(row.record_type) ?? [];
    selected.push(row);
    grouped.set(row.record_type, selected);
  }
  return grouped;
}

function latestOutboxForSource(
  rows: readonly ExpectationOutboxRow[],
  sourceRecordId: string | undefined,
): ExpectationOutboxRow | undefined {
  if (sourceRecordId === undefined) return undefined;
  return rows.filter((row) => row.source_record_id === sourceRecordId).at(-1);
}

function latestIssueForSource(
  rows: readonly ExpectationProjectionIssueRow[],
  sourceRecordId: string | undefined,
): ExpectationProjectionIssueRow | undefined {
  if (sourceRecordId === undefined) return undefined;
  return rows.filter((row) => row.source_record_id === sourceRecordId).at(-1);
}

interface UnconditionalAuthorityFact {
  readonly sourceRecordId: string;
  readonly sourceRevision: string;
}

function unconditionalAuthorityFacts(
  authority: EpisodeAuthorityRow | undefined,
  taskId: string,
): ReadonlyMap<string, UnconditionalAuthorityFact> {
  const facts = new Map<string, UnconditionalAuthorityFact>();
  if (authority === undefined) return facts;
  const task = authority.task_value;
  const taskRevision = {
    taskId,
    phase: task['phase'] ?? null,
    goalId: task['goal_id'] ?? null,
    goalVersion: task['goal_version'] ?? null,
    updatedAt: task['updated_at'] ?? null,
  };
  facts.set('runtime.episode', {
    sourceRecordId: taskId,
    sourceRevision: hashCanonicalEvidenceJson(taskRevision),
  });
  const inputHash = hashCanonicalEvidenceJson(
    JSON.stringify({
      requestText: task['request_text'] ?? '',
      requestMetadata: task['request_metadata'] ?? {},
    }),
  );
  facts.set('runtime.request', {
    sourceRecordId: taskId,
    sourceRevision: hashCanonicalEvidenceJson({ ...taskRevision, inputHash }),
  });

  const goal = authority.goal_value;
  if (goal !== null) {
    const goalId = evidenceText(goal, 'goal_id');
    const goalVersion = evidenceInteger(goal, 'version');
    facts.set('runtime.goal', {
      sourceRecordId: `${goalId}:${String(goalVersion)}`,
      sourceRevision: hashCanonicalEvidenceJson({
        goalId,
        goalVersion,
        status: goal['status'] ?? null,
        updatedAt: goal['updated_at'] ?? null,
      }),
    });
  }
  const contract = authority.contract_value;
  if (contract !== null) {
    const goalId = evidenceText(contract, 'goal_id');
    const goalVersion = evidenceInteger(contract, 'goal_version');
    facts.set('runtime.goal_contract', {
      sourceRecordId: `${goalId}:${String(goalVersion)}`,
      sourceRevision: hashCanonicalEvidenceJson({
        goalVersion,
        contractHash: contract['contract_hash'] ?? null,
      }),
    });
  }
  const plan = authority.plan_value;
  if (plan !== null) {
    facts.set('runtime.plan', {
      sourceRecordId: evidenceText(plan, 'plan_id'),
      sourceRevision: hashCanonicalEvidenceJson({
        revision: plan['revision'] ?? null,
        lockVersion: plan['lock_version'] ?? null,
        contentHash: plan['content_hash'] ?? null,
        status: plan['status'] ?? null,
      }),
    });
  }
  return facts;
}

function expectationStage(input: {
  readonly projected?: ExpectationOutboxRow;
  readonly issue?: ExpectationProjectionIssueRow;
  readonly authoritySourceId?: string;
  readonly authoritySourceRevision?: string;
}): EvidenceExpectedRecord['stage'] {
  if (input.issue?.issue_code === 'schema_invalid') return 'schema_invalid';
  if (input.issue?.issue_code === 'payload_hash_conflict') return 'payload_conflict';
  if (input.issue !== undefined) return 'projection_failed';
  if (
    input.authoritySourceId !== undefined &&
    (input.projected === undefined ||
      input.projected.source_revision !== input.authoritySourceRevision)
  ) {
    return 'source_fact_unprojected';
  }
  if (input.projected?.acknowledged_at !== null && input.projected?.acknowledged_at !== undefined) {
    return 'acknowledged';
  }
  if (input.projected?.sent_at !== null && input.projected?.sent_at !== undefined) {
    return 'exported_unacknowledged';
  }
  if (input.projected !== undefined) return 'projected_pending_export';
  return 'source_fact_missing';
}

function evidenceText(row: Readonly<Record<string, EvidenceJsonValue>>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > 512) {
    throw new Error(`EVIDENCE_AUTHORITY_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function evidenceInteger(row: Readonly<Record<string, EvidenceJsonValue>>, field: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`EVIDENCE_AUTHORITY_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function assertEpisodePolicy(records: readonly EpisodeEvidenceRecordPolicy[]): void {
  const recordTypes = new Set(records.map((record) => record.recordType));
  if (recordTypes.size !== records.length) {
    throw new EvidencePersistenceError(
      'EVIDENCE_EXPECTATION_POLICY_INVALID',
      'Episode Evidence policy contains duplicate record types.',
    );
  }
  for (const requiredRecordType of UNCONDITIONAL_EPISODE_RECORD_TYPES) {
    const policy = records.find((record) => record.recordType === requiredRecordType);
    if (policy?.requirementLevel !== 'required' || policy.evaluationRole !== 'required') {
      throw new EvidencePersistenceError(
        'EVIDENCE_EXPECTATION_POLICY_INVALID',
        `Episode Evidence policy is missing unconditional ${requiredRecordType}.`,
      );
    }
  }
}

const UNCONDITIONAL_EPISODE_RECORD_TYPES = Object.freeze([
  'runtime.episode',
  'runtime.request',
  'runtime.goal',
  'runtime.goal_contract',
  'runtime.plan',
] as const);

async function listExpectedRecordsWithClient(
  client: Pick<PoolClient, 'query'>,
  episodeId?: string,
): Promise<readonly EvidenceExpectedRecord[]> {
  const result = await client.query<ExpectedRecordRow>(
    `SELECT record_type,record_family,source_system,source_table,evaluation_role,
       requirement_level,applicable,stage,source_record_id,record_id
     FROM evidence_expected_record
     WHERE episode_id IS NOT DISTINCT FROM $1::text
     ORDER BY record_type,source_record_id NULLS FIRST`,
    [episodeId ?? null],
  );
  return Object.freeze(
    result.rows.map((row) =>
      Object.freeze({
        recordType: row.record_type,
        recordFamily: row.record_family,
        sourceSystem: row.source_system,
        sourceTable: row.source_table,
        evaluationRole: row.evaluation_role,
        requirementLevel: row.requirement_level,
        applicable: row.applicable,
        stage: row.stage,
        ...(row.source_record_id === null ? {} : { sourceRecordId: row.source_record_id }),
        ...(row.record_id === null ? {} : { recordId: row.record_id }),
      }),
    ),
  );
}

async function listOpenQualityIssuesWithClient(
  client: Pick<PoolClient, 'query'>,
  episodeId: string,
  excludeEvidenceFamily = false,
): Promise<readonly EvidenceQualityIssue[]> {
  const result = await client.query<QualityIssueRow>(
    `SELECT issue_id,revision::text AS revision_text,issue_code,severity,record_type,record_id,episode_id,source_system,
       source_table,source_record_id,detail,created_at
     FROM evidence_quality_issue
     WHERE episode_id=$1 AND resolved_at IS NULL
       AND (NOT $2::boolean OR record_type IS NULL OR record_type NOT LIKE 'evidence.%')
     ORDER BY issue_id`,
    [episodeId, excludeEvidenceFamily],
  );
  return Object.freeze(result.rows.map(toCoverageIssue));
}

async function listOpenCoverageProjectionIssuesWithClient(
  client: Pick<PoolClient, 'query'>,
  episodeId: string,
): Promise<readonly EvidenceQualityIssue[]> {
  const result = await client.query<QualityIssueRow>(
    `SELECT issue_id,revision::text AS revision_text,issue_code,severity,record_type,
       record_id,episode_id,source_system,source_table,source_record_id,detail,created_at
     FROM evidence_projection_issue
     WHERE resolved_at IS NULL AND evaluation_role='required'
       AND projector_version IN ('runtime-core/v1','skill/v1','1.4.1','1.4.1-phase8.2')
       AND (
         episode_id=$1
         OR (episode_id IS NULL AND detail->>'failureStage'='source_listing')
       )
     ORDER BY issue_id`,
    [episodeId],
  );
  return Object.freeze(result.rows.map(toCoverageIssue));
}

function toCoverageIssue(row: QualityIssueRow): EvidenceQualityIssue {
  return Object.freeze({
    issueId: row.issue_id,
    revision: safePositiveInteger(row.revision_text, 'coverageIssue.revision'),
    issueCode: row.issue_code,
    severity: row.severity,
    ...(row.record_type === null ? {} : { recordType: row.record_type }),
    ...(row.record_id === null ? {} : { recordId: row.record_id }),
    ...(row.episode_id === null ? {} : { episodeId: row.episode_id }),
    sourceSystem: row.source_system,
    sourceTable: row.source_table,
    sourceRecordId: row.source_record_id,
    detail: Object.freeze(structuredClone(row.detail)),
    createdAt: iso(row.created_at),
  });
}

async function loadManifestWithClient(
  client: Pick<PoolClient, 'query'>,
  episodeId: string,
  forUpdate = false,
): Promise<EpisodeEvidenceManifest | undefined> {
  const result = await client.query<ManifestRow>(
    `SELECT manifest_id,revision::text AS revision_text,policy_version,episode_id,task_id,
       terminal_outcome_id,expected_required_records,projected_required_records,
       pending_required_records,failed_required_records,expected_families,completed_families,
       missing_families,source_coverage,last_evidence_sequence::text AS last_evidence_sequence_text,
       status,quality_issue_ids,source_snapshot_hash,created_at,recomputed_at,sealed_at
     FROM episode_evidence_manifest WHERE episode_id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
    [episodeId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const revision = Number(row.revision_text);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('EVIDENCE_MANIFEST_REVISION_INVALID');
  }
  return Object.freeze({
    manifestId: row.manifest_id,
    revision,
    policyVersion: row.policy_version,
    episodeId: row.episode_id,
    taskId: row.task_id,
    terminalOutcomeId: row.terminal_outcome_id,
    expectedRequiredRecords: row.expected_required_records,
    projectedRequiredRecords: row.projected_required_records,
    pendingRequiredRecords: row.pending_required_records,
    failedRequiredRecords: row.failed_required_records,
    expectedFamilies: Object.freeze([...row.expected_families]),
    completedFamilies: Object.freeze([...row.completed_families]),
    missingFamilies: Object.freeze([...row.missing_families]),
    sourceCoverage: Object.freeze(structuredClone(row.source_coverage)),
    lastEvidenceSequence: row.last_evidence_sequence_text,
    status: row.status,
    qualityIssueIds: Object.freeze([...row.quality_issue_ids]),
    sourceSnapshotHash: row.source_snapshot_hash,
    createdAt: iso(row.created_at),
    recomputedAt: iso(row.recomputed_at),
    ...(row.sealed_at === null ? {} : { sealedAt: iso(row.sealed_at) }),
  });
}

function manifestContentHash(manifest: EpisodeEvidenceManifest): `sha256:${string}` {
  return hashCanonicalEvidenceJson({
    manifestId: manifest.manifestId,
    policyVersion: manifest.policyVersion,
    episodeId: manifest.episodeId,
    taskId: manifest.taskId,
    terminalOutcomeId: manifest.terminalOutcomeId,
    expectedRequiredRecords: manifest.expectedRequiredRecords,
    projectedRequiredRecords: manifest.projectedRequiredRecords,
    pendingRequiredRecords: manifest.pendingRequiredRecords,
    failedRequiredRecords: manifest.failedRequiredRecords,
    expectedFamilies: manifest.expectedFamilies,
    completedFamilies: manifest.completedFamilies,
    missingFamilies: manifest.missingFamilies,
    sourceCoverage: manifest.sourceCoverage,
    lastEvidenceSequence: manifest.lastEvidenceSequence,
    status: manifest.status,
    qualityIssueIds: manifest.qualityIssueIds,
    sourceSnapshotHash: manifest.sourceSnapshotHash,
  });
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
      ...(row.observation_generation === 1 ? { observationGeneration: 1 as const } : {}),
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
  // Source revisions and payload hashes are opaque equality markers, not ordered cursor fields.
  return false;
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

async function withAdvisoryRepeatableReadTransaction<T>(
  pool: Pool,
  advisoryKey: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [advisoryKey]);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(hashtext($1))', [advisoryKey])
      .catch(() => undefined);
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

async function clearHighWatermarkWithinTransaction(
  client: PoolClient,
  exportId: string,
  observedAt: string,
): Promise<void> {
  await client.query(
    `UPDATE evidence_export_state state
     SET status='idle',last_error_code=NULL,last_error_at=NULL,observed_at=$2
     FROM evidence_export_configuration configuration
     WHERE state.export_id=$1 AND state.source_partition='all'
       AND state.status='high_watermark'
       AND configuration.export_id=state.export_id AND configuration.is_active
       AND (
         SELECT count(*)
         FROM evidence_outbox evidence
         WHERE evidence.acknowledged_at IS NULL
           AND evidence.sequence > evidence_delivery_start_sequence(configuration.export_id)
           AND configuration.definition->'includedFamilies' ? evidence.record_family
           AND NOT (evidence.evaluation_role='diagnostic' AND COALESCE(
             configuration.definition->'excludedDiagnosticTypes','[]'::jsonb
           ) ? evidence.record_type)
           AND NOT EXISTS (
             SELECT 1 FROM evidence_dead_letter dead_letter
             WHERE dead_letter.sequence=evidence.sequence
               AND dead_letter.requeued_at IS NULL
           )
       ) < COALESCE(
         (configuration.definition->'outboxPolicy'->>'maxPendingRecords')::bigint,
         10000
       )`,
    [exportId, observedAt],
  );
}

function required(value: string | undefined, code: string): string {
  if (value === undefined) throw new Error(code);
  return value;
}

function boundedText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    throw new Error(`EVIDENCE_PERSISTENCE_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function validTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`EVIDENCE_PERSISTENCE_${field.toUpperCase()}_INVALID`);
  }
  return parsed.toISOString();
}

function safePositiveInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`EVIDENCE_PERSISTENCE_${field.toUpperCase()}_INVALID`);
  }
  return parsed;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
