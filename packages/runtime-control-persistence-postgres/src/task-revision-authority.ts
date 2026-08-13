import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

export type RuntimeTaskCommandOperation = 'pause' | 'resume' | 'cancel' | 'goal-patch';

export interface RuntimeTaskRevisionLeaseIdentity {
  readonly actionId: string;
  readonly attempt: number;
  readonly token: string;
}

export interface RuntimeTaskRevisionCommandIdentity {
  readonly operation: RuntimeTaskCommandOperation;
  readonly idempotencyKey: string;
  readonly lease: RuntimeTaskRevisionLeaseIdentity;
}

export type RuntimeTaskRevisionExecution<T> =
  | Readonly<{
      disposition: 'applied';
      priorRevision: number;
      claimedRevision: number;
      result: T;
    }>
  | Readonly<{ disposition: 'not_found' }>
  | Readonly<{ disposition: 'conflict'; currentRevision: number }>;

export type RuntimeTaskRevisionReconciliation<T> =
  | Readonly<{ disposition: 'applied'; result: T }>
  | Readonly<{ disposition: 'unapplied' }>
  | Readonly<{ disposition: 'indeterminate' }>;

export interface RuntimeTaskRevisionCommandContext {
  run<T>(
    state: Readonly<{
      taskId: string;
      token: string;
      actionId: string;
      operation: RuntimeTaskCommandOperation;
      idempotencyKey: string;
      leaseAttempt: number;
      leaseToken: string;
      expectedRevision?: number;
    }>,
    operation: () => Promise<T>,
  ): Promise<T>;
}

interface TaskRevisionClaimRow extends QueryResultRow {
  revision: string;
  active_command_token: string | null;
}

interface TaskCommandRecoveryRow extends QueryResultRow {
  revision: string;
  phase: string;
  goal_id: string | null;
  goal_version: number | null;
  plan_id: string | null;
  error_code: string | null;
  active_command_token: string | null;
  command_action_id: string | null;
  command_operation: RuntimeTaskCommandOperation | null;
  command_idempotency_key: string | null;
  command_lease_attempt: number | null;
  command_lease_token: string | null;
  command_claimed_revision: string | null;
  command_precondition_json: unknown;
  command_execution_phase:
    | 'claimed'
    | 'dispatch_started'
    | 'completed'
    | 'recovered_applied'
    | 'recovered_unapplied'
    | null;
  command_result_json: unknown;
  command_completed_at: Date | string | null;
  command_recovery_disposition: 'applied' | 'unapplied' | null;
  precondition_matches: boolean;
}

interface CommandEffectRow extends QueryResultRow {
  effect_kind: string;
  effect_ref: string;
  effect_json: unknown;
}

/**
 * Exact Task epoch authority. Every accepted command commits a per-Task fence,
 * its immutable precondition, and the exact live Cognitive action lease before
 * dispatch. The claim connection is returned before TaskService runs. Writers
 * re-lock the Cognitive row before touching command evidence, so lease takeover
 * and old-owner writes are serialized action -> Task without a session lock.
 */
