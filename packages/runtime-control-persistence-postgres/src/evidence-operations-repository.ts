import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { hashCanonicalEvidenceJson } from '../../domain/src/index.js';
import type {
  EvidenceConfigurationMetadata,
  EvidenceCoverageRecoveryTarget,
  EvidenceDeadLetterMetadata,
  EvidenceManifestMetadata,
  EvidenceMetadataPage,
  EvidenceOperationsPageQuery,
  EvidenceOperationsRepository,
  EvidenceOperationsStatusMetadata,
  EvidenceOutboxRecordMetadata,
  EvidenceProjectionCheckpointMetadata,
  EvidenceProjectionIssueMetadata,
  EvidenceQualityIssueMetadata,
  EvidenceRecoveryCommand,
  EvidenceRecoveryOperation,
  EvidenceRecoveryRunMetadata,
} from '../../runtime-control-application/src/index.js';
import { EvidencePersistenceError } from './evidence-store.js';

export type PostgresEvidenceRecoveryCommand = EvidenceRecoveryCommand;
export type PostgresEvidenceRecoveryRun = EvidenceRecoveryRunMetadata;

interface RecoveryRunRow extends QueryResultRow {
  readonly recovery_run_id: string;
  readonly operation_id: string;
  readonly idempotency_key_hash: string;
  readonly request_hash: string;
  readonly operation: EvidenceRecoveryOperation;
  readonly target: Readonly<Record<string, string>>;
  readonly actor_id: string;
  readonly reason: string;
  readonly status: EvidenceRecoveryRunMetadata['status'];
  readonly affected_records: number | null;
  readonly result_summary: Readonly<Record<string, string | number>> | null;
  readonly last_error_code: string | null;
  readonly requested_at: Date | string;
  readonly started_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly revision: string;
}

interface RecoveryAuthorityRow extends RecoveryRunRow {
  readonly export_id: string;
  readonly configuration_revision: string;
}

interface OutboxMetadataRow extends QueryResultRow {
  readonly sequence: string;
  readonly record_id: string;
  readonly record_family: EvidenceOutboxRecordMetadata['recordFamily'];
  readonly record_type: string;
  readonly schema_name: string;
  readonly schema_version: number;
  readonly source_system: EvidenceOutboxRecordMetadata['sourceSystem'];
  readonly source_table: string;
  readonly source_record_id: string;
  readonly source_revision: string;
  readonly source_partition: string;
  readonly evaluation_role: EvidenceOutboxRecordMetadata['evaluationRole'];
  readonly task_id: string | null;
  readonly episode_id: string | null;
  readonly payload_hash: string;
  readonly captured_at: Date | string;
  readonly delivery_attempts: number;
  readonly next_attempt_at: Date | string;
  readonly sent_at: Date | string | null;
  readonly acknowledged_at: Date | string | null;
  readonly last_error_code: string | null;
}

interface CheckpointMetadataRow extends QueryResultRow {
  readonly source_family: string;
  readonly source_partition: string;
  readonly last_occurred_at: Date | string | null;
  readonly last_source_record_id: string | null;
  readonly last_source_revision: string | null;
  readonly last_payload_hash: string | null;
  readonly last_projected_at: Date | string | null;
  readonly projector_version: string;
}

interface QualityIssueMetadataRow extends QueryResultRow {
  readonly issue_id: string;
  readonly rule_id: string | null;
  readonly issue_code: EvidenceQualityIssueMetadata['issueCode'];
  readonly severity: EvidenceQualityIssueMetadata['severity'];
  readonly record_type: string | null;
  readonly record_id: string | null;
  readonly episode_id: string | null;
  readonly source_system: EvidenceQualityIssueMetadata['sourceSystem'];
  readonly source_table: string;
  readonly source_record_id: string;
  readonly first_observed_at: Date | string;
  readonly last_observed_at: Date | string;
  readonly resolved_at: Date | string | null;
  readonly revision: number;
}

interface ProjectionIssueMetadataRow extends QualityIssueMetadataRow {
  readonly evaluation_role: EvidenceProjectionIssueMetadata['evaluationRole'];
  readonly source_partition: string;
  readonly projector_version: string;
  readonly retryable: boolean;
}

interface ManifestMetadataRow extends QueryResultRow {
  readonly manifest_id: string;
  readonly revision: number;
  readonly policy_version: string;
  readonly episode_id: string;
  readonly task_id: string;
  readonly terminal_outcome_id: string;
  readonly expected_required_records: number;
  readonly projected_required_records: number;
  readonly pending_required_records: number;
  readonly failed_required_records: number;
  readonly expected_families: EvidenceManifestMetadata['expectedFamilies'];
  readonly completed_families: EvidenceManifestMetadata['completedFamilies'];
  readonly missing_families: EvidenceManifestMetadata['missingFamilies'];
  readonly source_coverage: EvidenceManifestMetadata['sourceCoverage'];
  readonly last_evidence_sequence: string;
  readonly status: EvidenceManifestMetadata['status'];
  readonly quality_issue_ids: readonly string[];
  readonly source_snapshot_hash: string;
  readonly created_at: Date | string;
  readonly recomputed_at: Date | string;
  readonly sealed_at: Date | string | null;
}

interface DeadLetterMetadataRow extends QueryResultRow {
  readonly dead_letter_id: string;
  readonly sequence: string;
  readonly record_id: string;
  readonly issue_code: EvidenceDeadLetterMetadata['issueCode'];
  readonly attempts: number;
  readonly failed_at: Date | string;
  readonly requeued_at: Date | string | null;
  readonly requeue_count: number;
  readonly requeued_by: string | null;
  readonly requeue_reason: string | null;
}

interface ReplayRecordRow extends QueryResultRow {
  readonly sequence: string;
  readonly source_partition: string;
}

interface RecoveryActionResult {
  readonly affectedRecords: number;
  readonly sourcePartitions: readonly string[];
  readonly deferred?: boolean;
}

interface CoverageRecoveryTargetRow extends QueryResultRow {
  readonly recovery_run_id: string;
  readonly episode_id: string;
  readonly claim_token: string;
}

class EvidenceRecoveryActionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EvidenceRecoveryActionError';
    this.code = code;
  }
}

const maximumReplayRecords = 10_000;
const supportedReplaySourceFamilies = new Set([
  'runtime',
  'skill',
  'mcp-capability',
  'experience',
  'replay',
  'artifact',
  'node_control',
  'evidence',
]);
const sourceFamilyRecordFamilyPredicate = `(
  ($4::text='runtime' AND evidence.record_family='runtime')
  OR ($4::text='skill' AND evidence.record_family='skill')
  OR ($4::text='mcp-capability' AND evidence.record_family IN ('mcp_task','capability'))
  OR ($4::text='experience' AND evidence.record_family='experience')
  OR ($4::text='replay' AND evidence.record_family='replay')
  OR ($4::text='artifact' AND evidence.record_family='artifact')
  OR ($4::text='node_control' AND evidence.record_family='node_control')
  OR ($4::text='evidence' AND evidence.record_family='evidence')
)`;
const coverageTargetClaimSql = `WITH selected AS (
  SELECT target.recovery_run_id,target.episode_id,outcome.task_id,
    outcome.outcome_id AS terminal_outcome_id,
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
          EXISTS (SELECT 1 FROM agent_task task
            WHERE task.task_id=outcome.task_id AND task.skill_selection_id IS NOT NULL)
          OR EXISTS (SELECT 1 FROM skill_input_resolution resolution
            WHERE resolution.task_id=outcome.task_id)
          OR EXISTS (SELECT 1 FROM skill_execution_record execution
            WHERE execution.task_id=outcome.task_id)
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
          EXISTS (SELECT 1 FROM mcp_invocation invocation
            WHERE invocation.task_id=outcome.task_id)
          OR EXISTS (SELECT 1 FROM task_capability_binding binding
            WHERE binding.task_id=outcome.task_id)
          OR EXISTS (
            SELECT 1 FROM task_availability_snapshot snapshot
            JOIN task_execution_readiness readiness
              ON readiness.readiness_id=snapshot.readiness_id
            JOIN workflow_control control
              ON control.current_plan_id=readiness.workflow_plan_id
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
          EXISTS (SELECT 1 FROM goal_experience_episode episode
            WHERE episode.task_id=outcome.task_id)
          OR EXISTS (SELECT 1 FROM planning_correction_fact correction
            WHERE correction.task_id=outcome.task_id)
          OR EXISTS (SELECT 1 FROM planning_interaction_episode interaction
            WHERE interaction.task_id=outcome.task_id)
        ) OR EXISTS (
          SELECT 1 FROM evidence_source_checkpoint checkpoint
          WHERE checkpoint.source_family='experience'
            AND checkpoint.source_partition='v141:experience_task:'
              || length(outcome.task_id)::text || ':' || outcome.task_id
            AND checkpoint.projector_version='1.4.1-phase8.2'
        ) OR EXISTS (
          SELECT 1 FROM evidence_projection_issue issue
          WHERE issue.episode_id=outcome.task_id
            AND issue.source_partition='v141:experience_task:'
              || length(outcome.task_id)::text || ':' || outcome.task_id
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
            OR (issue.episode_id IS NULL AND issue.detail->>'failureStage'='source_listing')
          )
      )
    ) AS seal_requested
  FROM evidence_coverage_reconcile_target target
  JOIN evidence_recovery_run recovery
    ON recovery.recovery_run_id=target.recovery_run_id AND recovery.status='running'
  JOIN evidence_export_configuration configuration
    ON configuration.export_id=recovery.export_id
      AND configuration.revision=recovery.configuration_revision
      AND configuration.is_active
  JOIN runtime_terminal_outcome outcome ON outcome.task_id=target.episode_id
  WHERE target.recovery_run_id=$1 AND target.completed_at IS NULL
    AND (target.claim_token IS NULL OR target.claim_expires_at <= $2::timestamptz)
  ORDER BY target.requested_at,target.episode_id
  FOR UPDATE OF target SKIP LOCKED LIMIT 1
), claimed AS (
  UPDATE evidence_coverage_reconcile_target target
  SET claim_token=$3,claimed_at=GREATEST($2::timestamptz,target.requested_at),
    claim_expires_at=GREATEST($2::timestamptz,target.requested_at) + interval '5 minutes',
    attempt_count=target.attempt_count+1
  FROM selected
  WHERE target.recovery_run_id=selected.recovery_run_id
    AND target.episode_id=selected.episode_id
  RETURNING target.recovery_run_id,target.episode_id,target.claim_token
)
SELECT claimed.recovery_run_id,claimed.episode_id,claimed.claim_token,
  selected.task_id,selected.terminal_outcome_id,selected.seal_requested
FROM claimed JOIN selected USING (recovery_run_id,episode_id)`;

