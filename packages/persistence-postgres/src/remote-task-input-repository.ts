import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  RemoteTaskInputAttempt,
  RemoteTaskInputRepository,
} from '../../application/src/index.js';
import type { RemoteTaskInputLink } from '../../domain/src/index.js';

interface InputLinkRow extends QueryResultRow {
  input_request_id: string;
  control_event_id: string;
  binding_id: string;
  remote_task_id: string;
  workflow_instance_id: string;
  workflow_node_id: string;
  workflow_node_run_id: string;
  remote_revision: string;
  result_hash: string;
  input_requests_json: unknown;
  status: RemoteTaskInputLink['status'];
  created_at: Date | string;
  updated_at: Date | string;
}

interface InputAttemptRow extends QueryResultRow {
  attempt_id: string;
  input_request_id: string;
  binding_id: string;
  expected_binding_version: string | number;
  status: RemoteTaskInputAttempt['status'];
  protocol_revision: string | null;
  error_code: string | null;
  started_at: Date | string;
  completed_at: Date | string;
  duration_ms: string | number;
}

export class PostgresRemoteTaskInputRepository implements RemoteTaskInputRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  findEligibleRequests(bindingId: string, requests: Readonly<Record<string, unknown>>) {
    return findEligibleRemoteTaskInputRequests(this.#pool, bindingId, requests);
  }

