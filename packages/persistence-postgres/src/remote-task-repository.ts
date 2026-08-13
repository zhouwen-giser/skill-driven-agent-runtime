import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  RemoteTaskMutationResult,
  RemoteTaskPollClaimResult,
  RemoteTaskRepository,
} from '../../application/src/index.js';
import { canonicalHash } from '../../application/src/index.js';
import {
  controlEventTypeForStatus,
  compareRuntimeRevisions,
  createRemoteTaskAuthoritySnapshot,
  createProviderEvidenceItem,
  createRuntimeExecutionContext,
  errorSnapshotFromRemoteTask,
  localStateForStatus,
  resultSnapshotFromRemoteTask,
  type InternalToolResult,
  type McpTaskStatus,
  type McpProtocolContractSnapshot,
  type McpTaskBehavior,
  type McpToolCancellation,
  type RemoteTaskBinding,
  type RemoteTaskAuthoritySnapshot,
  type RemoteTaskControlEvent,
  type RemoteTaskControlEventStatus,
  type RemoteTaskControlEventType,
  type RemoteTaskFailureSnapshot,
  type RemoteTaskLocalState,
  type RemoteTaskObservation,
  type RemoteTaskObservationType,
  type RemoteTaskProtocolAttempt,
  type RemoteTaskProtocolAttemptStatus,
  type RemoteTaskProviderSubstate,
  type RemoteTaskSnapshot,
  type RuntimeExecutionMode,
  type TaskExecutionTiming,
} from '../../domain/src/index.js';

const InternalToolResultSchema = z
  .object({
    content: z.array(z.unknown()),
    structuredContent: z.unknown().optional(),
    isError: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    evidence: z
      .array(
        z
          .object({
            evidenceId: z.string(),
            evidenceType: z.string(),
            observedAt: z.string(),
            subjectRef: z.string().optional(),
            producer: z.array(z.string()).optional(),
            payloadRef: z.discriminatedUnion('kind', [
              z.object({ kind: z.literal('structured_content'), jsonPointer: z.string() }).strict(),
              z
                .object({
                  kind: z.literal('uri'),
                  uri: z.string(),
                  mediaType: z.string().optional(),
                  sha256: z.string().optional(),
                })
                .strict(),
            ]),
          })
          .strict(),
      )
      .optional(),
    validatedEvidence: z.record(z.string(), z.boolean()).optional(),
  })
  .strict();
const FailureSnapshotSchema = z
  .object({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  })
  .strict();