/** PostgreSQL is the recovery-run and replay authority. Redis may only wake callers after commit. */
export class PostgresEvidenceOperationsRepository implements EvidenceOperationsRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async getConfiguration(): Promise<EvidenceConfigurationMetadata | undefined> {
    const result = await this.#pool.query<
      QueryResultRow & {
        export_id: string;
        revision: string;
        checksum: string;
        applied_at: Date | string;
        is_active: boolean;
        is_lkg: boolean;
        included_families: EvidenceConfigurationMetadata['includedFamilies'];
        excluded_diagnostic_types: readonly string[];
        max_pending_records: number;
        retention_days: number;
      }
    >(
      `SELECT export_id,revision::text,checksum::text,applied_at,is_active,is_lkg,
         definition->'includedFamilies' AS included_families,
         COALESCE(definition->'excludedDiagnosticTypes','[]'::jsonb)
           AS excluded_diagnostic_types,
         (definition->'outboxPolicy'->>'maxPendingRecords')::integer AS max_pending_records,
         (definition->'outboxPolicy'->>'retentionDays')::integer AS retention_days
       FROM evidence_export_configuration
       WHERE is_active ORDER BY revision DESC LIMIT 1`,
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      exportId: row.export_id,
      revision: Number(row.revision),
      checksum: row.checksum,
      appliedAt: iso(row.applied_at),
      isActive: row.is_active,
      isLastKnownGood: row.is_lkg,
      includedFamilies: Object.freeze([...row.included_families]),
      excludedDiagnosticTypes: Object.freeze([...row.excluded_diagnostic_types]),
      maxPendingRecords: row.max_pending_records,
      retentionDays: row.retention_days,
    });
  }

  async getStatus(): Promise<EvidenceOperationsStatusMetadata> {
    return withReadOnlyTransaction(this.#pool, async (client) => {
      const result = await client.query<
        QueryResultRow & {
          export_id: string | null;
          revision: string | null;
          pending_records: string;
          dead_letter_records: string;
          projection_issues: string;
          quality_issues: string;
          acknowledged_frontier: string | null;
          high_watermark_active: boolean;
          observed_at: Date | string;
        }
      >(
        `WITH active AS (
           SELECT * FROM evidence_export_configuration WHERE is_active
         ), eligible AS (
           SELECT evidence.sequence,evidence.acknowledged_at
           FROM evidence_outbox evidence JOIN active ON true
           WHERE active.definition->'includedFamilies' ? evidence.record_family
             AND NOT (evidence.evaluation_role='diagnostic' AND COALESCE(
               active.definition->'excludedDiagnosticTypes','[]'::jsonb
             ) ? evidence.record_type)
         ), pending AS (
           SELECT eligible.sequence FROM eligible
           WHERE eligible.acknowledged_at IS NULL AND NOT EXISTS (
             SELECT 1 FROM evidence_dead_letter dead_letter
             WHERE dead_letter.sequence=eligible.sequence AND dead_letter.requeued_at IS NULL
           )
         )
         SELECT
           (SELECT export_id FROM active) AS export_id,
           (SELECT revision::text FROM active) AS revision,
           (SELECT count(*)::text FROM pending) AS pending_records,
           (SELECT count(*)::text FROM evidence_dead_letter WHERE requeued_at IS NULL)
             AS dead_letter_records,
           (SELECT count(*)::text FROM evidence_projection_issue WHERE resolved_at IS NULL)
             AS projection_issues,
           (SELECT count(*)::text FROM evidence_quality_issue WHERE resolved_at IS NULL)
             AS quality_issues,
           (SELECT CASE
             WHEN count(*)=0 THEN NULL
             WHEN min(sequence) FILTER (WHERE acknowledged_at IS NULL) IS NULL
               THEN max(sequence)::text
             ELSE GREATEST(
               0,min(sequence) FILTER (WHERE acknowledged_at IS NULL)-1
             )::text
           END FROM eligible) AS acknowledged_frontier,
           COALESCE((SELECT count(*) FROM pending) >= COALESCE((
             SELECT (definition->'outboxPolicy'->>'maxPendingRecords')::bigint FROM active
           ),10000),false) AS high_watermark_active,
           clock_timestamp() AS observed_at`,
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('EVIDENCE_OPERATIONS_STATUS_RETURNED_NO_ROW');
      const partitions = await client.query<
        QueryResultRow & {
          export_id: string;
          source_partition: string;
          status: EvidenceOperationsStatusMetadata['partitions'][number]['status'];
          last_sent_sequence: string | null;
          last_acknowledged_sequence: string | null;
          last_acknowledged_at: Date | string | null;
          lease_expires_at: Date | string | null;
          fencing_token: string;
          last_error_code: string | null;
          last_error_at: Date | string | null;
          observed_at: Date | string;
        }
      >(
        `SELECT state.export_id,state.source_partition,state.status,
           state.last_sent_sequence::text,state.last_acknowledged_sequence::text,
           state.last_acknowledged_at,state.lease_expires_at,state.fencing_token::text,
           state.last_error_code,state.last_error_at,state.observed_at
         FROM evidence_export_state state
         JOIN evidence_export_configuration configuration
           ON configuration.export_id=state.export_id AND configuration.is_active
         ORDER BY state.source_partition`,
      );
      return Object.freeze({
        ...(row.export_id === null ? {} : { exportId: row.export_id }),
        ...(row.revision === null ? {} : { activeRevision: Number(row.revision) }),
        pendingRecords: Number(row.pending_records),
        deadLetterRecords: Number(row.dead_letter_records),
        openProjectionIssues: Number(row.projection_issues),
        openQualityIssues: Number(row.quality_issues),
        ...(row.acknowledged_frontier === null
          ? {}
          : { globalAcknowledgedFrontier: row.acknowledged_frontier }),
        highWatermarkActive: row.high_watermark_active,
        partitions: Object.freeze(
          partitions.rows.map((partition) =>
            Object.freeze({
              exportId: partition.export_id,
              sourcePartition: partition.source_partition,
              status: partition.status,
              ...(partition.last_sent_sequence === null
                ? {}
                : { lastSentSequence: partition.last_sent_sequence }),
              ...(partition.last_acknowledged_sequence === null
                ? {}
                : { lastAcknowledgedSequence: partition.last_acknowledged_sequence }),
              ...(partition.last_acknowledged_at === null
                ? {}
                : { lastAcknowledgedAt: iso(partition.last_acknowledged_at) }),
              ...(partition.lease_expires_at === null
                ? {}
                : { leaseExpiresAt: iso(partition.lease_expires_at) }),
              fencingToken: partition.fencing_token,
              ...(partition.last_error_code === null
                ? {}
                : { lastErrorCode: partition.last_error_code }),
              ...(partition.last_error_at === null
                ? {}
                : { lastErrorAt: iso(partition.last_error_at) }),
              observedAt: iso(partition.observed_at),
            }),
          ),
        ),
        observedAt: iso(row.observed_at),
      });
    });
  }

  async listOutbox(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceOutboxRecordMetadata>> {
    const limit = pageLimit(query.limit);
    const after = query.cursor === undefined ? null : decimalCursor(query.cursor);
    const result = await this.#pool.query<OutboxMetadataRow>(
      `SELECT sequence::text,record_id,record_family,record_type,schema_name,schema_version,
         source_system,source_table,source_record_id,source_revision,source_partition,
         evaluation_role,task_id,episode_id,payload_hash::text,captured_at,
         delivery_attempts::integer,next_attempt_at,sent_at,acknowledged_at,last_error_code
       FROM evidence_outbox
       WHERE ($2::bigint IS NULL OR sequence>$2)
         AND ($3::text IS NULL OR episode_id=$3)
         AND ($4::text IS NULL OR source_partition=$4)
       ORDER BY sequence LIMIT $1`,
      [limit + 1, after, query.episodeId ?? null, query.sourcePartition ?? null],
    );
    return metadataPage(result.rows, limit, (row) => row.sequence, toOutboxMetadata);
  }

  async listCheckpoints(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceProjectionCheckpointMetadata>> {
    const limit = pageLimit(query.limit);
    const after = query.cursor === undefined ? [null, null] : decodeCursor(query.cursor, 2);
    const result = await this.#pool.query<CheckpointMetadataRow>(
      `SELECT source_family,source_partition,last_occurred_at,last_source_record_id,
         last_source_revision,last_payload_hash::text,last_projected_at,projector_version
       FROM evidence_source_checkpoint
       WHERE ($2::text IS NULL OR (source_family,source_partition)>($2,$3))
         AND ($4::text IS NULL OR source_partition=$4)
       ORDER BY source_family,source_partition LIMIT $1`,
      [limit + 1, after[0], after[1], query.sourcePartition ?? null],
    );
    return metadataPage(
      result.rows,
      limit,
      (row) => encodeCursor([row.source_family, row.source_partition]),
      toCheckpointMetadata,
    );
  }

  async listProjectionIssues(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceProjectionIssueMetadata>> {
    const limit = pageLimit(query.limit);
    const after = query.cursor === undefined ? [null, null] : decodeCursor(query.cursor, 2);
    const result = await this.#pool.query<ProjectionIssueMetadataRow>(
      `SELECT issue_id,rule_id,issue_code,severity,evaluation_role,record_type,record_id,
         episode_id,source_system,source_table,source_record_id,source_partition,
         projector_version,retryable,first_observed_at,last_observed_at,resolved_at,
         revision::integer
       FROM evidence_projection_issue
       WHERE ($2::timestamptz IS NULL OR (last_observed_at,issue_id)>($2,$3))
         AND ($4::text IS NULL OR episode_id=$4)
         AND ($5::text IS NULL OR source_partition=$5)
         AND (NOT $6::boolean OR resolved_at IS NULL)
       ORDER BY last_observed_at,issue_id LIMIT $1`,
      [
        limit + 1,
        after[0],
        after[1],
        query.episodeId ?? null,
        query.sourcePartition ?? null,
        query.openOnly ?? false,
      ],
    );
    return metadataPage(
      result.rows,
      limit,
      (row) => encodeCursor([iso(row.last_observed_at), row.issue_id]),
      toProjectionIssueMetadata,
    );
  }

  async listQualityIssues(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceQualityIssueMetadata>> {
    const limit = pageLimit(query.limit);
    const after = query.cursor === undefined ? [null, null] : decodeCursor(query.cursor, 2);
    const result = await this.#pool.query<QualityIssueMetadataRow>(
      `SELECT issue_id,rule_id,issue_code,severity,record_type,record_id,episode_id,
         source_system,source_table,source_record_id,first_observed_at,last_observed_at,
         resolved_at,revision::integer
       FROM evidence_quality_issue
       WHERE ($2::timestamptz IS NULL OR (last_observed_at,issue_id)>($2,$3))
         AND ($4::text IS NULL OR episode_id=$4)
         AND (NOT $5::boolean OR resolved_at IS NULL)
       ORDER BY last_observed_at,issue_id LIMIT $1`,
      [limit + 1, after[0], after[1], query.episodeId ?? null, query.openOnly ?? false],
    );
    return metadataPage(
      result.rows,
      limit,
      (row) => encodeCursor([iso(row.last_observed_at), row.issue_id]),
      toQualityIssueMetadata,
    );
  }

  async getManifest(episodeId: string): Promise<EvidenceManifestMetadata | undefined> {
    const result = await this.#pool.query<ManifestMetadataRow>(
      `SELECT manifest_id,revision::integer,policy_version,episode_id,task_id,
         terminal_outcome_id,expected_required_records,projected_required_records,
         pending_required_records,failed_required_records,expected_families,
         completed_families,missing_families,source_coverage,last_evidence_sequence::text,
         status,quality_issue_ids,source_snapshot_hash,created_at,recomputed_at,sealed_at
       FROM episode_evidence_manifest WHERE episode_id=$1`,
      [bounded(episodeId, 'episodeId', 2_048)],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toManifestMetadata(row);
  }

  async listDeadLetters(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceDeadLetterMetadata>> {
    const limit = pageLimit(query.limit);
    const after = query.cursor === undefined ? [null, null] : decodeCursor(query.cursor, 2);
    const result = await this.#pool.query<DeadLetterMetadataRow>(
      `SELECT dead_letter_id,sequence::text,record_id,issue_code,attempts::integer,
         failed_at,requeued_at,requeue_count::integer,requeued_by,requeue_reason
       FROM evidence_dead_letter
       WHERE ($2::timestamptz IS NULL OR (failed_at,dead_letter_id)>($2,$3))
         AND (NOT $4::boolean OR requeued_at IS NULL)
       ORDER BY failed_at,dead_letter_id LIMIT $1`,
      [limit + 1, after[0], after[1], query.openOnly ?? false],
    );
    return metadataPage(
      result.rows,
      limit,
      (row) => encodeCursor([iso(row.failed_at), row.dead_letter_id]),
      toDeadLetterMetadata,
    );
  }

  async startRecoveryRun(
    command: PostgresEvidenceRecoveryCommand,
  ): Promise<PostgresEvidenceRecoveryRun> {
    assertRecoveryCommand(command);
    return withTransaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `evidence.recovery:${command.idempotencyKeyHash}`,
      ]);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('runtime.evidence-export'))`);
      await assertActiveRecoveryConfiguration(client, command);
      const existing = await client.query<RecoveryRunRow>(
        `SELECT *,revision::text FROM evidence_recovery_run
         WHERE idempotency_key_hash=$1 OR operation_id=$2
         ORDER BY requested_at,recovery_run_id FOR UPDATE`,
        [command.idempotencyKeyHash, command.operationId],
      );
      if (existing.rows.length > 1) {
        throw new EvidencePersistenceError(
          'EVIDENCE_RECOVERY_CONFLICT',
          'Evidence recovery idempotency and operation identity refer to different runs.',
        );
      }
      const replay = existing.rows[0];
      if (replay !== undefined) {
        if (
          replay.idempotency_key_hash !== command.idempotencyKeyHash ||
          replay.operation_id !== command.operationId ||
          replay.request_hash !== command.requestHash
        ) {
          throw new EvidencePersistenceError(
            'EVIDENCE_RECOVERY_CONFLICT',
            'Evidence recovery idempotency or operation identity was reused with different input.',
          );
        }
        return toRecoveryRun(replay);
      }

      const recoveryRunId = `evidence-recovery-run:${hashCanonicalEvidenceJson({
        operationId: command.operationId,
        idempotencyKeyHash: command.idempotencyKeyHash,
      }).slice('sha256:'.length)}`;
      const target = recoveryTarget(command);
      const inserted = await client.query<RecoveryRunRow>(
        `INSERT INTO evidence_recovery_run(
           recovery_run_id,operation_id,idempotency_key_hash,request_hash,
           export_id,configuration_revision,operation,target,
           actor_id,reason,status,attempt_count,requested_at,wake_requested_at,revision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'requested',0,$11,$11,1)
         RETURNING *,revision::text`,
        [
          recoveryRunId,
          command.operationId,
          command.idempotencyKeyHash,
          command.requestHash,
          command.exportId,
          command.configurationRevision,
          command.operation,
          JSON.stringify(target),
          command.actorId,
          command.reason,
          command.requestedAt,
        ],
      );
      if (inserted.rows[0] === undefined) {
        throw new Error('EVIDENCE_RECOVERY_RUN_INSERT_RETURNED_NO_ROW');
      }
      return requiredRun(inserted.rows[0]);
    });
  }

  async getRecoveryRun(recoveryRunId: string): Promise<PostgresEvidenceRecoveryRun | undefined> {
    const result = await this.#pool.query<RecoveryRunRow>(
      `SELECT *,revision::text FROM evidence_recovery_run WHERE recovery_run_id=$1`,
      [bounded(recoveryRunId, 'recoveryRunId', 256)],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toRecoveryRun(row);
  }

  async listRecoverableRuns(limit: number): Promise<readonly PostgresEvidenceRecoveryRun[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('EVIDENCE_RECOVERY_RESUME_LIMIT_INVALID');
    }
    const result = await this.#pool.query<RecoveryRunRow>(
      `SELECT *,revision::text FROM evidence_recovery_run
       WHERE status IN ('requested','running')
       ORDER BY requested_at,recovery_run_id LIMIT $1`,
      [limit],
    );
    return Object.freeze(result.rows.map(toRecoveryRun));
  }

  async resumeRecoveryRun(recoveryRunId: string): Promise<PostgresEvidenceRecoveryRun> {
    const cleanRunId = bounded(recoveryRunId, 'recoveryRunId', 256);

    // Claim is committed independently. A crash after this point leaves a durable running
    // run which resumeRecoveryRuns() can re-drive without repeating the request insert.
    const claimed = await withTransaction(this.#pool, async (client) => {
      const locked = await client.query<RecoveryAuthorityRow>(
        `SELECT *,configuration_revision::text,revision::text
         FROM evidence_recovery_run WHERE recovery_run_id=$1 FOR UPDATE`,
        [cleanRunId],
      );
      const current = locked.rows[0];
      if (current === undefined) throw new Error('EVIDENCE_RECOVERY_RUN_MISSING');
      if (current.status === 'succeeded' || current.status === 'failed') return current;
      const updated = await client.query<RecoveryAuthorityRow>(
        `UPDATE evidence_recovery_run SET status='running',
           attempt_count=attempt_count+1,
           started_at=COALESCE(started_at,GREATEST(requested_at,clock_timestamp())),
           wake_requested_at=GREATEST(wake_requested_at,clock_timestamp()),
           revision=revision+1
         WHERE recovery_run_id=$1 RETURNING *,configuration_revision::text,revision::text`,
        [cleanRunId],
      );
      const row = updated.rows[0];
      if (row === undefined) throw new Error('EVIDENCE_RECOVERY_RUN_CLAIM_RETURNED_NO_ROW');
      return row;
    });
    if (claimed.status === 'succeeded' || claimed.status === 'failed') {
      return toRecoveryRun(claimed);
    }

    // The recovery side effect and its terminal result share a third transaction, separate
    // from both the durable request and claim commits.
    return withTransaction(this.#pool, async (client) => {
      const locked = await client.query<RecoveryAuthorityRow>(
        `SELECT *,configuration_revision::text,revision::text
         FROM evidence_recovery_run WHERE recovery_run_id=$1 FOR UPDATE`,
        [cleanRunId],
      );
      const current = locked.rows[0];
      if (current === undefined) throw new Error('EVIDENCE_RECOVERY_RUN_MISSING');
      if (current.status === 'succeeded' || current.status === 'failed') {
        return toRecoveryRun(current);
      }
      const command = recoveryCommandFromRow(current);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('runtime.evidence-export'))`);
      await client.query('SAVEPOINT evidence_recovery_action');
      try {
        await assertActiveRecoveryConfiguration(client, command);
        const result = await executeRecoveryAction(client, cleanRunId, command);
        if (result.deferred === true) {
          if (command.operation === 'apply_retention') {
            const runningRetention = await client.query<RecoveryRunRow>(
              `UPDATE evidence_recovery_run
               SET affected_records=COALESCE(affected_records,0)+$2,
                 result_summary=jsonb_build_object(
                   'purgedDiagnosticRecords',COALESCE(affected_records,0)+$2,
                   'lastBatchRecords',$2
                 ),revision=revision+1
               WHERE recovery_run_id=$1 RETURNING *,revision::text`,
              [cleanRunId, result.affectedRecords],
            );
            return requiredRun(runningRetention.rows[0]);
          }
          const running = await client.query<RecoveryRunRow>(
            `UPDATE evidence_recovery_run SET affected_records=$2,
               result_summary=$3::jsonb,revision=revision+1
             WHERE recovery_run_id=$1 RETURNING *,revision::text`,
            [
              cleanRunId,
              result.affectedRecords,
              JSON.stringify({ pendingCoverageEpisodes: result.affectedRecords }),
            ],
          );
          return requiredRun(running.rows[0]);
        }
        if (command.operation === 'apply_retention') {
          const completedRetention = await client.query<RecoveryRunRow>(
            `UPDATE evidence_recovery_run SET status='succeeded',
               affected_records=COALESCE(affected_records,0)+$2,
               result_summary=jsonb_build_object(
                 'purgedDiagnosticRecords',COALESCE(affected_records,0)+$2,
                 'lastBatchRecords',$2
               ),completed_at=GREATEST(started_at,clock_timestamp()),
               revision=revision+1
             WHERE recovery_run_id=$1 RETURNING *,revision::text`,
            [cleanRunId, result.affectedRecords],
          );
          return requiredRun(completedRetention.rows[0]);
        }
        const completed = await client.query<RecoveryRunRow>(
          `UPDATE evidence_recovery_run SET status='succeeded',affected_records=$2,
             result_summary=$3::jsonb,
             completed_at=GREATEST(started_at,clock_timestamp()),revision=revision+1
           WHERE recovery_run_id=$1 RETURNING *,revision::text`,
          [
            cleanRunId,
            result.affectedRecords,
            JSON.stringify(
              command.operation === 'reconcile_coverage'
                ? { reconciledCoverageEpisodes: result.affectedRecords }
                : { sourcePartitions: result.sourcePartitions.length },
            ),
          ],
        );
        return requiredRun(completed.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT evidence_recovery_action');
        const failed = await client.query<RecoveryRunRow>(
          `UPDATE evidence_recovery_run SET status='failed',
             affected_records=COALESCE(affected_records,0),
             result_summary=CASE WHEN operation='apply_retention'
               THEN result_summary ELSE NULL END,last_error_code=$2,
             completed_at=GREATEST(started_at,clock_timestamp()),revision=revision+1
           WHERE recovery_run_id=$1 RETURNING *,revision::text`,
          [cleanRunId, recoveryErrorCode(error)],
        );
        return requiredRun(failed.rows[0]);
      }
    });
  }

  async claimCoverageRecoveryTarget(
    recoveryRunId: string,
    claimedAt: string,
  ): Promise<EvidenceCoverageRecoveryTarget | undefined> {
    const cleanRunId = bounded(recoveryRunId, 'recoveryRunId', 256);
    const cleanClaimedAt = timestamp(claimedAt, 'claimedAt');
    const claimToken = `coverage-claim:${randomUUID()}`;
    return withTransaction(this.#pool, async (client) => {
      const result = await client.query<
        CoverageRecoveryTargetRow & {
          task_id: string;
          terminal_outcome_id: string;
          seal_requested: boolean;
        }
      >(coverageTargetClaimSql, [cleanRunId, cleanClaimedAt, claimToken]);
      const row = result.rows[0];
      if (row === undefined) return undefined;
      return Object.freeze({
        recoveryRunId: row.recovery_run_id,
        episodeId: row.episode_id,
        taskId: row.task_id,
        terminalOutcomeId: row.terminal_outcome_id,
        sealRequested: row.seal_requested,
        claimToken: row.claim_token,
      });
    });
  }

  async completeCoverageRecoveryTarget(
    target: EvidenceCoverageRecoveryTarget,
    completedAt: string,
  ): Promise<PostgresEvidenceRecoveryRun> {
    const completed = timestamp(completedAt, 'completedAt');
    return withTransaction(this.#pool, async (client) => {
      const authority = await client.query<RecoveryAuthorityRow>(
        `SELECT recovery.*,recovery.configuration_revision::text,recovery.revision::text
         FROM evidence_recovery_run recovery
         WHERE recovery.recovery_run_id=$1 FOR UPDATE`,
        [bounded(target.recoveryRunId, 'recoveryRunId', 256)],
      );
      const currentAuthority = authority.rows[0];
      if (currentAuthority === undefined) throw new Error('EVIDENCE_RECOVERY_RUN_MISSING');
      if (currentAuthority.status === 'succeeded' || currentAuthority.status === 'failed') {
        return toRecoveryRun(currentAuthority);
      }
      const active = await client.query(
        `SELECT 1 FROM evidence_export_configuration
         WHERE export_id=$1 AND revision=$2 AND is_active FOR SHARE`,
        [currentAuthority.export_id, currentAuthority.configuration_revision],
      );
      if (active.rowCount !== 1) {
        const stale = await client.query<RecoveryRunRow>(
          `UPDATE evidence_recovery_run SET status='failed',
             last_error_code='EVIDENCE_RECOVERY_CONFIGURATION_STALE',
             completed_at=GREATEST(started_at,$2::timestamptz),revision=revision+1
           WHERE recovery_run_id=$1 RETURNING *,revision::text`,
          [target.recoveryRunId, completed],
        );
        return requiredRun(stale.rows[0]);
      }
      const targetResult = await client.query(
        `UPDATE evidence_coverage_reconcile_target
         SET completed_at=GREATEST(requested_at,$4::timestamptz)
         WHERE recovery_run_id=$1 AND episode_id=$2 AND claim_token=$3
           AND completed_at IS NULL`,
        [
          bounded(target.recoveryRunId, 'recoveryRunId', 256),
          bounded(target.episodeId, 'episodeId', 2_048),
          bounded(target.claimToken, 'claimToken', 256),
          completed,
        ],
      );
      if (targetResult.rowCount !== 1) {
        const replay = await client.query<{ completed_at: Date | string | null }>(
          `SELECT completed_at FROM evidence_coverage_reconcile_target
           WHERE recovery_run_id=$1 AND episode_id=$2 AND claim_token=$3`,
          [target.recoveryRunId, target.episodeId, target.claimToken],
        );
        if (replay.rows[0]?.completed_at === null || replay.rows[0] === undefined) {
          throw new EvidenceRecoveryActionError(
            'EVIDENCE_COVERAGE_RECOVERY_CLAIM_STALE',
            'The Evidence coverage recovery target claim is no longer authoritative.',
          );
        }
      }
      const run = await client.query<RecoveryRunRow>(
        `UPDATE evidence_recovery_run recovery SET status='succeeded',
           result_summary=jsonb_build_object(
             'reconciledCoverageEpisodes',COALESCE(recovery.affected_records,0)
           ),completed_at=GREATEST(recovery.started_at,$2::timestamptz),revision=revision+1
         WHERE recovery.recovery_run_id=$1 AND recovery.status='running'
           AND NOT EXISTS (
             SELECT 1 FROM evidence_coverage_reconcile_target target
             WHERE target.recovery_run_id=recovery.recovery_run_id
               AND target.completed_at IS NULL
           )
         RETURNING *,revision::text`,
        [target.recoveryRunId, completed],
      );
      if (run.rows[0] !== undefined) return requiredRun(run.rows[0]);
      const current = await client.query<RecoveryRunRow>(
        `SELECT *,revision::text FROM evidence_recovery_run WHERE recovery_run_id=$1`,
        [target.recoveryRunId],
      );
      return requiredRun(current.rows[0]);
    });
  }

  async failRecoveryRun(
    recoveryRunId: string,
    errorCode: string,
    completedAt: string,
  ): Promise<PostgresEvidenceRecoveryRun> {
    const cleanCode = boundedErrorCode(errorCode);
    return withTransaction(this.#pool, async (client) => {
      const failed = await client.query<RecoveryRunRow>(
        `UPDATE evidence_recovery_run SET status='failed',last_error_code=$2,
           started_at=COALESCE(started_at,GREATEST(requested_at,$3::timestamptz)),
           completed_at=GREATEST(
             COALESCE(started_at,requested_at),$3::timestamptz
           ),revision=revision+1
         WHERE recovery_run_id=$1 AND status IN ('requested','running')
         RETURNING *,revision::text`,
        [
          bounded(recoveryRunId, 'recoveryRunId', 256),
          cleanCode,
          timestamp(completedAt, 'completedAt'),
        ],
      );
      if (failed.rows[0] !== undefined) return requiredRun(failed.rows[0]);
      const current = await client.query<RecoveryRunRow>(
        `SELECT *,revision::text FROM evidence_recovery_run WHERE recovery_run_id=$1`,
        [recoveryRunId],
      );
      return requiredRun(current.rows[0]);
    });
  }
}

