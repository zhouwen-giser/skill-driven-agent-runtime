import type { Pool, PoolClient } from 'pg';

import type {
  RuntimeCoreEvidenceSnapshot,
  RuntimeCoreEvidenceSource,
  RuntimeCoreSourceRow,
} from '../../runtime-control-application/src/index.js';

export class PostgresRuntimeCoreEvidenceSource implements RuntimeCoreEvidenceSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async pendingTaskIds(limit: number): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('Runtime core Evidence pending limit must be between 1 and 1000.');
    const result = await this.#pool.query<{ task_id: string }>(
      `WITH candidate AS (
         SELECT outcome.task_id,outcome.outcome_id,outcome.committed_at
         FROM runtime_terminal_outcome outcome
         WHERE outcome.task_id IS NOT NULL
           AND (
             NOT EXISTS (
               SELECT 1 FROM evidence_outbox evidence
               WHERE evidence.record_type='runtime.run_seal'
                 AND evidence.source_record_id=outcome.outcome_id
             )
             OR EXISTS (
               SELECT 1 FROM evidence_projection_issue projection_issue
               WHERE projection_issue.source_partition='runtime-core:' || outcome.task_id
                 AND projection_issue.projector_version='runtime-core/v1'
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
         SELECT projection_issue.last_observed_at
         FROM evidence_projection_issue projection_issue
         WHERE projection_issue.source_partition='runtime-core:' || candidate.task_id
           AND projection_issue.projector_version='runtime-core/v1'
           AND projection_issue.evaluation_role='required'
           AND projection_issue.severity='blocking'
           AND projection_issue.retryable
           AND projection_issue.resolved_at IS NULL
         ORDER BY projection_issue.last_observed_at DESC,projection_issue.issue_id
         LIMIT 1
       ) projection_issue ON true
       WHERE projection_issue.last_observed_at IS NULL
          OR projection_issue.last_observed_at + interval '5 seconds' <= clock_timestamp()
       ORDER BY COALESCE(
         projection_issue.last_observed_at + interval '5 seconds',candidate.committed_at
       ),candidate.outcome_id
       LIMIT $1`,
      [limit],
    );
    return Object.freeze(result.rows.map((row) => row.task_id));
  }

  async load(taskId: string): Promise<RuntimeCoreEvidenceSnapshot | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const task = (
        await rows(client, 'SELECT to_jsonb(task) AS value FROM agent_task task WHERE task_id=$1', [
          taskId,
        ])
      )[0];
      if (task === undefined) {
        await client.query('COMMIT');
        return undefined;
      }

      const goals = await rows(
        client,
        `SELECT to_jsonb(goal) AS value FROM goal
         JOIN agent_task task ON task.goal_id=goal.goal_id AND task.goal_version=goal.version
         WHERE task.task_id=$1 ORDER BY goal.version,goal.goal_id`,
        [taskId],
      );
      const goalContracts = await rows(
        client,
        `SELECT to_jsonb(contract) AS value FROM user_goal_contract contract
         JOIN agent_task task ON task.goal_id=contract.goal_id
           AND task.goal_version=contract.goal_version
         WHERE task.task_id=$1 ORDER BY contract.goal_version,contract.goal_id`,
        [taskId],
      );
      const goalPatches = await rows(
        client,
        `SELECT to_jsonb(patch) AS value FROM goal_patch patch
         JOIN agent_task task ON task.goal_id=patch.goal_id
         WHERE task.task_id=$1
         ORDER BY patch.created_at,patch.patch_id`,
        [taskId],
      );
      const plans = await rows(
        client,
        `SELECT to_jsonb(plan) AS value FROM user_goal_plan plan
         JOIN agent_task task ON task.goal_id=plan.goal_id AND task.goal_version=plan.goal_version
         WHERE task.task_id=$1 ORDER BY plan.revision,plan.plan_id`,
        [taskId],
      );
      const planSteps = await rows(
        client,
        `SELECT to_jsonb(step) AS value FROM skill_goal step
         JOIN user_goal_plan plan ON plan.plan_id=step.plan_id
         JOIN agent_task task ON task.goal_id=plan.goal_id AND task.goal_version=plan.goal_version
         WHERE task.task_id=$1 ORDER BY plan.revision,step.ordinal,step.skill_goal_id`,
        [taskId],
      );
      const stateTransitions = await rows(
        client,
        `SELECT to_jsonb(event)
           || jsonb_build_object('plan_id',instance.plan_id,'skill_goal_id',instance.skill_goal_id)
           AS value
         FROM workflow_node_event event
         JOIN workflow_instance instance ON instance.instance_id=event.instance_id
         JOIN agent_task task ON task.goal_id=instance.goal_id
           AND task.goal_version=instance.goal_version
         WHERE task.task_id=$1 ORDER BY event.event_timestamp,event.event_id`,
        [taskId],
      );
      const controlRounds = await rows(
        client,
        `SELECT to_jsonb(round) AS value FROM workflow_control_round round
         JOIN workflow_control control ON control.control_id=round.control_id
         WHERE control.task_id=$1 ORDER BY round.round_index,round.control_id`,
        [taskId],
      );
      const executionGates = await rows(
        client,
        `SELECT to_jsonb(gate) AS value FROM task_execution_readiness gate
         JOIN workflow_plan plan ON plan.plan_id=gate.workflow_plan_id
         JOIN agent_task task ON task.goal_id=plan.goal_id AND task.goal_version=plan.goal_version
         WHERE task.task_id=$1 ORDER BY gate.created_at,gate.readiness_id`,
        [taskId],
      );
      const confirmations = await rows(
        client,
        `SELECT to_jsonb(plan) AS value FROM workflow_plan plan
         JOIN agent_task task ON task.goal_id=plan.goal_id AND task.goal_version=plan.goal_version
         WHERE task.task_id=$1 AND plan.confirmation_status IN ('confirmed','superseded','invalidated')
         ORDER BY COALESCE(plan.confirmed_at,plan.created_at),plan.plan_id`,
        [taskId],
      );
      const skillExecutions = await rows(
        client,
        `SELECT to_jsonb(execution) AS value FROM skill_execution_record execution
         WHERE execution.task_id=$1 ORDER BY execution.created_at,execution.execution_id`,
        [taskId],
      );
      const skillExecutionReferences = await rows(
        client,
        `SELECT to_jsonb(reference) AS value
         FROM skill_execution_reference reference
         JOIN skill_execution_record execution ON execution.execution_id=reference.execution_id
         WHERE execution.task_id=$1
         ORDER BY reference.created_at,reference.link_id`,
        [taskId],
      );
      const invocations = await rows(
        client,
        `SELECT to_jsonb(invocation) AS value FROM mcp_invocation invocation
         WHERE invocation.task_id=$1 ORDER BY invocation.started_at,invocation.invocation_id`,
        [taskId],
      );
      const verifications = await rows(
        client,
        `SELECT to_jsonb(effect) AS value FROM completed_effect effect
         JOIN user_goal_plan plan ON plan.plan_id=effect.plan_id
         JOIN agent_task task ON task.goal_id=plan.goal_id AND task.goal_version=plan.goal_version
         WHERE task.task_id=$1 ORDER BY effect.created_at,effect.completed_effect_id`,
        [taskId],
      );
      const outcomes = await rows(
        client,
        `SELECT to_jsonb(decision) AS value FROM outcome_decision decision
         JOIN user_goal_plan plan ON plan.plan_id=decision.plan_id
         JOIN agent_task task ON task.goal_id=plan.goal_id AND task.goal_version=plan.goal_version
         WHERE task.task_id=$1 ORDER BY decision.created_at,decision.outcome_decision_id`,
        [taskId],
      );
      const runSeals = await rows(
        client,
        `SELECT to_jsonb(outcome) || jsonb_build_object(
           'task_status',task.phase,
           'goal_status',goal.status,
           'control_current_status',control.status,
           'workflow_status',instance.status
         ) AS value
         FROM runtime_terminal_outcome outcome
         LEFT JOIN agent_task task ON task.task_id=outcome.task_id
         JOIN goal ON goal.goal_id=outcome.goal_id AND goal.version=outcome.goal_version
         JOIN workflow_control control ON control.control_id=outcome.control_id
         LEFT JOIN workflow_instance instance ON instance.instance_id=outcome.final_instance_id
         WHERE outcome.task_id=$1 ORDER BY outcome.committed_at,outcome.outcome_id`,
        [taskId],
      );

      await client.query('COMMIT');
      return Object.freeze({
        task,
        goals,
        goalContracts,
        goalPatches,
        plans,
        planSteps,
        stateTransitions,
        controlRounds,
        executionGates,
        confirmations,
        skillExecutions,
        skillExecutionReferences,
        invocations,
        verifications,
        outcomes,
        runSeals,
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