export class PostgresRuntimeTaskRevisionAuthority {
  readonly #pool: Pool;
  readonly #commands: RuntimeTaskRevisionCommandContext;
  readonly #hooks: Readonly<{
    afterClaimCommit?(): void | Promise<void>;
    afterReleaseCommit?(): void | Promise<void>;
  }>;

  constructor(
    pool: Pool,
    commands: RuntimeTaskRevisionCommandContext,
    hooks: Readonly<{
      afterClaimCommit?(): void | Promise<void>;
      afterReleaseCommit?(): void | Promise<void>;
    }> = {},
  ) {
    this.#pool = pool;
    this.#commands = commands;
    this.#hooks = hooks;
  }

  async executeAtRevision<T>(
    taskId: string,
    expectedRevision: number,
    identity: RuntimeTaskRevisionCommandIdentity,
    operation: () => Promise<T>,
  ): Promise<RuntimeTaskRevisionExecution<T>> {
    return this.#execute(taskId, expectedRevision, identity, operation);
  }

  async executeAtCurrentRevision<T>(
    taskId: string,
    identity: RuntimeTaskRevisionCommandIdentity,
    operation: () => Promise<T>,
  ): Promise<RuntimeTaskRevisionExecution<T>> {
    return this.#execute(taskId, undefined, identity, operation);
  }

  async #execute<T>(
    taskId: string,
    suppliedExpectedRevision: number | undefined,
    identity: RuntimeTaskRevisionCommandIdentity,
    operation: () => Promise<T>,
  ): Promise<RuntimeTaskRevisionExecution<T>> {
    assertIdentity(identity);
    const client = await this.#pool.connect();
    const token = randomUUID();
    let transactionOpen = false;
    let claimClientReleased = false;
    let claimCommitStarted = false;
    let expectedRevision = suppliedExpectedRevision;
    let claimedRevision: number;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const actionExpectedRevision = await lockLease(
        client,
        taskId,
        identity,
        suppliedExpectedRevision,
      );
      const current = await client.query<TaskRevisionClaimRow>(
        `SELECT revision::text AS revision,active_command_token::text AS active_command_token
           FROM agent_task WHERE task_id=$1 FOR UPDATE`,
        [taskId],
      );
      const row = current.rows[0];
      if (row === undefined) {
        await client.query('COMMIT');
        transactionOpen = false;
        return Object.freeze({ disposition: 'not_found' });
      }
      const currentRevision = safeRevision(row.revision);
      expectedRevision ??= currentRevision;
      if (suppliedExpectedRevision === undefined && actionExpectedRevision !== 0)
        throw new Error('AGENT_TASK_COMMAND_EXPECTED_REVISION_SENTINEL_INVALID');
      if (currentRevision !== expectedRevision || row.active_command_token !== null) {
        await client.query('COMMIT');
        transactionOpen = false;
        return Object.freeze({ disposition: 'conflict', currentRevision });
      }
      await setCommandIdentity(
        client,
        taskId,
        token,
        identity,
        suppliedExpectedRevision === undefined ? -1 : expectedRevision,
      );
      const claimed = await client.query<TaskRevisionClaimRow>(
        `UPDATE agent_task task
            SET revision=revision+1,active_command_token=$3::uuid,
                command_action_id=$4,command_operation=$5,command_idempotency_key=$6,
                command_lease_attempt=$7,command_lease_token=$8,
                command_claimed_revision=revision+1,
                command_precondition_json=(to_jsonb(task)
                  - 'revision' - 'active_command_token' - 'command_action_id'
                  - 'command_operation' - 'command_idempotency_key'
                  - 'command_lease_attempt' - 'command_lease_token'
                  - 'command_claimed_revision' - 'command_precondition_json'
                  - 'command_claimed_at' - 'command_execution_phase'
                  - 'command_result_json' - 'command_completed_at'
                  - 'command_recovery_disposition'),
                command_claimed_at=clock_timestamp(),command_execution_phase='claimed',
                command_result_json=NULL,command_completed_at=NULL,
                command_recovery_disposition=NULL
          WHERE task_id=$1 AND revision=$2 AND active_command_token IS NULL
        RETURNING revision::text AS revision,active_command_token::text AS active_command_token`,
        [
          taskId,
          expectedRevision,
          token,
          identity.lease.actionId,
          identity.operation,
          identity.idempotencyKey,
          identity.lease.attempt,
          identity.lease.token,
        ],
      );
      const claimedRevisionValue = claimed.rows[0]?.revision;
      if (claimedRevisionValue === undefined) throw new Error('AGENT_TASK_REVISION_CLAIM_LOST');
      claimedRevision = safeRevision(claimedRevisionValue);
      claimCommitStarted = true;
      await client.query('COMMIT');
      transactionOpen = false;
      client.release();
      claimClientReleased = true;
      try {
        await this.#hooks.afterClaimCommit?.();
      } catch (error: unknown) {
        throw reconciliationPending(error);
      }

      try {
        await this.#markDispatchStarted(
          taskId,
          token,
          identity,
          expectedRevision,
          suppliedExpectedRevision === undefined,
        );
      } catch (error: unknown) {
        throw reconciliationPending(error);
      }

      let result: T;
      try {
        result = await this.#commands.run(
          commandState(
            taskId,
            token,
            identity,
            suppliedExpectedRevision === undefined ? -1 : expectedRevision,
          ),
          operation,
        );
      } catch (error: unknown) {
        if (stableErrorCode(error) === 'GOAL_PATCH_APPLIED_REPLAN_FAILED') {
          const recovered = await this.#reconcileFailure(
            taskId,
            identity,
            suppliedExpectedRevision === undefined ? -1 : expectedRevision,
            error,
          );
          if (recovered) throw error;
        }
        throw reconciliationPending(error);
      }
      try {
        await this.#releaseCompleted(
          taskId,
          token,
          identity,
          expectedRevision,
          suppliedExpectedRevision === undefined,
          result,
        );
      } catch (error: unknown) {
        throw reconciliationPending(error);
      }
      return Object.freeze({
        disposition: 'applied' as const,
        priorRevision: expectedRevision,
        claimedRevision,
        result,
      });
    } catch (error: unknown) {
      if (transactionOpen)
        try {
          await client.query('ROLLBACK');
          transactionOpen = false;
        } catch {
          // Preserve the primary failure. A started COMMIT is checked by recovery.
        }
      if (claimCommitStarted && !claimClientReleased) throw reconciliationPending(error);
      throw error;
    } finally {
      if (!claimClientReleased) client.release();
    }
  }

  reconcile<T>(
    taskId: string,
    identity: Omit<RuntimeTaskRevisionCommandIdentity, 'lease'>,
    recoveredLease: RuntimeTaskRevisionLeaseIdentity,
    recoveredResult: T,
  ): Promise<RuntimeTaskRevisionReconciliation<T>> {
    return this.#reconcile(taskId, { ...identity, lease: recoveredLease }, recoveredResult);
  }

  async #markDispatchStarted(
    taskId: string,
    token: string,
    identity: RuntimeTaskRevisionCommandIdentity,
    expectedRevision: number,
    omittedExpectedRevision: boolean,
  ): Promise<void> {
    const client = await this.#pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await lockLease(
        client,
        taskId,
        identity,
        omittedExpectedRevision ? undefined : expectedRevision,
      );
      await setCommandIdentity(
        client,
        taskId,
        token,
        identity,
        omittedExpectedRevision ? -1 : expectedRevision,
      );
      const updated = await client.query(
        `UPDATE agent_task SET command_execution_phase='dispatch_started'
          WHERE task_id=$1 AND active_command_token=$2::uuid
            AND command_execution_phase='claimed'`,
        [taskId, token],
      );
      if (updated.rowCount !== 1) throw new Error('AGENT_TASK_COMMAND_DISPATCH_LOST');
      await client.query('COMMIT');
      transactionOpen = false;
    } catch (error: unknown) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #releaseCompleted(
    taskId: string,
    token: string,
    identity: RuntimeTaskRevisionCommandIdentity,
    expectedRevision: number,
    omittedExpectedRevision: boolean,
    result: unknown,
  ): Promise<void> {
    const client = await this.#pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await lockLease(
        client,
        taskId,
        identity,
        omittedExpectedRevision ? undefined : expectedRevision,
      );
      await setCommandIdentity(
        client,
        taskId,
        token,
        identity,
        omittedExpectedRevision ? -1 : expectedRevision,
      );
      const released = await client.query(
        `UPDATE agent_task
            SET active_command_token=NULL,command_execution_phase='completed',
                command_result_json=$3::jsonb,command_completed_at=clock_timestamp()
          WHERE task_id=$1 AND active_command_token=$2::uuid
            AND command_execution_phase='dispatch_started'`,
        [taskId, token, encodeJson(result)],
      );
      if (released.rowCount !== 1) throw new Error('AGENT_TASK_COMMAND_RELEASE_LOST');
      await client.query('COMMIT');
      transactionOpen = false;
      await this.#hooks.afterReleaseCommit?.();
    } catch (error: unknown) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #reconcileFailure(
    taskId: string,
    identity: RuntimeTaskRevisionCommandIdentity,
    _settingExpectedRevision: number,
    error: unknown,
  ): Promise<boolean> {
    const result = await this.#reconcile(
      taskId,
      identity,
      { errorCode: stableErrorCode(error), applied: true },
      true,
    );
    return result.disposition === 'applied';
  }

  async #reconcile<T>(
    taskId: string,
    identity: RuntimeTaskRevisionCommandIdentity,
    recoveredResult: T,
    acceptPartialGoalPatch = false,
  ): Promise<RuntimeTaskRevisionReconciliation<T>> {
    const client = await this.#pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const action = await lockActionForRecovery(client, taskId, identity);
      const task = await selectRecoveryTask(client, taskId);
      const expectedRevision = action.expectedVersion;
      if (task === undefined) {
        await client.query('COMMIT');
        transactionOpen = false;
        return Object.freeze({ disposition: 'indeterminate' });
      }
      if (
        task.command_action_id !== identity.lease.actionId ||
        task.command_operation !== identity.operation ||
        task.command_idempotency_key !== identity.idempotencyKey
      ) {
        // An action that owns neither the Task command slot nor any durable
        // effect never crossed the claim boundary. This also handles the
        // omitted-revision sentinel when the Task was already at revision N.
        const effects = await client.query(
          `SELECT 1 FROM runtime_task_command_effect
            WHERE action_id=$1 AND task_id=$2 LIMIT 1`,
          [identity.lease.actionId, taskId],
        );
        await client.query('COMMIT');
        transactionOpen = false;
        return effects.rowCount === 0
          ? Object.freeze({ disposition: 'unapplied' })
          : Object.freeze({ disposition: 'indeterminate' });
      }
      if (task.command_completed_at !== null && task.command_result_json !== null) {
        await client.query('COMMIT');
        transactionOpen = false;
        return Object.freeze({
          disposition: 'applied' as const,
          result: task.command_result_json as T,
        });
      }
      if (task.command_recovery_disposition === 'unapplied') {
        await client.query('COMMIT');
        transactionOpen = false;
        return Object.freeze({ disposition: 'unapplied' });
      }
      if (task.active_command_token === null) {
        await client.query('COMMIT');
        transactionOpen = false;
        return Object.freeze({ disposition: 'indeterminate' });
      }

      const effects = await client.query<CommandEffectRow>(
        `SELECT effect_kind,effect_ref,effect_json
           FROM runtime_task_command_effect
          WHERE action_id=$1 AND task_id=$2 ORDER BY effect_kind,effect_ref`,
        [identity.lease.actionId, taskId],
      );
      const postcondition = await classifyPostcondition(client, taskId, task, effects.rows);
      const partialGoalPatch =
        acceptPartialGoalPatch &&
        task.command_operation === 'goal-patch' &&
        effects.rows.some((effect) => effect.effect_kind === 'goal_patch_committed');
      if (postcondition === 'indeterminate' && !partialGoalPatch) {
        await client.query('COMMIT');
        transactionOpen = false;
        return Object.freeze({ disposition: 'indeterminate' });
      }
      if (postcondition === 'unapplied' && task.command_execution_phase !== 'claimed') {
        await client.query('COMMIT');
        transactionOpen = false;
        return Object.freeze({ disposition: 'indeterminate' });
      }
      await setCommandIdentity(
        client,
        taskId,
        task.active_command_token,
        identity,
        recoverySettingExpectedRevision(task, expectedRevision),
      );
      await client.query("SELECT set_config('sdar.runtime_task_command_recovery',$1,true)", [
        postcondition,
      ]);
      const released = await client.query(
        `UPDATE agent_task
            SET active_command_token=NULL,
                command_execution_phase=$2,
                command_result_json=$3::jsonb,command_completed_at=$4,
                command_recovery_disposition=$5
          WHERE task_id=$1 AND active_command_token IS NOT NULL`,
        [
          taskId,
          postcondition === 'applied' || partialGoalPatch
            ? 'recovered_applied'
            : 'recovered_unapplied',
          postcondition === 'applied' || partialGoalPatch ? encodeJson(recoveredResult) : null,
          postcondition === 'applied' || partialGoalPatch ? new Date().toISOString() : null,
          partialGoalPatch ? 'applied' : postcondition,
        ],
      );
      if (released.rowCount !== 1) throw new Error('AGENT_TASK_COMMAND_RECOVERY_RELEASE_LOST');
      await client.query('COMMIT');
      transactionOpen = false;
      return postcondition === 'applied' || partialGoalPatch
        ? Object.freeze({ disposition: 'applied' as const, result: recoveredResult })
        : Object.freeze({ disposition: 'unapplied' as const });
    } catch (error: unknown) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function selectRecoveryTask(client: PoolClient, taskId: string) {
  const task = await client.query<TaskCommandRecoveryRow>(
    `SELECT task.revision::text AS revision,task.phase,task.goal_id,task.goal_version,
            task.plan_id,task.error_code,task.active_command_token::text AS active_command_token,
            task.command_action_id,task.command_operation,task.command_idempotency_key,
            task.command_lease_attempt,task.command_lease_token,
            task.command_claimed_revision::text AS command_claimed_revision,
            task.command_precondition_json,task.command_execution_phase,
            task.command_result_json,task.command_completed_at,task.command_recovery_disposition,
            ((to_jsonb(task)
              - 'revision' - 'active_command_token' - 'command_action_id'
              - 'command_operation' - 'command_idempotency_key'
              - 'command_lease_attempt' - 'command_lease_token'
              - 'command_claimed_revision' - 'command_precondition_json'
              - 'command_claimed_at' - 'command_execution_phase'
              - 'command_result_json' - 'command_completed_at'
              - 'command_recovery_disposition')=task.command_precondition_json) AS precondition_matches
       FROM agent_task task WHERE task.task_id=$1 FOR UPDATE`,
    [taskId],
  );
  return task.rows[0];
}

