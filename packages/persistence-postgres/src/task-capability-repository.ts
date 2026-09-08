import { randomUUID } from 'node:crypto';
import {
  assertDeviceWorkScope,
  type DeviceWorkScope,
  type DeviceTaskOwnership,
} from '../../domain/src/device-task-context.js';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  CapabilityAdmissionReceipt,
  CapabilityAdmissionReceiptStore,
  InitialTaskAdmissionRecord,
  InitialTaskAdmissionStore,
  RuntimeCapabilityExposure,
  RuntimeCapabilityResolution,
  TaskCapabilityAcceptance,
  TaskCapabilityAcceptanceStore,
} from '../../application/src/index.js';
import {
  createTaskCapabilityBinding,
  createTaskCapabilityExecutionAttempt,
  type ConversationContext,
  type TaskCapabilityBinding,
  type TaskCapabilityExecutionAttempt,
} from '../../domain/src/index.js';
import {
  parseMcpProviderBindingPolicyOverride,
  type ExactMcpProviderBindingPolicy,
} from '../../node-control-domain/src/index.js';
import {
  setAgentTaskCommandIdentity,
  type PostgresAgentTaskCommandContext,
} from './repositories.js';

interface ExposureRow extends QueryResultRow {
  exposure_id: string;
  exposure_version: number;
  capability_id: string;
  capability_version: number;
  request_schema: unknown;
  requester_policy: Record<string, unknown> | null;
}

interface ResolutionRow extends ExposureRow {
  evaluation_input: Record<string, unknown>;
  catalog_hash: string;
  policy_hash: string;
  snapshot_hash: string;
}

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

interface AttemptRow extends QueryResultRow {
  attempt_id: string;
  task_id: string;
  capability_binding_id: string;
  attempt_no: number;
  plan_id: string | null;
  plan_template_ref: string | null;
  skill_version_refs: string[];
  provider_binding_refs: string[];
  reason: TaskCapabilityExecutionAttempt['reason'];
  status: TaskCapabilityExecutionAttempt['status'];
  started_at: Date | null;
  completed_at: Date | null;
}

interface SkillPolicyRow extends QueryResultRow {
  tool_policy: unknown;
  runtime_policy: unknown;
}

interface ArtifactPolicyRow extends QueryResultRow {
  dependency_snapshot: unknown;
}

interface InitialTaskAdmissionRow extends QueryResultRow {
  admission_id?: string;
  idempotency_key: string;
  request_hash: string;
  task_id: string;
  context_id: string;
  capability_binding_id: string;
  capability_attempt_id: string;
  created_context: boolean;
  accepted_at: Date | string;
}

