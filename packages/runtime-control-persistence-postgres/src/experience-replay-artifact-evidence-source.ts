import type { Pool, PoolClient } from 'pg';

import {
  EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
  type ExperienceReplayArtifactEvidenceSnapshot,
  type ExperienceReplayArtifactEvidenceSource,
  type ExperienceReplayArtifactProjectionKind,
  type ExperienceReplayArtifactProjectionPartition,
  type ExperienceReplayArtifactSourceRow,
} from '../../runtime-control-application/src/index.js';
import { decodePatternCandidateDefinition } from './pattern-definition-artifact.js';

interface PartitionRow {
  readonly kind: ExperienceReplayArtifactProjectionKind;
  readonly source_family: 'experience' | 'replay' | 'artifact';
  readonly source_id: string;
  readonly source_version: number | null;
}

export class PostgresExperienceReplayArtifactEvidenceSource implements ExperienceReplayArtifactEvidenceSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async pendingPartitions(
    limit: number,
  ): Promise<readonly ExperienceReplayArtifactProjectionPartition[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('Experience Evidence pending limit must be between 1 and 1000.');
    const result = await this.#pool.query<PartitionRow>(pendingPartitionsSql, [
      EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
      limit,
    ]);
    return Object.freeze(result.rows.map(toPartition));
  }

  async load(
    partition: ExperienceReplayArtifactProjectionPartition,
  ): Promise<ExperienceReplayArtifactEvidenceSnapshot | undefined> {
    assertProjectionPartition(partition);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      let task: ExperienceReplayArtifactSourceRow | undefined;
      let episodes: readonly ExperienceReplayArtifactSourceRow[] = [];
      let traces: readonly ExperienceReplayArtifactSourceRow[] = [];
      let patterns: readonly ExperienceReplayArtifactSourceRow[] = [];
      let corrections: readonly ExperienceReplayArtifactSourceRow[] = [];
      let interactions: readonly ExperienceReplayArtifactSourceRow[] = [];
      let replayCases: readonly ExperienceReplayArtifactSourceRow[] = [];
      let datasets: readonly ExperienceReplayArtifactSourceRow[] = [];
      let artifacts: readonly ExperienceReplayArtifactSourceRow[] = [];
      let validationRuns: readonly ExperienceReplayArtifactSourceRow[] = [];
      let caseResults: readonly ExperienceReplayArtifactSourceRow[] = [];
      let counterexamples: readonly ExperienceReplayArtifactSourceRow[] = [];
      let retrievals: readonly ExperienceReplayArtifactSourceRow[] = [];
      let usages: readonly ExperienceReplayArtifactSourceRow[] = [];
      let feedback: readonly ExperienceReplayArtifactSourceRow[] = [];
      let promotions: readonly ExperienceReplayArtifactSourceRow[] = [];

      switch (partition.kind) {
        case 'experience_task': {
          task = await loadTask(client, partition.sourceId);
          if (task === undefined) return await notFound(client);
          episodes = await rows(client, experienceEpisodeSql, [partition.sourceId]);
          traces = await rows(client, experienceTraceSql, [partition.sourceId]);
          corrections = await rows(
            client,
            `SELECT to_jsonb(correction_row) AS value
             FROM planning_correction_fact correction_row
             WHERE correction_row.task_id=$1
             ORDER BY correction_row.created_at,correction_row.correction_id`,
            [partition.sourceId],
          );
          interactions = await rows(
            client,
            `SELECT to_jsonb(interaction_row) || jsonb_build_object(
               'correction_ids',COALESCE(interaction_row.snapshot->'correctionIds','[]'::jsonb)
             ) AS value
             FROM planning_interaction_episode interaction_row
             WHERE interaction_row.task_id=$1
             ORDER BY interaction_row.revision,interaction_row.episode_id`,
            [partition.sourceId],
          );
          break;
        }
        case 'experience_pattern': {
          patterns = (await rows(client, experiencePatternSql, [partition.sourceId])).map(
            decodePatternRow,
          );
          if (patterns.length === 0) return await notFound(client);
          break;
        }
        case 'replay_case': {
          replayCases = await rows(client, replayCaseSql, [partition.sourceId]);
          if (replayCases.length === 0) return await notFound(client);
          const taskId = optionalText(replayCases[0], 'source_task_id');
          task = taskId === undefined ? undefined : await loadTask(client, taskId);
          break;
        }
        case 'replay_dataset': {
          if (partition.sourceVersion === undefined)
            throw new Error('Replay Dataset projection version missing.');
          datasets = await rows(client, replayDatasetSql, [
            partition.sourceId,
            partition.sourceVersion,
          ]);
          if (datasets.length === 0) return await notFound(client);
          break;
        }
        case 'validation': {
          validationRuns = await rows(client, validationSql, [partition.sourceId]);
          if (validationRuns.length === 0) return await notFound(client);
          caseResults = await rows(client, caseResultSql, [partition.sourceId]);
          counterexamples = await rows(client, counterexampleSql, [partition.sourceId]);
          break;
        }
        case 'artifact': {
          if (partition.sourceVersion === undefined)
            throw new Error('Artifact projection version missing.');
          artifacts = await rows(client, artifactSql, [
            partition.sourceId,
            partition.sourceVersion,
          ]);
          if (artifacts.length === 0) return await notFound(client);
          break;
        }
        case 'retrieval': {
          retrievals = await rows(client, retrievalSql, [partition.sourceId]);
          if (retrievals.length === 0) return await notFound(client);
          task = await loadTask(client, requiredText(retrievals[0], 'task_id'));
          break;
        }
        case 'usage': {
          usages = await rows(client, usageSql, [partition.sourceId]);
          if (usages.length === 0) return await notFound(client);
          task = await loadTask(client, requiredText(usages[0], 'task_id'));
          break;
        }
        case 'feedback': {
          feedback = await rows(client, feedbackSql, [partition.sourceId]);
          if (feedback.length === 0) return await notFound(client);
          task = await loadTask(client, requiredText(feedback[0], 'task_id'));
          break;
        }
        case 'promotion': {
          promotions = await rows(client, promotionSql, [partition.sourceId]);
          if (promotions.length === 0) return await notFound(client);
          const validationId = optionalText(promotions[0], 'validation_summary_ref');
          if (validationId !== undefined) {
            validationRuns = await rows(client, validationSql, [validationId]);
          }
          break;
        }
      }

      const checkpoint = (
        await rows(
          client,
          `SELECT to_jsonb(checkpoint_row) AS value
           FROM evidence_source_checkpoint checkpoint_row
           WHERE checkpoint_row.source_family=$1 AND checkpoint_row.source_partition=$2`,
          [partition.sourceFamily, partition.sourcePartition],
        )
      )[0];
      const sourceIds = collectEvidenceSourceIds({
        partition,
        ...(task === undefined ? {} : { task }),
        episodes,
        traces,
        patterns,
        corrections,
        interactions,
        replayCases,
        datasets,
        artifacts,
        validationRuns,
        caseResults,
        counterexamples,
        retrievals,
        usages,
        feedback,
        promotions,
      });
      const existingEvidence = await rows(
        client,
        `SELECT to_jsonb(latest_evidence) AS value FROM (
           SELECT DISTINCT ON (evidence_row.record_type,evidence_row.source_record_id)
                  evidence_row.*
           FROM evidence_outbox evidence_row
           WHERE evidence_row.source_record_id=ANY($1::text[])
              OR evidence_row.payload->>'workflowPatternId'=ANY($1::text[])
              OR evidence_row.payload->>'episodeId'=ANY($1::text[])
           ORDER BY evidence_row.record_type,evidence_row.source_record_id,
                    evidence_row.sequence DESC
         ) latest_evidence
         ORDER BY latest_evidence.sequence DESC`,
        [[...sourceIds]],
      );

      await client.query('COMMIT');
      return Object.freeze({
        partition,
        ...(task === undefined ? {} : { task }),
        ...(checkpoint === undefined ? {} : { checkpoint }),
        episodes,
        traces,
        patterns,
        corrections,
        interactions,
        replayCases,
        datasets,
        artifacts,
        validationRuns,
        caseResults,
        counterexamples,
        retrievals,
        usages,
        feedback,
        promotions,
        existingEvidence,
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
  SELECT 'experience_task'::text AS kind,'experience'::text AS source_family,
         episode.task_id AS source_id,NULL::integer AS source_version,0 AS priority
  FROM goal_experience_episode episode WHERE episode.task_id IS NOT NULL
  UNION
  SELECT 'experience_task','experience',correction.task_id,NULL::integer,0
  FROM planning_correction_fact correction
  UNION
  SELECT 'experience_task','experience',interaction.task_id,NULL::integer,0
  FROM planning_interaction_episode interaction
  UNION
  SELECT 'experience_pattern','experience',pattern.pattern_id,NULL::integer,1
  FROM pattern_candidate pattern
  UNION
  SELECT 'replay_case','replay',replay_case.replay_case_id,NULL::integer,2
  FROM artifact_replay_case replay_case
  UNION
  SELECT 'artifact','artifact',artifact.artifact_id,artifact.version,3
  FROM compiled_artifact artifact
  UNION
  SELECT 'replay_dataset','replay',dataset.dataset_id,dataset.dataset_version,4
  FROM replay_dataset_manifest dataset
  UNION
  SELECT 'validation','replay',validation.validation_run_id,NULL::integer,5
  FROM artifact_validation_run validation
  UNION
  SELECT 'retrieval','artifact',match.match_id,NULL::integer,6
  FROM artifact_match_log match
  UNION
  SELECT 'usage','artifact',execution.artifact_execution_id,NULL::integer,7
  FROM artifact_execution execution
  UNION
  SELECT 'feedback','artifact',feedback.feedback_id,NULL::integer,8
  FROM artifact_feedback feedback
  UNION
  SELECT 'promotion','artifact',package.promotion_package_id,NULL::integer,9
  FROM artifact_promotion_package package
), normalized AS (
  SELECT kind,source_family,source_id,source_version,priority,
         'v141:' || kind || ':' || length(source_id)::text || ':' || source_id ||
           CASE WHEN source_version IS NULL THEN '' ELSE ':v' || source_version::text END
           AS source_partition
  FROM candidate
)
SELECT normalized.kind,normalized.source_family,normalized.source_id,normalized.source_version
FROM normalized
LEFT JOIN evidence_source_checkpoint checkpoint
  ON checkpoint.source_family=normalized.source_family
 AND checkpoint.source_partition=normalized.source_partition
LEFT JOIN LATERAL (
  SELECT projection_issue.created_at
  FROM evidence_projection_issue projection_issue
  WHERE projection_issue.source_partition=normalized.source_partition
    AND projection_issue.projector_version=$1
    AND projection_issue.evaluation_role='required'
    AND projection_issue.severity='blocking'
    AND projection_issue.retryable
    AND projection_issue.resolved_at IS NULL
  ORDER BY projection_issue.created_at DESC,projection_issue.issue_id
  LIMIT 1
) projection_issue ON true
WHERE projection_issue.created_at IS NULL
   OR projection_issue.created_at + interval '5 seconds' <= clock_timestamp()
ORDER BY
  CASE WHEN checkpoint.projector_version IS DISTINCT FROM $1 THEN 0 ELSE 1 END,
  COALESCE(
    projection_issue.created_at + interval '5 seconds',checkpoint.last_projected_at
  ) NULLS FIRST,
  normalized.priority,normalized.source_partition
LIMIT $2`;

const experienceEpisodeSql = `SELECT to_jsonb(episode_row) || jsonb_build_object(
    'source_refs',COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'schemaVersion','1.0',
        'sourceRefId',source_row.source_ref_id,
        'sourceKind',source_row.source_kind,
        'sourceId',source_row.source_id,
        'sourceRevision',source_row.source_revision,
        'authority',source_row.authority,
        'dataClassification',source_row.data_classification,
        'capturedAt',source_row.captured_at,
        'contentHash',source_row.content_hash
      ))
        ORDER BY source_row.captured_at,source_row.source_ref_id)
      FROM goal_experience_episode_source source_row
      WHERE source_row.episode_id=episode_row.episode_id
    ),'[]'::jsonb)
  ) AS value
  FROM goal_experience_episode episode_row
  WHERE episode_row.task_id=$1
  ORDER BY episode_row.revision,episode_row.episode_id`;

const experienceTraceSql = `SELECT to_jsonb(trace_row) || jsonb_build_object(
    'source_hash',source_row.source_hash,'normalizer_version',source_row.normalizer_version,
    'tenant_id',source_row.tenant_id,'user_scope_id',source_row.user_scope_id,
    'data_classification',source_row.data_classification,
    'redaction_codes',source_row.redaction_codes,
    'compilation_run_refs',COALESCE((
      SELECT jsonb_agg(run.run_id ORDER BY run.updated_at,run.run_id)
      FROM compilation_run run
      WHERE run.run_type='normalization' AND run.status='completed'
        AND run.result_ref=trace_row.trace_id
    ),'[]'::jsonb)
  ) AS value
  FROM experience_trace trace_row
  JOIN experience_trace_source source_row ON source_row.trace_id=trace_row.trace_id
  JOIN goal_experience_episode episode_row
    ON episode_row.episode_id=source_row.source_episode_id
  WHERE episode_row.task_id=$1
  ORDER BY trace_row.created_at,trace_row.trace_id`;

const experiencePatternSql = `SELECT to_jsonb(pattern_row) || jsonb_build_object(
    'support_refs',COALESCE((
      SELECT jsonb_agg(support.trace_id ORDER BY support.trace_id)
      FROM pattern_candidate_support support
      WHERE support.pattern_id=pattern_row.pattern_id AND support.support_kind='support'
    ),'[]'::jsonb),
    'contradiction_refs',COALESCE((
      SELECT jsonb_agg(support.trace_id ORDER BY support.trace_id)
      FROM pattern_candidate_support support
      WHERE support.pattern_id=pattern_row.pattern_id AND support.support_kind='contradiction'
    ),'[]'::jsonb),
    'tenant_ids',COALESCE((
      SELECT jsonb_agg(DISTINCT support.tenant_id ORDER BY support.tenant_id)
      FROM pattern_candidate_support support WHERE support.pattern_id=pattern_row.pattern_id
    ),'[]'::jsonb),
    'compilation_run_refs',COALESCE((
      SELECT jsonb_agg(run.run_id ORDER BY run.updated_at,run.run_id)
      FROM compilation_run run
      WHERE run.run_type='process_mining' AND run.status='completed'
        AND run.result_ref=pattern_row.definition->>'workflowPatternId'
    ),'[]'::jsonb)
  ) AS value
  FROM pattern_candidate pattern_row WHERE pattern_row.pattern_id=$1`;

const replayCaseSql = `SELECT to_jsonb(replay_case_row) || jsonb_build_object(
    'dataset_refs',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'datasetId',membership.dataset_id,'datasetVersion',membership.dataset_version
      ) ORDER BY membership.dataset_id,membership.dataset_version)
      FROM replay_dataset_case membership
      WHERE membership.replay_case_id=replay_case_row.replay_case_id
    ),'[]'::jsonb),
    'source_task_id',episode_row.task_id,'source_context_id',episode_row.context_id,
    'source_goal_id',episode_row.goal_id,'source_goal_version',episode_row.goal_version,
    'source_user_scope_id',episode_row.user_scope_id
  ) AS value
  FROM artifact_replay_case replay_case_row
  JOIN goal_experience_episode episode_row
    ON episode_row.episode_id=replay_case_row.primary_source_episode_id
  WHERE replay_case_row.replay_case_id=$1`;

const replayDatasetSql = `SELECT to_jsonb(dataset_row) || jsonb_build_object(
    'case_refs',COALESCE((
      SELECT jsonb_agg(membership.replay_case_id ORDER BY membership.ordinal)
      FROM replay_dataset_case membership
      WHERE membership.dataset_id=dataset_row.dataset_id
        AND membership.dataset_version=dataset_row.dataset_version
    ),'[]'::jsonb)
  ) AS value
  FROM replay_dataset_manifest dataset_row
  WHERE dataset_row.dataset_id=$1 AND dataset_row.dataset_version=$2`;

const artifactSql = `SELECT to_jsonb(artifact_row) || jsonb_build_object(
    'lineage',to_jsonb(lineage_row),
    'workflow_pattern_refs',COALESCE((
      SELECT jsonb_agg(DISTINCT fused_row.workflow_pattern_id ORDER BY fused_row.workflow_pattern_id)
      FROM generalized_pattern generalized_row
      JOIN fused_pattern fused_row
        ON fused_row.fused_pattern_id=generalized_row.source_fused_pattern_ref
      WHERE lineage_row.source_pattern_refs ? generalized_row.generalized_pattern_id
        AND lineage_row.source_pattern_refs ? fused_row.fused_pattern_id
        AND lineage_row.source_pattern_refs ? fused_row.source_process_pattern_ref
        AND lineage_row.source_pattern_refs ? fused_row.workflow_pattern_id
        AND generalized_row.tenant_id IS NOT DISTINCT FROM artifact_row.tenant_id
        AND fused_row.tenant_id IS NOT DISTINCT FROM artifact_row.tenant_id
    ),'[]'::jsonb)) AS value
  FROM compiled_artifact artifact_row
  JOIN artifact_lineage lineage_row ON lineage_row.lineage_id=artifact_row.lineage_id
  WHERE artifact_row.artifact_id=$1 AND artifact_row.version=$2`;

const validationSql = `SELECT to_jsonb(validation_row) || jsonb_build_object(
    'artifact_tenant_id',artifact_row.tenant_id) AS value
  FROM artifact_validation_run validation_row
  JOIN compiled_artifact artifact_row
    ON artifact_row.artifact_id=validation_row.artifact_id
   AND artifact_row.version=validation_row.artifact_version
  WHERE validation_row.validation_run_id=$1`;

const caseResultSql = `SELECT to_jsonb(result_row) || jsonb_build_object(
    'source_task_id',episode_row.task_id,'source_context_id',episode_row.context_id,
    'source_episode_id',episode_row.episode_id,
    'source_goal_id',episode_row.goal_id,'source_goal_version',episode_row.goal_version,
    'source_user_scope_id',episode_row.user_scope_id,
    'source_tenant_id',replay_case_row.tenant_id,
    'source_plan_id',plan_row.plan_id,'source_plan_version',plan_row.revision) AS value
  FROM artifact_replay_case_result result_row
  JOIN artifact_replay_case replay_case_row
    ON replay_case_row.replay_case_id=result_row.replay_case_id
  JOIN goal_experience_episode episode_row
    ON episode_row.episode_id=replay_case_row.primary_source_episode_id
  JOIN agent_task task_row ON task_row.task_id=episode_row.task_id
  LEFT JOIN user_goal_plan plan_row ON plan_row.plan_id=task_row.user_goal_plan_id
  WHERE result_row.validation_run_id=$1
  ORDER BY result_row.created_at,result_row.replay_case_id`;

const counterexampleSql = `SELECT to_jsonb(counterexample_row) || jsonb_build_object(
    'source_task_id',episode_row.task_id,'source_context_id',episode_row.context_id,
    'source_episode_id',episode_row.episode_id,
    'source_goal_id',episode_row.goal_id,'source_goal_version',episode_row.goal_version,
    'source_user_scope_id',episode_row.user_scope_id,
    'source_tenant_id',replay_case_row.tenant_id,
    'source_plan_id',plan_row.plan_id,'source_plan_version',plan_row.revision) AS value
  FROM artifact_counterexample counterexample_row
  JOIN artifact_replay_case replay_case_row
    ON replay_case_row.replay_case_id=counterexample_row.replay_case_id
  JOIN goal_experience_episode episode_row
    ON episode_row.episode_id=replay_case_row.primary_source_episode_id
  JOIN agent_task task_row ON task_row.task_id=episode_row.task_id
  LEFT JOIN user_goal_plan plan_row ON plan_row.plan_id=task_row.user_goal_plan_id
  WHERE counterexample_row.validation_run_id=$1
  ORDER BY counterexample_row.created_at,counterexample_row.counterexample_id`;

const retrievalSql = `SELECT to_jsonb(match_row) || jsonb_build_object(
    'artifact_tenant_id',artifact_row.tenant_id) AS value
  FROM artifact_match_log match_row
  JOIN compiled_artifact artifact_row
    ON artifact_row.artifact_id=match_row.candidate_artifact_id
   AND artifact_row.version=match_row.artifact_version
  WHERE match_row.match_id=$1`;

const usageSql = `SELECT to_jsonb(execution_row) || jsonb_build_object(
    'artifact_tenant_id',artifact_row.tenant_id,
    'retrieval_decision_id',decision_row.decision_id,
    'retrieval_match_id',decision_row.match_id,
    'retrieval_selected_artifact_ref',decision_row.selected_artifact_ref,
    'retrieval_request_id',match_row.request_id,
    'retrieval_task_id',match_row.task_id,
    'retrieval_artifact_id',match_row.candidate_artifact_id,
    'retrieval_artifact_version',match_row.artifact_version
  ) AS value
  FROM artifact_execution execution_row
  JOIN compiled_artifact artifact_row
    ON artifact_row.artifact_id=execution_row.artifact_id
   AND artifact_row.version=execution_row.artifact_version
  LEFT JOIN runtime_candidate_decision decision_row
    ON decision_row.decision_id=execution_row.decision_snapshot->>'retrievalDecisionId'
  LEFT JOIN artifact_match_log match_row ON match_row.match_id=decision_row.match_id
  WHERE execution_row.artifact_execution_id=$1`;

const feedbackSql = `SELECT to_jsonb(feedback_row) || jsonb_build_object(
    'task_id',execution_row.task_id,'artifact_version',execution_row.artifact_version,
    'artifact_tenant_id',artifact_row.tenant_id) AS value
  FROM artifact_feedback feedback_row
  JOIN artifact_execution execution_row
    ON execution_row.artifact_execution_id=feedback_row.artifact_execution_id
  JOIN compiled_artifact artifact_row
    ON artifact_row.artifact_id=execution_row.artifact_id
   AND artifact_row.version=execution_row.artifact_version
  WHERE feedback_row.feedback_id=$1`;

const promotionSql = `SELECT to_jsonb(package_row) || jsonb_build_object(
    'assessment',to_jsonb(assessment_row),'artifact_tenant_id',artifact_row.tenant_id,
    'validation_counterexamples',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'counterexampleId',counterexample.counterexample_id,
        'content',counterexample.content
      ) ORDER BY counterexample.created_at,counterexample.counterexample_id)
      FROM artifact_counterexample counterexample
      WHERE counterexample.artifact_id=package_row.artifact_id
        AND counterexample.artifact_version=package_row.artifact_version
    ),'[]'::jsonb)
  ) AS value
  FROM artifact_promotion_package package_row
  JOIN compiled_artifact artifact_row
    ON artifact_row.artifact_id=package_row.artifact_id
   AND artifact_row.version=package_row.artifact_version
  LEFT JOIN artifact_promotion_assessment assessment_row
    ON assessment_row.promotion_package_id=package_row.promotion_package_id
  WHERE package_row.promotion_package_id=$1`;

async function loadTask(
  client: PoolClient,
  taskId: string,
): Promise<ExperienceReplayArtifactSourceRow | undefined> {
  return (
    await rows(
      client,
      `SELECT to_jsonb(task_row) || jsonb_strip_nulls(jsonb_build_object(
         'evidence_plan_id',plan_row.plan_id,'evidence_plan_version',plan_row.revision
       )) AS value
       FROM agent_task task_row
       LEFT JOIN user_goal_plan plan_row ON plan_row.plan_id=task_row.user_goal_plan_id
       WHERE task_row.task_id=$1`,
      [taskId],
    )
  )[0];
}

async function notFound(
  client: PoolClient,
): Promise<ExperienceReplayArtifactEvidenceSnapshot | undefined> {
  await client.query('COMMIT');
  return undefined;
}

async function rows(
  client: PoolClient,
  sql: string,
  parameters: readonly unknown[],
): Promise<readonly ExperienceReplayArtifactSourceRow[]> {
  const result = await client.query<{ value: ExperienceReplayArtifactSourceRow }>(sql, [
    ...parameters,
  ]);
  return Object.freeze(result.rows.map((row) => Object.freeze(row.value)));
}

function toPartition(row: PartitionRow): ExperienceReplayArtifactProjectionPartition {
  return Object.freeze({
    kind: row.kind,
    sourceFamily: row.source_family,
    sourcePartition: sourcePartition(row.kind, row.source_id, row.source_version ?? undefined),
    sourceId: row.source_id,
    ...(row.source_version === null ? {} : { sourceVersion: row.source_version }),
  });
}

function sourcePartition(
  kind: ExperienceReplayArtifactProjectionKind,
  sourceId: string,
  sourceVersion?: number,
) {
  return `v141:${kind}:${String(sourceId.length)}:${sourceId}${
    sourceVersion === undefined ? '' : `:v${String(sourceVersion)}`
  }`;
}

function assertProjectionPartition(partition: ExperienceReplayArtifactProjectionPartition): void {
  const sourceId = partition.sourceId.trim();
  if (sourceId === '' || sourceId !== partition.sourceId || sourceId.length > 512) {
    throw new Error('Experience Evidence projection source identity invalid.');
  }
  const expectedFamily: ExperienceReplayArtifactProjectionPartition['sourceFamily'] =
    partition.kind === 'experience_task' || partition.kind === 'experience_pattern'
      ? 'experience'
      : partition.kind === 'replay_case' ||
          partition.kind === 'replay_dataset' ||
          partition.kind === 'validation'
        ? 'replay'
        : 'artifact';
  const versioned = partition.kind === 'artifact' || partition.kind === 'replay_dataset';
  if (
    partition.sourceFamily !== expectedFamily ||
    versioned !== (partition.sourceVersion !== undefined) ||
    (partition.sourceVersion !== undefined &&
      (!Number.isSafeInteger(partition.sourceVersion) || partition.sourceVersion < 1)) ||
    partition.sourcePartition !==
      sourcePartition(partition.kind, partition.sourceId, partition.sourceVersion)
  ) {
    throw new Error('Experience Evidence projection partition identity invalid.');
  }
}

function decodePatternRow(
  row: ExperienceReplayArtifactSourceRow,
): ExperienceReplayArtifactSourceRow {
  const decoded = decodePatternCandidateDefinition({
    patternId: requiredText(row, 'pattern_id'),
    envelope: row['definition'],
  });
  return Object.freeze({
    ...row,
    definition: decoded.definition,
    definition_content_hash: decoded.contentHash,
    definition_uncompressed_bytes: decoded.uncompressedBytes,
  });
}

function collectEvidenceSourceIds(
  snapshot: Omit<ExperienceReplayArtifactEvidenceSnapshot, 'existingEvidence' | 'checkpoint'>,
) {
  const result = new Set<string>([snapshot.partition.sourceId]);
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim() !== '') result.add(value);
  };
  const addFields = (
    row: ExperienceReplayArtifactSourceRow | undefined,
    fields: readonly string[],
  ) => {
    for (const field of fields) add(row?.[field]);
  };
  addFields(snapshot.task, [
    'task_id',
    'goal_id',
    'plan_id',
    'user_goal_plan_id',
    'evidence_plan_id',
  ]);
  for (const row of snapshot.episodes)
    addFields(row, ['episode_id', 'task_id', 'terminal_outcome_ref']);
  for (const row of snapshot.traces) {
    addFields(row, ['trace_id', 'source_episode_id']);
    const trace = row['trace'];
    if (isRecord(trace)) for (const value of array(trace['correctionRefs'])) add(value);
  }
  for (const row of snapshot.patterns) {
    addFields(row, ['pattern_id']);
    const definition = row['definition'];
    if (!isRecord(definition)) continue;
    const workflow = definition['workflowPattern'];
    if (!isRecord(workflow)) continue;
    add(workflow['workflowPatternId']);
    add(workflow['sourcePatternRef']);
    for (const value of array(workflow['sourceTraceRefs'])) add(value);
    for (const variant of array(definition['variants'])) {
      if (!isRecord(variant)) continue;
      for (const value of array(variant['traceRefs'])) add(value);
    }
  }
  for (const row of snapshot.corrections) addFields(row, ['correction_id', 'task_id', 'goal_id']);
  for (const row of snapshot.interactions) addFields(row, ['episode_id', 'task_id', 'goal_id']);
  for (const row of snapshot.replayCases) {
    addFields(row, ['replay_case_id', 'primary_source_episode_id', 'source_task_id']);
    for (const member of array(row['dataset_refs'])) {
      if (isRecord(member)) {
        const id = member['datasetId'];
        const version = member['datasetVersion'];
        if (typeof id === 'string' && typeof version === 'number') add(`${id}:${String(version)}`);
      }
    }
  }
  for (const row of snapshot.datasets) {
    const id = row['dataset_id'];
    const version = row['dataset_version'];
    if (typeof id === 'string' && typeof version === 'number') add(`${id}:${String(version)}`);
    for (const value of array(row['case_refs'])) add(value);
  }
  for (const row of snapshot.artifacts) {
    const id = row['artifact_id'];
    const version = row['version'];
    if (typeof id === 'string' && typeof version === 'number') add(`${id}:${String(version)}`);
    const lineage = row['lineage'];
    if (isRecord(lineage)) for (const value of array(lineage['source_pattern_refs'])) add(value);
  }
  for (const row of snapshot.validationRuns) {
    addFields(row, ['validation_run_id', 'dataset_ref', 'artifact_id']);
    const dataset = row['dataset_ref'];
    const datasetVersion = row['dataset_version'];
    const artifact = row['artifact_id'];
    const artifactVersion = row['artifact_version'];
    if (typeof dataset === 'string' && typeof datasetVersion === 'number')
      add(`${dataset}:${String(datasetVersion)}`);
    if (typeof artifact === 'string' && typeof artifactVersion === 'number')
      add(`${artifact}:${String(artifactVersion)}`);
  }
  for (const row of snapshot.caseResults) {
    addFields(row, ['validation_run_id', 'replay_case_id', 'source_task_id']);
    const run = row['validation_run_id'];
    const replayCase = row['replay_case_id'];
    if (typeof run === 'string' && typeof replayCase === 'string') add(`${run}:${replayCase}`);
  }
  for (const row of snapshot.counterexamples)
    addFields(row, [
      'counterexample_id',
      'validation_run_id',
      'replay_case_id',
      'artifact_id',
      'source_task_id',
    ]);
  for (const row of snapshot.retrievals) {
    addFields(row, [
      'match_id',
      'request_id',
      'task_id',
      'candidate_artifact_id',
      'artifact_version',
    ]);
    addVersioned(row, 'candidate_artifact_id', 'artifact_version');
  }
  for (const row of snapshot.usages) {
    addFields(row, [
      'artifact_execution_id',
      'artifact_id',
      'task_id',
      'retrieval_match_id',
      'retrieval_decision_id',
    ]);
    addVersioned(row, 'artifact_id', 'artifact_version');
  }
  for (const row of snapshot.feedback) {
    addFields(row, ['feedback_id', 'artifact_execution_id', 'artifact_id', 'task_id']);
    addVersioned(row, 'artifact_id', 'artifact_version');
  }
  for (const row of snapshot.promotions) {
    addFields(row, [
      'promotion_package_id',
      'artifact_id',
      'validation_summary_ref',
      'counterexample_summary_ref',
    ]);
    addVersioned(row, 'artifact_id', 'artifact_version');
    for (const counterexample of array(row['validation_counterexamples'])) {
      if (isRecord(counterexample)) add(counterexample['counterexampleId']);
    }
  }
  function addVersioned(
    row: ExperienceReplayArtifactSourceRow,
    idField: string,
    versionField: string,
  ) {
    const id = row[idField];
    const version = row[versionField];
    if (typeof id === 'string' && typeof version === 'number' && Number.isSafeInteger(version)) {
      add(`${id}:${String(version)}`);
    }
  }
  return result;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalText(row: ExperienceReplayArtifactSourceRow | undefined, field: string) {
  const value = row?.[field];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function requiredText(row: ExperienceReplayArtifactSourceRow | undefined, field: string) {
  const value = optionalText(row, field);
  if (value === undefined) throw new Error(`Experience Evidence source ${field} missing.`);
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