async function executeRecoveryAction(
  client: PoolClient,
  recoveryRunId: string,
  command: PostgresEvidenceRecoveryCommand,
): Promise<RecoveryActionResult> {
  switch (command.operation) {
    case 'replay_record':
      return replayRecords(
        client,
        `evidence.record_id=$1`,
        [command.recordId],
        command.requestedAt,
        command,
        false,
      );
    case 'replay_source_partition': {
      assertKnownSourceFamily(command.sourceFamily);
      const checkpoint = await client.query(
        `SELECT 1 FROM evidence_source_checkpoint
         WHERE source_family=$1 AND source_partition=$2`,
        [command.sourceFamily, command.sourcePartition],
      );
      if (checkpoint.rowCount !== 1) {
        throw new EvidenceRecoveryActionError(
          'EVIDENCE_RECOVERY_SOURCE_PARTITION_NOT_FOUND',
          'The exact Evidence source family and partition checkpoint does not exist.',
        );
      }
      return replayRecords(
        client,
        `evidence.source_partition=$1`,
        [command.sourcePartition],
        command.requestedAt,
        command,
        true,
        command.sourceFamily,
      );
    }
    case 'replay_episode': {
      const episode = await client.query(
        `SELECT 1 FROM evidence_outbox WHERE episode_id=$1 LIMIT 1`,
        [command.episodeId],
      );
      if (episode.rowCount !== 1) {
        throw new EvidenceRecoveryActionError(
          'EVIDENCE_RECOVERY_TARGET_NOT_FOUND',
          'The requested Evidence episode replay target does not exist.',
        );
      }
      return replayRecords(
        client,
        `evidence.episode_id=$1`,
        [command.episodeId],
        command.requestedAt,
        command,
        true,
      );
    }
    case 'retry_dead_letter':
      return retryDeadLetter(client, command);
    case 'reconcile_coverage': {
      const terminal = await client.query(
        `SELECT 1 FROM runtime_terminal_outcome outcome
         WHERE outcome.task_id IS NOT NULL
           AND ($1::text IS NULL OR outcome.task_id=$1) LIMIT 1`,
        [command.episodeId ?? null],
      );
      if (command.episodeId !== undefined && terminal.rowCount !== 1) {
        throw new EvidenceRecoveryActionError(
          'EVIDENCE_RECOVERY_EPISODE_NOT_FOUND',
          'The requested terminal Evidence episode does not exist.',
        );
      }
      await client.query(
        `INSERT INTO evidence_coverage_reconcile_target(
           recovery_run_id,episode_id,requested_at)
         SELECT $1,outcome.task_id,$3 FROM runtime_terminal_outcome outcome
         WHERE outcome.task_id IS NOT NULL AND ($2::text IS NULL OR outcome.task_id=$2)
         ORDER BY outcome.task_id LIMIT ${String(maximumReplayRecords + 1)}
         ON CONFLICT (recovery_run_id,episode_id) DO NOTHING
         RETURNING episode_id`,
        [recoveryRunId, command.episodeId ?? null, command.requestedAt],
      );
      const totals = await client.query<{ total: string; pending: string }>(
        `SELECT count(*)::text AS total,
           count(*) FILTER (WHERE completed_at IS NULL)::text AS pending
         FROM evidence_coverage_reconcile_target WHERE recovery_run_id=$1`,
        [recoveryRunId],
      );
      const affectedRecords = Number(totals.rows[0]?.total ?? '0');
      const pending = Number(totals.rows[0]?.pending ?? '0');
      if (affectedRecords > maximumReplayRecords) {
        throw new EvidenceRecoveryActionError(
          'EVIDENCE_RECOVERY_TARGET_TOO_LARGE',
          'The requested coverage reconciliation exceeds the bounded recovery limit.',
        );
      }
      return Object.freeze({
        affectedRecords,
        sourcePartitions: Object.freeze([]),
        deferred: pending > 0,
      });
    }
    case 'apply_retention':
      return applyRetention(client, command);
  }
}