interface InitialTaskAdmissionContextRow extends QueryResultRow {
  context_id: string;
  user_id: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const INITIAL_TASK_ADMISSION_KEY_LOCK_NAMESPACE = 14_201;
const INITIAL_TASK_ADMISSION_CONTEXT_LOCK_NAMESPACE = 14_202;

const initialTaskAdmissionSelect = `SELECT idempotency_key,request_hash,task_id,context_id,
                                            capability_binding_id,capability_attempt_id,
                                            created_context,accepted_at
                                       FROM initial_task_admission`;

export class PostgresTaskCapabilityRepository
  implements
    TaskCapabilityAcceptanceStore,
    InitialTaskAdmissionStore,
    CapabilityAdmissionReceiptStore
{
  readonly #pool: Pool;
  readonly #deviceScope: DeviceWorkScope | undefined;
  readonly #initialSelect: string;
  readonly #onTaskStateCommitted:
    ((task: Parameters<TaskCapabilityAcceptanceStore['accept']>[0]['task']) => void) | undefined;
  readonly #commandContext: PostgresAgentTaskCommandContext | undefined;

  constructor(
    pool: Pool,
    onTaskStateCommitted?: (
      task: Parameters<TaskCapabilityAcceptanceStore['accept']>[0]['task'],
    ) => void,
    commandContext?: PostgresAgentTaskCommandContext,
    deviceScope?: DeviceWorkScope,
  ) {
    this.#pool = pool;
    this.#deviceScope = deviceScope;
    this.#initialSelect =
      deviceScope === undefined
        ? initialTaskAdmissionSelect
        : initialTaskAdmissionSelect.replace('SELECT ', 'SELECT admission_id,');
    this.#onTaskStateCommitted = onTaskStateCommitted;
    this.#commandContext = commandContext;
  }

  async listCurrentExposures(limit: number): Promise<readonly RuntimeCapabilityExposure[]> {
    const result = await this.#pool.query<ExposureRow>(
      `SELECT exposure.exposure_id,exposure.exposure_version,exposure.capability_id,exposure.capability_version,exposure.request_schema,exposure.requester_policy FROM runtime_agent_card_revision card JOIN runtime_agent_card_exposure_snapshot exposure ON exposure.revision=card.revision WHERE card.status='active' ORDER BY exposure.exposure_id,exposure.exposure_version DESC LIMIT $1`,
      [Math.min(64, Math.max(1, limit))],
    );
    return result.rows.map(mapExposure);
  }
  async findAdmissionReceipt(taskId: string): Promise<CapabilityAdmissionReceipt | undefined> {
    const result = await this.#pool.query<ReceiptRow>(
      'SELECT * FROM capability_admission_receipt WHERE task_id=$1',
      [taskId],
    );
    return result.rows[0] === undefined ? undefined : mapReceipt(result.rows[0]);
  }
  async findAdmissionReceiptByRequest(
    requestId: string,
  ): Promise<CapabilityAdmissionReceipt | undefined> {
    const result = await this.#pool.query<ReceiptRow>(
      'SELECT * FROM capability_admission_receipt WHERE request_id=$1',
      [requestId],
    );
    return result.rows[0] === undefined ? undefined : mapReceipt(result.rows[0]);
  }
  async createAdmissionReceipt(
    input: Parameters<CapabilityAdmissionReceiptStore['createAdmissionReceipt']>[0],
  ): Promise<CapabilityAdmissionReceipt> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        input.receipt.requestId,
      ]);
      const prior = await client.query<ReceiptRow>(
        'SELECT * FROM capability_admission_receipt WHERE request_id=$1',
        [input.receipt.requestId],
      );
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].request_hash !== input.receipt.requestHash)
          throw new Error('TASK_INITIAL_ADMISSION_IDEMPOTENCY_CONFLICT');
        await client.query('COMMIT');
        return mapReceipt(prior.rows[0]);
      }
      await insertOrValidateInitialAdmissionContext(client, input.context);
      await insertTask(client, input.task, this.#deviceScope);
      await client.query(
        'INSERT INTO capability_admission_receipt(task_id,request_id,request_hash,version,clarification,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)',
        [
          input.task.taskId,
          input.receipt.requestId,
          input.receipt.requestHash,
          input.receipt.version,
          JSON.stringify(input.receipt.clarification),
          input.receipt.createdAt,
          input.receipt.updatedAt,
        ],
      );
      await client.query(
        'INSERT INTO runtime_event(event_id,task_id,context_id,event_type,event_timestamp,summary) VALUES($1,$2,$3,$4,$5,$6)',
        [
          input.event.eventId,
          input.task.taskId,
          input.task.contextId,
          input.event.eventType,
          input.event.timestamp,
          input.event.summary,
        ],
      );
      await client.query('COMMIT');
      this.#onTaskStateCommitted?.(input.task);
      return input.receipt;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async updateAdmissionReceipt(
    receipt: CapabilityAdmissionReceipt,
    expectedVersion: number,
    task: Parameters<CapabilityAdmissionReceiptStore['updateAdmissionReceipt']>[2],
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const command = this.#commandContext?.current();
      if (command !== undefined) await setAgentTaskCommandIdentity(client, command);
      const taskRow = await client.query(
        "SELECT 1 FROM agent_task WHERE task_id=$1 AND phase='awaiting_user_input' FOR UPDATE",
        [task.taskId],
      );
      if (taskRow.rowCount !== 1) throw new Error('TASK_CAPABILITY_CLARIFICATION_STALE');
      const updated = await client.query(
        'UPDATE capability_admission_receipt SET version=$3,clarification=$4::jsonb,updated_at=$5 WHERE task_id=$1 AND version=$2 AND bound_at IS NULL',
        [
          receipt.taskId,
          expectedVersion,
          receipt.version,
          JSON.stringify(receipt.clarification),
          receipt.updatedAt,
        ],
      );
      if (updated.rowCount !== 1) throw new Error('TASK_CAPABILITY_CLARIFICATION_STALE');
      await client.query('UPDATE agent_task SET phase_message=$2,updated_at=$3 WHERE task_id=$1', [
        task.taskId,
        task.phaseMessage,
        task.updatedAt,
      ]);
      await client.query('COMMIT');
      this.#onTaskStateCommitted?.(task);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async acceptClarified(
    input: TaskCapabilityAcceptance,
    expectedReceiptVersion: number,
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const command = this.#commandContext?.current();
      if (command !== undefined) await setAgentTaskCommandIdentity(client, command);
      const task = await client.query(
        "SELECT 1 FROM agent_task WHERE task_id=$1 AND phase='awaiting_user_input' FOR UPDATE",
        [input.task.taskId],
      );
      if (task.rowCount !== 1) throw new Error('TASK_CAPABILITY_CLARIFICATION_STALE');
      const receipt = await client.query(
        'UPDATE capability_admission_receipt SET bound_at=$3,updated_at=$3,version=version+1 WHERE task_id=$1 AND version=$2 AND bound_at IS NULL',
        [input.task.taskId, expectedReceiptVersion, input.task.updatedAt],
      );
      if (receipt.rowCount !== 1) throw new Error('TASK_CAPABILITY_CLARIFICATION_STALE');
      await client.query(
        'UPDATE agent_task SET phase=$2,phase_message=$3,updated_at=$4 WHERE task_id=$1',
        [input.task.taskId, input.task.phase, input.task.phaseMessage, input.task.updatedAt],
      );
      await insertCapabilityAcceptance(client, input, true, this.#deviceScope);
      await client.query('COMMIT');
      this.#onTaskStateCommitted?.(input.task);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findCurrentExposure(exposureId: string): Promise<RuntimeCapabilityExposure | undefined> {
    const result = await this.#pool.query<ExposureRow>(
      `SELECT exposure.exposure_id,exposure.exposure_version,exposure.capability_id,
              exposure.capability_version,exposure.request_schema,exposure.requester_policy
         FROM runtime_agent_card_revision card
         JOIN runtime_agent_card_exposure_snapshot exposure ON exposure.revision=card.revision
        WHERE card.status='active' AND exposure.exposure_id=$1
        ORDER BY exposure.exposure_version DESC
        LIMIT 1`,
      [exposureId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapExposure(row);
  }

  async describeExposure(
    exposureId: string,
    exposureVersion: number,
  ): Promise<RuntimeCapabilityExposure | undefined> {
    const result = await this.#pool.query<ExposureRow>(
      `SELECT exposure.exposure_id,exposure.exposure_version,exposure.capability_id,
              exposure.capability_version,exposure.request_schema,exposure.requester_policy
         FROM runtime_agent_card_revision card
         JOIN runtime_agent_card_exposure_snapshot exposure ON exposure.revision=card.revision
        WHERE card.status='active' AND exposure.exposure_id=$1 AND exposure.exposure_version=$2`,
      [exposureId, exposureVersion],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapExposure(row);
  }

  async resolveExposure(exposureId: string, exposureVersion: number, now: string) {
    // Health is rechecked at execution; Task admission freezes the registered contract.
    void now;
    const result = await this.#pool.query<ResolutionRow>(
      `SELECT exposure.exposure_id,exposure.exposure_version,exposure.capability_id,
              exposure.capability_version,exposure.request_schema,exposure.requester_policy,
              readiness.evaluation_input,
              readiness.catalog_hash,readiness.policy_hash,readiness.snapshot_hash
         FROM runtime_agent_card_revision card
         JOIN runtime_agent_card_exposure_snapshot exposure ON exposure.revision=card.revision
         JOIN LATERAL (
           SELECT evaluation_input,catalog_hash,policy_hash,snapshot_hash
             FROM capability_readiness_snapshot
            WHERE capability_id=exposure.capability_id
              AND capability_version=exposure.capability_version
            ORDER BY snapshot_version DESC LIMIT 1
         ) readiness ON true
        WHERE card.status='active' AND exposure.exposure_id=$1 AND exposure.exposure_version=$2`,
      [exposureId, exposureVersion],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const definition = record(row.evaluation_input['definition']);
    if (
      definition['status'] !== 'published' ||
      row.evaluation_input['maintenanceMode'] !== false ||
      row.evaluation_input['killSwitch'] !== false
    )
      return undefined;
    const policies = await snapshotImplementationPolicies(this.#pool, row);
    return mapResolution(row, policies);
  }

  async accept(input: TaskCapabilityAcceptance): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `task-capability-accept:${input.task.taskId}`,
      ]);
      await insertCapabilityAcceptance(client, input, false, this.#deviceScope);
      await client.query('COMMIT');
      this.#onTaskStateCommitted?.(input.task);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
    ownership?: DeviceTaskOwnership,
  ): Promise<InitialTaskAdmissionRecord | undefined> {
    const scope = this.#initialScope(ownership);
    const result = await this.#pool.query<InitialTaskAdmissionRow>(
      `${this.#initialSelect}
       WHERE idempotency_key=$1 ${scope.predicate}`,
      [idempotencyKey, ...scope.values],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapInitialTaskAdmission(row);
  }

  #initialScope(ownership: DeviceTaskOwnership | undefined) {
    if (this.#deviceScope === undefined) {
      if (ownership !== undefined) throw new Error('DEVICE_STORAGE_NOT_CONFIGURED');
      return { predicate: '', values: [] as readonly unknown[] };
    }
    assertDeviceWorkScope(this.#deviceScope, ownership);
    return {
      predicate:
        'AND device_id IS NOT DISTINCT FROM $2::text AND sdar_service_key IS NOT DISTINCT FROM $3::text',
      values: [ownership?.deviceId ?? null, ownership?.sdarServiceKey ?? null],
    };
  }

  async acceptInitial(
    input: Parameters<InitialTaskAdmissionStore['acceptInitial']>[0],
  ): ReturnType<InitialTaskAdmissionStore['acceptInitial']> {
    const owner = input.capabilityAcceptance.task.deviceOwnership;
    const scope = this.#initialScope(owner);
    const admissionId = this.#deviceScope === undefined ? undefined : randomUUID();
    if (
      input.capabilityAcceptance.task.contextId !== input.context.contextId ||
      input.capabilityAcceptance.task.userId !== input.context.userId
    )
      throw new InitialTaskAdmissionPersistenceError(
        'TASK_INITIAL_ADMISSION_ACCEPTANCE_CONTEXT_MISMATCH',
        'Initial Task admission acceptance does not match its requested Context identity.',
      );
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      // Every initial admission acquires the two lock classes in this order.
      // Separate advisory namespaces prevent cross-class hash collisions from
      // reversing that order and introducing a deadlock cycle.
      await client.query('SELECT pg_advisory_xact_lock($1,hashtext($2))', [
        INITIAL_TASK_ADMISSION_KEY_LOCK_NAMESPACE,
        this.#deviceScope === undefined
          ? input.idempotencyKey
          : JSON.stringify([
              owner?.deviceId ?? null,
              owner?.sdarServiceKey ?? null,
              input.idempotencyKey,
            ]),
      ]);
      const existingResult = await client.query<InitialTaskAdmissionRow>(
        `${this.#initialSelect}
         WHERE idempotency_key=$1 ${scope.predicate}
         FOR SHARE`,
        [input.idempotencyKey, ...scope.values],
      );
      const existingRow = existingResult.rows[0];
      if (existingRow !== undefined) {
        const record = mapInitialTaskAdmission(existingRow);
        await client.query('COMMIT');
        return Object.freeze({
          status: record.requestHash === input.requestHash ? 'replayed' : 'conflict',
          record,
        });
      }
      await client.query('SELECT pg_advisory_xact_lock($1,hashtext($2))', [
        INITIAL_TASK_ADMISSION_CONTEXT_LOCK_NAMESPACE,
        input.context.contextId,
      ]);
      const contextAuthority = await insertOrValidateInitialAdmissionContext(client, input.context);
      await insertCapabilityAcceptance(
        client,
        input.capabilityAcceptance,
        false,
        this.#deviceScope,
      );
      await client.query(
        `INSERT INTO initial_task_admission(
           idempotency_key,request_hash,task_id,context_id,capability_binding_id,
           capability_attempt_id,created_context,accepted_at${admissionId === undefined ? '' : ',admission_id,device_id,sdar_service_key'})
         VALUES($1,$2,$3,$4,$5,$6,$7,$8${admissionId === undefined ? '' : ',$9,$10,$11'})`,
        [
          input.idempotencyKey,
          input.requestHash,
          input.capabilityAcceptance.task.taskId,
          input.context.contextId,
          input.capabilityAcceptance.binding.bindingId,
          input.capabilityAcceptance.capabilityAttempt.attemptId,
          contextAuthority.createdContext,
          input.acceptedAt,
          ...(admissionId === undefined
            ? []
            : [admissionId, owner?.deviceId ?? null, owner?.sdarServiceKey ?? null]),
        ],
      );
      await client.query('COMMIT');
      const record = Object.freeze({
        ...(admissionId === undefined ? {} : { admissionId }),
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        taskId: input.capabilityAcceptance.task.taskId,
        contextId: input.context.contextId,
        capabilityBindingId: input.capabilityAcceptance.binding.bindingId,
        capabilityAttemptId: input.capabilityAcceptance.capabilityAttempt.attemptId,
        createdContext: contextAuthority.createdContext,
        acceptedAt: input.acceptedAt,
      });
      // The A2A executor publishes this returned initial Task itself. Avoid an
      // optional post-commit notifier here: a notifier exception after COMMIT
      // must never turn durable formal acceptance into a synthetic failure.
      return Object.freeze({ status: 'accepted', record, context: contextAuthority.context });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findBinding(taskId: string) {
    const result = await this.#pool.query<BindingRow>(
      'SELECT * FROM task_capability_binding WHERE task_id=$1',
      [taskId],
    );
    return result.rows[0] === undefined ? undefined : mapBinding(result.rows[0]);
  }

  async listAttempts(taskId: string) {
    const result = await this.#pool.query<AttemptRow>(
      'SELECT * FROM task_capability_execution_attempt WHERE task_id=$1 ORDER BY attempt_no',
      [taskId],
    );
    return Object.freeze(result.rows.map(mapAttempt));
  }

  async bindInitialPlan(taskId: string, planId: string): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await this.#commandContext?.fenceTransaction(client, taskId);
      const updated = await client.query(
        `UPDATE task_capability_execution_attempt
            SET plan_id=$2
          WHERE attempt_id=(SELECT attempt_id FROM task_capability_execution_attempt
                             WHERE task_id=$1 ORDER BY attempt_no DESC LIMIT 1)
            AND status='prepared' AND plan_id IS NULL`,
        [taskId, planId],
      );
      if (updated.rowCount === 0) {
        const existing = await client.query<{ plan_id: string | null; status: string }>(
          `SELECT plan_id,status FROM task_capability_execution_attempt
            WHERE task_id=$1 ORDER BY attempt_no DESC LIMIT 1`,
          [taskId],
        );
        const row = existing.rows[0];
        if (row?.status !== 'prepared' || row.plan_id !== planId)
          throw new Error('TASK_CAPABILITY_INITIAL_PLAN_BINDING_INVALID');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendAttempt(input: Omit<TaskCapabilityExecutionAttempt, 'attemptNo' | 'status'>) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await this.#commandContext?.fenceTransaction(client, input.taskId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `task-capability-attempt:${input.taskId}`,
      ]);
      const nonterminalTask = await client.query(
        `SELECT task_id FROM agent_task
          WHERE task_id=$1
            AND phase NOT IN ('capability_gap','completed','canceled','failed','invalidated')
          FOR UPDATE`,
        [input.taskId],
      );
      if (nonterminalTask.rowCount !== 1) throw new Error('TASK_CAPABILITY_ATTEMPT_TASK_TERMINAL');
      await client.query(
        `UPDATE task_capability_execution_attempt
            SET status='superseded',completed_at=clock_timestamp()
          WHERE task_id=$1 AND status IN ('prepared','running','waiting')`,
        [input.taskId],
      );
      const next = await client.query<{ attempt_no: number }>(
        `SELECT COALESCE(MAX(attempt_no),0)+1 AS attempt_no
           FROM task_capability_execution_attempt WHERE task_id=$1`,
        [input.taskId],
      );
      const attempt = createTaskCapabilityExecutionAttempt({
        ...input,
        attemptNo: next.rows[0]?.attempt_no ?? 1,
        status: 'prepared',
      });
      await insertAttempt(client, attempt);
      await client.query('COMMIT');
      return attempt;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateLatestAttempt(
    taskId: string,
    status: Exclude<TaskCapabilityExecutionAttempt['status'], 'prepared'>,
    timestamp: string,
  ) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await this.#commandContext?.fenceTransaction(client, taskId);
      const result = await client.query(
        `UPDATE task_capability_execution_attempt
          SET status=$2,
              started_at=CASE WHEN status=$2 THEN started_at
                              WHEN $2='running' THEN $3 ELSE COALESCE(started_at,$3) END,
              completed_at=CASE WHEN status=$2 THEN completed_at
                                WHEN $2 IN ('succeeded','failed','canceled','superseded') THEN $3
                                ELSE NULL END
        WHERE attempt_id=(SELECT attempt_id FROM task_capability_execution_attempt
                           WHERE task_id=$1 ORDER BY attempt_no DESC LIMIT 1)
          AND ((status='prepared' AND $2 IN ('running','waiting','succeeded','failed','canceled'))
            OR (status IN ('running','waiting') AND $2 IN ('waiting','succeeded','failed','canceled','superseded'))
            OR status=$2)`,
        [taskId, status, timestamp],
      );
      if (result.rowCount === 0) throw new Error('TASK_CAPABILITY_ATTEMPT_TRANSITION_INVALID');
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileCanceledAttempts() {
    const result = await this.#pool.query(
      `UPDATE task_capability_execution_attempt AS attempt
          SET status='canceled',
              started_at=COALESCE(attempt.started_at,task.updated_at),
              completed_at=task.updated_at
         FROM agent_task AS task
        WHERE attempt.task_id=task.task_id
          AND task.phase='canceled'
          AND attempt.status IN ('prepared','running','waiting')
        RETURNING attempt.attempt_id`,
    );
    return result.rowCount ?? 0;
  }

  async reconcileFailedAttempts() {
    const result = await this.#pool.query(
      `UPDATE task_capability_execution_attempt AS attempt
          SET status='failed',
              started_at=COALESCE(attempt.started_at,task.updated_at),
              completed_at=task.updated_at
         FROM agent_task AS task
        WHERE attempt.task_id=task.task_id
          AND task.phase='failed'
          AND attempt.status IN ('prepared','running','waiting')
        RETURNING attempt.attempt_id`,
    );
    return result.rowCount ?? 0;
  }
}

