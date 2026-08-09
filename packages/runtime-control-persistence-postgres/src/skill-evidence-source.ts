import type { Pool, PoolClient } from 'pg';

import type {
  SkillEvidenceSnapshot,
  SkillEvidenceSource,
} from '../../runtime-control-application/src/index.js';
import type { RuntimeCoreSourceRow } from '../../runtime-control-application/src/runtime-core-evidence-projector.js';

export class PostgresSkillEvidenceSource implements SkillEvidenceSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async pendingTaskIds(limit: number): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('Skill Evidence pending limit must be between 1 and 1000.');
    const result = await this.#pool.query<{ task_id: string }>(
      `WITH candidate AS (
         SELECT execution.task_id,MIN(execution.created_at) AS first_created_at
         FROM skill_execution_record execution
         JOIN runtime_terminal_outcome outcome ON outcome.task_id=execution.task_id
         WHERE EXISTS (
             SELECT 1 FROM evidence_source_checkpoint runtime_checkpoint
             WHERE runtime_checkpoint.source_family='runtime'
               AND runtime_checkpoint.source_partition='runtime-core:' || execution.task_id
           )
           AND (NOT EXISTS (
             SELECT 1 FROM evidence_outbox evidence
             WHERE evidence.record_type='skill.usage_snapshot'
               AND evidence.source_record_id=execution.execution_id
           )
           OR NOT EXISTS (
             SELECT 1 FROM evidence_source_checkpoint checkpoint
             WHERE checkpoint.source_family='skill'
               AND checkpoint.source_partition='skill:' || execution.task_id
           )
           OR EXISTS (
             SELECT 1 FROM evidence_quality_issue issue
             WHERE issue.episode_id=execution.task_id
               AND issue.severity='blocking'
               AND issue.record_type LIKE 'skill.%'
               AND issue.resolved_at IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM evidence_projection_issue projection_issue
             WHERE projection_issue.source_partition='skill:' || execution.task_id
               AND projection_issue.projector_version='skill/v1'
               AND projection_issue.evaluation_role='required'
               AND projection_issue.severity='blocking'
               AND projection_issue.retryable
               AND projection_issue.resolved_at IS NULL
           ))
         GROUP BY execution.task_id
       )
       SELECT candidate.task_id
       FROM candidate
       LEFT JOIN LATERAL (
         SELECT projection_issue.created_at
         FROM evidence_projection_issue projection_issue
         WHERE projection_issue.source_partition='skill:' || candidate.task_id
           AND projection_issue.projector_version='skill/v1'
           AND projection_issue.evaluation_role='required'
           AND projection_issue.severity='blocking'
           AND projection_issue.retryable
           AND projection_issue.resolved_at IS NULL
         ORDER BY projection_issue.created_at DESC,projection_issue.issue_id
         LIMIT 1
       ) projection_issue ON true
       WHERE projection_issue.created_at IS NULL
          OR projection_issue.created_at + interval '5 seconds' <= clock_timestamp()
       ORDER BY COALESCE(
         projection_issue.created_at + interval '5 seconds',candidate.first_created_at
       ),candidate.task_id
       LIMIT $1`,
      [limit],
    );
    return Object.freeze(result.rows.map((row) => row.task_id));
  }

  async load(taskId: string): Promise<SkillEvidenceSnapshot | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const task = (
        await rows(
          client,
          `SELECT to_jsonb(task) AS value FROM agent_task task WHERE task.task_id=$1`,
          [taskId],
        )
      )[0];
      if (task === undefined) {
        await client.query('COMMIT');
        return undefined;
      }
      const executions = await rows(
        client,
        `SELECT to_jsonb(execution) AS value FROM skill_execution_record execution WHERE execution.task_id=$1 ORDER BY execution.created_at,execution.execution_id`,
        [taskId],
      );
      const selections = await rows(
        client,
        `SELECT to_jsonb(selection) AS value
         FROM skill_selection_record selection
         WHERE EXISTS (
           SELECT 1 FROM skill_execution_record execution
           WHERE execution.selection_ref=selection.selection_id AND execution.task_id=$1
         )
         ORDER BY selection.created_at,selection.selection_id`,
        [taskId],
      );
      const inputResolutions = await rows(
        client,
        `SELECT to_jsonb(resolution) AS value FROM skill_input_resolution resolution WHERE resolution.task_id=$1 ORDER BY resolution.created_at,resolution.resolution_id`,
        [taskId],
      );
      const events = await rows(
        client,
        `SELECT to_jsonb(event) AS value FROM skill_execution_event event JOIN skill_execution_record execution ON execution.execution_id=event.execution_id WHERE execution.task_id=$1 ORDER BY event.sequence_number,event.event_id`,
        [taskId],
      );
      const references = await rows(
        client,
        `SELECT to_jsonb(reference) AS value FROM skill_execution_reference reference JOIN skill_execution_record execution ON execution.execution_id=reference.execution_id WHERE execution.task_id=$1 ORDER BY reference.created_at,reference.link_id`,
        [taskId],
      );
      const skillVersions = await rows(
        client,
        `SELECT to_jsonb(skill_version_row) AS value
         FROM skill_version skill_version_row
         WHERE EXISTS (
           SELECT 1 FROM skill_execution_record execution
           WHERE execution.skill_id=skill_version_row.skill_id
             AND execution.skill_version=skill_version_row.version
             AND execution.task_id=$1
         )
         ORDER BY skill_version_row.skill_id,skill_version_row.version`,
        [taskId],
      );
      const capabilityBindings = await rows(
        client,
        `SELECT to_jsonb(binding) AS value FROM task_capability_binding binding WHERE binding.task_id=$1 ORDER BY binding.bound_at,binding.binding_id`,
        [taskId],
      );
      const existingEvidence = await rows(
        client,
        `SELECT jsonb_build_object(
           'record_id',evidence.record_id,
           'record_type',evidence.record_type,
           'source_record_id',evidence.source_record_id,
           'plan_id',evidence.plan_id,
           'payload',evidence.payload
         ) AS value
         FROM evidence_outbox evidence
         WHERE evidence.task_id=$1
            OR evidence.episode_id=$1
            OR (
              evidence.record_type='capability.definition'
              AND evidence.payload->>'capabilityId' IN (
                SELECT DISTINCT slots.slot->>'capability'
                FROM skill_execution_record execution
                JOIN skill_version version
                  ON version.skill_id=execution.skill_id
                 AND version.version=execution.skill_version
                CROSS JOIN LATERAL jsonb_array_elements(
                  COALESCE(
                    version.usage_specification_json->'composition'->'capabilitySlots',
                    '[]'::jsonb
                  )
                ) AS slots(slot)
                WHERE execution.task_id=$1
                  AND jsonb_typeof(slots.slot)='object'
                  AND slots.slot->>'capability' IS NOT NULL
              )
            )
         ORDER BY evidence.sequence`,
        [taskId],
      );
      await client.query('COMMIT');
      return Object.freeze({
        task,
        selections,
        inputResolutions,
        executions,
        events,
        references,
        skillVersions,
        capabilityBindings,
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

async function rows(
  client: PoolClient,
  sql: string,
  values: readonly unknown[],
): Promise<readonly RuntimeCoreSourceRow[]> {
  const result = await client.query<{ value: RuntimeCoreSourceRow }>(sql, [...values]);
  return Object.freeze(result.rows.map((row) => Object.freeze(row.value)));
}