const TaskExecutionTimingSchema: z.ZodType<TaskExecutionTiming> = z
  .object({
    start: z.discriminatedUnion('mode', [
      z
        .object({ mode: z.literal('immediate'), startToleranceMs: z.number().int().nonnegative() })
        .strict(),
      z
        .object({
          mode: z.literal('scheduled'),
          scheduledAt: z.string(),
          startToleranceMs: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
    maxElapsedMs: z.number().int().positive().nullable(),
  })
  .strict();
const McpProtocolContractSnapshotSchema: z.ZodType<McpProtocolContractSnapshot> = z
  .object({
    mode: z.literal('frozen_v1'),
    protocolVersion: z.string().min(1),
    baselineSha256: z.string().min(1),
    tasksSchemaSha256: z.string().min(1).optional(),
    taskExecutionProfileVersion: z.literal('1.0').optional(),
    evidenceProfileVersion: z.literal('1.0').optional(),
    serverDiscoverySnapshotId: z.string().min(1).optional(),
  })
  .strict();
const RemoteTaskAuthoritySnapshotSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    capturedAt: z.string().min(1),
    runtime: z
      .object({
        serverId: z.string().min(1),
        endpoint: z.string().min(1),
        serverUpdatedAt: z.string().min(1),
        toolRevision: z.number().int().positive(),
        protocolSnapshotId: z.string().min(1),
        catalogRevision: z.string().min(1),
        catalogChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
        operationCount: z.number().int().positive(),
      })
      .strict(),
    providerBinding: z
      .object({
        bindingId: z.string().min(1),
        revision: z.number().int().positive(),
        originType: z.enum(['direct', 'smpp_registry']),
        providerId: z.string().min(1),
        externalServerId: z.string().min(1).optional(),
        smppSourceId: z.string().min(1).optional(),
        endpointRef: z.string().min(1),
        catalogRevision: z.string().min(1),
        catalogChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
        operationCount: z.number().int().positive(),
        availabilityValidUntil: z.string().min(1),
        observedAt: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

interface RemoteTaskBindingRow extends QueryResultRow {
  binding_id: string;
  server_id: string;
  operation_name: string;
  remote_task_id: string;
  agent_task_id: string;
  context_id: string;
  goal_id: string;
  goal_version: number;
  workflow_plan_id: string;
  skill_goal_id: string | null;
  skill_attempt_id: string | null;
  workflow_definition_id: string;
  workflow_definition_version: number;
  workflow_instance_id: string;
  workflow_node_id: string;
  workflow_node_run_id: string;
  parent_workflow_instance_id: string | null;
  parent_skill_call_id: string | null;
  mcp_invocation_id: string;
  protocol_status: McpTaskStatus;
  protocol_revision: string;
  tasks_schema_revision: string;
  protocol_contract_json: unknown;
  task_behavior: McpTaskBehavior | null;
  task_cancellation: McpToolCancellation | null;
  runtime_revision: string | null;
  provider_revision: string | null;
  task_ttl_ms: string | number | null;
  task_expires_at: Date | string | null;
  provider_substate: RemoteTaskProviderSubstate | null;
  remote_revision: string | null;
  last_provider_updated_at: Date | string;
  local_state: RemoteTaskLocalState;
  requested_timing_json: unknown;
  execution_mode: RuntimeExecutionMode;
  simulation_id: string | null;
  authority_snapshot_json: unknown;
  credential_revision: string;
  session_revision: string;
  poll_interval_ms: number;
  next_poll_at: Date | string | null;
  poll_attempt: number;
  provider_failure_count: number;
  poll_claim_token: string | null;
  poll_claimed_at: Date | string | null;
  poll_claim_expires_at: Date | string | null;
  result_snapshot_json: unknown;
  error_snapshot_json: unknown;
  last_safe_error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  invalidated_at: Date | string | null;
  terminal_at: Date | string | null;
  version: string | number;
}

interface RemoteTaskObservationRow extends QueryResultRow {
  observation_id: string;
  binding_id: string;
  sequence: string | number;
  observation_type: RemoteTaskObservationType;
  observation_source: RemoteTaskObservation['source'];
  provider_event_id: string | null;
  remote_revision: string | null;
  runtime_revision: string | null;
  provider_revision: string | null;
  subscription_id: string | null;
  payload_json: unknown;
  accepted: boolean;
  rejection_reason: 'stale_provider_revision' | 'binding_closed' | null;
  observed_at: Date | string;
}

interface RemoteTaskControlEventRow extends QueryResultRow {
  event_id: string;
  binding_id: string;
  event_type: RemoteTaskControlEventType;
  remote_revision: string;
  runtime_revision: string | null;
  result_hash: string;
  payload_json: unknown;
  status: RemoteTaskControlEventStatus;
  created_at: Date | string;
  claimed_at: Date | string | null;
  processed_at: Date | string | null;
  error_code: string | null;
}

interface RemoteTaskProtocolAttemptRow extends QueryResultRow {
  attempt_id: string;
  binding_id: string;
  method: 'tasks/get';
  expected_binding_version: string | number;
  protocol_revision: string;
  status: RemoteTaskProtocolAttemptStatus;
  error_code: string | null;
  started_at: Date | string;
  completed_at: Date | string;
  duration_ms: string | number;
}

export class PostgresRemoteTaskRepository implements RemoteTaskRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async admit(
    binding: RemoteTaskBinding,
    acceptedObservationId: string,
  ): Promise<Readonly<{ binding: RemoteTaskBinding; created: boolean }>> {
    return withTransaction(this.#pool, async (client) => {
      const inserted = await client.query<RemoteTaskBindingRow>(
        `INSERT INTO remote_task_binding (
           binding_id,server_id,operation_name,remote_task_id,agent_task_id,context_id,
           goal_id,goal_version,workflow_plan_id,skill_goal_id,skill_attempt_id,
           workflow_definition_id,
           workflow_definition_version,workflow_instance_id,workflow_node_id,
           workflow_node_run_id,parent_workflow_instance_id,parent_skill_call_id,
           mcp_invocation_id,protocol_status,protocol_revision,tasks_schema_revision,
           protocol_contract_json,task_behavior,task_cancellation,runtime_revision,provider_revision,
           task_ttl_ms,task_expires_at,
           provider_substate,remote_revision,last_provider_updated_at,local_state,
           requested_timing_json,execution_mode,simulation_id,authority_snapshot_json,credential_revision,
           session_revision,poll_interval_ms,next_poll_at,poll_attempt,
           provider_failure_count,created_at,updated_at,version)
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
           $21,$22,$23::jsonb,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34::jsonb,$35,$36,$37::jsonb,
           $38,$39,$40,$41,$42,$43,$44,$45,$46)
         ON CONFLICT (server_id,remote_task_id) DO NOTHING
         RETURNING *`,
        bindingInsertParameters(binding),
      );
      const insertedRow = inserted.rows[0];
      if (insertedRow !== undefined) {
        await insertObservation(client, {
          observationId: acceptedObservationId,
          bindingId: binding.bindingId,
          sequence: 1,
          type: 'task.accepted',
          source: 'admission',
          ...(binding.remoteRevision === undefined
            ? {}
            : { remoteRevision: binding.remoteRevision }),
          ...(binding.runtimeRevision === undefined
            ? {}
            : { runtimeRevision: binding.runtimeRevision }),
          ...(binding.providerRevision === undefined
            ? {}
            : { providerRevision: binding.providerRevision }),
          payload: {
            protocolStatus: binding.protocolStatus,
            protocolRevision: binding.protocolRevision,
            tasksSchemaRevision: binding.tasksSchemaRevision,
            protocolContract: binding.protocolContract,
            ...(binding.taskBehavior === undefined ? {} : { taskBehavior: binding.taskBehavior }),
            taskCancellation: binding.taskCancellation,
            ...(binding.runtimeRevision === undefined
              ? {}
              : { runtimeRevision: binding.runtimeRevision }),
          },
          accepted: true,
          observedAt: binding.createdAt,
        });
        return { binding: mapBinding(insertedRow), created: true };
      }
      const existing = await client.query<RemoteTaskBindingRow>(
        'SELECT * FROM remote_task_binding WHERE server_id=$1 AND remote_task_id=$2 FOR UPDATE',
        [binding.serverId, binding.remoteTaskId],
      );
      const row = existing.rows[0];
      if (row === undefined) throw new Error('REMOTE_TASK_BINDING_CONFLICT_NOT_FOUND');
      const current = mapBinding(row);
      if (!sameAdmissionIdentity(current, binding)) {
        throw new RemoteTaskPersistenceError(
          'REMOTE_TASK_BINDING_CONFLICT',
          'Remote Task identity is already bound to a different invocation or node run.',
        );
      }
      return { binding: current, created: false };
    });
  }

  async findById(bindingId: string): Promise<RemoteTaskBinding | undefined> {
    const result = await this.#pool.query<RemoteTaskBindingRow>(
      'SELECT * FROM remote_task_binding WHERE binding_id=$1',
      [bindingId],
    );
    return result.rows[0] === undefined ? undefined : mapBinding(result.rows[0]);
  }

  async findByRemoteIdentity(
    serverId: string,
    remoteTaskId: string,
  ): Promise<RemoteTaskBinding | undefined> {
    const result = await this.#pool.query<RemoteTaskBindingRow>(
      'SELECT * FROM remote_task_binding WHERE server_id=$1 AND remote_task_id=$2',
      [serverId, remoteTaskId],
    );
    return result.rows[0] === undefined ? undefined : mapBinding(result.rows[0]);
  }

  async listRequiringPoll(
    now: string,
    limit: number,
    afterBindingId?: string,
  ): Promise<readonly RemoteTaskBinding[]> {
    const safeLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    const result = await this.#pool.query<RemoteTaskBindingRow>(
      `SELECT * FROM remote_task_binding
       WHERE local_state IN ('polling','cancel_observing')
         AND (invalidated_at IS NULL OR local_state='cancel_observing')
         AND terminal_at IS NULL
         AND next_poll_at IS NOT NULL
         AND next_poll_at <= $1
         AND (poll_claim_expires_at IS NULL OR poll_claim_expires_at <= $1)
         AND ($2::text IS NULL OR binding_id > $2)
       ORDER BY binding_id
       LIMIT $3`,
      [now, afterBindingId ?? null, safeLimit],
    );
    return result.rows.map(mapBinding);
  }

  async listActiveByServer(serverId: string, limit: number): Promise<readonly RemoteTaskBinding[]> {
    const safeLimit = Math.max(1, Math.min(256, Math.trunc(limit)));
    const result = await this.#pool.query<RemoteTaskBindingRow>(
      `SELECT * FROM remote_task_binding
       WHERE server_id=$1 AND protocol_contract_json->>'mode'='frozen_v1'
         AND terminal_at IS NULL AND invalidated_at IS NULL
         AND local_state IN ('polling','cancel_observing','awaiting_input')
       ORDER BY binding_id LIMIT $2`,
      [serverId, safeLimit],
    );
    return result.rows.map(mapBinding);
  }

  async claimPoll(
    input: Readonly<{
      bindingId: string;
      expectedVersion: number;
      claimToken: string;
      claimedAt: string;
      expiresAt: string;
    }>,
  ): Promise<RemoteTaskPollClaimResult> {
    const result = await this.#pool.query<RemoteTaskBindingRow>(
      `UPDATE remote_task_binding
       SET poll_claim_token=$3,poll_claimed_at=$4,poll_claim_expires_at=$5,
           poll_attempt=poll_attempt+1,updated_at=$4,version=version+1
       WHERE binding_id=$1 AND version=$2
         AND local_state IN ('polling','cancel_observing')
         AND (invalidated_at IS NULL OR local_state='cancel_observing')
         AND terminal_at IS NULL
         AND next_poll_at IS NOT NULL AND next_poll_at <= $4
         AND (poll_claim_expires_at IS NULL OR poll_claim_expires_at <= $4)
       RETURNING *`,
      [input.bindingId, input.expectedVersion, input.claimToken, input.claimedAt, input.expiresAt],
    );
    const row = result.rows[0];
    if (row !== undefined) return { claimed: true, binding: mapBinding(row) };
    const current = await this.findById(input.bindingId);
    if (current === undefined) return { claimed: false, reason: 'missing' };
    if (!isObservationActive(current)) {
      return { claimed: false, reason: 'closed' };
    }
    if (
      current.pollClaimExpiresAt !== undefined &&
      Date.parse(current.pollClaimExpiresAt) > Date.parse(input.claimedAt)
    ) {
      return { claimed: false, reason: 'leased' };
    }
    return { claimed: false, reason: 'stale' };
  }

  recordSnapshot(
    input: Readonly<{
      bindingId: string;
      expectedVersion: number;
      claimToken: string;
      snapshot: RemoteTaskSnapshot;
      observationId: string;
      controlEventId?: string;
      resultHash?: string;
      observedAt: string;
      nextPollAt?: string;
      protocolAttempt: RemoteTaskProtocolAttempt;
    }>,
  ): Promise<RemoteTaskMutationResult> {
    return withTransaction(this.#pool, async (client) => {
      const locked = await lockBinding(client, input.bindingId);
      if (locked === undefined) return { applied: false, reason: 'missing' };
      const claimValid =
        locked.version === input.expectedVersion &&
        locked.pollClaimToken === input.claimToken &&
        isObservationActive(locked);
      if (!claimValid) {
        await insertProtocolAttempt(client, input.protocolAttempt);
        await insertRejectedObservation(
          client,
          locked,
          input.observationId,
          input.snapshot,
          input.observedAt,
        );
        return {
          applied: false,
          reason: isObservationActive(locked) ? 'stale' : 'closed',
        };
      }
      await insertProtocolAttempt(client, input.protocolAttempt);
      const providerTimestamp = Date.parse(input.snapshot.lastUpdatedAt);
      const currentProviderTimestamp = Date.parse(locked.lastProviderUpdatedAt);
      if (providerTimestamp < currentProviderTimestamp) {
        const nextPollAt = new Date(
          Date.parse(input.observedAt) + locked.pollIntervalMs,
        ).toISOString();
        await insertObservation(client, {
          observationId: input.observationId,
          bindingId: locked.bindingId,
          sequence: await nextObservationSequence(client, locked.bindingId),
          type: observationType(input.snapshot),
          source: 'poll',
          ...providerIdentity(input.snapshot),
          payload: input.snapshot,
          accepted: false,
          rejectionReason: 'stale_provider_revision',
          observedAt: input.observedAt,
        });
        const updated = await client.query<RemoteTaskBindingRow>(
          `UPDATE remote_task_binding
           SET poll_claim_token=NULL,poll_claimed_at=NULL,poll_claim_expires_at=NULL,
               next_poll_at=$4,updated_at=$5,version=version+1
           WHERE binding_id=$1 AND version=$2 AND poll_claim_token=$3
           RETURNING *`,
          [locked.bindingId, locked.version, input.claimToken, nextPollAt, input.observedAt],
        );
        const row = requiredUpdatedRow(updated.rows[0]);
        return { applied: true, binding: mapBinding(row), snapshotAccepted: false };
      }

      await insertObservation(client, {
        observationId: input.observationId,
        bindingId: locked.bindingId,
        sequence: await nextObservationSequence(client, locked.bindingId),
        type: observationType(input.snapshot),
        source: 'poll',
        ...providerIdentity(input.snapshot),
        payload: input.snapshot,
        accepted: true,
        observedAt: input.observedAt,
      });
      const answeredInputEcho =
        input.snapshot.status === 'input_required' &&
        input.resultHash !== undefined &&
        (await isAnsweredInputEcho(
          client,
          locked.bindingId,
          input.snapshot.providerObservation?.remoteRevision,
          input.resultHash,
        ));
      const cancellationObservationContinues =
        locked.localState === 'cancel_observing' &&
        input.snapshot.status !== 'completed' &&
        input.snapshot.status !== 'failed' &&
        input.snapshot.status !== 'cancelled';
      let control: RemoteTaskControlEvent | undefined;
      if (
        input.snapshot.status !== 'working' &&
        !cancellationObservationContinues &&
        !answeredInputEcho
      ) {
        control = await insertControlEvent(client, locked, {
          snapshot: input.snapshot,
          ...(input.controlEventId === undefined ? {} : { controlEventId: input.controlEventId }),
          ...(input.resultHash === undefined ? {} : { resultHash: input.resultHash }),
          observedAt: input.observedAt,
        });
      }
      const localState = cancellationObservationContinues
        ? 'cancel_observing'
        : answeredInputEcho
          ? 'polling'
          : localStateForStatus(input.snapshot.status);
      const resultSnapshot = resultSnapshotFromRemoteTask(input.snapshot);
      const errorSnapshot = errorSnapshotFromRemoteTask(input.snapshot);
      const updated = await client.query<RemoteTaskBindingRow>(
        `UPDATE remote_task_binding
         SET protocol_status=$4,provider_substate=$5,remote_revision=$6,
             runtime_revision=$7,provider_revision=$8,task_ttl_ms=$9,
             task_expires_at=$10,last_provider_updated_at=$11,local_state=$12,
             next_poll_at=$13,provider_failure_count=0,poll_claim_token=NULL,
             poll_claimed_at=NULL,poll_claim_expires_at=NULL,
             result_snapshot_json=$14::jsonb,error_snapshot_json=$15::jsonb,
             last_safe_error_code=NULL,terminal_at=$16,updated_at=$17,version=version+1
         WHERE binding_id=$1 AND version=$2 AND poll_claim_token=$3
         RETURNING *`,
        [
          locked.bindingId,
          locked.version,
          input.claimToken,
          input.snapshot.status,
          input.snapshot.providerObservation?.substate ?? null,
          input.snapshot.providerObservation?.remoteRevision ?? null,
          input.snapshot.runtimeRevision ?? null,
          input.snapshot.providerRevision ?? null,
          input.snapshot.ttlMs,
          taskExpiry(input.snapshot),
          input.snapshot.lastUpdatedAt,
          localState,
          input.nextPollAt ??
            (answeredInputEcho
              ? new Date(Date.parse(input.observedAt) + locked.pollIntervalMs).toISOString()
              : null),
          toJsonParameter(resultSnapshot),
          toJsonParameter(errorSnapshot),
          input.snapshot.status === 'completed' ||
          input.snapshot.status === 'failed' ||
          input.snapshot.status === 'cancelled'
            ? input.observedAt
            : null,
          input.observedAt,
        ],
      );
      const row = requiredUpdatedRow(updated.rows[0]);
      if (
        input.snapshot.status === 'completed' ||
        input.snapshot.status === 'failed' ||
        input.snapshot.status === 'cancelled'
      )
        await resolveCancellationIfInstalled(
          client,
          locked.bindingId,
          input.snapshot.status,
          input.observedAt,
        );
      return {
        applied: true,
        binding: mapBinding(row),
        snapshotAccepted: true,
        ...(control === undefined ? {} : { controlEvent: control }),
      };
    });
  }

  recordExternalSnapshot(
    input: Readonly<{
      bindingId: string;
      expectedVersion: number;
      snapshot: RemoteTaskSnapshot;
      observationId: string;
      source: 'notification' | 'reconciliation';
      subscriptionId?: string;
      controlEventId?: string;
      resultHash?: string;
      observedAt: string;
    }>,
  ): Promise<RemoteTaskMutationResult> {
    return withTransaction(this.#pool, async (client) => {
      const locked = await lockBinding(client, input.bindingId);
      if (locked === undefined) return { applied: false, reason: 'missing' };
      if (locked.version !== input.expectedVersion)
        return { applied: false, reason: isObservationActive(locked) ? 'stale' : 'closed' };
      if (locked.terminalAt !== undefined || locked.invalidatedAt !== undefined)
        return { applied: false, reason: 'closed' };
      if (input.snapshot.runtimeRevision === undefined)
        throw new RemoteTaskPersistenceError(
          'REMOTE_TASK_EXTERNAL_REVISION_REQUIRED',
          'Frozen external observations require runtimeRevision.',
        );
      if (
        locked.runtimeRevision !== undefined &&
        compareRuntimeRevisions(input.snapshot.runtimeRevision, locked.runtimeRevision) <= 0
      )
        return { applied: true, binding: locked, snapshotAccepted: false };

      await insertObservation(client, {
        observationId: input.observationId,
        bindingId: locked.bindingId,
        sequence: await nextObservationSequence(client, locked.bindingId),
        type: observationType(input.snapshot),
        source: input.source,
        ...providerIdentity(input.snapshot),
        ...(input.subscriptionId === undefined ? {} : { subscriptionId: input.subscriptionId }),
        payload: input.snapshot,
        accepted: true,
        observedAt: input.observedAt,
      });
      const answeredInputEcho =
        input.snapshot.status === 'input_required' &&
        input.resultHash !== undefined &&
        (await isAnsweredInputEcho(
          client,
          locked.bindingId,
          input.snapshot.runtimeRevision,
          input.resultHash,
        ));
      const cancellationObservationContinues =
        locked.localState === 'cancel_observing' &&
        input.snapshot.status !== 'completed' &&
        input.snapshot.status !== 'failed' &&
        input.snapshot.status !== 'cancelled';
      let control: RemoteTaskControlEvent | undefined;
      if (
        input.snapshot.status !== 'working' &&
        !cancellationObservationContinues &&
        !answeredInputEcho
      )
        control = await insertControlEvent(client, locked, {
          snapshot: input.snapshot,
          ...(input.controlEventId === undefined ? {} : { controlEventId: input.controlEventId }),
          ...(input.resultHash === undefined ? {} : { resultHash: input.resultHash }),
          observedAt: input.observedAt,
        });
      const localState = cancellationObservationContinues
        ? 'cancel_observing'
        : answeredInputEcho
          ? 'polling'
          : localStateForStatus(input.snapshot.status);
      const keepPolling = localState === 'polling' || localState === 'cancel_observing';
      const nextPollAt = keepPolling
        ? new Date(Date.parse(input.observedAt) + locked.pollIntervalMs).toISOString()
        : null;
      const resultSnapshot = resultSnapshotFromRemoteTask(input.snapshot);
      const errorSnapshot = errorSnapshotFromRemoteTask(input.snapshot);
      const terminal =
        input.snapshot.status === 'completed' ||
        input.snapshot.status === 'failed' ||
        input.snapshot.status === 'cancelled';
      const updated = await client.query<RemoteTaskBindingRow>(
        `UPDATE remote_task_binding
         SET protocol_status=$3,provider_substate=$4,remote_revision=$5,
             runtime_revision=$6,provider_revision=$7,task_ttl_ms=$8,
             task_expires_at=$9,last_provider_updated_at=$10,local_state=$11,
             next_poll_at=$12,provider_failure_count=0,poll_claim_token=NULL,
             poll_claimed_at=NULL,poll_claim_expires_at=NULL,
             result_snapshot_json=$13::jsonb,error_snapshot_json=$14::jsonb,
             last_safe_error_code=NULL,terminal_at=$15,updated_at=$16,version=version+1
         WHERE binding_id=$1 AND version=$2 RETURNING *`,
        [
          locked.bindingId,
          locked.version,
          input.snapshot.status,
          input.snapshot.providerObservation?.substate ?? null,
          input.snapshot.providerObservation?.remoteRevision ?? input.snapshot.runtimeRevision,
          input.snapshot.runtimeRevision,
          input.snapshot.providerRevision ?? null,
          input.snapshot.ttlMs,
          taskExpiry(input.snapshot),
          input.snapshot.lastUpdatedAt,
          localState,
          nextPollAt,
          toJsonParameter(resultSnapshot),
          toJsonParameter(errorSnapshot),
          terminal ? input.observedAt : null,
          input.observedAt,
        ],
      );
      const row = requiredUpdatedRow(updated.rows[0]);
      if (terminal)
        await resolveCancellationIfInstalled(
          client,
          locked.bindingId,
          input.snapshot.status,
          input.observedAt,
        );
      return {
        applied: true,
        binding: mapBinding(row),
        snapshotAccepted: true,
        ...(control === undefined ? {} : { controlEvent: control }),
      };
    });
  }

  recordProviderFailure(
    input: Readonly<{
      bindingId: string;
      expectedVersion: number;
      claimToken: string;
      observationId: string;
      errorCode: string;
      observedAt: string;
      nextPollAt: string;
      protocolAttempt: RemoteTaskProtocolAttempt;
    }>,
  ): Promise<RemoteTaskMutationResult> {
    return withTransaction(this.#pool, async (client) => {
      const locked = await lockBinding(client, input.bindingId);
      if (locked === undefined) return { applied: false, reason: 'missing' };
      if (!matchesActiveClaim(locked, input.expectedVersion, input.claimToken)) {
        await insertProtocolAttempt(client, input.protocolAttempt);
        return {
          applied: false,
          reason: isObservationActive(locked) ? 'stale' : 'closed',
        };
      }
      await insertProtocolAttempt(client, input.protocolAttempt);
      await insertObservation(client, {
        observationId: input.observationId,
        bindingId: locked.bindingId,
        sequence: await nextObservationSequence(client, locked.bindingId),
        type: 'provider_unreachable',
        source: 'poll',
        payload: { errorCode: input.errorCode },
        accepted: true,
        observedAt: input.observedAt,
      });
      const updated = await client.query<RemoteTaskBindingRow>(
        `UPDATE remote_task_binding
         SET provider_failure_count=provider_failure_count+1,next_poll_at=$4,
             poll_claim_token=NULL,poll_claimed_at=NULL,poll_claim_expires_at=NULL,
             last_safe_error_code=$5,updated_at=$6,version=version+1
         WHERE binding_id=$1 AND version=$2 AND poll_claim_token=$3
         RETURNING *`,
        [
          locked.bindingId,
          locked.version,
          input.claimToken,
          input.nextPollAt,
          input.errorCode,
          input.observedAt,
        ],
      );
      return { applied: true, binding: mapBinding(requiredUpdatedRow(updated.rows[0])) };
    });
  }

  quarantine(
    input: Readonly<{
      bindingId: string;
      expectedVersion: number;
      claimToken: string;
      observationId: string;
      errorCode: string;
      observedAt: string;
      protocolAttempt: RemoteTaskProtocolAttempt;
    }>,
  ): Promise<RemoteTaskMutationResult> {
    return withTransaction(this.#pool, async (client) => {
      const locked = await lockBinding(client, input.bindingId);
      if (locked === undefined) return { applied: false, reason: 'missing' };
      if (!matchesActiveClaim(locked, input.expectedVersion, input.claimToken)) {
        await insertProtocolAttempt(client, input.protocolAttempt);
        return {
          applied: false,
          reason: isObservationActive(locked) ? 'stale' : 'closed',
        };
      }
      await insertProtocolAttempt(client, input.protocolAttempt);
      await insertObservation(client, {
        observationId: input.observationId,
        bindingId: locked.bindingId,
        sequence: await nextObservationSequence(client, locked.bindingId),
        type: 'schema_invalid',
        source: 'poll',
        payload: { errorCode: input.errorCode },
        accepted: true,
        observedAt: input.observedAt,
      });
      const updated = await client.query<RemoteTaskBindingRow>(
        `UPDATE remote_task_binding
         SET local_state='quarantined',next_poll_at=NULL,poll_claim_token=NULL,
             poll_claimed_at=NULL,poll_claim_expires_at=NULL,last_safe_error_code=$4,
             updated_at=$5,version=version+1
         WHERE binding_id=$1 AND version=$2 AND poll_claim_token=$3
         RETURNING *`,
        [locked.bindingId, locked.version, input.claimToken, input.errorCode, input.observedAt],
      );
      return { applied: true, binding: mapBinding(requiredUpdatedRow(updated.rows[0])) };
    });
  }

  closeUncertain(
    input: Readonly<{
      bindingId: string;
      expectedVersion: number;
      claimToken: string;
      observationId: string;
      controlEventId: string;
      errorCode: string;
      summary: string;
      observedAt: string;
      resultHash: string;
      protocolAttempt: RemoteTaskProtocolAttempt;
    }>,
  ): Promise<RemoteTaskMutationResult> {
    return withTransaction(this.#pool, async (client) => {
      const locked = await lockBinding(client, input.bindingId);
      if (locked === undefined) return { applied: false, reason: 'missing' };
      if (!matchesActiveClaim(locked, input.expectedVersion, input.claimToken)) {
        await insertProtocolAttempt(client, input.protocolAttempt);
        return { applied: false, reason: isObservationActive(locked) ? 'stale' : 'closed' };
      }
      await insertProtocolAttempt(client, input.protocolAttempt);
      const payload = {
        status: 'failed' as const,
        remoteTaskId: locked.remoteTaskId,
        protocolRevision: locked.protocolRevision,
        tasksSchemaRevision: locked.tasksSchemaRevision,
        runtimeRevision: locked.runtimeRevision,
        error: {
          code: -32_001,
          message: input.summary,
          data: { errorCode: input.errorCode, uncertainty: true },
        },
      };
      await insertObservation(client, {
        observationId: input.observationId,
        bindingId: locked.bindingId,
        sequence: await nextObservationSequence(client, locked.bindingId),
        type: 'schema_invalid',
        source: 'reconciliation',
        ...(locked.remoteRevision === undefined ? {} : { remoteRevision: locked.remoteRevision }),
        ...(locked.runtimeRevision === undefined
          ? {}
          : { runtimeRevision: locked.runtimeRevision }),
        ...(locked.providerRevision === undefined
          ? {}
          : { providerRevision: locked.providerRevision }),
        payload,
        accepted: true,
        observedAt: input.observedAt,
      });
      const control = await insertUncertainControlEvent(client, locked, {
        controlEventId: input.controlEventId,
        resultHash: input.resultHash,
        payload,
        observedAt: input.observedAt,
      });
      const updated = await client.query<RemoteTaskBindingRow>(
        `UPDATE remote_task_binding
         SET local_state='terminal_event_pending',next_poll_at=NULL,
             poll_claim_token=NULL,poll_claimed_at=NULL,poll_claim_expires_at=NULL,
             last_safe_error_code=$4,updated_at=$5,version=version+1
         WHERE binding_id=$1 AND version=$2 AND poll_claim_token=$3
         RETURNING *`,
        [locked.bindingId, locked.version, input.claimToken, input.errorCode, input.observedAt],
      );
      return {
        applied: true,
        binding: mapBinding(requiredUpdatedRow(updated.rows[0])),
        controlEvent: control,
      };
    });
  }

  async listObservations(bindingId: string): Promise<readonly RemoteTaskObservation[]> {
    const result = await this.#pool.query<RemoteTaskObservationRow>(
      'SELECT * FROM remote_task_observation WHERE binding_id=$1 ORDER BY sequence',
      [bindingId],
    );
    return result.rows.map(mapObservation);
  }

  async listControlEvents(bindingId: string): Promise<readonly RemoteTaskControlEvent[]> {
    const result = await this.#pool.query<RemoteTaskControlEventRow>(
      'SELECT * FROM remote_task_control_event WHERE binding_id=$1 ORDER BY created_at,event_id',
      [bindingId],
    );
    return result.rows.map(mapControlEvent);
  }

  async listProtocolAttempts(bindingId: string): Promise<readonly RemoteTaskProtocolAttempt[]> {
    const result = await this.#pool.query<RemoteTaskProtocolAttemptRow>(
      'SELECT * FROM remote_task_protocol_attempt WHERE binding_id=$1 ORDER BY started_at,attempt_id',
      [bindingId],
    );
    return result.rows.map(mapProtocolAttempt);
  }
}

