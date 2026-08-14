import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { CognitiveManagementActionGate } from '../../application/src/index.js';
import {
  PostgresAgentTaskCommandContext,
  PostgresAgentTaskRepository,
  PostgresCognitiveManagementActionRepository,
  PostgresRuntimeRecoveryRepository,
} from '../../persistence-postgres/src/index.js';
import {
  PostgresRuntimeTaskRevisionAuthority,
  type RuntimeTaskCommandOperation,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const pool = new Pool({ connectionString, max: 12 });
const taskId = 'task-p08-revision-authority';
const otherTaskId = 'task-p08-revision-authority-other';
const fixedNow = '2026-08-14T01:00:00.000Z';

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query('TRUNCATE cognitive_management_action,agent_task,conversation_context CASCADE');
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('context-p08-revision','user-p08',$1,$1)`,
    [fixedNow],
  );
  await seedTask(taskId, 'Executing primary Task.');
});

afterAll(async () => {
  await pool.end();
});

describe('P08 durable per-Task revision authority', { concurrent: false }, () => {
  it('leaves a stale explicit precondition untouched and same-key replay mutates once', async () => {
    const commands = new PostgresAgentTaskCommandContext().bindPool(pool);
    const authority = new PostgresRuntimeTaskRevisionAuthority(pool, commands);
    const tasks = new PostgresAgentTaskRepository(pool, undefined, commands);
    const gate = createGate('exact-replay');
    const mutation = vi.fn(async () => {
      const task = await requiredTask(tasks, taskId);
      await tasks.save({ ...task, phaseMessage: 'Exact mutation.', updatedAt: fixedNow });
      return auditResult('exact');
    });

    await expect(
      execute(gate, authority, { key: 'stale', expectedRevision: 9 }, mutation),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(mutation).not.toHaveBeenCalled();
    await expect(revision(taskId)).resolves.toBe(0);

    const first = await execute(gate, authority, { key: 'exact', expectedRevision: 0 }, mutation);
    await expect(
      execute(gate, authority, { key: 'exact', expectedRevision: 0 }, mutation),
    ).resolves.toEqual(first);
    expect(mutation).toHaveBeenCalledOnce();
    await expect(revision(taskId)).resolves.toBe(2);
  });

  it('claims current revision atomically for a legacy command at revision greater than zero', async () => {
    await pool.query(
      `UPDATE agent_task SET phase_message='Background revision one.' WHERE task_id=$1`,
      [taskId],
    );
    const commands = new PostgresAgentTaskCommandContext().bindPool(pool);
    const authority = new PostgresRuntimeTaskRevisionAuthority(pool, commands);
    const tasks = new PostgresAgentTaskRepository(pool, undefined, commands);

    await expect(
      execute(createGate('legacy-current'), authority, { key: 'legacy-current' }, async () => {
        const task = await requiredTask(tasks, taskId);
        await tasks.save({ ...task, phaseMessage: 'Legacy fenced mutation.', updatedAt: fixedNow });
        return auditResult('legacy-current');
      }),
    ).resolves.toEqual(auditResult('legacy-current'));

    await expect(commandRow(taskId)).resolves.toMatchObject({
      revision: '3',
      active_command_token: null,
      command_execution_phase: 'completed',
    });
    await expect(
      pool.query<{ expected_version: string }>(
        `SELECT expected_version::text AS expected_version
           FROM cognitive_management_action WHERE idempotency_key='legacy-current'`,
      ),
    ).resolves.toMatchObject({ rows: [{ expected_version: '0' }] });
  });

  it('returns the claim connection before command writers run with a max=1 pool', async () => {
    const singlePool = new Pool({ connectionString, max: 1 });
    try {
      const commands = new PostgresAgentTaskCommandContext().bindPool(singlePool);
      const authority = new PostgresRuntimeTaskRevisionAuthority(singlePool, commands);
      const tasks = new PostgresAgentTaskRepository(singlePool, undefined, commands);
      await expect(
        execute(createGate('max-one', singlePool), authority, { key: 'max-one' }, async () => {
          const task = await requiredTask(tasks, taskId);
          await tasks.save({ ...task, phaseMessage: 'max=1 completed.', updatedAt: fixedNow });
          return auditResult('max-one');
        }),
      ).resolves.toEqual(auditResult('max-one'));
    } finally {
      await singlePool.end();
    }
    await expect(revision(taskId)).resolves.toBe(2);
  });

  it('blocks same-Task background writes while allowing different Task commands concurrently', async () => {
    await seedTask(otherTaskId, 'Executing other Task.');
    const commands = new PostgresAgentTaskCommandContext().bindPool(pool);
    const authority = new PostgresRuntimeTaskRevisionAuthority(pool, commands);
    const firstGate = createGate('cross-first');
    const secondGate = createGate('cross-second');
    const firstEntered = deferred();
    const secondEntered = deferred();
    const release = deferred();

    const first = execute(firstGate, authority, { key: 'cross-first' }, async () => {
      firstEntered.resolve();
      await release.promise;
      return auditResult('cross-first');
    });
    await firstEntered.promise;

    await expect(
      pool.query(
        `UPDATE agent_task SET phase_message='Unsafe background write.' WHERE task_id=$1`,
        [taskId],
      ),
    ).rejects.toThrow(/AGENT_TASK_COMMAND_FENCED/);

    const second = execute(
      secondGate,
      authority,
      { key: 'cross-second', taskId: otherTaskId },
      async () => {
        secondEntered.resolve();
        await release.promise;
        return auditResult('cross-second');
      },
    );
    await secondEntered.promise;
    await expect(
      pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM agent_task
          WHERE task_id=ANY($1::text[]) AND active_command_token IS NOT NULL`,
        [[taskId, otherTaskId]],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '2' }] });
    release.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      auditResult('cross-first'),
      auditResult('cross-second'),
    ]);
  });

  it('rejects using a live command lease for a different Task', async () => {
    await seedTask(otherTaskId, 'Executing other Task.');
    const commands = new PostgresAgentTaskCommandContext().bindPool(pool);
    const authority = new PostgresRuntimeTaskRevisionAuthority(pool, commands);
    const gate = createGate('cross-task-misuse');

    await expect(
      gate.execute(actionInput(taskId, 'cross-task-misuse', 0), async (guard) => {
        const result = await authority.executeAtRevision(
          otherTaskId,
          0,
          commandIdentity('pause', 'cross-task-misuse', guard.leaseIdentity()),
          () => Promise.resolve(auditResult('must-not-run')),
        );
        if (result.disposition !== 'applied') throw new Error('P08_UNEXPECTED_DISPOSITION');
        return result.result;
      }),
    ).rejects.toThrow(/AGENT_TASK_COMMAND_LEASE_LOST/);
    await expect(revision(otherTaskId)).resolves.toBe(0);
  });

  it('turns claim COMMIT response loss into pending and recovers a legacy rev>0 claim as unapplied', async () => {
    await pool.query(`UPDATE agent_task SET phase_message='Revision one.' WHERE task_id=$1`, [
      taskId,
    ]);
    const commands = new PostgresAgentTaskCommandContext().bindPool(pool);
    let failOnce = true;
    const authority = new PostgresRuntimeTaskRevisionAuthority(pool, commands, {
      afterClaimCommit() {
        if (failOnce) {
          failOnce = false;
          throw new Error('SIMULATED_CLAIM_COMMIT_RESPONSE_LOST');
        }
      },
    });
    const gate = createGate('claim-response-lost', pool, 120);
    const operation = vi.fn(() => Promise.resolve(auditResult('claim-response-lost')));

    await expect(
      execute(gate, authority, { key: 'claim-response-lost' }, operation),
    ).rejects.toMatchObject({ code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING' });
    expect(operation).not.toHaveBeenCalled();
    await expect(commandRow(taskId)).resolves.toMatchObject({
      revision: '2',
      active_command_token: expect.any(String),
      command_execution_phase: 'claimed',
    });

    await expireAction('claim-response-lost');
    await expect(
      execute(gate, authority, { key: 'claim-response-lost' }, operation),
    ).rejects.toMatchObject({ code: 'RUNTIME_TASK_COMMAND_RECOVERY_UNAPPLIED' });
    expect(operation).not.toHaveBeenCalled();
    await expect(commandRow(taskId)).resolves.toMatchObject({
      revision: '2',
      active_command_token: null,
      command_execution_phase: 'recovered_unapplied',
      command_recovery_disposition: 'unapplied',
    });
  });

  it('recovers a legacy rev>0 applied crash without dispatching the operation twice', async () => {
    await pool.query(`UPDATE agent_task SET phase_message='Revision one.' WHERE task_id=$1`, [
      taskId,
    ]);
    const commands = new PostgresAgentTaskCommandContext().bindPool(pool);
    let loseReleaseResponse = true;
    const authority = new PostgresRuntimeTaskRevisionAuthority(pool, commands, {
      afterReleaseCommit() {
        if (loseReleaseResponse) {
          loseReleaseResponse = false;
          throw new Error('SIMULATED_RELEASE_COMMIT_RESPONSE_LOST');
        }
      },
    });
    const tasks = new PostgresAgentTaskRepository(pool, undefined, commands);
    const gate = createGate('release-response-lost', pool, 120);
    const operation = vi.fn(async () => {
      const task = await requiredTask(tasks, taskId);
      await tasks.save({ ...task, phaseMessage: 'Applied exactly once.', updatedAt: fixedNow });
      return auditResult('release-response-lost');
    });

    await expect(
      execute(gate, authority, { key: 'release-response-lost' }, operation),
    ).rejects.toMatchObject({ code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING' });
    expect(operation).toHaveBeenCalledOnce();
    await expect(commandRow(taskId)).resolves.toMatchObject({
      revision: '3',
      active_command_token: null,
      command_execution_phase: 'completed',
    });

    await expireAction('release-response-lost');
    await expect(
      execute(gate, authority, { key: 'release-response-lost' }, operation),
    ).resolves.toEqual(auditResult('release-response-lost'));
    expect(operation).toHaveBeenCalledOnce();
  });

  it('does not overwrite a released command result while its Cognitive action is pending', async () => {
    const commands = new PostgresAgentTaskCommandContext().bindPool(pool);
    const released = deferred();
    const finishFirst = deferred();
    const firstAuthority = new PostgresRuntimeTaskRevisionAuthority(pool, commands, {
      async afterReleaseCommit() {
        released.resolve();
        await finishFirst.promise;
      },
    });
    const first = execute(
      createGate('history-first'),
      firstAuthority,
      { key: 'history-first' },
      () => Promise.resolve(auditResult('history-first')),
    );
    await released.promise;
    const competing = execute(
      createGate('history-second'),
      new PostgresRuntimeTaskRevisionAuthority(pool, commands),
      { key: 'history-second' },
      () => Promise.resolve(auditResult('history-second')),
    );
    await expect(competing).rejects.toThrow(/AGENT_TASK_COMMAND_CLAIM_INVALID/);
    finishFirst.resolve();
    await expect(first).resolves.toEqual(auditResult('history-first'));
    await expect(commandRow(taskId)).resolves.toMatchObject({
      command_idempotency_key: 'history-first',
      command_result_json: auditResult('history-first'),
    });
  });

  it('startup recovery leaves a fenced Task, Workflow, and execution attempt untouched', async () => {
    await seedWorkflowAndAttempt(taskId);
    const commands = new PostgresAgentTaskCommandContext().bindPool(pool);
    const authority = new PostgresRuntimeTaskRevisionAuthority(pool, commands);
    const entered = deferred();
    const release = deferred();
    const running = execute(
      createGate('startup-skip'),
      authority,
      { key: 'startup-skip' },
      async () => {
        entered.resolve();
        await release.promise;
        return auditResult('startup-skip');
      },
    );
    await entered.promise;

    await expect(
      new PostgresRuntimeRecoveryRepository(pool).failInterrupted(fixedNow),
    ).resolves.toEqual({ tasks: 0, workflowInstances: 0, taskAttempts: 0 });
    await expect(
      pool.query<{ phase: string; workflow_status: string; attempt_status: string }>(
        `SELECT task.phase,instance.status AS workflow_status,attempt.status AS attempt_status
           FROM agent_task task
           JOIN workflow_instance instance ON instance.plan_id=task.plan_id
           JOIN task_execution_attempt attempt ON attempt.task_id=task.task_id
          WHERE task.task_id=$1`,
        [taskId],
      ),
    ).resolves.toMatchObject({
      rows: [{ phase: 'executing', workflow_status: 'paused', attempt_status: 'running' }],
    });
    release.resolve();
    await expect(running).resolves.toEqual(auditResult('startup-skip'));
  });

  it('keeps a dispatch-started partial effect indeterminate and fenced', async () => {
    const commands = new PostgresAgentTaskCommandContext().bindPool(pool);
    const authority = new PostgresRuntimeTaskRevisionAuthority(pool, commands);
    const gate = createGate('partial-pause', pool, 120);
    const operation = vi.fn(async () => {
      await commands.recordEffect('workflow_paused', 'instance-missing', {
        instanceId: 'instance-missing',
        planId: 'plan-missing',
        goalId: 'goal-missing',
        goalVersion: 1,
        status: 'paused',
      });
      throw Object.assign(new Error('Crash before Task projection.'), { code: 'SIMULATED_CRASH' });
    });

    await expect(
      execute(gate, authority, { key: 'partial-pause' }, operation),
    ).rejects.toMatchObject({ code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING' });
    await expireAction('partial-pause');
    await expect(
      execute(gate, authority, { key: 'partial-pause' }, operation),
    ).rejects.toMatchObject({ code: 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING' });
    expect(operation).toHaveBeenCalledOnce();
    await expect(commandRow(taskId)).resolves.toMatchObject({
      active_command_token: expect.any(String),
      command_execution_phase: 'dispatch_started',
    });
  });
});

function createGate(owner: string, sourcePool = pool, leaseDurationMs = 10_000) {
  return new CognitiveManagementActionGate({
    repository: new PostgresCognitiveManagementActionRepository(sourcePool),
    clock: { now: () => fixedNow },
    ownerId: `p08-${owner}`,
    leaseDurationMs,
    leaseRenewIntervalMs: Math.max(10, Math.floor(leaseDurationMs / 3)),
  });
}

function execute<T>(
  gate: CognitiveManagementActionGate,
  authority: PostgresRuntimeTaskRevisionAuthority,
  input: Readonly<{
    key: string;
    taskId?: string;
    operation?: RuntimeTaskCommandOperation;
    expectedRevision?: number;
  }>,
  operation: () => Promise<T>,
): Promise<T> {
  const targetTaskId = input.taskId ?? taskId;
  const commandOperation = input.operation ?? 'pause';
  const expectedVersion = input.expectedRevision ?? 0;
  return gate.execute(
    actionInput(targetTaskId, input.key, expectedVersion, commandOperation),
    async (guard) => {
      const identity = commandIdentity(commandOperation, input.key, guard.leaseIdentity());
      const result =
        input.expectedRevision === undefined
          ? await authority.executeAtCurrentRevision(targetTaskId, identity, operation)
          : await authority.executeAtRevision(
              targetTaskId,
              input.expectedRevision,
              identity,
              operation,
            );
      if (result.disposition === 'not_found')
        throw Object.assign(new Error('Task not found.'), { code: 'TASK_NOT_FOUND' });
      if (result.disposition === 'conflict')
        throw Object.assign(new Error('Task revision changed.'), { code: 'REVISION_CONFLICT' });
      return result.result;
    },
    async (guard) => {
      const result = await authority.reconcile(
        targetTaskId,
        { operation: commandOperation, idempotencyKey: input.key },
        guard.leaseIdentity(),
        auditResult(input.key) as T,
      );
      if (result.disposition === 'applied')
        return { disposition: 'completed' as const, result: result.result };
      return {
        disposition:
          result.disposition === 'unapplied' ? ('orphaned' as const) : ('indeterminate' as const),
        errorCode:
          result.disposition === 'unapplied'
            ? 'RUNTIME_TASK_COMMAND_RECOVERY_UNAPPLIED'
            : 'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
      };
    },
  );
}

function actionInput(
  subjectTaskId: string,
  key: string,
  expectedVersion: number,
  operation: RuntimeTaskCommandOperation = 'pause',
) {
  return {
    operation: auditOperation(operation),
    subjectId: `runtime-task-control:${subjectTaskId}`,
    expectedVersion,
    idempotencyKey: key,
    actorId: 'node-control-p08',
    reason: `Exercise ${operation} command ${key}.`,
  } as const;
}

function commandIdentity(
  operation: RuntimeTaskCommandOperation,
  idempotencyKey: string,
  lease: Readonly<{ actionId: string; attempt: number; token: string }>,
) {
  return { operation, idempotencyKey, lease } as const;
}

function auditOperation(operation: RuntimeTaskCommandOperation) {
  return operation === 'goal-patch' ? ('task_goal_patch' as const) : (`task_${operation}` as const);
}

function auditResult(key: string) {
  return Object.freeze({ operation: 'task.pause', key, status: 'succeeded' });
}

async function requiredTask(repository: PostgresAgentTaskRepository, id: string) {
  const task = await repository.findById(id);
  if (task === undefined) throw new Error('P08_TASK_FIXTURE_MISSING');
  return task;
}

async function seedTask(id: string, message: string): Promise<void> {
  await pool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,phase,phase_message,request_text,request_metadata,
       created_at,updated_at)
     VALUES($1,'context-p08-revision','user-p08','executing',$2,
       'Exercise durable Task authority.','{}'::jsonb,$3,$3)`,
    [id, message, fixedNow],
  );
}

async function seedWorkflowAndAttempt(id: string): Promise<void> {
  const goalId = 'goal-p08-startup';
  const planId = 'plan-p08-startup';
  await pool.query(
    `INSERT INTO goal(
       goal_id,context_id,version,title,description,constraints_json,success_criteria_json,
       status,created_at,updated_at)
     VALUES($1,'context-p08-revision',1,'Startup fence','Preserve exact state.',
       '[]'::jsonb,'["Preserved."]'::jsonb,'active',$2,$2)`,
    [goalId, fixedNow],
  );
  await pool.query(
    `INSERT INTO workflow_plan(
       plan_id,goal_id,goal_version,goal_contract_json,definition_json,
       confirmation_status,attempt_count,created_at)
     VALUES($2,$1,1,'{}'::jsonb,'{}'::jsonb,'confirmed',1,$3)`,
    [goalId, planId, fixedNow],
  );
  await pool.query('UPDATE agent_task SET goal_id=$1,goal_version=1,plan_id=$2 WHERE task_id=$3', [
    goalId,
    planId,
    id,
  ]);
  await pool.query(
    `INSERT INTO workflow_instance(
       instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
       status,input_json,errors_json,started_at,skill_versions_json,budget_limits_json,
       budget_usage_json,pending_confirmation_json)
     VALUES('instance-p08-startup',$2,'workflow-p08',1,$1,1,'paused','{}'::jsonb,
       '{}'::jsonb,$3,'[]'::jsonb,
       '{"maxReplans":1,"maxDurationSeconds":60,"maxLlmCalls":1,"maxMcpCalls":1,"maxCost":1}'::jsonb,
       '{"replanCount":0,"durationMs":0,"llmCalls":0,"mcpCalls":0,"cost":0}'::jsonb,
       '{"kind":"task_pause","nodeId":"pause","prompt":"Paused","requestedAt":"2026-08-14T01:00:00.000Z"}'::jsonb)`,
    [goalId, planId, fixedNow],
  );
  await pool.query(
    `INSERT INTO task_execution_attempt(
       attempt_id,task_id,context_id,reason,status,created_at,started_at)
     VALUES('attempt-p08-startup',$1,'context-p08-revision','initial','running',$2,$2)`,
    [id, fixedNow],
  );
}

async function expireAction(key: string): Promise<void> {
  await pool.query(
    `UPDATE cognitive_management_action
        SET lease_expires_at=clock_timestamp()-interval '1 second'
      WHERE idempotency_key=$1 AND status='pending'`,
    [key],
  );
}

async function revision(id: string): Promise<number> {
  const result = await pool.query<{ revision: string }>(
    'SELECT revision::text AS revision FROM agent_task WHERE task_id=$1',
    [id],
  );
  return Number(result.rows[0]?.revision);
}

async function commandRow(id: string) {
  const result = await pool.query<{
    revision: string;
    active_command_token: string | null;
    command_execution_phase: string | null;
    command_recovery_disposition: string | null;
    command_idempotency_key: string | null;
    command_result_json: unknown;
  }>(
    `SELECT revision::text AS revision,active_command_token::text AS active_command_token,
            command_execution_phase,command_recovery_disposition,
            command_idempotency_key,command_result_json
       FROM agent_task WHERE task_id=$1`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('P08_TASK_FIXTURE_MISSING');
  return row;
}

function deferred() {
  let resolvePromise!: () => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
