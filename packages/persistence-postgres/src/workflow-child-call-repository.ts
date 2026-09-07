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
  constructor(private readonly pool: Pool) {}
  async save(record: WorkflowChildCall): Promise<WorkflowChildCall> {
    return saveWorkflowChildCall(this.pool, record);
  }
  async find(
    parentInstanceId: string,
    parentNodeRunId: string,
  ): Promise<WorkflowChildCall | undefined> {
    const result = await this.pool.query<ChildRow>(
      'SELECT * FROM workflow_child_call WHERE parent_instance_id=$1 AND parent_node_run_id=$2',
      [parentInstanceId, parentNodeRunId],
    );
    return result.rows[0] === undefined ? undefined : mapChild(result.rows[0]);
  }
  async findByChildInstanceId(childInstanceId: string): Promise<WorkflowChildCall | undefined> {
    const result = await this.pool.query<ChildRow>(
      'SELECT * FROM workflow_child_call WHERE child_instance_id=$1',
      [childInstanceId],
    );
    return result.rows[0] === undefined ? undefined : mapChild(result.rows[0]);
  }
  async listByParent(parentInstanceId: string): Promise<readonly WorkflowChildCall[]> {
    const result = await this.pool.query<ChildRow>(
      'SELECT * FROM workflow_child_call WHERE parent_instance_id=$1 ORDER BY created_at,call_id',
      [parentInstanceId],
    );
    return result.rows.map(mapChild);
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
