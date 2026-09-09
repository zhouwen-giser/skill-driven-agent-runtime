import type { PoolClient } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';

export function evidenceTaskScope(
  scope: DeviceWorkScope | undefined,
  first: number,
  alias = 'task',
) {
  if (scope === undefined) return { predicate: 'TRUE', values: [] };
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias) || !Number.isSafeInteger(first) || first < 1)
    throw new Error('DEVICE_SCOPE_SQL_INVALID');
  return {
    predicate: `((${alias}.device_id=ANY($${String(first)}::text[]) AND ${alias}.sdar_service_key=$${String(first + 1)}) OR (${alias}.device_id IS NULL AND $${String(first + 2)}::boolean))`,
    values: [scope.allowedDeviceIds, scope.sdarServiceKey, scope.includeNonDevice],
  };
}

/** Global definitions have no Task; Task evidence derives ownership before deduplication. */
export async function evidenceTaskDevice(
  client: PoolClient,
  scope: DeviceWorkScope | undefined,
  taskId: string | undefined,
  contextId: string | undefined,
): Promise<string | null | undefined> {
  if (scope === undefined) return undefined;
  if (taskId === undefined) return null;
  const filter = evidenceTaskScope(scope, 3);
  const result = await client.query<{ device_id: string | null }>(
    `SELECT device_id FROM agent_task task WHERE task_id=$1 AND ($2::text IS NULL OR context_id=$2)
      AND ${filter.predicate} FOR KEY SHARE OF task`,
    [taskId, contextId ?? null, ...filter.values],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('EVIDENCE_TASK_DEVICE_SCOPE_DENIED');
  return row.device_id;
}

export function evidenceOutboxScope(
  scope: DeviceWorkScope | undefined,
  first: number,
  alias = 'evidence_outbox',
) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias)) throw new Error('DEVICE_SCOPE_SQL_INVALID');
  const task = evidenceTaskScope(scope, first);
  return {
    predicate:
      scope === undefined
        ? 'TRUE'
        : `(${alias}.task_id IS NULL OR EXISTS(SELECT 1 FROM agent_task task WHERE task.task_id=${alias}.task_id AND ${task.predicate}))`,
    values: task.values,
  };
}

export async function lockEvidencePartition(
  client: PoolClient,
  scope: DeviceWorkScope | undefined,
  partition: string,
): Promise<void> {
  if (scope !== undefined)
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `evidence.partition:${partition}`,
    ]);
}

/** A partition has one fenced ACK frontier: never acquire a partially visible partition. */
export async function requireEvidencePartitionScope(
  client: PoolClient,
  scope: DeviceWorkScope | undefined,
  partition: string,
): Promise<void> {
  if (scope === undefined) return;
  await lockEvidencePartition(client, scope, partition);
  const filter = evidenceOutboxScope(scope, 2);
  const result = await client.query<{ denied: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM evidence_outbox WHERE source_partition=$1 AND NOT (${filter.predicate})) AS denied`,
    [partition, ...filter.values],
  );
  if (result.rows[0]?.denied !== false) throw new Error('EVIDENCE_PARTITION_DEVICE_SCOPE_DENIED');
}

/** Issues can precede envelope persistence; a real Task episode still proves their owner. */
export function evidenceIssueScope(
  scope: DeviceWorkScope | undefined,
  first: number,
  alias: string,
) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias)) throw new Error('DEVICE_SCOPE_SQL_INVALID');
  const task = evidenceTaskScope(scope, first);
  const record = evidenceOutboxScope(scope, first, 'issue_evidence');
  if (scope === undefined) return task;
  return {
    values: task.values,
    predicate: `(
      (${alias}.episode_id IS NULL AND ${alias}.record_id IS NULL)
      OR EXISTS(SELECT 1 FROM agent_task task WHERE task.task_id=${alias}.episode_id AND ${task.predicate})
      OR EXISTS(SELECT 1 FROM evidence_outbox issue_evidence
        WHERE (issue_evidence.record_id=${alias}.record_id OR issue_evidence.episode_id=${alias}.episode_id)
          AND ${record.predicate})
    ) AND NOT EXISTS(SELECT 1 FROM agent_task task WHERE task.task_id=${alias}.episode_id AND NOT ${task.predicate})
      AND NOT EXISTS(SELECT 1 FROM evidence_outbox issue_evidence
      WHERE (issue_evidence.record_id=${alias}.record_id OR issue_evidence.episode_id=${alias}.episode_id)
        AND NOT ${record.predicate})`,
  };
}

export function directEvidencePartitionTask(partition: string): string | undefined {
  for (const prefix of ['runtime-core:', 'skill:', 'mcp-capability:']) {
    if (partition.startsWith(prefix)) {
      const taskId = partition.slice(prefix.length);
      if (taskId.length === 0) throw new Error('EVIDENCE_PARTITION_IDENTITY_INVALID');
      return taskId;
    }
  }
  if (!partition.startsWith('v141:experience_task:')) return undefined;
  const match = /^v141:experience_task:([0-9]+):(.+)$/u.exec(partition);
  const taskId = match?.[2];
  if (Number(match?.[1]) !== taskId?.length) throw new Error('EVIDENCE_PARTITION_IDENTITY_INVALID');
  return taskId;
}

export function evidenceCheckpointScope(
  scope: DeviceWorkScope | undefined,
  first: number,
  alias = 'evidence_source_checkpoint',
) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias)) throw new Error('DEVICE_SCOPE_SQL_INVALID');
  const task = evidenceTaskScope(scope, first);
  if (scope === undefined) return task;
  const evidence = evidenceOutboxScope(scope, first, 'checkpoint_evidence');
  const partition = `${alias}.source_partition`;
  const taskId = `CASE
    WHEN ${partition} LIKE 'runtime-core:%' THEN substring(${partition} from 14)
    WHEN ${partition} LIKE 'skill:%' THEN substring(${partition} from 7)
    WHEN ${partition} LIKE 'mcp-capability:%' THEN substring(${partition} from 16)
    WHEN ${partition} LIKE 'v141:experience_task:%' THEN regexp_replace(${partition},'^v141:experience_task:[0-9]+:','')
    ELSE NULL END`;
  return {
    values: task.values,
    predicate: `(
    (${taskId}) IS NULL OR EXISTS(SELECT 1 FROM agent_task task WHERE task.task_id=(${taskId}) AND ${task.predicate})
  ) AND NOT EXISTS(SELECT 1 FROM evidence_outbox checkpoint_evidence
    WHERE checkpoint_evidence.source_partition=${partition} AND NOT ${evidence.predicate})`,
  };
}