async function classifyPostcondition(
  client: PoolClient,
  taskId: string,
  row: TaskCommandRecoveryRow,
  effects: readonly CommandEffectRow[],
): Promise<'applied' | 'unapplied' | 'indeterminate'> {
  if (row.command_execution_phase === 'claimed' && effects.length === 0 && row.precondition_matches)
    return 'unapplied';
  if (row.command_execution_phase !== 'dispatch_started') return 'indeterminate';

  if (row.command_operation === 'pause') {
    const paused = effects.find((effect) => effect.effect_kind === 'workflow_paused');
    if (row.phase !== 'paused' || paused === undefined || row.plan_id === null)
      return 'indeterminate';
    const exact = await client.query(
      `SELECT 1 FROM workflow_instance
        WHERE instance_id=$1 AND plan_id=$2 AND status='paused'
          AND pending_confirmation_json->>'kind'='task_pause' LIMIT 1`,
      [paused.effect_ref, row.plan_id],
    );
    return exact.rowCount === 1 ? 'applied' : 'indeterminate';
  }

  if (row.command_operation === 'resume') {
    const running = effects.find((effect) => effect.effect_kind === 'workflow_running');
    if (running !== undefined && row.phase === 'executing' && row.plan_id !== null) {
      const exact = await client.query(
        `SELECT 1 FROM workflow_instance
          WHERE instance_id=$1 AND plan_id=$2 AND status='running'
            AND pending_confirmation_json IS NULL LIMIT 1`,
        [running.effect_ref, row.plan_id],
      );
      if (exact.rowCount === 1) return 'applied';
    }
    const planEffect = effects.find((effect) => effect.effect_kind === 'workflow_plan_saved');
    if (
      planEffect !== undefined &&
      row.phase === 'awaiting_plan_confirmation' &&
      row.plan_id === planEffect.effect_ref
    ) {
      const exact = await client.query(
        `SELECT 1 FROM workflow_plan
          WHERE plan_id=$1 AND goal_id=$2 AND goal_version=$3
            AND confirmation_status='awaiting_confirmation' LIMIT 1`,
        [row.plan_id, row.goal_id, row.goal_version],
      );
      if (exact.rowCount === 1) return 'applied';
    }
    return 'indeterminate';
  }

  if (row.command_operation === 'cancel') {
    const terminal = effects.find((effect) => effect.effect_kind === 'terminal_outcome_committed');
    if (terminal !== undefined && row.phase === 'canceled') {
      const exact = await client.query(
        `SELECT 1 FROM runtime_terminal_outcome
          WHERE outcome_id=$1 AND task_id=$2 AND outcome_kind='canceled' LIMIT 1`,
        [terminal.effect_ref, taskId],
      );
      if (exact.rowCount === 1) return 'applied';
    }
    const workflow = effects.find((effect) =>
      ['workflow_canceled', 'workflow_failed'].includes(effect.effect_kind),
    );
    if (workflow === undefined || row.phase !== 'canceled' || row.plan_id === null)
      return 'indeterminate';
    const exact = await client.query(
      `SELECT 1
         FROM workflow_instance instance
        WHERE instance.instance_id=$1 AND instance.plan_id=$2
          AND instance.status IN ('canceled','failed')
          AND NOT EXISTS (SELECT 1 FROM task_input_request request
            WHERE request.task_id=$3 AND request.status='waiting')
          AND EXISTS (SELECT 1 FROM runtime_event event
            WHERE event.task_id=$3 AND event.event_type='task.phase_changed'
              AND event.summary='Task canceled by user.')
        LIMIT 1`,
      [workflow.effect_ref, row.plan_id, taskId],
    );
    return exact.rowCount === 1 ? 'applied' : 'indeterminate';
  }

  const patchEffect = effects.find((effect) => effect.effect_kind === 'goal_patch_committed');
  if (patchEffect === undefined) return 'indeterminate';
  const fromVersion = preconditionNumber(row, 'goal_version');
  const newPlanId = objectText(patchEffect.effect_json, 'newPlanId');
  if (fromVersion === undefined || newPlanId === undefined) return 'indeterminate';
  const exactPatch = await client.query(
    `SELECT 1 FROM goal_patch patch
      WHERE patch.patch_id=$1 AND patch.triggering_task_id=$2
        AND patch.from_version=$3 AND patch.to_version=$3+1
        AND patch.new_plan_id=$4 LIMIT 1`,
    [patchEffect.effect_ref, taskId, fromVersion, newPlanId],
  );
  if (exactPatch.rowCount !== 1) return 'indeterminate';
  const exactPlan = await client.query(
    `SELECT 1 FROM workflow_plan
      WHERE plan_id=$1 AND goal_id=$2 AND goal_version=$3
        AND confirmation_status='awaiting_confirmation' LIMIT 1`,
    [newPlanId, row.goal_id, fromVersion + 1],
  );
  // A committed patch without its exact replacement plan is a stable partial
  // failure, not a completed command. execute() records the original 503.
  return exactPlan.rowCount === 1 ? 'applied' : 'indeterminate';
}