function bindingInsertParameters(binding: RemoteTaskBinding): unknown[] {
  return [
    binding.bindingId,
    binding.serverId,
    binding.operationName,
    binding.remoteTaskId,
    binding.agentTaskId,
    binding.contextId,
    binding.goalId,
    binding.goalVersion,
    binding.workflowPlanId,
    binding.skillGoalId ?? null,
    binding.skillAttemptId ?? null,
    binding.workflowDefinitionId,
    binding.workflowDefinitionVersion,
    binding.workflowInstanceId,
    binding.workflowNodeId,
    binding.workflowNodeRunId,
    binding.parentWorkflowInstanceId ?? null,
    binding.parentSkillCallId ?? null,
    binding.mcpInvocationId,
    binding.protocolStatus,
    binding.protocolRevision,
    binding.tasksSchemaRevision,
    JSON.stringify(binding.protocolContract),
    binding.taskBehavior ?? null,
    binding.taskCancellation,
    binding.runtimeRevision ?? null,
    binding.providerRevision ?? null,
    binding.taskTtlMs ?? null,
    binding.taskExpiresAt ?? null,
    binding.providerSubstate ?? null,
    binding.remoteRevision ?? null,
    binding.lastProviderUpdatedAt,
    binding.localState,
    toJsonParameter(binding.requestedTiming),
    binding.executionContext.mode,
    binding.executionContext.simulationId ?? null,
    toJsonParameter(binding.authoritySnapshot),
    binding.credentialRevision,
    binding.sessionRevision,
    binding.pollIntervalMs,
    binding.nextPollAt ?? null,
    binding.pollAttempt,
    binding.providerFailureCount,
    binding.createdAt,
    binding.updatedAt,
    binding.version,
  ];
}