async function replayRecords(
  client: PoolClient,
  predicate: 'evidence.record_id=$1' | 'evidence.source_partition=$1' | 'evidence.episode_id=$1',
  values: readonly [string],
  replayedAt: string,
  command: PostgresEvidenceRecoveryCommand,
  collection: boolean,
  sourceFamily?: string,
): Promise<RecoveryActionResult> {
  const records = await client.query<ReplayRecordRow>(
    collection
      ? `SELECT evidence.sequence::text,evidence.source_partition
         FROM evidence_outbox evidence
         JOIN evidence_export_configuration configuration
           ON configuration.export_id=$2 AND configuration.revision=$3
             AND configuration.is_active
         WHERE ${predicate}
           AND configuration.definition->'includedFamilies' ? evidence.record_family
           AND NOT (evidence.evaluation_role='diagnostic' AND COALESCE(
             configuration.definition->'excludedDiagnosticTypes','[]'::jsonb
           ) ? evidence.record_type)
           AND ($4::text IS NULL OR ${sourceFamilyRecordFamilyPredicate})
           AND NOT EXISTS (
             SELECT 1 FROM evidence_dead_letter dead_letter
             WHERE dead_letter.sequence=evidence.sequence AND dead_letter.requeued_at IS NULL
           )
         ORDER BY evidence.sequence LIMIT ${String(maximumReplayRecords + 1)}
         FOR UPDATE OF evidence`
      : `SELECT evidence.sequence::text,evidence.source_partition
         FROM evidence_outbox evidence WHERE ${predicate}
         ORDER BY evidence.sequence LIMIT ${String(maximumReplayRecords + 1)}
         FOR UPDATE OF evidence`,
    collection
      ? [values[0], command.exportId, command.configurationRevision, sourceFamily ?? null]
      : [...values],
  );
  if (!collection && records.rows.length === 0) {
    throw new EvidenceRecoveryActionError(
      'EVIDENCE_RECOVERY_TARGET_NOT_FOUND',
      'The requested Evidence replay target does not exist.',
    );
  }
  if (records.rows.length === 0) {
    throw new EvidenceRecoveryActionError(
      'EVIDENCE_RECOVERY_NO_ELIGIBLE_RECORDS',
      'The requested Evidence collection contains no active-configuration eligible records.',
    );
  }
  if (records.rows.length > maximumReplayRecords) {
    throw new EvidenceRecoveryActionError(
      'EVIDENCE_RECOVERY_TARGET_TOO_LARGE',
      'The requested Evidence replay target exceeds the bounded recovery limit.',
    );
  }
  const sequences = records.rows.map((row) => row.sequence);
  if (!collection) {
    await assertReplayScope(client, sequences, command);
    const unresolvedDeadLetters = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM evidence_dead_letter
       WHERE sequence=ANY($1::bigint[]) AND requeued_at IS NULL`,
      [sequences],
    );
    if (unresolvedDeadLetters.rows[0]?.count !== '0') {
      throw new EvidenceRecoveryActionError(
        'EVIDENCE_RECOVERY_TARGET_DEAD_LETTERED',
        'Dead-lettered Evidence must be retried through its dedicated audited operation.',
      );
    }
  }
  await client.query(
    `UPDATE evidence_outbox SET acknowledged_at=NULL,sent_export_id=NULL,
       sent_fencing_token=NULL,sent_at=NULL,delivery_attempts=0,next_attempt_at=$2,
       last_error_code=NULL WHERE sequence=ANY($1::bigint[])`,
    [sequences, replayedAt],
  );
  const sourcePartitions = unique(records.rows.map((row) => row.source_partition));
  await resetPartitionDeliveryState(client, sourcePartitions, replayedAt, command);
  return Object.freeze({ affectedRecords: records.rows.length, sourcePartitions });
}

async function retryDeadLetter(
  client: PoolClient,
  command: Extract<PostgresEvidenceRecoveryCommand, { operation: 'retry_dead_letter' }>,
): Promise<RecoveryActionResult> {
  const selected = await client.query<ReplayRecordRow & { requeued_at: Date | string | null }>(
    `SELECT evidence.sequence::text,evidence.source_partition,dead_letter.requeued_at
     FROM evidence_dead_letter dead_letter
     JOIN evidence_outbox evidence ON evidence.sequence=dead_letter.sequence
     WHERE dead_letter.dead_letter_id=$1 FOR UPDATE OF dead_letter,evidence`,
    [command.deadLetterId],
  );
  const row = selected.rows[0];
  if (row === undefined) {
    throw new EvidenceRecoveryActionError(
      'EVIDENCE_RECOVERY_DEAD_LETTER_NOT_FOUND',
      'The requested Evidence dead letter does not exist.',
    );
  }
  if (row.requeued_at !== null) {
    return Object.freeze({ affectedRecords: 0, sourcePartitions: Object.freeze([]) });
  }
  await assertReplayScope(client, [row.sequence], command);
  await client.query(
    `UPDATE evidence_dead_letter SET requeued_at=$2,requeue_count=requeue_count+1,
       requeued_by=$3,requeue_reason=$4 WHERE dead_letter_id=$1`,
    [command.deadLetterId, command.requestedAt, command.actorId, command.reason],
  );
  await client.query(
    `UPDATE evidence_outbox SET acknowledged_at=NULL,sent_export_id=NULL,
       sent_fencing_token=NULL,sent_at=NULL,delivery_attempts=0,next_attempt_at=$2,
       last_error_code=NULL WHERE sequence=$1::bigint`,
    [row.sequence, command.requestedAt],
  );
  const sourcePartitions = Object.freeze([row.source_partition]);
  await resetPartitionDeliveryState(client, sourcePartitions, command.requestedAt, command);
  return Object.freeze({ affectedRecords: 1, sourcePartitions });
}

async function applyRetention(
  client: PoolClient,
  command: Extract<PostgresEvidenceRecoveryCommand, { operation: 'apply_retention' }>,
): Promise<RecoveryActionResult> {
  const purged = await client.query<{ source_partition: string }>(
    `WITH policy AS (
       SELECT configuration.definition,
         GREATEST(1,COALESCE(
           (configuration.definition->'outboxPolicy'->>'retentionDays')::integer,30
         )) AS retention_days
       FROM evidence_export_configuration configuration
       WHERE configuration.export_id=$1 AND configuration.revision=$2
         AND configuration.is_active
     ), candidate AS (
       SELECT evidence.sequence
       FROM evidence_outbox evidence JOIN policy ON true
       WHERE evidence.evaluation_role='diagnostic'
         AND evidence.acknowledged_at IS NOT NULL
         AND evidence.captured_at < $3::timestamptz
           - make_interval(days => policy.retention_days)
         AND evidence.record_type <> 'node_control.audit_event'
         AND NOT EXISTS (
           SELECT 1 FROM evidence_dead_letter dead_letter
           WHERE dead_letter.sequence=evidence.sequence
         )
         AND NOT EXISTS (
           SELECT 1 FROM evidence_expected_record expectation
           WHERE expectation.evidence_sequence=evidence.sequence
         )
       ORDER BY evidence.sequence
       LIMIT 1000 FOR UPDATE OF evidence SKIP LOCKED
     )
     DELETE FROM evidence_outbox evidence USING candidate
     WHERE evidence.sequence=candidate.sequence
     RETURNING evidence.source_partition`,
    [command.exportId, command.configurationRevision, command.requestedAt],
  );
  const sourcePartitions = unique(purged.rows.map((row) => row.source_partition));
  if (sourcePartitions.length > 0) {
    await resetPartitionDeliveryState(client, sourcePartitions, command.requestedAt, command);
  }
  return Object.freeze({
    affectedRecords: purged.rows.length,
    sourcePartitions,
    deferred: purged.rows.length === 1000,
  });
}

async function assertActiveRecoveryConfiguration(
  client: PoolClient,
  command: PostgresEvidenceRecoveryCommand,
): Promise<void> {
  const active = await client.query(
    `SELECT 1 FROM evidence_export_configuration
     WHERE export_id=$1 AND revision=$2 AND is_active FOR SHARE`,
    [command.exportId, command.configurationRevision],
  );
  if (active.rowCount !== 1) {
    throw new EvidencePersistenceError(
      'EVIDENCE_RECOVERY_CONFIGURATION_STALE',
      'Evidence recovery configuration is no longer the active authority revision.',
    );
  }
}

async function assertReplayScope(
  client: PoolClient,
  sequences: readonly string[],
  command: PostgresEvidenceRecoveryCommand,
): Promise<void> {
  const outside = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM evidence_outbox evidence
     WHERE evidence.sequence=ANY($1::bigint[]) AND NOT EXISTS (
       SELECT 1 FROM evidence_export_configuration configuration
       WHERE configuration.export_id=$2 AND configuration.revision=$3
         AND configuration.is_active
         AND configuration.definition->'includedFamilies' ? evidence.record_family
         AND NOT (evidence.evaluation_role='diagnostic' AND COALESCE(
           configuration.definition->'excludedDiagnosticTypes','[]'::jsonb
         ) ? evidence.record_type)
     )`,
    [sequences, command.exportId, command.configurationRevision],
  );
  if (outside.rows[0]?.count !== '0') {
    throw new EvidenceRecoveryActionError(
      'EVIDENCE_RECOVERY_OUTSIDE_ACTIVE_SCOPE',
      'Evidence delivery replay cannot include records excluded by the active configuration.',
    );
  }
}

