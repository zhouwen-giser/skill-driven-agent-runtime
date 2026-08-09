import type { Pool, PoolClient } from 'pg';

import type {
  McpCapabilityEvidenceSnapshot,
  McpCapabilityEvidenceSource,
} from '../../runtime-control-application/src/index.js';
import type { RuntimeCoreSourceRow } from '../../runtime-control-application/src/runtime-core-evidence-projector.js';

export class PostgresMcpCapabilityEvidenceSource implements McpCapabilityEvidenceSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async pendingTaskIds(limit: number): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('MCP/Capability Evidence pending limit must be between 1 and 1000.');
    const result = await this.#pool.query<{ task_id: string }>(
      `WITH candidate AS (
         SELECT task.task_id,task.created_at
         FROM agent_task task
         JOIN runtime_terminal_outcome outcome ON outcome.task_id=task.task_id
         WHERE EXISTS (
           SELECT 1 FROM evidence_source_checkpoint checkpoint
           WHERE checkpoint.source_family='runtime'
             AND checkpoint.source_partition='runtime-core:' || task.task_id
         ) AND (
           EXISTS (SELECT 1 FROM mcp_invocation invocation WHERE invocation.task_id=task.task_id)
           OR EXISTS (SELECT 1 FROM task_capability_binding binding WHERE binding.task_id=task.task_id)
         ) AND (
           NOT EXISTS (
             SELECT 1 FROM evidence_source_checkpoint checkpoint
             WHERE checkpoint.source_family='mcp-capability'
               AND checkpoint.source_partition='mcp-capability:' || task.task_id
           ) OR EXISTS (
             SELECT 1 FROM evidence_quality_issue issue
             WHERE issue.episode_id=task.task_id AND issue.severity='blocking'
               AND issue.resolved_at IS NULL
               AND (issue.record_type LIKE 'mcp_task.%' OR issue.record_type LIKE 'capability.%')
           ) OR EXISTS (
             SELECT 1 FROM evidence_projection_issue projection_issue
             WHERE projection_issue.source_partition='mcp-capability:' || task.task_id
               AND projection_issue.projector_version='1.4.1'
               AND projection_issue.evaluation_role='required'
               AND projection_issue.severity='blocking'
               AND projection_issue.retryable
               AND projection_issue.resolved_at IS NULL
           )
         )
       )
       SELECT candidate.task_id
       FROM candidate
       LEFT JOIN LATERAL (
         SELECT projection_issue.created_at
         FROM evidence_projection_issue projection_issue
         WHERE projection_issue.source_partition='mcp-capability:' || candidate.task_id
           AND projection_issue.projector_version='1.4.1'
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
         projection_issue.created_at + interval '5 seconds',candidate.created_at
       ),candidate.task_id
       LIMIT $1`,
      [limit],
    );
    return Object.freeze(result.rows.map((row) => row.task_id));
  }

  async load(taskId: string): Promise<McpCapabilityEvidenceSnapshot | undefined> {
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
      const invocations = await rows(
        client,
        `SELECT to_jsonb(row) AS value FROM mcp_invocation row WHERE row.task_id=$1 ORDER BY row.started_at,row.invocation_id`,
        [taskId],
      );
      const availability = await rows(
        client,
        `SELECT to_jsonb(snapshot) AS value
         FROM task_availability_snapshot snapshot
         JOIN task_execution_readiness readiness ON readiness.readiness_id=snapshot.readiness_id
         WHERE EXISTS (
           SELECT 1 FROM workflow_control control
           WHERE control.task_id=$1 AND control.current_plan_id=readiness.workflow_plan_id
         )
         ORDER BY snapshot.checked_at,snapshot.snapshot_id`,
        [taskId],
      );
      const bindings = await rows(
        client,
        `SELECT to_jsonb(row) AS value FROM remote_task_binding row WHERE row.agent_task_id=$1 ORDER BY row.created_at,row.binding_id`,
        [taskId],
      );
      const observations = await childRows(
        client,
        'remote_task_observation',
        'observation',
        taskId,
        'observation.observed_at,observation.observation_id',
      );
      const controlEvents = await childRows(
        client,
        'remote_task_control_event',
        'event',
        taskId,
        'event.created_at,event.event_id',
      );
      const pollAttempts = await childRows(
        client,
        'remote_task_protocol_attempt',
        'attempt',
        taskId,
        'attempt.started_at,attempt.attempt_id',
      );
      const inputLinks = await childRows(
        client,
        'remote_task_input_link',
        'link',
        taskId,
        'link.created_at,link.input_request_id',
      );
      const cancels = await childRows(
        client,
        'remote_task_cancel_request',
        'request',
        taskId,
        'request.requested_at,request.cancel_request_id',
      );
      const continuationSnapshots = await rows(
        client,
        `SELECT to_jsonb(snapshot) || jsonb_build_object('binding_ids',COALESCE(jsonb_agg(wait.binding_id ORDER BY wait.binding_id) FILTER (WHERE wait.binding_id IS NOT NULL),'[]'::jsonb)) AS value FROM workflow_continuation_snapshot snapshot LEFT JOIN workflow_continuation_wait_binding wait ON wait.snapshot_id=snapshot.snapshot_id WHERE snapshot.agent_task_id=$1 GROUP BY snapshot.snapshot_id ORDER BY snapshot.created_at,snapshot.snapshot_id`,
        [taskId],
      );
      const continuationAttempts = await rows(
        client,
        `SELECT to_jsonb(attempt) AS value FROM workflow_continuation_attempt attempt JOIN workflow_continuation_snapshot snapshot ON snapshot.snapshot_id=attempt.snapshot_id WHERE snapshot.agent_task_id=$1 ORDER BY attempt.created_at,attempt.attempt_id`,
        [taskId],
      );
      const readiness = await rows(
        client,
        `SELECT to_jsonb(snapshot) AS value FROM capability_readiness_snapshot snapshot WHERE EXISTS (SELECT 1 FROM task_capability_binding binding WHERE binding.task_id=$1 AND binding.requested_capability_id=snapshot.capability_id AND binding.capability_version=snapshot.capability_version) ORDER BY snapshot.evaluated_at,snapshot.capability_id,snapshot.snapshot_version`,
        [taskId],
      );
      const capabilityBindings = await rows(
        client,
        `SELECT to_jsonb(binding) AS value FROM task_capability_binding binding WHERE binding.task_id=$1 ORDER BY binding.bound_at,binding.binding_id`,
        [taskId],
      );
      const capabilityAttempts = await rows(
        client,
        `SELECT to_jsonb(attempt) AS value FROM task_capability_execution_attempt attempt WHERE attempt.task_id=$1 ORDER BY attempt.attempt_no,attempt.attempt_id`,
        [taskId],
      );
      const exposures = await rows(
        client,
        `SELECT to_jsonb(exposure) AS value FROM runtime_agent_card_exposure_snapshot exposure WHERE EXISTS (SELECT 1 FROM task_capability_binding binding WHERE binding.task_id=$1 AND binding.requested_capability_id=exposure.capability_id AND binding.capability_version=exposure.capability_version) ORDER BY exposure.revision,exposure.exposure_id,exposure.exposure_version`,
        [taskId],
      );
      const cardRevisions = await rows(
        client,
        `SELECT to_jsonb(revision_row) AS value
         FROM runtime_agent_card_revision revision_row
         WHERE EXISTS (
           SELECT 1 FROM runtime_agent_card_exposure_snapshot exposure
           JOIN task_capability_binding binding
             ON binding.requested_capability_id=exposure.capability_id
            AND binding.capability_version=exposure.capability_version
           WHERE binding.task_id=$1 AND exposure.revision=revision_row.revision
         )
         ORDER BY revision_row.revision`,
        [taskId],
      );
      const existingEvidence = await rows(
        client,
        `SELECT jsonb_build_object('record_id',record_id,'record_type',record_type,'source_record_id',source_record_id,'skill_execution_id',skill_execution_id,'payload',payload) AS value
         FROM evidence_outbox
         WHERE task_id=$1 OR episode_id=$1 OR (
           record_type='node_control.capability_revision'
           AND EXISTS (
             SELECT 1 FROM task_capability_binding binding
             WHERE binding.task_id=$1
               AND payload->>'capabilityId'=binding.requested_capability_id
               AND payload->>'version'=binding.capability_version::text
           )
         )
         ORDER BY sequence`,
        [taskId],
      );
      await client.query('COMMIT');
      return Object.freeze({
        task,
        invocations,
        availability,
        bindings,
        observations,
        controlEvents,
        pollAttempts,
        inputLinks,
        cancels,
        continuationSnapshots,
        continuationAttempts,
        readiness,
        capabilityBindings,
        capabilityAttempts,
        exposures,
        cardRevisions,
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

async function childRows(
  client: PoolClient,
  table: string,
  alias: string,
  taskId: string,
  orderBy: string,
) {
  return rows(
    client,
    `SELECT to_jsonb(${alias}) AS value FROM ${table} ${alias} JOIN remote_task_binding binding ON binding.binding_id=${alias}.binding_id WHERE binding.agent_task_id=$1 ORDER BY ${orderBy}`,
    [taskId],
  );
}

async function rows(
  client: PoolClient,
  sql: string,
  values: readonly unknown[],
): Promise<readonly RuntimeCoreSourceRow[]> {
  const result = await client.query<{ value: RuntimeCoreSourceRow }>(sql, [...values]);
  return Object.freeze(result.rows.map((row) => Object.freeze(row.value)));
}
