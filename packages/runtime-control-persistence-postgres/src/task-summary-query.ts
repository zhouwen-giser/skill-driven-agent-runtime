import type { Pool, QueryResultRow } from 'pg';

export interface RuntimeTaskSummary {
  readonly taskId: string;
  readonly goalId?: string;
  readonly planId?: string;
  readonly contextId?: string;
  readonly phase: string;
  readonly selectedSkillId?: string;
  readonly capabilityBindingId?: string;
  readonly createdAt?: string;
  readonly updatedAt: string;
  readonly controlledActions: Readonly<Record<string, boolean>>;
}

interface TaskRow extends QueryResultRow {
  task_id: string;
  goal_id: string | null;
  plan_id: string | null;
  context_id: string;
  phase: string;
  selected_skill_id: string | null;
  binding_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class PostgresRuntimeTaskSummaryQuery {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async list(filter: Readonly<{ phase?: string; goalId?: string; limit: number }>) {
    const result = await this.#pool.query<TaskRow>(
      `${selectTaskSummary}
        WHERE ($1::text IS NULL OR task.phase=$1)
          AND ($2::text IS NULL OR task.goal_id=$2)
        ORDER BY task.updated_at DESC,task.task_id
        LIMIT $3`,
      [filter.phase ?? null, filter.goalId ?? null, filter.limit],
    );
    return Object.freeze(result.rows.map(mapTaskSummary));
  }

  async get(taskId: string): Promise<RuntimeTaskSummary | undefined> {
    const result = await this.#pool.query<TaskRow>(`${selectTaskSummary} WHERE task.task_id=$1`, [
      taskId,
    ]);
    return result.rows[0] === undefined ? undefined : mapTaskSummary(result.rows[0]);
  }
}

const selectTaskSummary = `SELECT task.task_id,task.goal_id,task.plan_id,task.context_id,task.phase,
  task.selected_skill_id,binding.binding_id,task.created_at,task.updated_at
  FROM agent_task task
  LEFT JOIN task_capability_binding binding ON binding.task_id=task.task_id`;

function mapTaskSummary(row: TaskRow): RuntimeTaskSummary {
  return Object.freeze({
    taskId: row.task_id,
    ...(row.goal_id === null ? {} : { goalId: row.goal_id }),
    ...(row.plan_id === null ? {} : { planId: row.plan_id }),
    contextId: row.context_id,
    phase: row.phase,
    ...(row.selected_skill_id === null ? {} : { selectedSkillId: row.selected_skill_id }),
    ...(row.binding_id === null ? {} : { capabilityBindingId: row.binding_id }),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    controlledActions: Object.freeze({
      pause: false,
      resume: false,
      cancel: false,
      goalPatch: false,
    }),
  });
}