async function resetPartitionDeliveryState(
  client: PoolClient,
  sourcePartitions: readonly string[],
  observedAt: string,
  command: PostgresEvidenceRecoveryCommand,
): Promise<void> {
  for (const sourcePartition of sourcePartitions) {
    const frontier = await client.query<{
      sent_sequence: string | null;
      acknowledged_sequence: string | null;
      acknowledged_at: Date | string | null;
    }>(
      `WITH eligible AS (
         SELECT evidence.sequence,evidence.sent_at,evidence.acknowledged_at
         FROM evidence_outbox evidence
         JOIN evidence_export_configuration configuration
           ON configuration.export_id=$2 AND configuration.revision=$3
             AND configuration.is_active
         WHERE evidence.source_partition=$1
           AND configuration.definition->'includedFamilies' ? evidence.record_family
           AND NOT (evidence.evaluation_role='diagnostic' AND COALESCE(
             configuration.definition->'excludedDiagnosticTypes','[]'::jsonb
           ) ? evidence.record_type)
       ), frontier AS (
         SELECT min(sequence) FILTER (WHERE acknowledged_at IS NULL) AS first_unacknowledged,
                max(sequence) FILTER (WHERE sent_at IS NOT NULL) AS sent_sequence
         FROM eligible
       )
       SELECT frontier.sent_sequence::text,
              acknowledged.sequence::text AS acknowledged_sequence,
              acknowledged.acknowledged_at
       FROM frontier
       LEFT JOIN LATERAL (
         SELECT eligible.sequence,eligible.acknowledged_at
         FROM eligible
         WHERE eligible.acknowledged_at IS NOT NULL
           AND (
             frontier.first_unacknowledged IS NULL
             OR eligible.sequence < frontier.first_unacknowledged
           )
         ORDER BY eligible.sequence DESC
         LIMIT 1
       ) acknowledged ON true`,
      [sourcePartition, command.exportId, command.configurationRevision],
    );
    const state = frontier.rows[0];
    await client.query(
      `UPDATE evidence_export_state state SET status='idle',
         last_sent_sequence=$2::bigint,last_acknowledged_sequence=$3::bigint,
         last_acknowledged_at=$4,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
         fencing_token=fencing_token+1,last_error_code=NULL,last_error_at=NULL,observed_at=$5
       FROM evidence_export_configuration configuration
       WHERE state.export_id=configuration.export_id
         AND configuration.export_id=$6 AND configuration.revision=$7
         AND configuration.is_active
         AND state.source_partition=$1`,
      [
        sourcePartition,
        state?.sent_sequence ?? null,
        state?.acknowledged_sequence ?? null,
        state?.acknowledged_at ?? null,
        observedAt,
        command.exportId,
        command.configurationRevision,
      ],
    );
  }
  await client.query(
    `UPDATE evidence_export_state state
     SET status='idle',last_error_code=NULL,last_error_at=NULL,observed_at=$1
     FROM evidence_export_configuration configuration
     WHERE state.export_id=configuration.export_id
       AND configuration.export_id=$2 AND configuration.revision=$3
       AND configuration.is_active
       AND state.source_partition='all' AND state.status='high_watermark'
       AND (
         SELECT count(*) FROM evidence_outbox evidence
         WHERE evidence.acknowledged_at IS NULL
           AND configuration.definition->'includedFamilies' ? evidence.record_family
           AND NOT (evidence.evaluation_role='diagnostic' AND COALESCE(
             configuration.definition->'excludedDiagnosticTypes','[]'::jsonb
           ) ? evidence.record_type)
           AND NOT EXISTS (
             SELECT 1 FROM evidence_dead_letter dead_letter
             WHERE dead_letter.sequence=evidence.sequence AND dead_letter.requeued_at IS NULL
           )
       ) < COALESCE(
         (configuration.definition->'outboxPolicy'->>'maxPendingRecords')::bigint,10000
       )`,
    [observedAt, command.exportId, command.configurationRevision],
  );
}