interface ActionLockRow extends QueryResultRow {
  expected_version: string;
}

async function lockLease(
  client: PoolClient,
  taskId: string,
  identity: RuntimeTaskRevisionCommandIdentity,
  suppliedExpectedRevision: number | undefined,
): Promise<number> {
  const result = await client.query<ActionLockRow>(
    `SELECT expected_version::text AS expected_version
       FROM cognitive_management_action
      WHERE action_id=$1 AND operation=$2 AND subject_id=$3
        AND idempotency_key=$4 AND status='pending'
        AND lease_attempt=$5 AND lease_token=$6
        AND lease_expires_at>clock_timestamp()
        AND ($7::bigint IS NULL OR expected_version=$7)
      FOR UPDATE`,
    [
      identity.lease.actionId,
      auditOperation(identity.operation),
      commandSubject(taskId),
      identity.idempotencyKey,
      identity.lease.attempt,
      identity.lease.token,
      suppliedExpectedRevision ?? null,
    ],
  );
  const expectedVersion = result.rows[0]?.expected_version;
  if (expectedVersion === undefined) throw new Error('AGENT_TASK_COMMAND_LEASE_LOST');
  return safeRevision(expectedVersion);
}

async function lockActionForRecovery(
  client: PoolClient,
  taskId: string,
  identity: RuntimeTaskRevisionCommandIdentity,
): Promise<{ expectedVersion: number }> {
  const expectedVersion = await lockLease(client, taskId, identity, undefined);
  return { expectedVersion };
}

