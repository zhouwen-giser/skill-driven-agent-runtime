import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { WorkflowContinuationRepository } from '../../application/src/index.js';
import {
  assertWorkflowContinuationSuccessor,
  createWorkflowContinuationAttempt,
  createWorkflowContinuationSnapshot,
  transitionWorkflowContinuationLifecycle,
  type RemoteTaskControlEvent,
  type RemoteTaskControlEventStatus,
  type RemoteTaskControlEventType,
  type WorkflowContinuationAttempt,
  type WorkflowContinuationAttemptStatus,
  type WorkflowContinuationLifecycle,
  type WorkflowContinuationSnapshot,
} from '../../domain/src/index.js';

const RuntimeExecutionContextSchema = z
  .object({
    mode: z.enum(['live', 'simulation', 'historical-replay']),
    simulationId: z.string().optional(),
  })
  .strict();
const WorkflowBudgetLimitsSchema = z
  .object({
    maxReplans: z.number(),
    maxDurationSeconds: z.number(),
    maxLlmCalls: z.number(),
    maxMcpCalls: z.number(),
    maxCost: z.number(),
  })
  .strict();
const WorkflowBudgetUsageSchema = z
  .object({
    replanCount: z.number(),
    durationMs: z.number(),
    llmCalls: z.number(),
    mcpCalls: z.number(),
    cost: z.number(),
  })
  .strict();
const ContinuationStateSchema = z
  .object({
    input: z.unknown(),
    waitingNodeRuns: z.array(
      z
        .object({
          waitId: z.string(),
          kind: z.enum(['remote_task', 'child_workflow']),
          sourceId: z.string(),
          nodeId: z.string(),
          nodeRunId: z.string(),
          state: z.enum(['waiting', 'awaiting_input']),
        })
        .strict(),
    ),
    runnableFrontier: z.array(
      z.object({ nodeId: z.string(), nextRunOrdinal: z.number() }).strict(),
    ),
    completedNodeRunIds: z.array(z.string()),
    nodeRunCounts: z.record(z.string(), z.number()),
    outputs: z.record(z.string(), z.unknown()),
    errors: z.record(z.string(), z.unknown()),
    routes: z.record(z.string(), z.unknown()),
    loopCounts: z.record(z.string(), z.number()),
    recoveryCounts: z.record(z.string(), z.number()),
    parallelJoinState: z.array(
      z
        .object({
          joinKey: z.string(),
          joinNodeId: z.string(),
          requiredPredecessorNodeIds: z.array(z.string()),
          arrivals: z.array(
            z.object({ predecessorNodeId: z.string(), predecessorNodeRunId: z.string() }).strict(),
          ),
        })
        .strict(),
    ),
    result: z.unknown().optional(),
    failed: z.boolean(),
    executionContext: RuntimeExecutionContextSchema,
    budgetLimits: WorkflowBudgetLimitsSchema,
    budgetUsage: WorkflowBudgetUsageSchema,
  })
  .strict();