function toOutboxMetadata(row: OutboxMetadataRow): EvidenceOutboxRecordMetadata {
  return Object.freeze({
    sequence: row.sequence,
    recordId: row.record_id,
    recordFamily: row.record_family,
    recordType: row.record_type,
    schemaName: row.schema_name,
    schemaVersion: row.schema_version,
    sourceSystem: row.source_system,
    sourceTable: row.source_table,
    sourceRecordId: row.source_record_id,
    sourceRevision: row.source_revision,
    sourcePartition: row.source_partition,
    evaluationRole: row.evaluation_role,
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    ...(row.episode_id === null ? {} : { episodeId: row.episode_id }),
    payloadHash: row.payload_hash,
    capturedAt: iso(row.captured_at),
    deliveryAttempts: row.delivery_attempts,
    nextAttemptAt: iso(row.next_attempt_at),
    ...(row.sent_at === null ? {} : { sentAt: iso(row.sent_at) }),
    ...(row.acknowledged_at === null ? {} : { acknowledgedAt: iso(row.acknowledged_at) }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
  });
}

function toCheckpointMetadata(row: CheckpointMetadataRow): EvidenceProjectionCheckpointMetadata {
  return Object.freeze({
    sourceFamily: row.source_family,
    sourcePartition: row.source_partition,
    ...(row.last_occurred_at === null ? {} : { lastOccurredAt: iso(row.last_occurred_at) }),
    ...(row.last_source_record_id === null
      ? {}
      : { lastSourceRecordId: row.last_source_record_id }),
    ...(row.last_source_revision === null ? {} : { lastSourceRevision: row.last_source_revision }),
    ...(row.last_payload_hash === null ? {} : { lastPayloadHash: row.last_payload_hash }),
    ...(row.last_projected_at === null ? {} : { lastProjectedAt: iso(row.last_projected_at) }),
    projectorVersion: row.projector_version,
  });
}

function toProjectionIssueMetadata(
  row: ProjectionIssueMetadataRow,
): EvidenceProjectionIssueMetadata {
  return Object.freeze({
    ...issueMetadata(row),
    evaluationRole: row.evaluation_role,
    sourcePartition: row.source_partition,
    projectorVersion: row.projector_version,
    retryable: row.retryable,
  });
}

function toQualityIssueMetadata(row: QualityIssueMetadataRow): EvidenceQualityIssueMetadata {
  return Object.freeze(issueMetadata(row));
}

function issueMetadata(row: QualityIssueMetadataRow): EvidenceQualityIssueMetadata {
  return {
    issueId: row.issue_id,
    ...(row.rule_id === null ? {} : { ruleId: row.rule_id }),
    issueCode: row.issue_code,
    severity: row.severity,
    ...(row.record_type === null ? {} : { recordType: row.record_type }),
    ...(row.record_id === null ? {} : { recordId: row.record_id }),
    ...(row.episode_id === null ? {} : { episodeId: row.episode_id }),
    sourceSystem: row.source_system,
    sourceTable: row.source_table,
    sourceRecordId: row.source_record_id,
    firstObservedAt: iso(row.first_observed_at),
    lastObservedAt: iso(row.last_observed_at),
    ...(row.resolved_at === null ? {} : { resolvedAt: iso(row.resolved_at) }),
    revision: row.revision,
  };
}

function toManifestMetadata(row: ManifestMetadataRow): EvidenceManifestMetadata {
  return Object.freeze({
    manifestId: row.manifest_id,
    revision: row.revision,
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
    sourceCoverage: Object.freeze({ ...row.source_coverage }),
    lastEvidenceSequence: row.last_evidence_sequence,
    status: row.status,
    qualityIssueIds: Object.freeze([...row.quality_issue_ids]),
    sourceSnapshotHash: row.source_snapshot_hash,
    createdAt: iso(row.created_at),
    recomputedAt: iso(row.recomputed_at),
    ...(row.sealed_at === null ? {} : { sealedAt: iso(row.sealed_at) }),
  });
}

function toDeadLetterMetadata(row: DeadLetterMetadataRow): EvidenceDeadLetterMetadata {
  return Object.freeze({
    deadLetterId: row.dead_letter_id,
    sequence: row.sequence,
    recordId: row.record_id,
    issueCode: row.issue_code,
    attempts: row.attempts,
    failedAt: iso(row.failed_at),
    ...(row.requeued_at === null ? {} : { requeuedAt: iso(row.requeued_at) }),
    requeueCount: row.requeue_count,
    ...(row.requeued_by === null ? {} : { requeuedBy: row.requeued_by }),
    ...(row.requeue_reason === null ? {} : { requeueReason: row.requeue_reason }),
  });
}

function metadataPage<Row, Metadata>(
  rows: readonly Row[],
  limit: number,
  cursor: (row: Row) => string,
  map: (row: Row) => Metadata,
): EvidenceMetadataPage<Metadata> {
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return Object.freeze({
    items: Object.freeze(selected.map(map)),
    ...(rows.length <= limit || last === undefined ? {} : { nextCursor: cursor(last) }),
  });
}

function pageLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new Error('EVIDENCE_OPERATIONS_PAGE_LIMIT_INVALID');
  }
  return value;
}