async function setCommandIdentity(
  client: PoolClient,
  taskId: string,
  token: string,
  identity: RuntimeTaskRevisionCommandIdentity,
  expectedRevision: number,
): Promise<void> {
  await client.query(
    `SELECT set_config('sdar.runtime_task_command_task_id',$1,true),
            set_config('sdar.runtime_task_command_token',$2,true),
            set_config('sdar.runtime_task_command_action_id',$3,true),
            set_config('sdar.runtime_task_command_operation',$4,true),
            set_config('sdar.runtime_task_command_idempotency_key',$5,true),
            set_config('sdar.runtime_task_command_lease_attempt',$6,true),
            set_config('sdar.runtime_task_command_lease_token',$7,true),
            set_config('sdar.runtime_task_command_expected_revision',$8,true)`,
    [
      taskId,
      token,
      identity.lease.actionId,
      identity.operation,
      identity.idempotencyKey,
      String(identity.lease.attempt),
      identity.lease.token,
      String(expectedRevision),
    ],
  );
}

function commandState(
  taskId: string,
  token: string,
  identity: RuntimeTaskRevisionCommandIdentity,
  expectedRevision: number,
) {
  return Object.freeze({
    taskId,
    token,
    actionId: identity.lease.actionId,
    operation: identity.operation,
    idempotencyKey: identity.idempotencyKey,
    leaseAttempt: identity.lease.attempt,
    leaseToken: identity.lease.token,
    expectedRevision,
  });
}

