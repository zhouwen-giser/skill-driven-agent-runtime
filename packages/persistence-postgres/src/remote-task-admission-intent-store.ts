import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  RemoteTaskAdmissionEnvelope,
  RemoteTaskAdmissionIntent,
  RemoteTaskAdmissionIntentMutation,
  RemoteTaskAdmissionIntentStatus,
  RemoteTaskAdmissionIntentStore,
  RemoteTaskAdmissionObservation,
  RemoteTaskAdmissionObservationQuery,
  RemoteTaskAdmissionReceipt,
  RemoteTaskReconciliationContract,
  RemoteTaskReconciliationSeed,
} from '../../application/src/index.js';
import { canonicalHash } from '../../application/src/index.js';
import {
  createRemoteTaskAuthoritySnapshot,
  createWorkflowContinuationSnapshot,
  type McpInvocation,
} from '../../domain/src/index.js';

interface RemoteTaskAdmissionIntentRow extends QueryResultRow {
  intent_id: string;
  invocation_id: string;
  binding_id: string;
  task_id: string;
  capability_attempt_id: string | null;
  context_id: string;
  server_id: string;
  operation_name: string;
  arguments_hash: string;
  logical_invocation_id: string | null;
  logical_identity_hash: string | null;
  reconciliation_contract_json: unknown;
  local_envelope_json: unknown;
  status: RemoteTaskAdmissionIntentStatus;
  dispatch_hash: string | null;
  dispatched_at: Date | string | null;
  recorded_invocation_id: string | null;
  remote_receipt_json: unknown;
  receipt_recorded_at: Date | string | null;
  materialized_binding_id: string | null;
  materialized_snapshot_id: string | null;
  materialized_at: Date | string | null;
  reason_code: string | null;
  closed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number | string;
}

interface TransitionRow extends RemoteTaskAdmissionIntentRow {
  transition_applied: boolean;
}

interface McpInvocationAuditRow extends QueryResultRow {
  invocation_id: string;
  task_id: string | null;
  capability_attempt_id: string | null;
  control_confirmation_id: string | null;
  control_provider_binding_id: string | null;
  control_arguments_hash: string | null;
  control_dispatch_hash: string | null;
  context_id: string | null;
  execution_mode: McpInvocation['executionMode'];
  simulation_id: string | null;
  server_id: string;
  tool_name: string;
  execution_semantics_json: unknown;
  arguments_json: unknown;
  result_json: unknown;
  status: McpInvocation['status'];
  error_code: string | null;
  error_message: string | null;
  started_at: Date | string;
  completed_at: Date | string;
  duration_ms: number;
}

interface RemoteTaskAdmissionObservationRow extends QueryResultRow {
  intent_id: string;
  invocation_id: string;
  binding_id: string;
  task_id: string;
  capability_attempt_id: string | null;
  context_id: string;
  server_id: string;
  operation_name: string;
  local_envelope_json: unknown;
  status: RemoteTaskAdmissionIntentStatus;
  version: number | string;
  dispatch_hash: string | null;
  recorded_invocation_id: string | null;
  materialized_binding_id: string | null;
  reason_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  receipt_recorded_at: Date | string | null;
  raw_admission_response: unknown;
  raw_admission_receipt: unknown;
}

/**
 * Credential-free development projection of the admission boundary. It exposes
 * persisted values exactly as observations and makes no cross-repository authority
 * decision.
 */
export class PostgresRemoteTaskAdmissionObservationQuery implements RemoteTaskAdmissionObservationQuery {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listByAgentTaskId(agentTaskId: string): Promise<readonly RemoteTaskAdmissionObservation[]> {
    const result = await this.#pool.query<RemoteTaskAdmissionObservationRow>(
      `SELECT intent.intent_id,intent.invocation_id,intent.binding_id,intent.task_id,
              intent.capability_attempt_id,intent.context_id,intent.server_id,
              intent.operation_name,intent.local_envelope_json,intent.status,intent.version,
              intent.dispatch_hash,intent.recorded_invocation_id,
              intent.materialized_binding_id,intent.reason_code,intent.created_at,
              intent.updated_at,intent.receipt_recorded_at,
              invocation.result_json AS raw_admission_response,
              intent.remote_receipt_json AS raw_admission_receipt
         FROM remote_task_admission_intent intent
         LEFT JOIN mcp_invocation invocation
           ON invocation.invocation_id=intent.recorded_invocation_id
        WHERE intent.task_id=$1
        ORDER BY intent.created_at,intent.intent_id`,
      [agentTaskId],
    );
    return result.rows.map(mapAdmissionObservationRow);
  }
}