async function insertOrValidateInitialAdmissionContext(
  client: PoolClient,
  context: Parameters<InitialTaskAdmissionStore['acceptInitial']>[0]['context'],
): Promise<Readonly<{ createdContext: boolean; context: ConversationContext }>> {
  const inserted = await client.query<InitialTaskAdmissionContextRow>(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(context_id) DO NOTHING
     RETURNING context_id,user_id,created_at,updated_at`,
    [context.contextId, context.userId, context.createdAt, context.updatedAt],
  );
  const authoritative = await client.query<InitialTaskAdmissionContextRow>(
    `SELECT context_id,user_id,created_at,updated_at
       FROM conversation_context
      WHERE context_id=$1
      FOR SHARE`,
    [context.contextId],
  );
  const row = authoritative.rows[0];
  if (row === undefined)
    throw new InitialTaskAdmissionPersistenceError(
      'TASK_INITIAL_ADMISSION_CONTEXT_AUTHORITY_INVALID',
      'Initial Task admission could not establish its authoritative Context.',
    );
  if (row.user_id !== context.userId)
    throw new InitialTaskAdmissionPersistenceError(
      'TASK_INITIAL_ADMISSION_CONTEXT_USER_CONFLICT',
      'The requested Context is already bound to a different user.',
    );
  return Object.freeze({
    createdContext: inserted.rowCount === 1,
    context: Object.freeze({
      contextId: row.context_id,
      userId: row.user_id,
      createdAt: isoTimestamp(row.created_at),
      updatedAt: isoTimestamp(row.updated_at),
    }),
  });
}

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function insertCapabilityAcceptance(
  client: PoolClient,
  input: TaskCapabilityAcceptance,
  existingTask = false,
  deviceScope?: DeviceWorkScope,
): Promise<void> {
  if (deviceScope !== undefined) assertDeviceWorkScope(deviceScope, input.task.deviceOwnership);
  else if (input.task.deviceOwnership !== undefined)
    throw new Error('DEVICE_STORAGE_NOT_CONFIGURED');
  if (!existingTask) await insertTask(client, input.task, deviceScope);
  await client.query(
    `INSERT INTO task_execution_attempt(
       attempt_id,task_id,context_id,reason,status,input_request_id,created_at,
       started_at,completed_at,error_code)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.inputAttempt.attemptId,
      input.inputAttempt.taskId,
      input.inputAttempt.contextId,
      input.inputAttempt.reason,
      input.inputAttempt.status,
      input.inputAttempt.inputRequestId ?? null,
      input.inputAttempt.createdAt,
      input.inputAttempt.startedAt ?? null,
      input.inputAttempt.completedAt ?? null,
      input.inputAttempt.errorCode ?? null,
    ],
  );
  await insertBinding(client, input.binding);
  await insertAttempt(client, input.capabilityAttempt);
  await client.query(
    `INSERT INTO runtime_event(event_id,task_id,context_id,event_type,event_timestamp,summary)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      input.event.eventId,
      input.event.taskId,
      input.event.contextId,
      input.event.eventType,
      input.event.timestamp,
      input.event.summary,
    ],
  );
  await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at)
     VALUES($1,'node.task.capability_bound','task_capability_binding',$2,1,$3::jsonb,$4::jsonb,$5)
     ON CONFLICT(aggregate_type,aggregate_id,aggregate_version,event_type) DO NOTHING`,
    [
      `node-task-capability-bound:${input.binding.bindingId}`,
      input.binding.bindingId,
      JSON.stringify({ taskId: input.task.taskId, contextId: input.task.contextId }),
      JSON.stringify({
        resourceRef: {
          type: 'task_capability_binding',
          id: input.task.taskId,
          revision: 1,
        },
        changeCode: 'TASK_CAPABILITY_BOUND',
      }),
      input.binding.boundAt,
    ],
  );
}