function auditOperation(operation: RuntimeTaskCommandOperation): string {
  return operation === 'goal-patch' ? 'task_goal_patch' : `task_${operation}`;
}

function commandSubject(taskId: string): string {
  return `runtime-task-control:${taskId}`;
}

function assertIdentity(identity: RuntimeTaskRevisionCommandIdentity): void {
  if (
    identity.idempotencyKey.trim() === '' ||
    identity.lease.actionId.trim() === '' ||
    !Number.isSafeInteger(identity.lease.attempt) ||
    identity.lease.attempt < 1 ||
    identity.lease.token.trim() === ''
  )
    throw new Error('AGENT_TASK_COMMAND_IDENTITY_INVALID');
}

function preconditionNumber(row: TaskCommandRecoveryRow, key: string): number | undefined {
  const value = objectValue(row.command_precondition_json, key);
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function recoverySettingExpectedRevision(
  row: TaskCommandRecoveryRow,
  actionExpectedVersion: number,
): number {
  const claimedRevision =
    row.command_claimed_revision === null ? undefined : safeRevision(row.command_claimed_revision);
  // expected_version=0 is the durable Cognitive sentinel for a command whose
  // client omitted expectedRevision. At revision zero both explicit and
  // omitted commands validate with zero; above zero recovery must restore the
  // -1 writer sentinel recorded by the accepted claim.
  return actionExpectedVersion === 0 && claimedRevision !== undefined && claimedRevision > 1
    ? -1
    : actionExpectedVersion;
}

function objectText(value: unknown, key: string): string | undefined {
  const candidate = objectValue(value, key);
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined;
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)[key]
    : undefined;
}

function encodeJson(value: unknown): string {
  const encoded = (JSON.stringify as (input: unknown) => string | undefined)(value);
  if (encoded === undefined) throw new Error('AGENT_TASK_COMMAND_RESULT_NOT_JSON');
  return encoded;
}

function safeRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error('AGENT_TASK_REVISION_INVALID');
  return revision;
}

function stableErrorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.trim() !== ''
    ? error.code
    : 'RUNTIME_TASK_COMMAND_FAILED';
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* Fence remains fail-closed. */
  }
}

function reconciliationPending(cause: unknown): Error {
  return Object.assign(
    new Error('Runtime Task command requires durable reconciliation.', { cause }),
    {
      code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
      status: 503,
    },
  );
}