interface WorkflowContinuationSnapshotRow extends QueryResultRow {
  snapshot_id: string;
  continuation_id: string;
  state_version: string | number;
  predecessor_snapshot_id: string | null;
  schema_version: '1.0';
  lifecycle: WorkflowContinuationLifecycle;
  agent_task_id: string;
  context_id: string;
  workflow_control_id: string;
  goal_id: string;
  goal_version: number;
  workflow_plan_id: string;
  workflow_definition_id: string;
  workflow_definition_version: number;
  workflow_definition_hash: string;
  input_hash: string;
  workflow_instance_id: string;
  state_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkflowContinuationAttemptRow extends QueryResultRow {
  attempt_id: string;
  event_id: string;
  snapshot_id: string;
  continuation_id: string;
  workflow_instance_id: string;
  snapshot_state_version: string | number;
  claim_token: string;
  status: WorkflowContinuationAttemptStatus;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  error_code: string | null;
}

interface RemoteTaskWaitAuthorityRow extends QueryResultRow {
  workflow_instance_id: string;
  workflow_node_id: string;
  workflow_node_run_id: string;
}

interface ContinuationControlRow extends QueryResultRow {
  event_id: string;
  binding_id: string;
  event_type: RemoteTaskControlEventType;
  remote_revision: string;
  result_hash: string;
  payload_json: unknown;
  status: RemoteTaskControlEventStatus;
  created_at: Date | string;
  claimed_at: Date | string | null;
  processed_at: Date | string | null;
  error_code: string | null;
  continuation_claim_token: string | null;
  continuation_claim_expires_at: Date | string | null;
  continuation_claim_attempt: number;
}

export class PostgresWorkflowContinuationRepository implements WorkflowContinuationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async saveSnapshot(snapshot: WorkflowContinuationSnapshot): Promise<void> {
    const validated = createWorkflowContinuationSnapshot(snapshot);
    await withTransaction(this.#pool, async (client) => {
      const currentResult = await client.query<WorkflowContinuationSnapshotRow>(
        `SELECT * FROM workflow_continuation_snapshot
         WHERE continuation_id=$1
         ORDER BY state_version DESC
         LIMIT 1 FOR UPDATE`,
        [validated.continuationId],
      );
      const currentRow = currentResult.rows[0];
      if (currentRow === undefined) {
        if (validated.stateVersion !== 1)
          throw new WorkflowContinuationPersistenceError(
            'WORKFLOW_CONTINUATION_CAS_FAILED',
            'A continuation must begin at state version one.',
          );
      } else {
        const current = mapSnapshot(currentRow);
        if (current.snapshotId === validated.snapshotId) {
          if (JSON.stringify(current) !== JSON.stringify(validated))
            throw new WorkflowContinuationPersistenceError(
              'WORKFLOW_CONTINUATION_IDEMPOTENCY_CONFLICT',
              'The continuation snapshot identity is already bound to different evidence.',
            );
          return;
        }
        assertWorkflowContinuationSuccessor(current, validated);
        if (current.lifecycle !== 'active' && current.lifecycle !== 'building')
          throw new WorkflowContinuationPersistenceError(
            'WORKFLOW_CONTINUATION_CLOSED',
            'A terminal or invalidated continuation cannot accept a successor.',
          );
        if (validated.lifecycle === 'active') {
          await client.query(
            `UPDATE workflow_continuation_snapshot
             SET lifecycle='superseded',updated_at=$2
             WHERE snapshot_id=$1`,
            [current.snapshotId, validated.updatedAt],
          );
        }
      }

      await assertWaitBindingsAvailable(client, validated);
      await insertSnapshot(client, validated);
      if (validated.lifecycle === 'active') {
        const instance = await client.query(
          `UPDATE workflow_instance SET status='waiting_external'
           WHERE instance_id=$1 AND status IN ('running','paused','waiting_external')
           RETURNING instance_id`,
          [validated.workflowInstanceId],
        );
        if (instance.rowCount !== 1)
          throw new WorkflowContinuationPersistenceError(
            'WORKFLOW_CONTINUATION_INSTANCE_CLOSED',
            'The Workflow instance cannot enter external wait from its current state.',
          );
      }
    });
  }

  async transitionLifecycle(
    snapshotId: string,
    expected: WorkflowContinuationLifecycle,
    next: WorkflowContinuationLifecycle,
    updatedAt: string,
  ): Promise<WorkflowContinuationSnapshot> {
    return withTransaction(this.#pool, async (client) => {
      const locked = await client.query<WorkflowContinuationSnapshotRow>(
        'SELECT * FROM workflow_continuation_snapshot WHERE snapshot_id=$1 FOR UPDATE',
        [snapshotId],
      );
      const row = locked.rows[0];
      if (row?.lifecycle !== expected)
        throw new WorkflowContinuationPersistenceError(
          'WORKFLOW_CONTINUATION_CAS_FAILED',
          'The continuation lifecycle changed before the requested transition.',
        );
      const transitioned = transitionWorkflowContinuationLifecycle(
        mapSnapshot(row),
        next,
        updatedAt,
      );
      const updated = await client.query<WorkflowContinuationSnapshotRow>(
        `UPDATE workflow_continuation_snapshot SET lifecycle=$2,updated_at=$3
         WHERE snapshot_id=$1 AND lifecycle=$4 RETURNING *`,
        [snapshotId, transitioned.lifecycle, transitioned.updatedAt, expected],
      );
      if (updated.rows[0] === undefined)
        throw new WorkflowContinuationPersistenceError(
          'WORKFLOW_CONTINUATION_CAS_FAILED',
          'The continuation lifecycle transition lost its compare-and-set race.',
        );
      return mapSnapshot(updated.rows[0]);
    });
  }

  async findById(snapshotId: string): Promise<WorkflowContinuationSnapshot | undefined> {
    const result = await this.#pool.query<WorkflowContinuationSnapshotRow>(
      'SELECT * FROM workflow_continuation_snapshot WHERE snapshot_id=$1',
      [snapshotId],
    );
    return result.rows[0] === undefined ? undefined : mapSnapshot(result.rows[0]);
  }

  async findCurrent(workflowInstanceId: string): Promise<WorkflowContinuationSnapshot | undefined> {
    const result = await this.#pool.query<WorkflowContinuationSnapshotRow>(
      `SELECT * FROM workflow_continuation_snapshot
       WHERE workflow_instance_id=$1 AND lifecycle='active'
       ORDER BY state_version DESC LIMIT 1`,
      [workflowInstanceId],
    );
    return result.rows[0] === undefined ? undefined : mapSnapshot(result.rows[0]);
  }

  async findCurrentByBinding(bindingId: string): Promise<WorkflowContinuationSnapshot | undefined> {
    const result = await this.#pool.query<WorkflowContinuationSnapshotRow>(
      `SELECT snapshot.*
       FROM workflow_continuation_snapshot snapshot
       JOIN workflow_continuation_wait_binding wait ON wait.snapshot_id=snapshot.snapshot_id
       WHERE wait.binding_id=$1 AND snapshot.lifecycle='active'
       ORDER BY snapshot.state_version DESC LIMIT 1`,
      [bindingId],
    );
    return result.rows[0] === undefined ? undefined : mapSnapshot(result.rows[0]);
  }

  async listInbox(
    now: string,
    limit: number,
    afterEventId?: string,
  ): Promise<readonly RemoteTaskControlEvent[]> {
    const result = await this.#pool.query<ContinuationControlRow>(
      `SELECT event.*
       FROM remote_task_control_event event
       WHERE (event.status='pending'
           OR (event.status='claimed' AND event.continuation_claim_expires_at <= $1))
         AND (
           EXISTS (
             SELECT 1
             FROM workflow_continuation_wait_binding wait
             JOIN workflow_continuation_snapshot snapshot ON snapshot.snapshot_id=wait.snapshot_id
             WHERE wait.binding_id=event.binding_id AND snapshot.lifecycle='active'
           )
           OR EXISTS (
             SELECT 1 FROM workflow_continuation_attempt attempt
             WHERE attempt.event_id=event.event_id
           )
         )
         AND ($3::text IS NULL OR event.event_id > $3)
       ORDER BY event.event_id
       LIMIT $2`,
      [now, boundedLimit(limit), afterEventId ?? null],
    );
    return result.rows.map(mapControl);
  }

  async claimControl(
    input: Readonly<{
      eventId: string;
      claimToken: string;
      claimedAt: string;
      expiresAt: string;
    }>,
  ): Promise<RemoteTaskControlEvent | undefined> {
    return withTransaction(this.#pool, async (client) => {
      const locked = await client.query<ContinuationControlRow>(
        'SELECT * FROM remote_task_control_event WHERE event_id=$1 FOR UPDATE',
        [input.eventId],
      );
      const event = locked.rows[0];
      if (event === undefined) return undefined;
      if (event.status !== 'pending' && event.status !== 'claimed') return undefined;
      if (
        event.status === 'claimed' &&
        event.continuation_claim_expires_at !== null &&
        Date.parse(toIsoString(event.continuation_claim_expires_at)) > Date.parse(input.claimedAt)
      )
        return undefined;

      const authority = await client.query<{ present: boolean }>(
        `SELECT (
           EXISTS (
             SELECT 1
             FROM workflow_continuation_wait_binding wait
             JOIN workflow_continuation_snapshot snapshot ON snapshot.snapshot_id=wait.snapshot_id
             WHERE wait.binding_id=$1 AND snapshot.lifecycle='active'
           )
           OR EXISTS (
             SELECT 1 FROM workflow_continuation_attempt attempt
             WHERE attempt.event_id=$2
           )
         ) AS present`,
        [event.binding_id, input.eventId],
      );
      if (authority.rows[0]?.present !== true) return undefined;
      const updated = await client.query<ContinuationControlRow>(
        `UPDATE remote_task_control_event
         SET status='claimed',claimed_at=$2,continuation_claim_token=$3,
             continuation_claim_expires_at=$4,
             continuation_claim_attempt=continuation_claim_attempt+1
         WHERE event_id=$1 RETURNING *`,
        [input.eventId, input.claimedAt, input.claimToken, input.expiresAt],
      );
      const claimed = requiredRow(updated.rows[0]);
      return mapControl(claimed);
    });
  }

  async finishControl(
    input: Readonly<{
      eventId: string;
      claimToken: string;
      status: 'processed' | 'failed';
      processedAt: string;
      errorCode?: string;
      bindingDisposition?: 'reentered';
    }>,
  ): Promise<void> {
    if (input.status === 'failed' && input.errorCode === undefined)
      throw new Error('WORKFLOW_CONTINUATION_CONTROL_ERROR_CODE_REQUIRED');
    if (input.status === 'processed' && input.errorCode !== undefined)
      throw new Error('WORKFLOW_CONTINUATION_CONTROL_ERROR_CODE_UNEXPECTED');
    if (input.bindingDisposition !== undefined && input.status !== 'processed')
      throw new Error('WORKFLOW_CONTINUATION_BINDING_DISPOSITION_REQUIRES_PROCESSED_CONTROL');
    await withTransaction(this.#pool, async (client) => {
      const result = await client.query<{ binding_id: string }>(
        `UPDATE remote_task_control_event
         SET status=$3,processed_at=$4,error_code=$5
         WHERE event_id=$1 AND status='claimed' AND continuation_claim_token=$2
         RETURNING binding_id`,
        [input.eventId, input.claimToken, input.status, input.processedAt, input.errorCode ?? null],
      );
      if (result.rowCount !== 1)
        throw new WorkflowContinuationPersistenceError(
          'WORKFLOW_CONTINUATION_CAS_FAILED',
          'The remote Task control claim is stale or already closed.',
        );
      if (input.bindingDisposition === 'reentered') {
        const bindingId = requiredRow(result.rows[0]).binding_id;
        const bindingResult = await client.query(
          `UPDATE remote_task_binding
           SET local_state='reentered',version=version+1,updated_at=$2
           WHERE binding_id=$1
             AND local_state IN ('terminal_event_pending','terminal_event_claimed')`,
          [bindingId, input.processedAt],
        );
        if (bindingResult.rowCount !== 1)
          throw new WorkflowContinuationPersistenceError(
            'WORKFLOW_CONTINUATION_BINDING_STATE_MISMATCH',
            'The terminal remote Task binding was not pending continuation re-entry.',
          );
      }
    });
  }

  async deferControl(
    input: Readonly<{
      eventId: string;
      claimToken: string;
      errorCode: string;
    }>,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE remote_task_control_event
       SET status='pending',claimed_at=NULL,processed_at=NULL,error_code=$3,
           continuation_claim_token=NULL,continuation_claim_expires_at=NULL
       WHERE event_id=$1 AND status='claimed' AND continuation_claim_token=$2`,
      [input.eventId, input.claimToken, input.errorCode],
    );
    if (result.rowCount !== 1)
      throw new WorkflowContinuationPersistenceError(
        'WORKFLOW_CONTINUATION_CAS_FAILED',
        'The remote Task control claim is stale or already closed.',
      );
  }

  async saveAttempt(attempt: WorkflowContinuationAttempt): Promise<void> {
    const validated = createWorkflowContinuationAttempt(attempt);
    const result = await this.#pool.query<WorkflowContinuationAttemptRow>(
      `INSERT INTO workflow_continuation_attempt (
         attempt_id,event_id,snapshot_id,continuation_id,workflow_instance_id,
         snapshot_state_version,claim_token,status,created_at,started_at,completed_at,error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (attempt_id) DO NOTHING RETURNING *`,
      attemptParameters(validated),
    );
    if (result.rowCount === 1) return;
    const existing = await this.findAttempt(validated.attemptId);
    if (existing === undefined || JSON.stringify(existing) !== JSON.stringify(validated))
      throw new WorkflowContinuationPersistenceError(
        'WORKFLOW_CONTINUATION_IDEMPOTENCY_CONFLICT',
        'The continuation attempt identity is already bound to different evidence.',
      );
  }

  async updateAttempt(
    attempt: WorkflowContinuationAttempt,
    expectedStatus: WorkflowContinuationAttemptStatus,
  ): Promise<void> {
    const validated = createWorkflowContinuationAttempt(attempt);
    const result = await this.#pool.query(
      `UPDATE workflow_continuation_attempt
       SET status=$3,started_at=$4,completed_at=$5,error_code=$6
       WHERE attempt_id=$1 AND claim_token=$2 AND status=$7`,
      [
        validated.attemptId,
        validated.claimToken,
        validated.status,
        validated.startedAt ?? null,
        validated.completedAt ?? null,
        validated.errorCode ?? null,
        expectedStatus,
      ],
    );
    if (result.rowCount !== 1)
      throw new WorkflowContinuationPersistenceError(
        'WORKFLOW_CONTINUATION_CAS_FAILED',
        'The continuation attempt status changed before the requested transition.',
      );
  }

  async findAttempt(attemptId: string): Promise<WorkflowContinuationAttempt | undefined> {
    const result = await this.#pool.query<WorkflowContinuationAttemptRow>(
      'SELECT * FROM workflow_continuation_attempt WHERE attempt_id=$1',
      [attemptId],
    );
    return result.rows[0] === undefined ? undefined : mapAttempt(result.rows[0]);
  }

  async findLatestAttemptByEvent(
    eventId: string,
  ): Promise<WorkflowContinuationAttempt | undefined> {
    const result = await this.#pool.query<WorkflowContinuationAttemptRow>(
      `SELECT * FROM workflow_continuation_attempt
       WHERE event_id=$1 ORDER BY created_at DESC,attempt_id DESC LIMIT 1`,
      [eventId],
    );
    return result.rows[0] === undefined ? undefined : mapAttempt(result.rows[0]);
  }

  async listAttempts(workflowInstanceId: string): Promise<readonly WorkflowContinuationAttempt[]> {
    const result = await this.#pool.query<WorkflowContinuationAttemptRow>(
      `SELECT * FROM workflow_continuation_attempt
       WHERE workflow_instance_id=$1 ORDER BY created_at,attempt_id`,
      [workflowInstanceId],
    );
    return result.rows.map(mapAttempt);
  }
}

async function insertSnapshot(
  client: PoolClient,
  snapshot: WorkflowContinuationSnapshot,
): Promise<void> {
  await client.query(
    `INSERT INTO workflow_continuation_snapshot (
       snapshot_id,continuation_id,state_version,predecessor_snapshot_id,schema_version,
       lifecycle,agent_task_id,context_id,workflow_control_id,goal_id,goal_version,
       workflow_plan_id,workflow_definition_id,workflow_definition_version,
       workflow_definition_hash,input_hash,workflow_instance_id,state_json,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20)`,
    [
      snapshot.snapshotId,
      snapshot.continuationId,
      snapshot.stateVersion,
      snapshot.predecessorSnapshotId ?? null,
      snapshot.schemaVersion,
      snapshot.lifecycle,
      snapshot.agentTaskId,
      snapshot.contextId,
      snapshot.workflowControlId,
      snapshot.goalId,
      snapshot.goalVersion,
      snapshot.workflowPlanId,
      snapshot.workflowDefinitionId,
      snapshot.workflowDefinitionVersion,
      snapshot.workflowDefinitionHash,
      snapshot.inputHash,
      snapshot.workflowInstanceId,
      JSON.stringify(snapshotState(snapshot)),
      snapshot.createdAt,
      snapshot.updatedAt,
    ],
  );
  for (const wait of snapshot.waitingNodeRuns) {
    if (wait.kind !== 'remote_task') continue;
    await client.query(
      `INSERT INTO workflow_continuation_wait_binding (
         snapshot_id,wait_id,binding_id,wait_kind,node_id,node_run_id,wait_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        snapshot.snapshotId,
        wait.waitId,
        wait.sourceId,
        wait.kind,
        wait.nodeId,
        wait.nodeRunId,
        wait.state,
      ],
    );
  }
}