async function insertTask(
  client: PoolClient,
  task: Parameters<TaskCapabilityAcceptanceStore['accept']>[0]['task'],
  deviceScope: DeviceWorkScope | undefined,
) {
  const shared = deviceScope !== undefined;
  if (deviceScope !== undefined) assertDeviceWorkScope(deviceScope, task.deviceOwnership);
  else if (task.deviceOwnership !== undefined) throw new Error('DEVICE_STORAGE_NOT_CONFIGURED');
  await client.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,
       goal_id,goal_version,plan_id,selected_skill_id,selected_skill_version,
       skill_selection_id,skill_input_resolution_id,temporary_skill_id,user_goal_plan_id,
       skill_goal_id,skill_attempt_id,skill_execution_contract_id,output_text,output_structured,
       capability_gap_json,error_code,created_at,updated_at${shared ? ',device_id,gowm_binding_id,sdar_service_key' : ''})
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23,$24,$25${shared ? ',$26,$27,$28' : ''})`,
    [
      task.taskId,
      task.contextId,
      task.userId,
      task.requestText,
      JSON.stringify(task.requestMetadata),
      task.phase,
      task.phaseMessage,
      task.goalId ?? null,
      task.goalVersion ?? null,
      task.planId ?? null,
      task.selectedSkillId ?? null,
      task.selectedSkillVersion ?? null,
      task.skillSelectionId ?? null,
      task.skillInputResolutionId ?? null,
      task.temporarySkillId ?? null,
      task.userGoalPlanId ?? null,
      task.skillGoalId ?? null,
      task.skillAttemptId ?? null,
      task.skillExecutionContractId ?? null,
      task.output?.text ?? null,
      task.output?.structured === undefined ? null : JSON.stringify(task.output.structured),
      task.capabilityGap === undefined ? null : JSON.stringify(task.capabilityGap),
      task.errorCode ?? null,
      task.createdAt,
      task.updatedAt,
      ...(shared
        ? [
            task.deviceOwnership?.deviceId ?? null,
            task.deviceOwnership?.bindingId ?? null,
            task.deviceOwnership?.sdarServiceKey ?? null,
          ]
        : []),
    ],
  );
}

function mapInitialTaskAdmission(row: InitialTaskAdmissionRow): InitialTaskAdmissionRecord {
  if (!/^sha256:[0-9a-f]{64}$/u.test(row.request_hash))
    throw new Error('INITIAL_TASK_ADMISSION_REQUEST_HASH_INVALID');
  return Object.freeze({
    ...(row.admission_id === undefined ? {} : { admissionId: row.admission_id }),
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash as `sha256:${string}`,
    taskId: row.task_id,
    contextId: row.context_id,
    capabilityBindingId: row.capability_binding_id,
    capabilityAttemptId: row.capability_attempt_id,
    createdContext: row.created_context,
    acceptedAt:
      typeof row.accepted_at === 'string' ? row.accepted_at : row.accepted_at.toISOString(),
  });
}

export type InitialTaskAdmissionPersistenceErrorCode =
  | 'TASK_INITIAL_ADMISSION_ACCEPTANCE_CONTEXT_MISMATCH'
  | 'TASK_INITIAL_ADMISSION_CONTEXT_AUTHORITY_INVALID'
  | 'TASK_INITIAL_ADMISSION_CONTEXT_USER_CONFLICT';

export class InitialTaskAdmissionPersistenceError extends Error {
  readonly code: InitialTaskAdmissionPersistenceErrorCode;

  constructor(code: InitialTaskAdmissionPersistenceErrorCode, message: string) {
    super(message);
    this.name = 'InitialTaskAdmissionPersistenceError';
    this.code = code;
  }
}

function insertBinding(client: PoolClient, binding: TaskCapabilityBinding) {
  return client.query(
    `INSERT INTO task_capability_binding(
       binding_id,task_id,requested_capability_id,capability_version,exposure_id,exposure_version,
       input_snapshot,success_criteria_snapshot,evidence_requirement_snapshot,constraint_snapshot,
       initial_implementation_refs,provider_policy_snapshot,binding_hash,bound_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)`,
    [
      binding.bindingId,
      binding.taskId,
      binding.requestedCapabilityId,
      binding.capabilityVersion,
      binding.exposureId ?? null,
      binding.exposureVersion ?? null,
      JSON.stringify(binding.inputSnapshot),
      JSON.stringify(binding.successCriteriaSnapshot),
      JSON.stringify(binding.evidenceRequirementSnapshot),
      JSON.stringify(binding.constraintSnapshot),
      JSON.stringify(binding.initialImplementationRefs),
      binding.providerPolicySnapshot === undefined
        ? null
        : JSON.stringify(binding.providerPolicySnapshot),
      binding.bindingHash,
      binding.boundAt,
    ],
  );
}

function insertAttempt(client: PoolClient, attempt: TaskCapabilityExecutionAttempt) {
  return client.query(
    `INSERT INTO task_capability_execution_attempt(
       attempt_id,task_id,capability_binding_id,attempt_no,plan_id,plan_template_ref,
       skill_version_refs,provider_binding_refs,reason,status,started_at,completed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
    [
      attempt.attemptId,
      attempt.taskId,
      attempt.capabilityBindingId,
      attempt.attemptNo,
      attempt.planId ?? null,
      attempt.planTemplateRef ?? null,
      JSON.stringify(attempt.skillVersionRefs),
      JSON.stringify(attempt.providerBindingRefs),
      attempt.reason,
      attempt.status,
      attempt.startedAt ?? null,
      attempt.completedAt ?? null,
    ],
  );
}

