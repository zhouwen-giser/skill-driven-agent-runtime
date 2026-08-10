import type { Pool } from 'pg';

import {
  type EvidenceQualityAuthoritySource,
  type EvidenceQualityFinding,
  type EvidenceQualityRule,
} from '../../runtime-control-application/src/index.js';

interface FindingRow {
  readonly identity: string;
  readonly source_system: 'runtime' | 'node_control';
  readonly source_table: string;
  readonly source_record_id: string;
  readonly record_type: string | null;
  readonly record_id: string | null;
  readonly episode_id: string | null;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

export class PostgresEvidenceQualityAuthoritySource implements EvidenceQualityAuthoritySource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findings(ruleId: EvidenceQualityRule): Promise<readonly EvidenceQualityFinding[]> {
    const sql = qualityQueries[ruleId];
    const result = await this.#pool.query<FindingRow>(sql);
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          ruleId,
          identity: row.identity,
          sourceSystem: row.source_system,
          sourceTable: row.source_table,
          sourceRecordId: row.source_record_id,
          ...(row.record_type === null ? {} : { recordType: row.record_type }),
          ...(row.record_id === null ? {} : { recordId: row.record_id }),
          ...(row.episode_id === null ? {} : { episodeId: row.episode_id }),
          detail: Object.freeze(row.detail),
        }),
      ),
    );
  }
}