async function lockBinding(
  client: PoolClient,
  bindingId: string,
): Promise<RemoteTaskBinding | undefined> {
  const result = await client.query<RemoteTaskBindingRow>(
    'SELECT * FROM remote_task_binding WHERE binding_id=$1 FOR UPDATE',
    [bindingId],
  );
  return result.rows[0] === undefined ? undefined : mapBinding(result.rows[0]);
}

function matchesActiveClaim(
  binding: RemoteTaskBinding,
  expectedVersion: number,
  claimToken: string,
): boolean {
  return (
    binding.version === expectedVersion &&
    binding.pollClaimToken === claimToken &&
    isObservationActive(binding)
  );
}

function isObservationActive(binding: RemoteTaskBinding): boolean {
  return (
    binding.terminalAt === undefined &&
    (binding.localState === 'polling' || binding.localState === 'cancel_observing') &&
    (binding.invalidatedAt === undefined || binding.localState === 'cancel_observing')
  );
}

async function resolveCancellationIfInstalled(
  client: PoolClient,
  bindingId: string,
  status: Extract<McpTaskStatus, 'completed' | 'failed' | 'cancelled'>,
  resolvedAt: string,
): Promise<void> {
  const installed = await client.query<{ present: boolean }>(
    "SELECT to_regclass('remote_task_cancel_request') IS NOT NULL AS present",
  );
  if (installed.rows[0]?.present !== true) return;
  await client.query(
    `UPDATE remote_task_cancel_request
     SET provider_terminal_status=$2,resolved_at=$3,
         claim_token=NULL,claimed_at=NULL,claim_expires_at=NULL,
         updated_at=$3,version=version+1
     WHERE binding_id=$1 AND provider_terminal_status IS NULL`,
    [bindingId, status, resolvedAt],
  );
}