/** PostgreSQL journal for the Provider-return/admission crash boundary. */
export class PostgresRemoteTaskAdmissionIntentStore implements RemoteTaskAdmissionIntentStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async prepare(
    intent: RemoteTaskAdmissionIntent,
  ): Promise<Readonly<{ intent: RemoteTaskAdmissionIntent; created: boolean }>> {
    assertPreparedIntent(intent);
    const result = await this.#pool.query<RemoteTaskAdmissionIntentRow & { inserted: boolean }>(
      `WITH inserted AS (
         INSERT INTO remote_task_admission_intent(
           intent_id,invocation_id,binding_id,task_id,capability_attempt_id,context_id,
           server_id,operation_name,arguments_hash,local_envelope_json,
           logical_invocation_id,logical_identity_hash,reconciliation_contract_json,
           status,created_at,updated_at,version)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,
                'prepared',$14,$15,1)
         ON CONFLICT DO NOTHING
         RETURNING *,true AS inserted
       )
       SELECT * FROM inserted
       UNION ALL
       SELECT existing.*,false AS inserted
         FROM remote_task_admission_intent existing
        WHERE (existing.intent_id=$1 OR existing.invocation_id=$2 OR existing.binding_id=$3)
          AND NOT EXISTS(SELECT 1 FROM inserted)
        ORDER BY inserted DESC
        LIMIT 1`,
      [
        intent.intentId,
        intent.invocationId,
        intent.envelope.bindingId,
        intent.taskId,
        intent.capabilityAttemptId ?? null,
        intent.contextId,
        intent.serverId,
        intent.operationName,
        intent.argumentsHash,
        JSON.stringify(intent.envelope),
        intent.logicalIdentity?.logicalInvocationId ?? null,
        intent.logicalIdentity?.identityHash ?? null,
        intent.reconciliationSeed === undefined ? null : JSON.stringify(intent.reconciliationSeed),
        intent.createdAt,
        intent.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('REMOTE_TASK_ADMISSION_INTENT_PREPARE_FAILED');
    const current = mapIntentRow(row);
    if (!samePreparedIdentity(current, intent))
      throw new Error('REMOTE_TASK_ADMISSION_INTENT_CONFLICT');
    return { intent: current, created: row.inserted };
  }

  async markDispatching(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      dispatchHash: string;
      reconciliationContract?: RemoteTaskReconciliationContract;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation> {
    const result = await this.#pool.query<TransitionRow>(
      transitionQuery(
        `UPDATE remote_task_admission_intent
            SET status='dispatching',dispatch_hash=$3,dispatched_at=$4,
                reconciliation_contract_json=COALESCE($5::jsonb,reconciliation_contract_json),
                updated_at=$4,version=version+1
          WHERE intent_id=$1 AND invocation_id=$2 AND status='prepared'
          RETURNING *`,
      ),
      [
        input.intentId,
        input.invocationId,
        input.dispatchHash,
        input.at,
        input.reconciliationContract === undefined
          ? null
          : JSON.stringify(input.reconciliationContract),
      ],
    );
    return classifyTransition(
      result.rows[0],
      (intent) =>
        intent.status === 'dispatching' &&
        intent.invocationId === input.invocationId &&
        intent.dispatchHash === input.dispatchHash &&
        canonicalHash(intent.reconciliationContract ?? null) ===
          canonicalHash(input.reconciliationContract ?? null) &&
        intent.dispatchedAt === input.at,
      (intent) =>
        intent.invocationId !== input.invocationId ||
        (intent.status === 'dispatching' && intent.dispatchHash !== input.dispatchHash),
    );
  }

  async recordRemoteReceiptAndInvocation(
    intentId: string,
    invocation: McpInvocation,
    receipt: RemoteTaskAdmissionReceipt,
    at: string,
  ): Promise<RemoteTaskAdmissionIntentMutation> {
    if (receipt.authoritySnapshot === undefined)
      throw new Error('REMOTE_TASK_ADMISSION_RECEIPT_AUTHORITY_REQUIRED');
    createRemoteTaskAuthoritySnapshot(receipt.authoritySnapshot);
    return withTransaction(this.#pool, async (client) => {
      const locked = await client.query<RemoteTaskAdmissionIntentRow>(
        `SELECT * FROM remote_task_admission_intent WHERE intent_id=$1 FOR UPDATE`,
        [intentId],
      );
      const row = locked.rows[0];
      if (row === undefined) return { applied: false, reason: 'missing' };
      const current = mapIntentRow(row);
      if (current.invocationId !== invocation.invocationId)
        return { applied: false, reason: 'conflict', intent: current };
      if (current.status === 'receipt_recorded' || current.status === 'materialized') {
        return sameReceipt(current.receipt, receipt) &&
          (await invocationMatches(client, invocation))
          ? { applied: true, intent: current }
          : { applied: false, reason: 'conflict', intent: current };
      }
      if (current.status === 'uncertain' || current.status === 'closed')
        return { applied: false, reason: 'closed', intent: current };
      if (current.status !== 'dispatching')
        return { applied: false, reason: 'stale', intent: current };

      await insertInvocation(client, invocation);
      const updated = await client.query<RemoteTaskAdmissionIntentRow>(
        `UPDATE remote_task_admission_intent
            SET status='receipt_recorded',recorded_invocation_id=$2,
                remote_receipt_json=$3::jsonb,receipt_recorded_at=$4,
                updated_at=$4,version=version+1
          WHERE intent_id=$1 AND invocation_id=$2 AND status='dispatching'
          RETURNING *`,
        [intentId, invocation.invocationId, JSON.stringify(receipt), at],
      );
      const updatedRow = updated.rows[0];
      if (updatedRow === undefined) throw new Error('REMOTE_TASK_ADMISSION_RECEIPT_CAS_FAILED');
      return { applied: true, intent: mapIntentRow(updatedRow) };
    });
  }

  async recordReconciledReceiptAndInvocation(
    input: Readonly<{
      intentId: string;
      logicalInvocationId: string;
      invocation: McpInvocation;
      receipt: RemoteTaskAdmissionReceipt;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation> {
    if (input.receipt.authoritySnapshot === undefined)
      throw new Error('REMOTE_TASK_ADMISSION_RECEIPT_AUTHORITY_REQUIRED');
    createRemoteTaskAuthoritySnapshot(input.receipt.authoritySnapshot);
    return withTransaction(this.#pool, async (client) => {
      const locked = await client.query<RemoteTaskAdmissionIntentRow>(
        `SELECT * FROM remote_task_admission_intent WHERE intent_id=$1 FOR UPDATE`,
        [input.intentId],
      );
      const row = locked.rows[0];
      if (row === undefined) return { applied: false, reason: 'missing' };
      const current = mapIntentRow(row);
      if (
        current.invocationId !== input.invocation.invocationId ||
        current.logicalIdentity?.logicalInvocationId !== input.logicalInvocationId
      )
        return { applied: false, reason: 'conflict', intent: current };
      if (current.status === 'receipt_recorded' || current.status === 'materialized')
        return sameReceipt(current.receipt, input.receipt) &&
          (await invocationMatches(client, input.invocation))
          ? { applied: true, intent: current }
          : { applied: false, reason: 'conflict', intent: current };
      if (current.status !== 'uncertain')
        return { applied: false, reason: 'stale', intent: current };
      const expectedRequestHash = `sha256:${canonicalHash(current.reconciliationContract)}`;
      const exactAttempt = await client.query(
        `SELECT 1 FROM remote_task_reconciliation_attempt
          WHERE intent_id=$1 AND logical_invocation_id=$2
            AND status='found_exact' AND identity_validated
            AND expected_intent_version=$3 AND request_hash=$4
            AND remote_task_id=$5
          LIMIT 1`,
        [
          input.intentId,
          input.logicalInvocationId,
          current.version,
          expectedRequestHash,
          input.receipt.remoteTask.remoteTaskId,
        ],
      );
      if (exactAttempt.rowCount !== 1) return { applied: false, reason: 'stale', intent: current };

      await insertInvocation(client, input.invocation);
      const updated = await client.query<RemoteTaskAdmissionIntentRow>(
        `UPDATE remote_task_admission_intent
            SET status='receipt_recorded',recorded_invocation_id=$2,
                remote_receipt_json=$3::jsonb,receipt_recorded_at=$4,
                reason_code=NULL,closed_at=NULL,updated_at=$4,version=version+1
          WHERE intent_id=$1 AND invocation_id=$2 AND status='uncertain'
          RETURNING *`,
        [input.intentId, input.invocation.invocationId, JSON.stringify(input.receipt), input.at],
      );
      const updatedRow = updated.rows[0];
      if (updatedRow === undefined) throw new Error('REMOTE_TASK_RECONCILED_RECEIPT_CAS_FAILED');
      return { applied: true, intent: mapIntentRow(updatedRow) };
    });
  }

  async markMaterialized(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      bindingId: string;
      snapshotId: string;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation> {
    const result = await this.#pool.query<TransitionRow>(
      transitionQuery(
        `UPDATE remote_task_admission_intent
            SET status='materialized',materialized_binding_id=$3,materialized_snapshot_id=$4,
                materialized_at=$5,closed_at=$5,updated_at=$5,version=version+1
          WHERE intent_id=$1 AND invocation_id=$2 AND binding_id=$3
            AND status='receipt_recorded'
            AND EXISTS (
              SELECT 1
                FROM workflow_continuation_snapshot snapshot
                JOIN workflow_continuation_wait_binding wait
                  ON wait.snapshot_id=snapshot.snapshot_id
                JOIN workflow_instance instance
                  ON instance.instance_id=snapshot.workflow_instance_id
               WHERE snapshot.snapshot_id=$4
                 AND snapshot.lifecycle='active'
                 AND snapshot.workflow_instance_id=local_envelope_json->>'workflowInstanceId'
                 AND instance.status='waiting_external'
                 AND wait.binding_id=$3
            )
          RETURNING *`,
      ),
      [input.intentId, input.invocationId, input.bindingId, input.snapshotId, input.at],
    );
    return classifyTransition(
      result.rows[0],
      (intent) =>
        intent.status === 'materialized' &&
        intent.invocationId === input.invocationId &&
        intent.materializedBindingId === input.bindingId &&
        intent.materializedSnapshotId === input.snapshotId,
      (intent) =>
        intent.invocationId !== input.invocationId ||
        (intent.status === 'materialized' &&
          (intent.materializedBindingId !== input.bindingId ||
            intent.materializedSnapshotId !== input.snapshotId)),
    );
  }

  async findByBindingId(bindingId: string): Promise<RemoteTaskAdmissionIntent | undefined> {
    const result = await this.#pool.query<RemoteTaskAdmissionIntentRow>(
      'SELECT * FROM remote_task_admission_intent WHERE binding_id=$1',
      [bindingId],
    );
    return result.rows[0] === undefined ? undefined : mapIntentRow(result.rows[0]);
  }

  async markUncertain(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      reasonCode: string;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation> {
    const result = await this.#pool.query<TransitionRow>(
      transitionQuery(
        `UPDATE remote_task_admission_intent
            SET status='uncertain',reason_code=$3,closed_at=$4,
                updated_at=$4,version=version+1
          WHERE intent_id=$1 AND invocation_id=$2 AND status='dispatching'
          RETURNING *`,
      ),
      [input.intentId, input.invocationId, input.reasonCode, input.at],
    );
    return classifyTransition(
      result.rows[0],
      (intent) =>
        intent.status === 'uncertain' &&
        intent.invocationId === input.invocationId &&
        intent.reasonCode === input.reasonCode,
      (intent) =>
        intent.invocationId !== input.invocationId ||
        (intent.status === 'uncertain' && intent.reasonCode !== input.reasonCode),
    );
  }

  async closeReceiptAsUncertain(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      reasonCode: string;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation> {
    const result = await this.#pool.query<TransitionRow>(
      transitionQuery(
        `UPDATE remote_task_admission_intent
            SET status='uncertain',reason_code=$3,
                closed_at=$4,updated_at=$4,version=version+1
          WHERE intent_id=$1 AND invocation_id=$2
            AND status='receipt_recorded'
          RETURNING *`,
      ),
      [input.intentId, input.invocationId, input.reasonCode, input.at],
    );
    return classifyTransition(
      result.rows[0],
      (intent) =>
        intent.status === 'uncertain' &&
        intent.invocationId === input.invocationId &&
        intent.reasonCode === input.reasonCode,
      (intent) =>
        intent.invocationId !== input.invocationId ||
        (intent.status === 'uncertain' && intent.reasonCode !== input.reasonCode),
    );
  }

  async replaceContinuation(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      continuation: RemoteTaskAdmissionReceipt['continuation'];
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation> {
    if (input.continuation.completeness !== 'exact_final')
      throw new Error('REMOTE_TASK_ADMISSION_CONTINUATION_FINAL_REQUIRED');
    const result = await this.#pool.query<TransitionRow>(
      transitionQuery(
        `UPDATE remote_task_admission_intent
            SET remote_receipt_json=jsonb_set(
                  remote_receipt_json,'{continuation}',$3::jsonb,true),
                updated_at=$4,version=version+1
          WHERE intent_id=$1 AND invocation_id=$2 AND status='receipt_recorded'
            AND remote_receipt_json->'continuation'->>'completeness'='requires_graph_merge'
          RETURNING *`,
      ),
      [input.intentId, input.invocationId, JSON.stringify(input.continuation), input.at],
    );
    return classifyTransition(
      result.rows[0],
      (intent) =>
        intent.status === 'receipt_recorded' &&
        intent.invocationId === input.invocationId &&
        sameContinuation(intent.receipt?.continuation, input.continuation),
      (intent) =>
        intent.invocationId !== input.invocationId ||
        (intent.status === 'receipt_recorded' &&
          intent.receipt?.continuation.completeness === 'exact_final' &&
          !sameContinuation(intent.receipt.continuation, input.continuation)),
    );
  }

  async close(
    input: Readonly<{
      intentId: string;
      invocationId: string;
      reasonCode: string;
      at: string;
    }>,
  ): Promise<RemoteTaskAdmissionIntentMutation> {
    const result = await this.#pool.query<TransitionRow>(
      transitionQuery(
        `UPDATE remote_task_admission_intent
            SET status='closed',reason_code=$3,closed_at=$4,
                updated_at=$4,version=version+1
          WHERE intent_id=$1 AND invocation_id=$2 AND status IN ('prepared','dispatching')
          RETURNING *`,
      ),
      [input.intentId, input.invocationId, input.reasonCode, input.at],
    );
    return classifyTransition(
      result.rows[0],
      (intent) =>
        intent.status === 'closed' &&
        intent.invocationId === input.invocationId &&
        intent.reasonCode === input.reasonCode,
      (intent) =>
        intent.invocationId !== input.invocationId ||
        (intent.status === 'closed' && intent.reasonCode !== input.reasonCode),
    );
  }

  async listRecoverable(limit: number): Promise<readonly RemoteTaskAdmissionIntent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new Error('REMOTE_TASK_ADMISSION_RECOVERY_LIMIT_INVALID');
    const result = await this.#pool.query<RemoteTaskAdmissionIntentRow>(
      `SELECT * FROM remote_task_admission_intent
        WHERE status IN ('prepared','dispatching','receipt_recorded')
           OR (status='uncertain' AND logical_invocation_id IS NOT NULL)
        ORDER BY updated_at,intent_id
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapIntentRow);
  }
}

function transitionQuery(update: string): string {
  return `WITH updated AS (${update}),
    selected AS (
      SELECT updated.*,true AS transition_applied FROM updated
      UNION ALL
      SELECT existing.*,false AS transition_applied
        FROM remote_task_admission_intent existing
       WHERE existing.intent_id=$1 AND NOT EXISTS(SELECT 1 FROM updated)
    )
    SELECT * FROM selected LIMIT 1`;
}

function classifyTransition(
  row: TransitionRow | undefined,
  isIdempotent: (intent: RemoteTaskAdmissionIntent) => boolean,
  isConflict: (intent: RemoteTaskAdmissionIntent) => boolean,
): RemoteTaskAdmissionIntentMutation {
  if (row === undefined) return { applied: false, reason: 'missing' };
  const intent = mapIntentRow(row);
  if (row.transition_applied || isIdempotent(intent)) return { applied: true, intent };
  if (isConflict(intent)) return { applied: false, reason: 'conflict', intent };
  if (
    intent.status === 'materialized' ||
    intent.status === 'uncertain' ||
    intent.status === 'closed'
  )
    return { applied: false, reason: 'closed', intent };
  return { applied: false, reason: 'stale', intent };
}

async function insertInvocation(client: PoolClient, invocation: McpInvocation): Promise<void> {
  await client.query(
    `INSERT INTO mcp_invocation(
       invocation_id,task_id,capability_attempt_id,control_confirmation_id,
       control_provider_binding_id,control_arguments_hash,control_dispatch_hash,
       context_id,execution_mode,simulation_id,server_id,tool_name,arguments_json,
       execution_semantics_json,result_json,status,error_code,error_message,
       started_at,completed_at,duration_ms)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,
            $16,$17,$18,$19,$20,$21)`,
    [
      invocation.invocationId,
      invocation.taskId ?? null,
      invocation.capabilityAttemptId ?? null,
      invocation.controlConfirmationId ?? null,
      invocation.controlProviderBindingId ?? null,
      invocation.controlArgumentsHash ?? null,
      invocation.controlDispatchHash ?? null,
      invocation.contextId ?? null,
      invocation.executionMode,
      invocation.simulationId ?? null,
      invocation.serverId,
      invocation.toolName,
      JSON.stringify(invocation.arguments),
      JSON.stringify(invocation.executionSemantics),
      invocation.result === undefined ? null : JSON.stringify(invocation.result),
      invocation.status,
      invocation.errorCode ?? null,
      invocation.errorMessage ?? null,
      invocation.startedAt,
      invocation.completedAt,
      invocation.durationMs,
    ],
  );
}

async function invocationMatches(client: PoolClient, expected: McpInvocation): Promise<boolean> {
  const result = await client.query<McpInvocationAuditRow>(
    `SELECT invocation_id,task_id,capability_attempt_id,control_confirmation_id,
            control_provider_binding_id,control_arguments_hash,control_dispatch_hash,
            context_id,execution_mode,simulation_id,server_id,tool_name,
            execution_semantics_json,arguments_json,result_json,status,error_code,error_message,
            started_at,completed_at,duration_ms
       FROM mcp_invocation WHERE invocation_id=$1`,
    [expected.invocationId],
  );
  const row = result.rows[0];
  if (row === undefined) return false;
  return (
    row.invocation_id === expected.invocationId &&
    (row.task_id ?? undefined) === expected.taskId &&
    (row.capability_attempt_id ?? undefined) === expected.capabilityAttemptId &&
    (row.control_confirmation_id ?? undefined) === expected.controlConfirmationId &&
    (row.control_provider_binding_id ?? undefined) === expected.controlProviderBindingId &&
    (row.control_arguments_hash ?? undefined) === expected.controlArgumentsHash &&
    (row.control_dispatch_hash ?? undefined) === expected.controlDispatchHash &&
    (row.context_id ?? undefined) === expected.contextId &&
    row.execution_mode === expected.executionMode &&
    (row.simulation_id ?? undefined) === expected.simulationId &&
    row.server_id === expected.serverId &&
    row.tool_name === expected.toolName &&
    canonicalHash(row.execution_semantics_json) === canonicalHash(expected.executionSemantics) &&
    canonicalHash(row.arguments_json) === canonicalHash(expected.arguments) &&
    (row.result_json === null
      ? expected.result === undefined
      : canonicalHash(row.result_json) === canonicalHash(expected.result)) &&
    row.status === expected.status &&
    (row.error_code ?? undefined) === expected.errorCode &&
    (row.error_message ?? undefined) === expected.errorMessage &&
    toIsoString(row.started_at) === expected.startedAt &&
    toIsoString(row.completed_at) === expected.completedAt &&
    row.duration_ms === expected.durationMs
  );
}

function mapIntentRow(row: RemoteTaskAdmissionIntentRow): RemoteTaskAdmissionIntent {
  const envelope = parseEnvelope(row.local_envelope_json);
  const receipt =
    row.remote_receipt_json === null ? undefined : parseReceipt(row.remote_receipt_json);
  return {
    intentId: row.intent_id,
    invocationId: row.invocation_id,
    taskId: row.task_id,
    ...(row.capability_attempt_id === null
      ? {}
      : { capabilityAttemptId: row.capability_attempt_id }),
    contextId: row.context_id,
    serverId: row.server_id,
    operationName: row.operation_name,
    argumentsHash: row.arguments_hash,
    ...(row.logical_invocation_id == null || row.logical_identity_hash == null
      ? {}
      : {
          logicalIdentity: parseLogicalIdentity(
            row.logical_invocation_id,
            row.logical_identity_hash,
            row.reconciliation_contract_json,
          ),
        }),
    ...parseReconciliationContract(row.reconciliation_contract_json),
    envelope,
    status: row.status,
    ...(row.dispatch_hash === null ? {} : { dispatchHash: row.dispatch_hash }),
    ...(row.dispatched_at === null ? {} : { dispatchedAt: toIsoString(row.dispatched_at) }),
    ...(receipt === undefined ? {} : { receipt }),
    ...(row.receipt_recorded_at === null
      ? {}
      : { receiptRecordedAt: toIsoString(row.receipt_recorded_at) }),
    ...(row.materialized_binding_id === null
      ? {}
      : { materializedBindingId: row.materialized_binding_id }),
    ...(row.materialized_snapshot_id === null
      ? {}
      : { materializedSnapshotId: row.materialized_snapshot_id }),
    ...(row.materialized_at === null ? {} : { materializedAt: toIsoString(row.materialized_at) }),
    ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
    ...(row.closed_at === null ? {} : { closedAt: toIsoString(row.closed_at) }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    version: Number(row.version),
  };
}

function mapAdmissionObservationRow(
  row: RemoteTaskAdmissionObservationRow,
): RemoteTaskAdmissionObservation {
  return {
    observationKind: 'runtime_remote_task_admission',
    authorityInference: 'none',
    runtimeLocalIdentity: {
      intentId: row.intent_id,
      invocationId: row.invocation_id,
      bindingId: row.binding_id,
      taskId: row.task_id,
      ...(row.capability_attempt_id === null
        ? {}
        : { capabilityAttemptId: row.capability_attempt_id }),
      contextId: row.context_id,
      serverId: row.server_id,
      operationName: row.operation_name,
      localEnvelope: row.local_envelope_json,
    },
    rawAdmissionResponse: row.raw_admission_response ?? null,
    rawAdmissionReceipt: row.raw_admission_receipt ?? null,
    journal: {
      status: row.status,
      version: Number(row.version),
      ...(row.dispatch_hash === null ? {} : { dispatchHash: row.dispatch_hash }),
      ...(row.recorded_invocation_id === null
        ? {}
        : { recordedInvocationId: row.recorded_invocation_id }),
      ...(row.materialized_binding_id === null
        ? {}
        : { materializedBindingId: row.materialized_binding_id }),
      ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
      ...(row.receipt_recorded_at === null
        ? {}
        : { receiptRecordedAt: toIsoString(row.receipt_recorded_at) }),
    },
  };
}

function parseEnvelope(value: unknown): RemoteTaskAdmissionEnvelope {
  if (!isRecord(value) || typeof value['bindingId'] !== 'string')
    throw new Error('REMOTE_TASK_ADMISSION_ENVELOPE_INVALID');
  return value as unknown as RemoteTaskAdmissionEnvelope;
}

function parseReceipt(value: unknown): RemoteTaskAdmissionReceipt {
  if (
    !isRecord(value) ||
    !isRecord(value['remoteTask']) ||
    typeof value['remoteTask']['remoteTaskId'] !== 'string' ||
    typeof value['credentialRevision'] !== 'string' ||
    typeof value['sessionRevision'] !== 'string' ||
    !isRecord(value['protocolContract']) ||
    !isMcpTaskBehavior(value['taskBehavior']) ||
    (value['taskCancellation'] !== undefined &&
      !isMcpToolCancellation(value['taskCancellation'])) ||
    !isRecord(value['continuation']) ||
    !isWorkflowContinuationCompleteness(value['continuation']['completeness']) ||
    !isRecord(value['continuation']['snapshot'])
  )
    throw new Error('REMOTE_TASK_ADMISSION_RECEIPT_INVALID');
  const authority = value['authoritySnapshot'];
  if (authority !== undefined && !isRecord(authority))
    throw new Error('REMOTE_TASK_ADMISSION_RECEIPT_INVALID');
  return {
    ...(value as unknown as Omit<RemoteTaskAdmissionReceipt, 'continuation'>),
    taskCancellation: value['taskCancellation'] ?? 'unknown',
    ...(authority === undefined
      ? {}
      : { authoritySnapshot: createRemoteTaskAuthoritySnapshot(authority as never) }),
    continuation: {
      snapshot: createWorkflowContinuationSnapshot(value['continuation']['snapshot'] as never),
      completeness: value['continuation']['completeness'],
    },
  };
}

function isWorkflowContinuationCompleteness(
  value: unknown,
): value is RemoteTaskAdmissionReceipt['continuation']['completeness'] {
  return value === 'exact_single' || value === 'requires_graph_merge' || value === 'exact_final';
}

function isMcpTaskBehavior(value: unknown): value is RemoteTaskAdmissionReceipt['taskBehavior'] {
  return value === 'synchronous_only' || value === 'server_directed' || value === 'task_required';
}

function isMcpToolCancellation(
  value: unknown,
): value is RemoteTaskAdmissionReceipt['taskCancellation'] {
  return (
    value === 'unsupported' ||
    value === 'cooperative' ||
    value === 'task_cancel' ||
    value === 'unknown'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPreparedIntent(intent: RemoteTaskAdmissionIntent): void {
  if (
    intent.status !== 'prepared' ||
    intent.version !== 1 ||
    intent.invocationId !== intent.envelope.mcpInvocationId ||
    intent.contextId !== intent.envelope.contextId ||
    intent.serverId !== intent.envelope.serverId ||
    intent.operationName !== intent.envelope.operationName ||
    intent.taskId !== intent.envelope.agentTaskId ||
    (intent.logicalIdentity === undefined) !== (intent.reconciliationSeed === undefined) ||
    (intent.logicalIdentity !== undefined &&
      intent.logicalIdentity.logicalInvocationId !==
        intent.reconciliationSeed?.logicalIdentity.logicalInvocationId) ||
    intent.dispatchHash !== undefined ||
    intent.receipt !== undefined ||
    intent.materializedBindingId !== undefined ||
    intent.materializedSnapshotId !== undefined ||
    intent.reasonCode !== undefined ||
    intent.closedAt !== undefined
  )
    throw new Error('REMOTE_TASK_ADMISSION_INTENT_INVALID');
}

function samePreparedIdentity(
  actual: RemoteTaskAdmissionIntent,
  expected: RemoteTaskAdmissionIntent,
): boolean {
  return (
    actual.intentId === expected.intentId &&
    actual.invocationId === expected.invocationId &&
    actual.envelope.bindingId === expected.envelope.bindingId &&
    actual.taskId === expected.taskId &&
    actual.capabilityAttemptId === expected.capabilityAttemptId &&
    actual.contextId === expected.contextId &&
    actual.serverId === expected.serverId &&
    actual.operationName === expected.operationName &&
    actual.argumentsHash === expected.argumentsHash &&
    actual.logicalIdentity?.logicalInvocationId === expected.logicalIdentity?.logicalInvocationId &&
    actual.logicalIdentity?.identityHash === expected.logicalIdentity?.identityHash &&
    canonicalHash(actual.reconciliationSeed ?? null) ===
      canonicalHash(expected.reconciliationSeed ?? null) &&
    canonicalHash(actual.envelope) === canonicalHash(expected.envelope)
  );
}

function parseLogicalIdentity(
  logicalInvocationId: string,
  identityHash: string,
  value: unknown,
): NonNullable<RemoteTaskAdmissionIntent['logicalIdentity']> {
  if (!isRecord(value) || !isRecord(value['logicalIdentity']))
    throw new Error('REMOTE_TASK_LOGICAL_INVOCATION_INVALID');
  const identity = value['logicalIdentity'];
  if (
    identity['logicalInvocationId'] !== logicalInvocationId ||
    identity['identityHash'] !== identityHash
  )
    throw new Error('REMOTE_TASK_LOGICAL_INVOCATION_CONFLICT');
  return identity as unknown as NonNullable<RemoteTaskAdmissionIntent['logicalIdentity']>;
}

function parseReconciliationContract(value: unknown): Readonly<{
  reconciliationSeed?: RemoteTaskReconciliationSeed;
  reconciliationContract?: RemoteTaskReconciliationContract;
}> {
  if (value === null || value === undefined) return {};
  if (!isRecord(value)) throw new Error('REMOTE_TASK_RECONCILIATION_CONTRACT_INVALID');
  if (value['schemaVersion'] === 'sdar.remote-task-reconciliation-seed/v1')
    return { reconciliationSeed: value as unknown as RemoteTaskReconciliationSeed };
  if (value['schemaVersion'] === 'sdar.remote-task-reconciliation-contract/v1')
    return { reconciliationContract: value as unknown as RemoteTaskReconciliationContract };
  throw new Error('REMOTE_TASK_RECONCILIATION_CONTRACT_INVALID');
}

function sameReceipt(
  actual: RemoteTaskAdmissionReceipt | undefined,
  expected: RemoteTaskAdmissionReceipt,
): boolean {
  return actual !== undefined && canonicalHash(actual) === canonicalHash(expected);
}

function sameContinuation(
  actual: RemoteTaskAdmissionReceipt['continuation'] | undefined,
  expected: RemoteTaskAdmissionReceipt['continuation'],
): boolean {
  return actual !== undefined && canonicalHash(actual) === canonicalHash(expected);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