const qualityQueries: Readonly<Record<EvidenceQualityRule, string>> = Object.freeze({
  sequence_gap: `SELECT
      'export-batch:' || batch.batch_id AS identity,
      'runtime'::text AS source_system,
      'evidence_export_batch'::text AS source_table,
      batch.batch_id AS source_record_id,
      'evidence.export_status'::text AS record_type,
      NULL::text AS record_id,
      NULL::text AS episode_id,
      jsonb_build_object(
        'batchId',batch.batch_id,
        'sourcePartition',batch.source_partition,
        'firstSequence',batch.first_sequence::text,
        'lastSequence',batch.last_sequence::text,
        'declaredRecordCount',batch.record_count,
        'observedRecordCount',observed.observed_count
      ) AS detail
    FROM evidence_export_batch batch
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS observed_count
      FROM evidence_outbox evidence
      WHERE evidence.source_partition=batch.source_partition
        AND evidence.sequence BETWEEN batch.first_sequence AND batch.last_sequence
    ) observed
    WHERE observed.observed_count<>batch.record_count
      AND EXISTS (
        SELECT 1 FROM evidence_outbox evidence
        WHERE evidence.source_partition=batch.source_partition
          AND evidence.sequence BETWEEN batch.first_sequence AND batch.last_sequence
          AND evidence.observation_generation=0
      )
    ORDER BY batch.ledger_sequence,batch.batch_id`,

  payload_conflict: `SELECT
      'projection-issue:' || issue.issue_id AS identity,
      issue.source_system,
      issue.source_table,
      issue.source_record_id,
      issue.record_type,
      issue.record_id,
      issue.episode_id,
      jsonb_build_object(
        'projectionIssueId',issue.issue_id,
        'sourcePartition',issue.source_partition,
        'projectorVersion',issue.projector_version
      ) AS detail
    FROM evidence_projection_issue issue
    WHERE issue.issue_code='payload_hash_conflict' AND issue.resolved_at IS NULL
      AND issue.projector_version<>'evidence-infrastructure/v1'
      AND (issue.record_type IS NULL OR issue.record_type NOT LIKE 'evidence.%')
    ORDER BY issue.issue_id`,

  orphan_reference: `SELECT
      'record:' || evidence.record_id || ':ref:' || reference.record_id AS identity,
      evidence.source_system,
      evidence.source_table,
      evidence.source_record_id,
      evidence.record_type,
      evidence.record_id,
      evidence.episode_id,
      jsonb_build_object(
        'recordId',evidence.record_id,
        'recordType',evidence.record_type,
        'missingEvidenceRef',reference.record_id
      ) AS detail
    FROM evidence_outbox evidence
    CROSS JOIN LATERAL jsonb_array_elements_text(evidence.evidence_refs) reference(record_id)
    WHERE evidence.observation_generation=0
      AND NOT EXISTS (
        SELECT 1 FROM evidence_outbox target WHERE target.record_id=reference.record_id
      )
    ORDER BY evidence.sequence,reference.record_id`,

  version_gap: `WITH versioned AS (
      SELECT evidence.*,
        COALESCE(
          evidence.goal_id,
          evidence.payload->>'configurationId',evidence.payload->>'profileId',
          evidence.payload->>'providerId',evidence.payload->>'routeId',
          evidence.payload->>'sourceId',evidence.payload->>'bindingId',
          evidence.payload->>'skillId',evidence.payload->>'planTemplateId',
          evidence.payload->>'capabilityId',evidence.payload->>'exposureId',
          evidence.payload->>'agentCardId',evidence.source_record_id
        ) AS authority_id,
        (evidence.payload->>'revision')::bigint AS revision_value,
        lag((evidence.payload->>'revision')::bigint) OVER (
          PARTITION BY evidence.record_type,COALESCE(
            evidence.goal_id,
            evidence.payload->>'configurationId',evidence.payload->>'profileId',
            evidence.payload->>'providerId',evidence.payload->>'routeId',
            evidence.payload->>'sourceId',evidence.payload->>'bindingId',
            evidence.payload->>'skillId',evidence.payload->>'planTemplateId',
            evidence.payload->>'capabilityId',evidence.payload->>'exposureId',
            evidence.payload->>'agentCardId',evidence.source_record_id
          )
          ORDER BY evidence.sequence
        ) AS previous_revision
      FROM evidence_outbox evidence
      WHERE evidence.observation_generation=0
        AND jsonb_typeof(evidence.payload->'revision')='number'
    )
    SELECT
      'record:' || record_type || ':' || authority_id || ':revision:' || revision_value::text
        AS identity,
      source_system,source_table,source_record_id,record_type,record_id,episode_id,
      jsonb_build_object(
        'recordType',record_type,
        'authorityId',authority_id,
        'previousRevision',previous_revision,
        'observedRevision',revision_value
      ) AS detail
    FROM versioned
    WHERE previous_revision IS NOT NULL AND revision_value>previous_revision+1
    ORDER BY sequence`,

  missing_verification: `SELECT
      'run-seal:' || seal.record_id AS identity,
      seal.source_system,seal.source_table,seal.source_record_id,seal.record_type,seal.record_id,
      seal.episode_id,
      jsonb_build_object('runSealRecordId',seal.record_id,'episodeId',seal.episode_id) AS detail
    FROM evidence_outbox seal
    WHERE seal.record_type='runtime.run_seal'
      AND seal.observation_generation=0
      AND seal.episode_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM evidence_outbox verification
        WHERE verification.record_type='runtime.verification'
          AND verification.observation_generation=0
          AND verification.episode_id=seal.episode_id
      )
    ORDER BY seal.sequence`,

  remote_task_unclosed: `WITH binding AS (
      SELECT DISTINCT ON (evidence.source_record_id) evidence.*,
        COALESCE(evidence.payload->>'bindingId',evidence.source_record_id) AS binding_id
      FROM evidence_outbox evidence
      WHERE evidence.record_type='mcp_task.remote_binding'
        AND evidence.observation_generation=0
      ORDER BY evidence.source_record_id,evidence.sequence DESC
    )
    SELECT
      'remote-binding:' || binding.binding_id AS identity,
      binding.source_system,binding.source_table,binding.source_record_id,binding.record_type,
      binding.record_id,binding.episode_id,
      jsonb_build_object(
        'remoteTaskBindingId',binding.binding_id,
        'bindingRecordId',binding.record_id
      ) AS detail
    FROM binding
    WHERE binding.episode_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM evidence_outbox seal
        WHERE seal.record_type='runtime.run_seal'
          AND seal.observation_generation=0
          AND seal.episode_id=binding.episode_id
      )
      AND COALESCE(binding.payload->>'protocolStatus','')
        NOT IN ('completed','failed','cancelled','canceled')
    ORDER BY binding.sequence`,

  skill_tree_incomplete: `SELECT
      'skill-execution:' || child.source_record_id || ':parent:' ||
        (child.payload->>'parentExecutionId') AS identity,
      child.source_system,child.source_table,child.source_record_id,child.record_type,child.record_id,
      child.episode_id,
      jsonb_build_object(
        'childExecutionId',child.source_record_id,
        'parentExecutionId',child.payload->>'parentExecutionId'
      ) AS detail
    FROM evidence_outbox child
    WHERE child.record_type='skill.execution'
      AND child.observation_generation=0
      AND NULLIF(child.payload->>'parentExecutionId','') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM evidence_outbox parent
        WHERE parent.record_type='skill.execution'
          AND parent.observation_generation=0
          AND parent.source_record_id=child.payload->>'parentExecutionId'
      )
    ORDER BY child.sequence`,

  experience_missing_fact: `SELECT
      'run-seal:' || seal.record_id AS identity,
      seal.source_system,seal.source_table,seal.source_record_id,seal.record_type,seal.record_id,
      seal.episode_id,
      jsonb_build_object('runSealRecordId',seal.record_id,'episodeId',seal.episode_id) AS detail
    FROM evidence_outbox seal
    WHERE seal.record_type='runtime.run_seal'
      AND seal.observation_generation=0
      AND seal.episode_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM evidence_outbox experience
        WHERE experience.record_type IN ('experience.episode','experience.trace')
          AND experience.observation_generation=0
          AND experience.task_id=seal.task_id
      )
    ORDER BY seal.sequence`,

  node_revision_regression: `WITH node_revision AS (
      SELECT evidence.*,
        COALESCE(
          evidence.payload->>'configurationId',evidence.payload->>'profileId',
          evidence.payload->>'providerId',evidence.payload->>'routeId',
          evidence.payload->>'sourceId',evidence.payload->>'bindingId',
          evidence.payload->>'skillId',evidence.payload->>'planTemplateId',
          evidence.payload->>'capabilityId',evidence.payload->>'exposureId',
          evidence.payload->>'agentCardId',evidence.source_record_id
        ) AS authority_id,
        COALESCE(
          (CASE WHEN jsonb_typeof(evidence.payload->'revision')='number'
            THEN evidence.payload->>'revision' END),
          (CASE WHEN jsonb_typeof(evidence.payload->'aggregateRevision')='number'
            THEN evidence.payload->>'aggregateRevision' END),
          (CASE WHEN jsonb_typeof(evidence.payload->'version')='number'
            THEN evidence.payload->>'version' END)
        )::bigint AS revision_value
      FROM evidence_outbox evidence
      WHERE evidence.record_family='node_control' AND evidence.observation_generation=0
    ), ordered AS (
      SELECT node_revision.*,
        lag(revision_value) OVER (
          PARTITION BY record_type,authority_id ORDER BY sequence
        ) AS previous_revision
      FROM node_revision WHERE revision_value IS NOT NULL
    )
    SELECT
      'node:' || record_type || ':' || authority_id || ':sequence:' || sequence::text AS identity,
      source_system,source_table,source_record_id,record_type,record_id,episode_id,
      jsonb_build_object(
        'authorityId',authority_id,
        'previousRevision',previous_revision,
        'observedRevision',revision_value
      ) AS detail
    FROM ordered
    WHERE previous_revision IS NOT NULL AND revision_value<previous_revision
    ORDER BY sequence`,

  export_ack_gap: `WITH latest_batch AS (
      SELECT DISTINCT ON (batch.export_id,batch.source_partition) batch.*
      FROM evidence_export_batch batch
      WHERE EXISTS (
        SELECT 1 FROM evidence_outbox evidence
        WHERE evidence.sequence BETWEEN batch.first_sequence AND batch.last_sequence
          AND evidence.observation_generation=0
      )
      ORDER BY batch.export_id,batch.source_partition,batch.attempt_no DESC,batch.ledger_sequence DESC
    )
    SELECT
      'export-partition:' || batch.export_id || ':' || batch.source_partition AS identity,
      'runtime'::text AS source_system,
      'evidence_export_ack'::text AS source_table,
      COALESCE(ack.ack_id,batch.batch_id) AS source_record_id,
      'evidence.export_status'::text AS record_type,
      NULL::text AS record_id,
      NULL::text AS episode_id,
      jsonb_build_object(
        'ackId',ack.ack_id,
        'batchId',ack.batch_id,
        'ackDisposition',ack.ack_disposition,
        'acknowledgedSequence',ack.acknowledged_sequence::text,
        'firstSequence',batch.first_sequence::text,
        'lastSequence',batch.last_sequence::text
      ) AS detail
    FROM latest_batch batch
    LEFT JOIN evidence_export_ack ack ON ack.batch_id=batch.batch_id
    WHERE ack.ack_id IS NULL
       OR ack.ack_disposition IN ('partial','rejected')
       OR ack.acknowledged_sequence IS DISTINCT FROM batch.last_sequence
    ORDER BY batch.ledger_sequence,batch.batch_id`,
});