  activate(input: Parameters<RemoteTaskInputRepository['activate']>[0]): Promise<boolean> {
    return withTransaction(this.#pool, async (client) => {
      const authority = (
        await client.query<{
          event_id: string;
          binding_id: string;
          remote_task_id: string;
          agent_task_id: string;
          workflow_instance_id: string;
          workflow_node_id: string;
          workflow_node_run_id: string;
          remote_revision: string;
          result_hash: string;
        }>(
          `SELECT event.event_id,event.binding_id,binding.remote_task_id,binding.agent_task_id,
                  binding.workflow_instance_id,binding.workflow_node_id,binding.workflow_node_run_id,
                  event.remote_revision,event.result_hash
           FROM remote_task_control_event AS event
           JOIN remote_task_binding AS binding ON binding.binding_id=event.binding_id
           JOIN workflow_continuation_wait_binding AS wait
             ON wait.binding_id=binding.binding_id AND wait.node_run_id=binding.workflow_node_run_id
           JOIN workflow_continuation_snapshot AS snapshot
             ON snapshot.snapshot_id=wait.snapshot_id AND snapshot.lifecycle='active'
           JOIN workflow_instance AS instance
             ON instance.instance_id=binding.workflow_instance_id AND instance.status='waiting_external'
           WHERE event.event_id=$1 AND event.event_type='task.input_required'
             AND event.status='claimed' AND event.continuation_claim_token=$2
             AND binding.local_state='awaiting_input' AND binding.protocol_status='input_required'
             AND event.runtime_revision=binding.runtime_revision
             AND binding.invalidated_at IS NULL AND binding.terminal_at IS NULL
           FOR UPDATE OF event,binding,instance`,
          [input.link.controlEventId, input.claimToken],
        )
      ).rows[0];
      if (authority === undefined) return false;
      if (
        authority.binding_id !== input.link.bindingId ||
        authority.remote_task_id !== input.link.remoteTaskId ||
        authority.agent_task_id !== input.request.taskId ||
        authority.workflow_instance_id !== input.link.workflowInstanceId ||
        authority.workflow_node_id !== input.link.workflowNodeId ||
        authority.workflow_node_run_id !== input.link.workflowNodeRunId ||
        authority.remote_revision !== input.link.remoteRevision ||
        authority.result_hash !== input.link.resultHash
      )
        throw new Error('REMOTE_TASK_INPUT_AUTHORITY_MISMATCH');
      const eligible = await findEligibleRemoteTaskInputRequests(
        client,
        input.link.bindingId,
        input.link.inputRequests,
      );
      if (Object.keys(eligible).length !== Object.keys(input.link.inputRequests).length)
        return false;
      const task = await client.query(
        `UPDATE agent_task SET phase='awaiting_user_input',phase_message=$2,updated_at=$3
         WHERE task_id=$1 AND (phase='executing' OR (phase='awaiting_user_input' AND EXISTS(
           SELECT 1 FROM task_input_request request
           JOIN remote_task_input_link link ON link.input_request_id=request.input_request_id
           JOIN remote_task_control_event event ON event.event_id=link.control_event_id
           WHERE request.task_id=$1 AND request.status='waiting' AND link.binding_id=$4
             AND event.runtime_revision IS DISTINCT FROM (
               SELECT runtime_revision FROM remote_task_control_event WHERE event_id=$5))))
         RETURNING task_id`,
        [
          input.request.taskId,
          input.phaseMessage,
          input.processedAt,
          input.link.bindingId,
          input.link.controlEventId,
        ],
      );
      if (task.rowCount !== 1) return false;
      // Replacing a local question does not close an unsent Provider key.
      await client.query(
        `UPDATE task_input_request request SET status='canceled'
         FROM remote_task_input_link link,remote_task_control_event event
         WHERE request.input_request_id=link.input_request_id
           AND event.event_id=link.control_event_id AND link.binding_id=$1
           AND request.status='waiting' AND event.runtime_revision IS DISTINCT FROM (
             SELECT runtime_revision FROM remote_task_control_event WHERE event_id=$2)`,
        [input.link.bindingId, input.link.controlEventId],
      );
      await client.query(
        `INSERT INTO task_input_request(
           input_request_id,task_id,context_id,source,question,status,control_id,
           control_round_index,created_at,answered_at)
         VALUES($1,$2,$3,'remote_task',$4,'waiting',NULL,NULL,$5,NULL)`,
        [
          input.request.inputRequestId,
          input.request.taskId,
          input.request.contextId,
          input.request.question,
          input.request.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO remote_task_input_link(
           input_request_id,control_event_id,binding_id,remote_task_id,workflow_instance_id,
           workflow_node_id,workflow_node_run_id,remote_revision,result_hash,input_requests_json,
           status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'waiting',$11,$11)`,
        [
          input.link.inputRequestId,
          input.link.controlEventId,
          input.link.bindingId,
          input.link.remoteTaskId,
          input.link.workflowInstanceId,
          input.link.workflowNodeId,
          input.link.workflowNodeRunId,
          input.link.remoteRevision,
          input.link.resultHash,
          JSON.stringify(input.link.inputRequests),
          input.link.createdAt,
        ],
      );
      const finished = await client.query(
        `UPDATE remote_task_control_event
         SET status='processed',processed_at=$3,error_code=NULL,
             continuation_claim_token=NULL,continuation_claim_expires_at=NULL
         WHERE event_id=$1 AND status='claimed' AND continuation_claim_token=$2`,
        [input.link.controlEventId, input.claimToken, input.processedAt],
      );
      if (finished.rowCount !== 1) throw new Error('REMOTE_TASK_INPUT_CONTROL_CAS_FAILED');
      return true;
    });
  }

  async findLink(inputRequestId: string): Promise<RemoteTaskInputLink | undefined> {
    const result = await this.#pool.query<InputLinkRow>(
      'SELECT * FROM remote_task_input_link WHERE input_request_id=$1',
      [inputRequestId],
    );
    return result.rows[0] === undefined ? undefined : mapLink(result.rows[0]);
  }

  claimUpdate(input: Parameters<RemoteTaskInputRepository['claimUpdate']>[0]) {
    return withTransaction(this.#pool, async (client) => {
      const link = (
        await client.query<InputLinkRow>(
          `SELECT link.* FROM remote_task_binding binding
         JOIN remote_task_input_link link ON link.binding_id=binding.binding_id
         JOIN remote_task_control_event event ON event.event_id=link.control_event_id
         WHERE link.input_request_id=$1 AND binding.version=$2 AND link.status='answered'
           AND event.runtime_revision=binding.runtime_revision
           AND binding.local_state='awaiting_input' AND binding.protocol_status='input_required'
           AND binding.invalidated_at IS NULL AND binding.terminal_at IS NULL
         FOR UPDATE OF binding,link`,
          [input.inputRequestId, input.expectedBindingVersion],
        )
      ).rows[0];
      if (link === undefined) return undefined;
      const eligible = await findEligibleRemoteTaskInputRequests(
        client,
        link.binding_id,
        mapLink(link).inputRequests,
      );
      if (Object.keys(eligible).length === 0) return undefined;
      await client.query(
        `UPDATE remote_task_input_link SET status='update_uncertain',updated_at=$2
         WHERE input_request_id=$1 AND status='answered'`,
        [input.inputRequestId, input.startedAt],
      );
      // A crash before/after the wire request leaves a pollable, non-replayable reservation.
      const reserved = await client.query<{ version: string | number }>(
        `UPDATE remote_task_binding
         SET local_state='polling',next_poll_at=$3,updated_at=$3,version=version+1
         WHERE binding_id=$1 AND version=$2 RETURNING version`,
        [link.binding_id, input.expectedBindingVersion, input.startedAt],
      );
      const version = reserved.rows[0]?.version;
      if (version === undefined) throw new Error('REMOTE_TASK_INPUT_RESERVATION_CAS_FAILED');
      return { inputRequests: eligible, expectedBindingVersion: toSafeNumber(version) };
    });
  }

  recordUpdateOutcome(
    input: Parameters<RemoteTaskInputRepository['recordUpdateOutcome']>[0],
  ): Promise<Readonly<{ applied: boolean }>> {
    return withTransaction(this.#pool, async (client) => {
      const link = (
        await client.query<InputLinkRow>(
          `SELECT link.* FROM remote_task_binding binding
           JOIN remote_task_input_link link ON link.binding_id=binding.binding_id
           WHERE link.input_request_id=$1 FOR UPDATE OF binding,link`,
          [input.inputRequestId],
        )
      ).rows[0];
      if (link?.status !== 'update_uncertain') return { applied: false };
      if (
        input.attempt.inputRequestId !== link.input_request_id ||
        input.attempt.bindingId !== link.binding_id ||
        input.attempt.expectedBindingVersion !== input.expectedBindingVersion
      )
        throw new Error('REMOTE_TASK_INPUT_ATTEMPT_AUTHORITY_MISMATCH');
      await insertAttempt(client, input.attempt);
      // The actual wire outcome survives even if a later observation won the binding CAS.
      await client.query(
        `UPDATE remote_task_input_link SET status=$2,updated_at=$3
         WHERE input_request_id=$1 AND status='update_uncertain'`,
        [input.inputRequestId, input.status, input.observedAt],
      );
      const binding = await client.query(
        `UPDATE remote_task_binding
         SET local_state='polling',next_poll_at=$3,
             poll_claim_token=NULL,poll_claimed_at=NULL,poll_claim_expires_at=NULL,
             updated_at=$3,version=version+1
         WHERE binding_id=$1 AND version=$2 AND local_state='polling'
           AND invalidated_at IS NULL AND terminal_at IS NULL`,
        [link.binding_id, input.expectedBindingVersion, input.observedAt],
      );
      if (binding.rowCount !== 1) return { applied: false };
      return { applied: true };
    });
  }

  async listAttempts(inputRequestId: string): Promise<readonly RemoteTaskInputAttempt[]> {
    const result = await this.#pool.query<InputAttemptRow>(
      `SELECT * FROM remote_task_input_attempt
       WHERE input_request_id=$1 ORDER BY started_at,attempt_id`,
      [inputRequestId],
    );
    return result.rows.map(mapAttempt);
  }
}

/** Read persisted accepted Task details only; callers that mutate must hold the binding lock. */
export async function findEligibleRemoteTaskInputRequests(
  client: Pick<Pool, 'query'>,
  bindingId: string,
  requests: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const history = await client.query<{
    status: string;
    input_requests: Readonly<Record<string, unknown>> | null;
  }>(
    `SELECT payload_json->>'status' AS status,payload_json->'inputRequests' AS input_requests
     FROM remote_task_observation
     WHERE binding_id=$1 AND accepted AND observation_source<>'admission'
       AND observation_type IN ('task.snapshot','task.progress','task.scheduled',
         'task.paused','task.resumed','task.heartbeat')
     ORDER BY sequence`,
    [bindingId],
  );
  const states = new Map<string, 'open' | 'superseded'>();
  for (const observation of history.rows) {
    // A basic input_required projection does not assert a detailed request set.
    if (observation.status === 'input_required' && observation.input_requests === null) continue;
    if (
      !['input_required', 'working', 'completed', 'failed', 'cancelled'].includes(
        observation.status,
      )
    )
      continue;
    const current =
      observation.status === 'input_required' ? (observation.input_requests ?? {}) : {};
    for (const [key, state] of states)
      if (state === 'open' && !Object.hasOwn(current, key)) states.set(key, 'superseded');
    for (const key of Object.keys(current)) if (!states.has(key)) states.set(key, 'open');
  }
  const links = await client.query<{
    input_requests_json: Readonly<Record<string, unknown>>;
  }>(
    `SELECT link.input_requests_json FROM remote_task_input_link link
     WHERE link.binding_id=$1 AND (link.status IN (
       'update_acknowledged','update_uncertain','provider_advanced') OR EXISTS(
       SELECT 1 FROM remote_task_input_attempt attempt
       WHERE attempt.input_request_id=link.input_request_id AND attempt.binding_id=link.binding_id))`,
    [bindingId],
  );
  const closed = new Set(links.rows.flatMap((link) => Object.keys(link.input_requests_json)));
  return Object.fromEntries(
    Object.entries(requests).filter(([key]) => states.get(key) === 'open' && !closed.has(key)),
  );
}

async function insertAttempt(client: PoolClient, attempt: RemoteTaskInputAttempt): Promise<void> {
  await client.query(
    `INSERT INTO remote_task_input_attempt(
       attempt_id,input_request_id,binding_id,expected_binding_version,method,status,
       protocol_revision,error_code,started_at,completed_at,duration_ms)
     VALUES($1,$2,$3,$4,'tasks/update',$5,$6,$7,$8,$9,$10)
     ON CONFLICT(attempt_id) DO NOTHING`,
    [
      attempt.attemptId,
      attempt.inputRequestId,
      attempt.bindingId,
      attempt.expectedBindingVersion,
      attempt.status,
      attempt.protocolRevision ?? null,
      attempt.errorCode ?? null,
      attempt.startedAt,
      attempt.completedAt,
      attempt.durationMs,
    ],
  );
}

function mapLink(row: InputLinkRow): RemoteTaskInputLink {
  if (typeof row.input_requests_json !== 'object' || row.input_requests_json === null)
    throw new Error('REMOTE_TASK_INPUT_JSON_INVALID');
  return {
    inputRequestId: row.input_request_id,
    controlEventId: row.control_event_id,
    bindingId: row.binding_id,
    remoteTaskId: row.remote_task_id,
    workflowInstanceId: row.workflow_instance_id,
    workflowNodeId: row.workflow_node_id,
    workflowNodeRunId: row.workflow_node_run_id,
    remoteRevision: row.remote_revision,
    resultHash: row.result_hash,
    inputRequests: row.input_requests_json as Readonly<Record<string, unknown>>,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapAttempt(row: InputAttemptRow): RemoteTaskInputAttempt {
  return {
    attemptId: row.attempt_id,
    inputRequestId: row.input_request_id,
    bindingId: row.binding_id,
    expectedBindingVersion: toSafeNumber(row.expected_binding_version),
    status: row.status,
    ...(row.protocol_revision === null ? {} : { protocolRevision: row.protocol_revision }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
    durationMs: toSafeNumber(row.duration_ms),
  };
}

function toIsoString(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.valueOf())) throw new Error('POSTGRES_TIMESTAMP_INVALID');
  return timestamp.toISOString();
}

function toSafeNumber(value: string | number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('POSTGRES_NUMBER_INVALID');
  return number;
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