async function assertWaitBindingsAvailable(
  client: PoolClient,
  snapshot: WorkflowContinuationSnapshot,
): Promise<void> {
  for (const wait of snapshot.waitingNodeRuns) {
    if (wait.kind !== 'remote_task') continue;
    const bindingResult = await client.query<RemoteTaskWaitAuthorityRow>(
      `SELECT workflow_instance_id,workflow_node_id,workflow_node_run_id
       FROM remote_task_binding WHERE binding_id=$1 FOR UPDATE`,
      [wait.sourceId],
    );
    const binding = bindingResult.rows[0];
    if (
      binding?.workflow_instance_id !== snapshot.workflowInstanceId ||
      binding.workflow_node_id !== wait.nodeId ||
      binding.workflow_node_run_id !== wait.nodeRunId
    )
      throw new WorkflowContinuationPersistenceError(
        'WORKFLOW_CONTINUATION_WAIT_BINDING_INVALID',
        'A remote wait must match its authoritative binding and exact Workflow node run.',
      );
    const active = await client.query(
      `SELECT 1
       FROM workflow_continuation_wait_binding wait_binding
       JOIN workflow_continuation_snapshot active_snapshot
         ON active_snapshot.snapshot_id=wait_binding.snapshot_id
       WHERE wait_binding.binding_id=$1
         AND active_snapshot.lifecycle='active'
         AND active_snapshot.continuation_id<>$2
       LIMIT 1`,
      [wait.sourceId, snapshot.continuationId],
    );
    if (active.rowCount !== 0)
      throw new WorkflowContinuationPersistenceError(
        'WORKFLOW_CONTINUATION_WAIT_BINDING_INVALID',
        'A remote Task binding cannot drive more than one active continuation.',
      );
  }
}