async function isAnsweredInputEcho(
  client: PoolClient,
  bindingId: string,
  remoteRevision: string | undefined,
  resultHash: string,
): Promise<boolean> {
  if (remoteRevision === undefined) return false;
  const installed = await client.query<{ present: boolean }>(
    "SELECT to_regclass('remote_task_input_link') IS NOT NULL AS present",
  );
  if (installed.rows[0]?.present !== true) return false;
  const result = await client.query<{ echoed: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM remote_task_input_link
       WHERE binding_id=$1 AND remote_revision=$2 AND result_hash=$3
         AND status IN ('answered','update_acknowledged','update_uncertain')
     ) AS echoed`,
    [bindingId, remoteRevision, resultHash],
  );
  return result.rows[0]?.echoed === true;
}

async function nextObservationSequence(client: PoolClient, bindingId: string): Promise<number> {
  const result = await client.query<{ next_sequence: string | number }>(
    'SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence FROM remote_task_observation WHERE binding_id=$1',
    [bindingId],
  );
  return toSafeNumber(result.rows[0]?.next_sequence ?? 1, 'REMOTE_TASK_SEQUENCE_INVALID');
}

async function insertObservation(client: PoolClient, observation: RemoteTaskObservation) {
  await client.query(
    `INSERT INTO remote_task_observation (
       observation_id,binding_id,sequence,observation_type,provider_event_id,
       remote_revision,payload_json,accepted,rejection_reason,observed_at,
       observation_source,runtime_revision,provider_revision,subscription_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT DO NOTHING`,
    [
      observation.observationId,
      observation.bindingId,
      observation.sequence,
      observation.type,
      observation.providerEventId ?? null,
      observation.remoteRevision ?? null,
      JSON.stringify(observation.payload),
      observation.accepted,
      observation.rejectionReason ?? null,
      observation.observedAt,
      observation.source,
      observation.runtimeRevision ?? null,
      observation.providerRevision ?? null,
      observation.subscriptionId ?? null,
    ],
  );
}

async function insertRejectedObservation(
  client: PoolClient,
  binding: RemoteTaskBinding,
  observationId: string,
  snapshot: RemoteTaskSnapshot,
  observedAt: string,
) {
  await insertObservation(client, {
    observationId,
    bindingId: binding.bindingId,
    sequence: await nextObservationSequence(client, binding.bindingId),
    type: observationType(snapshot),
    source: 'poll',
    ...providerIdentity(snapshot),
    payload: snapshot,
    accepted: false,
    rejectionReason: 'binding_closed',
    observedAt,
  });
}

async function insertControlEvent(
  client: PoolClient,
  binding: RemoteTaskBinding,
  input: Readonly<{
    snapshot: Exclude<RemoteTaskSnapshot, { status: 'working' }>;
    controlEventId?: string;
    resultHash?: string;
    observedAt: string;
  }>,
): Promise<RemoteTaskControlEvent> {
  if (input.controlEventId === undefined || input.resultHash === undefined) {
    throw new RemoteTaskPersistenceError(
      'REMOTE_TASK_CONTROL_IDEMPOTENCY_REQUIRED',
      'A non-working snapshot requires a control event ID and result hash.',
    );
  }
  const type = controlEventTypeForStatus(input.snapshot.status);
  const remoteRevision =
    input.snapshot.providerObservation?.remoteRevision ?? input.snapshot.lastUpdatedAt;
  const inserted = await client.query<RemoteTaskControlEventRow>(
    `INSERT INTO remote_task_control_event (
       event_id,binding_id,event_type,remote_revision,runtime_revision,result_hash,
       payload_json,status,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'pending',$8)
     ON CONFLICT (binding_id,event_type,remote_revision,result_hash)
     DO UPDATE SET event_id=remote_task_control_event.event_id
     RETURNING *`,
    [
      input.controlEventId,
      binding.bindingId,
      type,
      remoteRevision,
      input.snapshot.runtimeRevision ?? null,
      input.resultHash,
      JSON.stringify(input.snapshot),
      input.observedAt,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('REMOTE_TASK_CONTROL_EVENT_INSERT_FAILED');
  return mapControlEvent(row);
}

async function insertUncertainControlEvent(
  client: PoolClient,
  binding: RemoteTaskBinding,
  input: Readonly<{
    controlEventId: string;
    resultHash: string;
    payload: unknown;
    observedAt: string;
  }>,
): Promise<RemoteTaskControlEvent> {
  const remoteRevision = binding.remoteRevision ?? `uncertain:${input.observedAt}`;
  const inserted = await client.query<RemoteTaskControlEventRow>(
    `INSERT INTO remote_task_control_event (
       event_id,binding_id,event_type,remote_revision,runtime_revision,result_hash,
       payload_json,status,created_at)
     VALUES ($1,$2,'task.failed',$3,$4,$5,$6::jsonb,'pending',$7)
     ON CONFLICT (binding_id,event_type,remote_revision,result_hash)
     DO UPDATE SET event_id=remote_task_control_event.event_id
     RETURNING *`,
    [
      input.controlEventId,
      binding.bindingId,
      remoteRevision,
      binding.runtimeRevision ?? null,
      input.resultHash,
      JSON.stringify(input.payload),
      input.observedAt,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('REMOTE_TASK_CONTROL_EVENT_INSERT_FAILED');
  return mapControlEvent(row);
}

async function insertProtocolAttempt(client: PoolClient, attempt: RemoteTaskProtocolAttempt) {
  await client.query(
    `INSERT INTO remote_task_protocol_attempt (
       attempt_id,binding_id,method,expected_binding_version,protocol_revision,status,
       error_code,started_at,completed_at,duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (attempt_id) DO NOTHING`,
    [
      attempt.attemptId,
      attempt.bindingId,
      attempt.method,
      attempt.expectedBindingVersion,
      attempt.protocolRevision,
      attempt.status,
      attempt.errorCode ?? null,
      attempt.startedAt,
      attempt.completedAt,
      attempt.durationMs,
    ],
  );
}

function observationType(snapshot: RemoteTaskSnapshot): RemoteTaskObservationType {
  const observation = snapshot.providerObservation;
  if (observation?.progress !== undefined) return 'task.progress';
  if (observation?.substate === 'scheduled') return 'task.scheduled';
  if (observation?.substate === 'paused') return 'task.paused';
  if (observation?.substate === 'resuming') return 'task.resumed';
  return 'task.snapshot';
}

function providerIdentity(snapshot: RemoteTaskSnapshot): Readonly<{
  providerEventId?: string;
  remoteRevision?: string;
  runtimeRevision?: string;
  providerRevision?: string;
}> {
  return {
    ...(snapshot.providerObservation?.eventId === undefined
      ? {}
      : { providerEventId: snapshot.providerObservation.eventId }),
    ...(snapshot.providerObservation?.remoteRevision === undefined
      ? { remoteRevision: snapshot.lastUpdatedAt }
      : { remoteRevision: snapshot.providerObservation.remoteRevision }),
    ...(snapshot.runtimeRevision === undefined
      ? {}
      : { runtimeRevision: snapshot.runtimeRevision }),
    ...(snapshot.providerRevision === undefined
      ? {}
      : { providerRevision: snapshot.providerRevision }),
  };
}

function taskExpiry(snapshot: RemoteTaskSnapshot): string | null {
  if (snapshot.ttlMs === null) return null;
  return (
    snapshot.expiresAt ?? new Date(Date.parse(snapshot.createdAt) + snapshot.ttlMs).toISOString()
  );
}

function mapBinding(row: RemoteTaskBindingRow): RemoteTaskBinding {
  return {
    bindingId: row.binding_id,
    serverId: row.server_id,
    operationName: row.operation_name,
    remoteTaskId: row.remote_task_id,
    agentTaskId: row.agent_task_id,
    contextId: row.context_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    workflowPlanId: row.workflow_plan_id,
    ...(row.skill_goal_id === null ? {} : { skillGoalId: row.skill_goal_id }),
    ...(row.skill_attempt_id === null ? {} : { skillAttemptId: row.skill_attempt_id }),
    workflowDefinitionId: row.workflow_definition_id,
    workflowDefinitionVersion: row.workflow_definition_version,
    workflowInstanceId: row.workflow_instance_id,
    workflowNodeId: row.workflow_node_id,
    workflowNodeRunId: row.workflow_node_run_id,
    ...(row.parent_workflow_instance_id === null
      ? {}
      : { parentWorkflowInstanceId: row.parent_workflow_instance_id }),
    ...(row.parent_skill_call_id === null ? {} : { parentSkillCallId: row.parent_skill_call_id }),
    mcpInvocationId: row.mcp_invocation_id,
    protocolStatus: row.protocol_status,
    protocolRevision: row.protocol_revision,
    tasksSchemaRevision: row.tasks_schema_revision,
    protocolContract: McpProtocolContractSnapshotSchema.parse(row.protocol_contract_json),
    ...(row.task_behavior === null ? {} : { taskBehavior: row.task_behavior }),
    taskCancellation: row.task_cancellation ?? 'unknown',
    ...(row.runtime_revision === null ? {} : { runtimeRevision: row.runtime_revision }),
    ...(row.provider_revision === null ? {} : { providerRevision: row.provider_revision }),
    ...(row.task_ttl_ms === null
      ? {}
      : { taskTtlMs: toSafeNumber(row.task_ttl_ms, 'REMOTE_TASK_TTL_INVALID') }),
    ...(row.task_expires_at === null ? {} : { taskExpiresAt: toIsoString(row.task_expires_at) }),
    ...(row.provider_substate === null ? {} : { providerSubstate: row.provider_substate }),
    ...(row.remote_revision === null ? {} : { remoteRevision: row.remote_revision }),
    lastProviderUpdatedAt: toIsoString(row.last_provider_updated_at),
    localState: row.local_state,
    ...(row.requested_timing_json === null
      ? {}
      : { requestedTiming: TaskExecutionTimingSchema.parse(row.requested_timing_json) }),
    executionContext: createRuntimeExecutionContext({
      mode: row.execution_mode,
      ...(row.simulation_id === null ? {} : { simulationId: row.simulation_id }),
    }),
    ...(row.authority_snapshot_json === null
      ? {}
      : { authoritySnapshot: parseAuthoritySnapshot(row.authority_snapshot_json) }),
    credentialRevision: row.credential_revision,
    sessionRevision: row.session_revision,
    pollIntervalMs: row.poll_interval_ms,
    ...(row.next_poll_at === null ? {} : { nextPollAt: toIsoString(row.next_poll_at) }),
    pollAttempt: row.poll_attempt,
    providerFailureCount: row.provider_failure_count,
    ...(row.poll_claim_token === null ? {} : { pollClaimToken: row.poll_claim_token }),
    ...(row.poll_claimed_at === null ? {} : { pollClaimedAt: toIsoString(row.poll_claimed_at) }),
    ...(row.poll_claim_expires_at === null
      ? {}
      : { pollClaimExpiresAt: toIsoString(row.poll_claim_expires_at) }),
    ...(row.result_snapshot_json === null
      ? {}
      : { resultSnapshot: parseToolResult(row.result_snapshot_json) }),
    ...(row.error_snapshot_json === null
      ? {}
      : { errorSnapshot: parseFailureSnapshot(row.error_snapshot_json) }),
    ...(row.last_safe_error_code === null ? {} : { lastSafeErrorCode: row.last_safe_error_code }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    ...(row.invalidated_at === null ? {} : { invalidatedAt: toIsoString(row.invalidated_at) }),
    ...(row.terminal_at === null ? {} : { terminalAt: toIsoString(row.terminal_at) }),
    version: toSafeNumber(row.version, 'REMOTE_TASK_VERSION_INVALID'),
  };
}

function mapObservation(row: RemoteTaskObservationRow): RemoteTaskObservation {
  const rejectionReason = row.rejection_reason;
  return {
    observationId: row.observation_id,
    bindingId: row.binding_id,
    sequence: toSafeNumber(row.sequence, 'REMOTE_TASK_SEQUENCE_INVALID'),
    type: row.observation_type,
    source: row.observation_source,
    ...(row.provider_event_id === null ? {} : { providerEventId: row.provider_event_id }),
    ...(row.remote_revision === null ? {} : { remoteRevision: row.remote_revision }),
    ...(row.runtime_revision === null ? {} : { runtimeRevision: row.runtime_revision }),
    ...(row.provider_revision === null ? {} : { providerRevision: row.provider_revision }),
    ...(row.subscription_id === null ? {} : { subscriptionId: row.subscription_id }),
    payload: assertBoundedJson(row.payload_json),
    accepted: row.accepted,
    ...(rejectionReason === null ? {} : { rejectionReason }),
    observedAt: toIsoString(row.observed_at),
  };
}

function mapControlEvent(row: RemoteTaskControlEventRow): RemoteTaskControlEvent {
  return {
    eventId: row.event_id,
    bindingId: row.binding_id,
    type: row.event_type,
    remoteRevision: row.remote_revision,
    ...(row.runtime_revision === null ? {} : { runtimeRevision: row.runtime_revision }),
    resultHash: row.result_hash,
    payload: assertBoundedJson(row.payload_json),
    status: row.status,
    createdAt: toIsoString(row.created_at),
    ...(row.claimed_at === null ? {} : { claimedAt: toIsoString(row.claimed_at) }),
    ...(row.processed_at === null ? {} : { processedAt: toIsoString(row.processed_at) }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
  };
}

function mapProtocolAttempt(row: RemoteTaskProtocolAttemptRow): RemoteTaskProtocolAttempt {
  return {
    attemptId: row.attempt_id,
    bindingId: row.binding_id,
    method: row.method,
    expectedBindingVersion: toSafeNumber(
      row.expected_binding_version,
      'REMOTE_TASK_VERSION_INVALID',
    ),
    protocolRevision: row.protocol_revision,
    status: row.status,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
    durationMs: toSafeNumber(row.duration_ms, 'REMOTE_TASK_DURATION_INVALID'),
  };
}

function sameAdmissionIdentity(current: RemoteTaskBinding, candidate: RemoteTaskBinding): boolean {
  return (
    current.serverId === candidate.serverId &&
    current.remoteTaskId === candidate.remoteTaskId &&
    current.operationName === candidate.operationName &&
    current.agentTaskId === candidate.agentTaskId &&
    current.contextId === candidate.contextId &&
    current.skillGoalId === candidate.skillGoalId &&
    current.skillAttemptId === candidate.skillAttemptId &&
    current.workflowInstanceId === candidate.workflowInstanceId &&
    current.workflowNodeRunId === candidate.workflowNodeRunId &&
    current.mcpInvocationId === candidate.mcpInvocationId &&
    current.taskCancellation === candidate.taskCancellation &&
    canonicalHash(current.authoritySnapshot ?? null) ===
      canonicalHash(candidate.authoritySnapshot ?? null)
  );
}

function parseAuthoritySnapshot(value: unknown): RemoteTaskAuthoritySnapshot {
  assertBoundedJson(value);
  return createRemoteTaskAuthoritySnapshot(
    RemoteTaskAuthoritySnapshotSchema.parse(value) as RemoteTaskAuthoritySnapshot,
  );
}

function parseToolResult(value: unknown): InternalToolResult {
  assertBoundedJson(value);
  const parsed = InternalToolResultSchema.parse(value);
  return {
    content: parsed.content,
    ...(parsed.structuredContent === undefined
      ? {}
      : { structuredContent: parsed.structuredContent }),
    isError: parsed.isError,
    ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
    ...(parsed.evidence === undefined
      ? {}
      : {
          evidence: parsed.evidence.map((item) =>
            createProviderEvidenceItem({
              evidenceId: item.evidenceId,
              evidenceType: item.evidenceType,
              observedAt: item.observedAt,
              ...(item.subjectRef === undefined ? {} : { subjectRef: item.subjectRef }),
              ...(item.producer === undefined ? {} : { producer: item.producer }),
              payloadRef:
                item.payloadRef.kind === 'structured_content'
                  ? item.payloadRef
                  : {
                      kind: 'uri',
                      uri: item.payloadRef.uri,
                      ...(item.payloadRef.mediaType === undefined
                        ? {}
                        : { mediaType: item.payloadRef.mediaType }),
                      ...(item.payloadRef.sha256 === undefined
                        ? {}
                        : { sha256: item.payloadRef.sha256 }),
                    },
            }),
          ),
        }),
    ...(parsed.validatedEvidence === undefined
      ? {}
      : { validatedEvidence: parsed.validatedEvidence }),
  };
}

function parseFailureSnapshot(value: unknown): RemoteTaskFailureSnapshot {
  assertBoundedJson(value);
  const parsed = FailureSnapshotSchema.parse(value);
  return {
    code: parsed.code,
    message: parsed.message,
    ...(parsed.data === undefined ? {} : { data: parsed.data }),
  };
}

function assertBoundedJson(value: unknown): unknown {
  const encoded: unknown = JSON.stringify(value);
  if (typeof encoded !== 'string' || encoded.length > 1_048_576) {
    throw new Error('REMOTE_TASK_PERSISTED_JSON_INVALID');
  }
  return value;
}

function toJsonParameter(value: unknown): string | null {
  if (value === undefined) return null;
  assertBoundedJson(value);
  return JSON.stringify(value);
}

function requiredUpdatedRow(row: RemoteTaskBindingRow | undefined): RemoteTaskBindingRow {
  if (row === undefined) throw new Error('REMOTE_TASK_CAS_UPDATE_FAILED');
  return row;
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('POSTGRES_TIMESTAMP_INVALID');
  return date.toISOString();
}

function toSafeNumber(value: string | number, code: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code);
  return parsed;
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

export type RemoteTaskPersistenceErrorCode =
  | 'REMOTE_TASK_BINDING_CONFLICT'
  | 'REMOTE_TASK_CONTROL_IDEMPOTENCY_REQUIRED'
  | 'REMOTE_TASK_EXTERNAL_OBSERVATION_MODE_INVALID'
  | 'REMOTE_TASK_EXTERNAL_REVISION_REQUIRED';

export class RemoteTaskPersistenceError extends Error {
  readonly code: RemoteTaskPersistenceErrorCode;

  constructor(code: RemoteTaskPersistenceErrorCode, message: string) {
    super(message);
    this.name = 'RemoteTaskPersistenceError';
    this.code = code;
  }
}