function decimalCursor(value: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error('EVIDENCE_OPERATIONS_CURSOR_INVALID');
  }
  return value;
}

function encodeCursor(values: readonly string[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

function decodeCursor(value: string, expectedValues: number): readonly (string | null)[] {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== expectedValues ||
      decoded.some((item) => typeof item !== 'string' || item.length > 2_048)
    ) {
      throw new Error('invalid');
    }
    return decoded as readonly string[];
  } catch {
    throw new Error('EVIDENCE_OPERATIONS_CURSOR_INVALID');
  }
}

function recoveryTarget(
  command: PostgresEvidenceRecoveryCommand,
): Readonly<Record<string, string>> {
  switch (command.operation) {
    case 'replay_record':
      return Object.freeze({ recordId: command.recordId });
    case 'replay_source_partition':
      return Object.freeze({
        sourceFamily: command.sourceFamily,
        sourcePartition: command.sourcePartition,
      });
    case 'replay_episode':
      return Object.freeze({ episodeId: command.episodeId });
    case 'retry_dead_letter':
      return Object.freeze({ deadLetterId: command.deadLetterId });
    case 'reconcile_coverage':
      return command.episodeId === undefined
        ? Object.freeze({})
        : Object.freeze({ episodeId: command.episodeId });
    case 'apply_retention':
      return Object.freeze({});
  }
}