function snapshotState(snapshot: WorkflowContinuationSnapshot) {
  return {
    input: snapshot.input,
    waitingNodeRuns: snapshot.waitingNodeRuns,
    runnableFrontier: snapshot.runnableFrontier,
    completedNodeRunIds: snapshot.completedNodeRunIds,
    nodeRunCounts: snapshot.nodeRunCounts,
    outputs: snapshot.outputs,
    errors: snapshot.errors,
    routes: snapshot.routes,
    loopCounts: snapshot.loopCounts,
    recoveryCounts: snapshot.recoveryCounts,
    parallelJoinState: snapshot.parallelJoinState,
    ...(snapshot.result === undefined ? {} : { result: snapshot.result }),
    failed: snapshot.failed,
    executionContext: snapshot.executionContext,
    budgetLimits: snapshot.budgetLimits,
    budgetUsage: snapshot.budgetUsage,
  };
}

function mapSnapshot(row: WorkflowContinuationSnapshotRow): WorkflowContinuationSnapshot {
  const state = ContinuationStateSchema.parse(row.state_json);
  const { executionContext, ...persistedState } = state;
  return createWorkflowContinuationSnapshot({
    schemaVersion: row.schema_version,
    snapshotId: row.snapshot_id,
    continuationId: row.continuation_id,
    stateVersion: toSafePositiveNumber(row.state_version),
    ...(row.predecessor_snapshot_id === null
      ? {}
      : { predecessorSnapshotId: row.predecessor_snapshot_id }),
    lifecycle: row.lifecycle,
    agentTaskId: row.agent_task_id,
    contextId: row.context_id,
    workflowControlId: row.workflow_control_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    workflowPlanId: row.workflow_plan_id,
    workflowDefinitionId: row.workflow_definition_id,
    workflowDefinitionVersion: row.workflow_definition_version,
    workflowDefinitionHash: row.workflow_definition_hash,
    inputHash: row.input_hash,
    workflowInstanceId: row.workflow_instance_id,
    ...persistedState,
    executionContext:
      executionContext.simulationId === undefined
        ? { mode: executionContext.mode }
        : { mode: executionContext.mode, simulationId: executionContext.simulationId },
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  });
}