function mapExposure(row: ExposureRow): RuntimeCapabilityExposure {
  return Object.freeze({
    exposureId: row.exposure_id,
    exposureVersion: row.exposure_version,
    requestedCapabilityId: row.capability_id,
    capabilityVersion: row.capability_version,
    requestSchema: row.request_schema,
    ...(row.requester_policy === null ? {} : { requesterPolicy: row.requester_policy }),
  });
}

function registeredImplementations(row: ResolutionRow) {
  return records(row.evaluation_input['implementations']).filter(
    (binding) =>
      binding['status'] === 'active' &&
      (binding['role'] === 'primary' || binding['role'] === 'alternative'),
  );
}

function mapResolution(
  row: ResolutionRow,
  policies: Readonly<{
    implementations: readonly Readonly<Record<string, unknown>>[];
    providerBindingRefs: readonly string[];
    providerBindingRequirements: readonly Readonly<{ bindingId: string; localServerId: string }>[];
  }>,
): RuntimeCapabilityResolution {
  const definition = record(row.evaluation_input['definition']);
  const implementationRefs = registeredImplementations(row).map((binding) => {
    const type = text(binding['implementationType'], 'implementationType');
    const id = text(binding['implementationId'], 'implementationId');
    const version = text(binding['implementationVersion'], 'implementationVersion');
    return `${type}:${id}:${version}`;
  });
  if (implementationRefs.length === 0)
    throw new Error('TASK_CAPABILITY_NO_REGISTERED_IMPLEMENTATION');
  return Object.freeze({
    ...mapExposure(row),
    successCriteria: records(definition['successCriteria']),
    requiredEvidence: records(definition['requiredEvidence']),
    constraints: records(definition['constraints'] ?? []),
    implementationRefs: Object.freeze(implementationRefs),
    providerBindingRefs: policies.providerBindingRefs,
    providerBindingRequirements: policies.providerBindingRequirements,
    providerPolicySnapshot: Object.freeze({
      catalogHash: row.catalog_hash,
      policyHash: row.policy_hash,
      snapshotHash: row.snapshot_hash,
      implementations: policies.implementations,
    }),
  });
}

