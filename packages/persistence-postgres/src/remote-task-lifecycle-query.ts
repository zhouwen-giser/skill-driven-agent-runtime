import type { Pool, QueryResultRow } from 'pg';

import type {
  RemoteTaskContinuationLifecycleEvidence,
  RemoteTaskInputLifecycleEvidence,
  RemoteTaskLifecycleEvidence,
  RemoteTaskLifecycleQuery,
} from '../../application/src/index.js';

import { PostgresRemoteTaskCancellationRepository } from './remote-task-cancellation-repository.js';
import { PostgresRemoteTaskInputRepository } from './remote-task-input-repository.js';
import { PostgresRemoteTaskRepository } from './remote-task-repository.js';

interface BindingIdentityRow extends QueryResultRow {
  binding_id: string;
}

interface InputIdentityRow extends QueryResultRow {
  input_request_id: string;
  question: string;
  request_status: RemoteTaskInputLifecycleEvidence['requestStatus'];
  response_content: unknown;
  answered_at: Date | string | null;
}

interface CancellationIdentityRow extends QueryResultRow {
  cancel_request_id: string;
}

interface ContinuationRow extends QueryResultRow {
  snapshot_id: string;
  continuation_id: string;
  state_version: string | number;
  lifecycle: RemoteTaskContinuationLifecycleEvidence['lifecycle'];
  wait_id: string;
  wait_state: RemoteTaskContinuationLifecycleEvidence['waitState'];
  node_id: string;
  node_run_id: string;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Builds a credential-free read model from the authoritative V1.1 tables.
 * The projection deliberately delegates persisted protocol payload validation to
 * the write repositories instead of introducing a second mapper/source of truth.
 */
export class PostgresRemoteTaskLifecycleQuery implements RemoteTaskLifecycleQuery {
  readonly #pool: Pool;
  readonly #remoteTasks: PostgresRemoteTaskRepository;
  readonly #inputs: PostgresRemoteTaskInputRepository;
  readonly #cancellations: PostgresRemoteTaskCancellationRepository;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.#remoteTasks = new PostgresRemoteTaskRepository(pool);
    this.#inputs = new PostgresRemoteTaskInputRepository(pool);
    this.#cancellations = new PostgresRemoteTaskCancellationRepository(pool);
  }

  async listByAgentTaskId(agentTaskId: string): Promise<readonly RemoteTaskLifecycleEvidence[]> {
    const bindings = await this.#pool.query<BindingIdentityRow>(
      `SELECT binding_id FROM remote_task_binding
       WHERE agent_task_id=$1 ORDER BY created_at,binding_id`,
      [agentTaskId],
    );
    return Promise.all(bindings.rows.map((row) => this.#readBinding(row.binding_id)));
  }

  async #readBinding(bindingId: string): Promise<RemoteTaskLifecycleEvidence> {
    const binding = await this.#remoteTasks.findById(bindingId);
    if (binding === undefined) throw new Error('REMOTE_TASK_LIFECYCLE_BINDING_DISAPPEARED');
    const [observations, controls, protocolAttempts, continuations, inputRounds, cancellations] =
      await Promise.all([
        this.#remoteTasks.listObservations(bindingId),
        this.#remoteTasks.listControlEvents(bindingId),
        this.#remoteTasks.listProtocolAttempts(bindingId),
        this.#readContinuations(bindingId),
        this.#readInputs(bindingId),
        this.#readCancellations(bindingId),
      ]);
    return {
      binding,
      observations,
      controls,
      protocolAttempts,
      continuations,
      inputRounds,
      cancellations,
    };
  }

  async #readInputs(bindingId: string): Promise<readonly RemoteTaskInputLifecycleEvidence[]> {
    const identities = await this.#pool.query<InputIdentityRow>(
      `SELECT link.input_request_id,request.question,request.status AS request_status,
              response.content_json AS response_content,request.answered_at
       FROM remote_task_input_link link
       JOIN task_input_request request ON request.input_request_id=link.input_request_id
       LEFT JOIN task_input_response response ON response.input_request_id=link.input_request_id
       WHERE link.binding_id=$1 ORDER BY link.created_at,link.input_request_id`,
      [bindingId],
    );
    return Promise.all(
      identities.rows.map(async (row) => {
        const link = await this.#inputs.findLink(row.input_request_id);
        if (link === undefined) throw new Error('REMOTE_TASK_LIFECYCLE_INPUT_LINK_DISAPPEARED');
        return {
          link,
          question: row.question,
          requestStatus: row.request_status,
          ...(row.response_content === null ? {} : { responseContent: row.response_content }),
          ...(row.answered_at === null ? {} : { answeredAt: toIsoString(row.answered_at) }),
          attempts: await this.#inputs.listAttempts(row.input_request_id),
        };
      }),
    );
  }

  async #readCancellations(bindingId: string) {
    const identities = await this.#pool.query<CancellationIdentityRow>(
      `SELECT cancel_request_id FROM remote_task_cancel_request
       WHERE binding_id=$1 ORDER BY requested_at,cancel_request_id`,
      [bindingId],
    );
    return Promise.all(
      identities.rows.map(async (row) => {
        const request = await this.#cancellations.findCancellation(row.cancel_request_id);
        if (request === undefined)
          throw new Error('REMOTE_TASK_LIFECYCLE_CANCELLATION_DISAPPEARED');
        return {
          request,
          attempts: await this.#cancellations.listCancellationAttempts(row.cancel_request_id),
        };
      }),
    );
  }

  async #readContinuations(
    bindingId: string,
  ): Promise<readonly RemoteTaskContinuationLifecycleEvidence[]> {
    const result = await this.#pool.query<ContinuationRow>(
      `SELECT snapshot.snapshot_id,snapshot.continuation_id,snapshot.state_version,
              snapshot.lifecycle,wait.wait_id,wait.wait_state,wait.node_id,wait.node_run_id,
              snapshot.created_at,snapshot.updated_at
       FROM workflow_continuation_wait_binding wait
       JOIN workflow_continuation_snapshot snapshot ON snapshot.snapshot_id=wait.snapshot_id
       WHERE wait.binding_id=$1 ORDER BY snapshot.state_version,snapshot.snapshot_id`,
      [bindingId],
    );
    return result.rows.map((row) => ({
      snapshotId: row.snapshot_id,
      continuationId: row.continuation_id,
      stateVersion: toSafeNumber(row.state_version),
      lifecycle: row.lifecycle,
      waitId: row.wait_id,
      waitState: row.wait_state,
      nodeId: row.node_id,
      nodeRunId: row.node_run_id,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    }));
  }
}

function toIsoString(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.valueOf())) throw new Error('POSTGRES_TIMESTAMP_INVALID');
  return timestamp.toISOString();
}

function toSafeNumber(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('POSTGRES_NUMBER_INVALID');
  return parsed;
}
