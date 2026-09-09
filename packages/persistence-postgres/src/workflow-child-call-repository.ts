import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { workflowPlanScopeSql } from './gowm-workflow-ownership.js';
import { WorkflowChildCallError } from '../../domain/src/index.js';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { WorkflowChildCallRepository } from '../../application/src/ports.js';
import type { WorkflowChildCall } from '../../domain/src/index.js';

interface ChildRow extends QueryResultRow {
  call_id: string;
  kind: WorkflowChildCall['kind'];
  parent_instance_id: string;
  parent_node_run_id: string;
  parent_node_id: string;
  child_plan_id: string;
  child_instance_id: string | null;
  created_at: Date;
}

export class PostgresWorkflowChildCallRepository implements WorkflowChildCallRepository {
  constructor(
    private readonly pool: Pool,
    private readonly deviceScope?: DeviceWorkScope,
  ) {}
  async save(record: WorkflowChildCall): Promise<WorkflowChildCall> {
    if (this.deviceScope === undefined) return saveWorkflowChildCall(this.pool, record);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const scope = workflowPlanScopeSql(this.deviceScope, 4);
      const owner = await client.query(
        `SELECT workflow_plan.plan_id FROM workflow_instance parent
          JOIN workflow_plan ON workflow_plan.plan_id=parent.plan_id
          JOIN workflow_plan child ON child.plan_id=$2
        WHERE parent.instance_id=$1 AND ${scope.predicate}
          AND child.device_id IS NOT DISTINCT FROM workflow_plan.device_id
          AND child.gowm_task_id IS NOT DISTINCT FROM workflow_plan.gowm_task_id
          AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM workflow_instance ci
            WHERE ci.instance_id=$3 AND ci.plan_id=child.plan_id))
        FOR KEY SHARE OF workflow_plan,child`,
        [
          record.parentInstanceId,
          record.childPlanId,
          record.childInstanceId ?? null,
          ...scope.values,
        ],
      );
      if (owner.rowCount !== 1) throw new Error('WORKFLOW_CHILD_DEVICE_SCOPE_DENIED');
      const saved = await saveWorkflowChildCall(client, record);
      await client.query('COMMIT');
      return saved;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async find(
    parentInstanceId: string,
    parentNodeRunId: string,
  ): Promise<WorkflowChildCall | undefined> {
    const scope = this.scope(3);
    const result = await this.pool.query<ChildRow>(
      `SELECT * FROM workflow_child_call WHERE parent_instance_id=$1 AND parent_node_run_id=$2 AND ${scope.predicate}`,
      [parentInstanceId, parentNodeRunId, ...scope.values],
    );
    return result.rows[0] === undefined ? undefined : mapChild(result.rows[0]);
  }
  async findByChildInstanceId(childInstanceId: string): Promise<WorkflowChildCall | undefined> {
    const scope = this.scope(2);
    const result = await this.pool.query<ChildRow>(
      `SELECT * FROM workflow_child_call WHERE child_instance_id=$1 AND ${scope.predicate}`,
      [childInstanceId, ...scope.values],
    );
    return result.rows[0] === undefined ? undefined : mapChild(result.rows[0]);
  }
  async listByParent(parentInstanceId: string): Promise<readonly WorkflowChildCall[]> {
    const scope = this.scope(2);
    const result = await this.pool.query<ChildRow>(
      `SELECT * FROM workflow_child_call WHERE parent_instance_id=$1 AND ${scope.predicate} ORDER BY created_at,call_id`,
      [parentInstanceId, ...scope.values],
    );
    return result.rows.map(mapChild);
  }
  private scope(first: number) {
    const filter = workflowPlanScopeSql(this.deviceScope, first);
    return {
      values: filter.values,
      predicate:
        this.deviceScope === undefined
          ? 'TRUE'
          : `EXISTS(SELECT 1 FROM workflow_instance parent JOIN workflow_plan ON workflow_plan.plan_id=parent.plan_id
        WHERE parent.instance_id=workflow_child_call.parent_instance_id AND ${filter.predicate})`,
    };
  }
}

/** Shared by normal child creation and the Skill repository's owning transaction. */
export async function saveWorkflowChildCall(
  client: Pool | PoolClient,
  record: WorkflowChildCall,
): Promise<WorkflowChildCall> {
  const result = await client.query<ChildRow>(
    `INSERT INTO workflow_child_call(
    call_id,kind,parent_instance_id,parent_node_run_id,parent_node_id,child_plan_id,child_instance_id,created_at
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  ON CONFLICT(parent_instance_id,parent_node_run_id) DO UPDATE SET
    child_instance_id=COALESCE(workflow_child_call.child_instance_id,EXCLUDED.child_instance_id)
  WHERE workflow_child_call.call_id=EXCLUDED.call_id
    AND workflow_child_call.kind=EXCLUDED.kind AND workflow_child_call.parent_node_id=EXCLUDED.parent_node_id
    AND workflow_child_call.child_plan_id=EXCLUDED.child_plan_id
    AND (workflow_child_call.child_instance_id IS NULL OR EXCLUDED.child_instance_id IS NULL
      OR workflow_child_call.child_instance_id=EXCLUDED.child_instance_id)
  RETURNING *`,
    [
      record.callId,
      record.kind,
      record.parentInstanceId,
      record.parentNodeRunId,
      record.parentNodeId,
      record.childPlanId,
      record.childInstanceId ?? null,
      record.createdAt,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new WorkflowChildCallError('WORKFLOW_CHILD_CALL_IDENTITY_CONFLICT');
  return mapChild(row);
}

function mapChild(row: ChildRow): WorkflowChildCall {
  return {
    callId: row.call_id,
    kind: row.kind,
    parentInstanceId: row.parent_instance_id,
    parentNodeRunId: row.parent_node_run_id,
    parentNodeId: row.parent_node_id,
    childPlanId: row.child_plan_id,
    ...(row.child_instance_id === null ? {} : { childInstanceId: row.child_instance_id }),
    createdAt: row.created_at.toISOString(),
  };
}