async function snapshotImplementationPolicies(
  pool: Pool,
  row: ResolutionRow,
): Promise<
  Readonly<{
    implementations: readonly Readonly<Record<string, unknown>>[];
    providerBindingRefs: readonly string[];
    providerBindingRequirements: readonly Readonly<{ bindingId: string; localServerId: string }>[];
  }>
> {
  const bindings = registeredImplementations(row);
  const implementations: Readonly<Record<string, unknown>>[] = [];
  const providerBindingRequirements = new Map<
    string,
    Readonly<{ bindingId: string; localServerId: string }>
  >();
  const implementationProviderBindingRequirements: (readonly Readonly<{
    bindingId: string;
    localServerId: string;
  }>[])[] = [];
  for (const binding of bindings) {
    const bindingId = text(binding['bindingId'], 'bindingId');
    const implementationType = text(binding['implementationType'], 'implementationType');
    const implementationId = text(binding['implementationId'], 'implementationId');
    const implementationVersion = text(binding['implementationVersion'], 'implementationVersion');
    const implementationRef = `${implementationType}:${implementationId}:${implementationVersion}`;
    const providerBindingPolicy = parseMcpProviderBindingPolicyOverride(
      binding['providerPolicyOverride'],
    );
    if (providerBindingPolicy.mode === 'invalid')
      throw new Error('TASK_CAPABILITY_PROVIDER_BINDING_POLICY_INVALID');
    const frozenProviderBindingRequirements = Object.freeze(
      providerBindingPolicy.requirements.map((requirement) =>
        Object.freeze({
          bindingId: requirement.mcpProviderBindingId,
          localServerId: requirement.localServerId,
        }),
      ),
    );
    implementationProviderBindingRequirements.push(frozenProviderBindingRequirements);
    for (const requirement of frozenProviderBindingRequirements) {
      const existing = providerBindingRequirements.get(requirement.bindingId);
      if (existing !== undefined) {
        if (existing.localServerId !== requirement.localServerId)
          throw new Error('TASK_CAPABILITY_PROVIDER_BINDING_POLICY_INVALID');
        continue;
      }
      providerBindingRequirements.set(requirement.bindingId, requirement);
    }
    if (implementationType === 'skill') {
      const result = await pool.query<SkillPolicyRow>(
        `SELECT tool_policy_json AS tool_policy,runtime_policy_json AS runtime_policy
           FROM skill_version WHERE skill_id=$1 AND version=$2`,
        [implementationId, Number(implementationVersion)],
      );
      const policy = result.rows[0];
      if (policy === undefined) throw new Error('TASK_CAPABILITY_POLICY_SNAPSHOT_UNAVAILABLE');
      if (
        providerBindingPolicy.mode === 'required_all' &&
        !requiredToolsMatchExactly(policy.tool_policy, providerBindingPolicy.requirements)
      )
        throw new Error('TASK_CAPABILITY_PROVIDER_BINDING_POLICY_INVALID');
      implementations.push(
        Object.freeze({
          bindingId,
          implementationRef,
          toolPolicy: structuredClone(policy.tool_policy),
          runtimePolicy: structuredClone(policy.runtime_policy),
          ...(providerBindingPolicy.mode === 'absent'
            ? {}
            : providerBindingPolicy.mode === 'single'
              ? {
                  providerBindingRequirement: frozenProviderBindingRequirements[0],
                }
              : {
                  providerBindingRequirements: frozenProviderBindingRequirements,
                }),
        }),
      );
      continue;
    }
    if (implementationType !== 'plan_template')
      throw new Error('TASK_CAPABILITY_IMPLEMENTATION_TYPE_INVALID');
    const result = await pool.query<ArtifactPolicyRow>(
      `SELECT dependency_snapshot FROM compiled_artifact
        WHERE artifact_id=$1 AND version=$2 AND artifact_type='plan_template'`,
      [implementationId, Number(implementationVersion)],
    );
    const policy = result.rows[0];
    if (policy === undefined) throw new Error('TASK_CAPABILITY_POLICY_SNAPSHOT_UNAVAILABLE');
    implementations.push(
      Object.freeze({
        bindingId,
        implementationRef,
        dependencySnapshot: structuredClone(policy.dependency_snapshot),
      }),
    );
  }
  for (const requirements of implementationProviderBindingRequirements) {
    for (const requirement of requirements) {
      const frozenAuthority = providerBindingRequirements.get(requirement.bindingId);
      if (frozenAuthority?.localServerId !== requirement.localServerId)
        throw new Error('TASK_CAPABILITY_PROVIDER_BINDING_POLICY_INVALID');
    }
  }
  return Object.freeze({
    implementations: Object.freeze(implementations),
    providerBindingRefs: Object.freeze([...providerBindingRequirements.keys()].sort()),
    providerBindingRequirements: Object.freeze(
      [...providerBindingRequirements.values()].sort((left, right) =>
        left.bindingId.localeCompare(right.bindingId),
      ),
    ),
  });
}

