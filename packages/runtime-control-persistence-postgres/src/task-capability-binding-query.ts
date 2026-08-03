import type { Pool, QueryResultRow } from 'pg';

import { createTaskCapabilityBinding, type TaskCapabilityBinding } from '../../domain/src/index.js';

interface BindingRow extends QueryResultRow {
  binding_id: string;
  task_id: string;
  requested_capability_id: string;
  capability_version: number;
  exposure_id: string | null;
  exposure_version: number | null;
  input_snapshot: unknown;
  success_criteria_snapshot: Record<string, unknown>[];
  evidence_requirement_snapshot: Record<string, unknown>[];
  constraint_snapshot: Record<string, unknown>[];
  initial_implementation_refs: string[];
  provider_policy_snapshot: unknown;
  binding_hash: string;
  bound_at: Date;
}

export class PostgresRuntimeTaskCapabilityBindingQuery {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined> {
    const result = await this.#pool.query<BindingRow>(
      'SELECT * FROM task_capability_binding WHERE task_id=$1',
      [taskId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return createTaskCapabilityBinding({
      bindingId: row.binding_id,
      taskId: row.task_id,
      requestedCapabilityId: row.requested_capability_id,
      capabilityVersion: row.capability_version,
      ...(row.exposure_id === null
        ? {}
        : {
            exposureId: row.exposure_id,
            exposureVersion: row.exposure_version ?? invalidBindingRow('exposure_version'),
          }),
      inputSnapshot: row.input_snapshot,
      successCriteriaSnapshot: row.success_criteria_snapshot,
      evidenceRequirementSnapshot: row.evidence_requirement_snapshot,
      constraintSnapshot: row.constraint_snapshot,
      initialImplementationRefs: row.initial_implementation_refs,
      ...(row.provider_policy_snapshot === null
        ? {}
        : { providerPolicySnapshot: row.provider_policy_snapshot }),
      bindingHash: row.binding_hash.trim(),
      boundAt: row.bound_at.toISOString(),
    });
  }
}

function invalidBindingRow(field: string): never {
  throw new Error(`TASK_CAPABILITY_ROW_INVALID:${field}`);
}