function recoveryCommandFromRow(row: RecoveryAuthorityRow): PostgresEvidenceRecoveryCommand {
  const common = Object.freeze({
    operationId: row.operation_id,
    idempotencyKeyHash: sha256(row.idempotency_key_hash, 'idempotencyKeyHash'),
    requestHash: sha256(row.request_hash, 'requestHash'),
    exportId: row.export_id,
    configurationRevision: Number(row.configuration_revision),
    actorId: row.actor_id,
    reason: row.reason,
    requestedAt: iso(row.requested_at),
  });
  switch (row.operation) {
    case 'replay_record':
      return Object.freeze({
        ...common,
        operation: row.operation,
        recordId: recoveryTargetValue(row, 'recordId'),
      });
    case 'replay_source_partition':
      return Object.freeze({
        ...common,
        operation: row.operation,
        sourceFamily: recoveryTargetValue(row, 'sourceFamily'),
        sourcePartition: recoveryTargetValue(row, 'sourcePartition'),
      });
    case 'replay_episode':
      return Object.freeze({
        ...common,
        operation: row.operation,
        episodeId: recoveryTargetValue(row, 'episodeId'),
      });
    case 'retry_dead_letter':
      return Object.freeze({
        ...common,
        operation: row.operation,
        deadLetterId: recoveryTargetValue(row, 'deadLetterId'),
      });
    case 'reconcile_coverage': {
      const episodeId = row.target['episodeId'];
      return Object.freeze({
        ...common,
        operation: row.operation,
        ...(episodeId === undefined ? {} : { episodeId: bounded(episodeId, 'episodeId', 2_048) }),
      });
    }
    case 'apply_retention':
      return Object.freeze({ ...common, operation: row.operation });
  }
}

function recoveryTargetValue(row: RecoveryAuthorityRow, field: string): string {
  const value = row.target[field];
  if (value === undefined)
    throw new Error(`EVIDENCE_RECOVERY_TARGET_${field.toUpperCase()}_MISSING`);
  return bounded(value, field, 2_048);
}

function assertRecoveryCommand(command: PostgresEvidenceRecoveryCommand): void {
  bounded(command.operationId, 'operationId', 256);
  sha256(command.idempotencyKeyHash, 'idempotencyKeyHash');
  sha256(command.requestHash, 'requestHash');
  bounded(command.exportId, 'exportId', 256);
  if (!Number.isSafeInteger(command.configurationRevision) || command.configurationRevision < 1) {
    throw new Error('EVIDENCE_RECOVERY_CONFIGURATIONREVISION_INVALID');
  }
  bounded(command.actorId, 'actorId', 256);
  bounded(command.reason, 'reason', 2_048);
  timestamp(command.requestedAt, 'requestedAt');
  for (const value of Object.values(recoveryTarget(command))) bounded(value, 'target', 2_048);
}

function toRecoveryRun(row: RecoveryRunRow): PostgresEvidenceRecoveryRun {
  return Object.freeze({
    recoveryRunId: row.recovery_run_id,
    operationId: row.operation_id,
    idempotencyKeyHash: sha256(row.idempotency_key_hash, 'idempotencyKeyHash'),
    requestHash: sha256(row.request_hash, 'requestHash'),
    operation: row.operation,
    target: Object.freeze({ ...row.target }),
    actorId: row.actor_id,
    reason: row.reason,
    status: row.status,
    affectedRecords: row.affected_records ?? 0,
    ...(row.result_summary === null ? {} : { resultSummary: Object.freeze(row.result_summary) }),
    ...(row.last_error_code === null ? {} : { errorCode: row.last_error_code }),
    requestedAt: iso(row.requested_at),
    ...(row.started_at === null ? {} : { startedAt: iso(row.started_at) }),
    ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
    revision: Number(row.revision),
  });
}

function requiredRun(row: RecoveryRunRow | undefined): PostgresEvidenceRecoveryRun {
  if (row === undefined) throw new Error('EVIDENCE_RECOVERY_RUN_UPDATE_RETURNED_NO_ROW');
  return toRecoveryRun(row);
}

function recoveryErrorCode(error: unknown): string {
  if (error instanceof EvidenceRecoveryActionError) return error.code;
  if (error instanceof EvidencePersistenceError) return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(code)) return code;
  }
  return 'EVIDENCE_RECOVERY_FAILED';
}

function boundedErrorCode(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{1,127}$/u.test(value)) {
    throw new Error('EVIDENCE_RECOVERY_ERROR_CODE_INVALID');
  }
  return value;
}

function assertKnownSourceFamily(value: string): void {
  if (!supportedReplaySourceFamilies.has(value)) {
    throw new EvidenceRecoveryActionError(
      'EVIDENCE_RECOVERY_SOURCE_FAMILY_UNSUPPORTED',
      'The Evidence source family cannot be mapped to an exact canonical record family.',
    );
  }
}

function bounded(value: string, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new Error(`EVIDENCE_RECOVERY_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function sha256(value: string, field: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`EVIDENCE_RECOVERY_${field.toUpperCase()}_INVALID`);
  }
  return value as `sha256:${string}`;
}

function timestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`EVIDENCE_RECOVERY_${field.toUpperCase()}_INVALID`);
  }
  return new Date(value).toISOString();
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
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

async function withReadOnlyTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
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