function requiredToolsMatchExactly(
  value: unknown,
  requirements: readonly ExactMcpProviderBindingPolicy[],
): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const required = (value as Readonly<Record<string, unknown>>)['required'];
  if (!Array.isArray(required) || required.length !== requirements.length) return false;
  const optional = (value as Readonly<Record<string, unknown>>)['optional'];
  if (!Array.isArray(optional) || optional.length !== 0) return false;
  const declared = required.map((reference) => {
    if (typeof reference !== 'object' || reference === null || Array.isArray(reference)) return '';
    const record = reference as Readonly<Record<string, unknown>>;
    return `${String(record['serverId'])}\u0000${String(record['toolName'])}`;
  });
  return requirements.every((requirement) =>
    declared.includes(`${requirement.localServerId}\u0000${requirement.mcpToolName}`),
  );
}

function mapBinding(row: BindingRow): TaskCapabilityBinding {
  return createTaskCapabilityBinding({
    bindingId: row.binding_id,
    taskId: row.task_id,
    requestedCapabilityId: row.requested_capability_id,
    capabilityVersion: row.capability_version,
    ...(row.exposure_id === null
      ? {}
      : {
          exposureId: row.exposure_id,
          exposureVersion: row.exposure_version ?? invalidRow('exposure_version'),
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

function mapAttempt(row: AttemptRow): TaskCapabilityExecutionAttempt {
  return createTaskCapabilityExecutionAttempt({
    attemptId: row.attempt_id,
    taskId: row.task_id,
    capabilityBindingId: row.capability_binding_id,
    attemptNo: row.attempt_no,
    ...(row.plan_id === null ? {} : { planId: row.plan_id }),
    ...(row.plan_template_ref === null ? {} : { planTemplateRef: row.plan_template_ref }),
    skillVersionRefs: row.skill_version_refs,
    providerBindingRefs: row.provider_binding_refs,
    reason: row.reason,
    status: row.status,
    ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('TASK_CAPABILITY_RESOLUTION_INVALID');
  return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) throw new Error('TASK_CAPABILITY_RESOLUTION_INVALID');
  return Object.freeze(value.map(record));
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`TASK_CAPABILITY_RESOLUTION_INVALID:${field}`);
  return value;
}

function invalidRow(field: string): never {
  throw new Error(`TASK_CAPABILITY_ROW_INVALID:${field}`);
}

interface ReceiptRow extends QueryResultRow {
  task_id: string;
  request_id: string;
  request_hash: string;
  version: number;
  clarification: unknown;
  created_at: Date;
  updated_at: Date;
  bound_at: Date | null;
}
function mapReceipt(row: ReceiptRow): CapabilityAdmissionReceipt {
  const parsed = z
    .strictObject({
      status: z.literal('clarification'),
      question: z.string(),
      partialInput: z.record(z.string(), z.unknown()),
      missingFields: z.array(z.string()),
      exposureId: z.string().optional(),
      exposureVersion: z.number().int().positive().optional(),
    })
    .parse(row.clarification);
  const { exposureId, exposureVersion, ...clarification } = parsed;
  return {
    taskId: row.task_id,
    requestId: row.request_id,
    requestHash: row.request_hash,
    version: row.version,
    clarification: {
      ...clarification,
      ...(exposureId === undefined ? {} : { exposureId }),
      ...(exposureVersion === undefined ? {} : { exposureVersion }),
    },
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    ...(row.bound_at === null ? {} : { boundAt: isoTimestamp(row.bound_at) }),
  };
}