function mapAttempt(row: WorkflowContinuationAttemptRow): WorkflowContinuationAttempt {
  return createWorkflowContinuationAttempt({
    attemptId: row.attempt_id,
    eventId: row.event_id,
    snapshotId: row.snapshot_id,
    continuationId: row.continuation_id,
    workflowInstanceId: row.workflow_instance_id,
    snapshotStateVersion: toSafePositiveNumber(row.snapshot_state_version),
    claimToken: row.claim_token,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    ...(row.started_at === null ? {} : { startedAt: toIsoString(row.started_at) }),
    ...(row.completed_at === null ? {} : { completedAt: toIsoString(row.completed_at) }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
  });
}

function mapControl(row: ContinuationControlRow): RemoteTaskControlEvent {
  return {
    eventId: row.event_id,
    bindingId: row.binding_id,
    type: row.event_type,
    remoteRevision: row.remote_revision,
    resultHash: row.result_hash,
    payload: row.payload_json,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    ...(row.claimed_at === null ? {} : { claimedAt: toIsoString(row.claimed_at) }),
    ...(row.processed_at === null ? {} : { processedAt: toIsoString(row.processed_at) }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
  };
}

function attemptParameters(attempt: WorkflowContinuationAttempt): unknown[] {
  return [
    attempt.attemptId,
    attempt.eventId,
    attempt.snapshotId,
    attempt.continuationId,
    attempt.workflowInstanceId,
    attempt.snapshotStateVersion,
    attempt.claimToken,
    attempt.status,
    attempt.createdAt,
    attempt.startedAt ?? null,
    attempt.completedAt ?? null,
    attempt.errorCode ?? null,
  ];
}

function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
    throw new Error('WORKFLOW_CONTINUATION_LIST_LIMIT_INVALID');
  return limit;
}

function requiredRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('WORKFLOW_CONTINUATION_UPDATE_FAILED');
  return row;
}

function toSafePositiveNumber(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error('WORKFLOW_CONTINUATION_VERSION_INVALID');
  return parsed;
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('POSTGRES_TIMESTAMP_INVALID');
  return date.toISOString();
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

export type WorkflowContinuationPersistenceErrorCode =
  | 'WORKFLOW_CONTINUATION_CAS_FAILED'
  | 'WORKFLOW_CONTINUATION_CLOSED'
  | 'WORKFLOW_CONTINUATION_IDEMPOTENCY_CONFLICT'
  | 'WORKFLOW_CONTINUATION_INSTANCE_CLOSED'
  | 'WORKFLOW_CONTINUATION_BINDING_STATE_MISMATCH'
  | 'WORKFLOW_CONTINUATION_WAIT_BINDING_INVALID';

export class WorkflowContinuationPersistenceError extends Error {
  readonly code: WorkflowContinuationPersistenceErrorCode;

  constructor(code: WorkflowContinuationPersistenceErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowContinuationPersistenceError';
    this.code = code;
  }
}
