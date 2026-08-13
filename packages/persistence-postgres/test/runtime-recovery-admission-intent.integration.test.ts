import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { PostgresRuntimeRecoveryRepository } from '../src/index.js';

const databaseName = 'sdar_v14_admission_startup_recovery_integration';
const adminConnection =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseConnection = replaceDatabase(adminConnection, databaseName);
const observedAt = '2026-08-13T03:00:00.000Z';

let pool: Pool | undefined;
let databaseCreated = false;

beforeAll(async () => {
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
  } finally {
    await admin.end();
  }
  pool = new Pool({ connectionString: databaseConnection, max: 4 });
  await applyRuntimeMigrations(pool);
  await seedRuntimeAuthority(pool);
}, 60_000);

afterAll(async () => {
  await pool?.end();
  if (!databaseCreated) return;
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  } finally {
    await admin.end();
  }
});

describe('PostgreSQL startup recovery with remote admission intent authority', () => {
  it('preserves receipt-recorded work without preserving dispatching or ordinary interruptions', async () => {
    const database = requiredPool();
    const notifications: string[] = [];

    await expect(
      new PostgresRuntimeRecoveryRepository(database, (task) => notifications.push(task.taskId), {
        preserveRemoteWaits: true,
      }).failInterrupted('2026-08-13T03:01:00.000Z'),
    ).resolves.toEqual({ tasks: 2, workflowInstances: 2, taskAttempts: 2 });

    await expect(
      database.query(
        `SELECT task_id,phase,error_code
           FROM agent_task
          WHERE task_id LIKE 'startup-recovery-%'
          ORDER BY task_id`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          task_id: 'startup-recovery-dispatching-task',
          phase: 'failed',
          error_code: 'PROCESS_EXECUTION_LOST',
        },
        {
          task_id: 'startup-recovery-ordinary-task',
          phase: 'failed',
          error_code: 'PROCESS_EXECUTION_LOST',
        },
        {
          task_id: 'startup-recovery-receipt-task',
          phase: 'executing',
          error_code: null,
        },
      ],
    });
    await expect(
      database.query(
        `SELECT instance_id,status,completed_at
           FROM workflow_instance
          WHERE instance_id LIKE 'startup-recovery-%'
          ORDER BY instance_id`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          instance_id: 'startup-recovery-dispatching-instance',
          status: 'failed',
          completed_at: new Date('2026-08-13T03:01:00.000Z'),
        },
        {
          instance_id: 'startup-recovery-ordinary-instance',
          status: 'failed',
          completed_at: new Date('2026-08-13T03:01:00.000Z'),
        },
        {
          instance_id: 'startup-recovery-receipt-instance',
          status: 'running',
          completed_at: null,
        },
      ],
    });
    await expect(
      database.query(
        `SELECT attempt_id,status,error_code
           FROM task_execution_attempt
          WHERE attempt_id LIKE 'startup-recovery-%'
          ORDER BY attempt_id`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          attempt_id: 'startup-recovery-dispatching-attempt',
          status: 'failed',
          error_code: 'PROCESS_EXECUTION_LOST',
        },
        {
          attempt_id: 'startup-recovery-ordinary-attempt',
          status: 'failed',
          error_code: 'PROCESS_EXECUTION_LOST',
        },
        {
          attempt_id: 'startup-recovery-receipt-attempt',
          status: 'running',
          error_code: null,
        },
      ],
    });
    expect(notifications.sort()).toEqual([
      'startup-recovery-dispatching-task',
      'startup-recovery-ordinary-task',
    ]);
  });
});

function requiredPool(): Pool {
  if (pool === undefined) throw new Error('TEST_POSTGRES_POOL_NOT_INITIALIZED');
  return pool;
}

function replaceDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}

async function seedRuntimeAuthority(database: Pool): Promise<void> {
  await database.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('startup-recovery-context','startup-recovery-user',$1,$1)`,
    [observedAt],
  );
  await database.query(
    `INSERT INTO goal(
       goal_id,context_id,version,title,description,status,created_at,updated_at)
     VALUES('startup-recovery-goal','startup-recovery-context',1,
            'Startup recovery','Preserve only durable Provider receipts.',
            'active',$1,$1)`,
    [observedAt],
  );
  await database.query(
    `INSERT INTO workflow_plan(
       plan_id,goal_id,goal_version,goal_contract_json,definition_json,
       confirmation_status,attempt_count,created_at)
     VALUES('startup-recovery-plan','startup-recovery-goal',1,
            '{"goalId":"startup-recovery-goal","version":1,"title":"Startup recovery","description":"Preserve only durable Provider receipts.","constraints":[],"successCriteria":[]}'::jsonb,
            '{"workflowDefinitionId":"startup-recovery-workflow","version":1}'::jsonb,
            'confirmed',1,$1)`,
    [observedAt],
  );
  await database.query(
    `INSERT INTO mcp_server(
       server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,
       created_at,updated_at)
     VALUES('startup-recovery-provider','Startup recovery Provider',
            'http://127.0.0.1/never-called','streamable_http','enabled',1,
            'encrypted-test-only',$1,$1)`,
    [observedAt],
  );
  await database.query(
    `INSERT INTO mcp_tool(
       server_id,tool_name,input_schema_json,discovered_at)
     VALUES('startup-recovery-provider','remote_operation','{"type":"object"}'::jsonb,$1)`,
    [observedAt],
  );

  for (const kind of ['receipt', 'dispatching', 'ordinary'] as const)
    await seedInterruptedExecution(database, kind);
  await seedReceiptRecordedIntent(database);
  await seedDispatchingIntent(database);
}

async function seedInterruptedExecution(
  database: Pool,
  kind: 'receipt' | 'dispatching' | 'ordinary',
): Promise<void> {
  const taskId = `startup-recovery-${kind}-task`;
  const instanceId = `startup-recovery-${kind}-instance`;
  const attemptId = `startup-recovery-${kind}-attempt`;
  await database.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,
       goal_id,goal_version,plan_id,created_at,updated_at)
     VALUES($1,'startup-recovery-context','startup-recovery-user','Run remote work.',
            '{}'::jsonb,'executing','Provider call in progress.',
            'startup-recovery-goal',1,'startup-recovery-plan',$2,$2)`,
    [taskId, observedAt],
  );
  await database.query(
    `INSERT INTO workflow_instance(
       instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
       status,input_json,errors_json,started_at)
     VALUES($1,'startup-recovery-plan','startup-recovery-workflow',1,
            'startup-recovery-goal',1,'running','{}'::jsonb,'{}'::jsonb,$2)`,
    [instanceId, observedAt],
  );
  await database.query(
    `INSERT INTO task_execution_attempt(
       attempt_id,task_id,context_id,reason,status,created_at,started_at)
     VALUES($1,$2,'startup-recovery-context','initial','running',$3,$3)`,
    [attemptId, taskId, observedAt],
  );
}

async function seedReceiptRecordedIntent(database: Pool): Promise<void> {
  const invocationId = 'startup-recovery-receipt-invocation';
  await database.query(
    `INSERT INTO mcp_invocation(
       invocation_id,task_id,context_id,server_id,tool_name,arguments_json,result_json,
       status,started_at,completed_at,duration_ms)
     VALUES($1,'startup-recovery-receipt-task','startup-recovery-context',
            'startup-recovery-provider','remote_operation','{}'::jsonb,'{}'::jsonb,
            'succeeded',$2,$2,0)`,
    [invocationId, observedAt],
  );

  const envelope = {
    bindingId: 'startup-recovery-receipt-binding',
    serverId: 'startup-recovery-provider',
    operationName: 'remote_operation',
    agentTaskId: 'startup-recovery-receipt-task',
    contextId: 'startup-recovery-context',
    goalId: 'startup-recovery-goal',
    goalVersion: 1,
    workflowPlanId: 'startup-recovery-plan',
    workflowDefinitionId: 'startup-recovery-workflow',
    workflowDefinitionVersion: 1,
    workflowInstanceId: 'startup-recovery-receipt-instance',
    workflowNodeId: 'remote-node',
    workflowNodeRunId: 'remote-node:1',
    mcpInvocationId: invocationId,
    executionContext: { mode: 'live' },
    createdAt: observedAt,
  };
  const continuation = continuationCapsule();
  const values: unknown[] = [
    'startup-recovery-receipt-intent',
    invocationId,
    envelope.bindingId,
    envelope.agentTaskId,
    envelope.contextId,
    envelope.serverId,
    envelope.operationName,
    'a'.repeat(64),
    JSON.stringify(envelope),
    'receipt_recorded',
    `sha256:${'b'.repeat(64)}`,
    observedAt,
    invocationId,
    JSON.stringify({
      remoteTask: { remoteTaskId: 'provider-task-receipt' },
      taskCancellation: 'unknown',
      authoritySnapshot: {
        schemaVersion: '1.0',
        capturedAt: observedAt,
        runtime: {
          serverId: envelope.serverId,
          endpoint: 'http://127.0.0.1/never-called',
          serverUpdatedAt: observedAt,
          toolRevision: 1,
          protocolSnapshotId: 'startup-recovery-protocol-snapshot',
          catalogRevision: 'startup-recovery-catalog:1',
          catalogChecksum: '9'.repeat(64),
          operationCount: 1,
        },
      },
      continuation: { snapshot: continuation, completeness: 'exact_single' },
    }),
    observedAt,
    observedAt,
    observedAt,
    3,
  ];
  await database.query(
    `INSERT INTO remote_task_admission_intent(
       intent_id,invocation_id,binding_id,task_id,context_id,server_id,operation_name,
       arguments_hash,local_envelope_json,status,dispatch_hash,dispatched_at,
       recorded_invocation_id,remote_receipt_json,receipt_recorded_at,
       created_at,updated_at,version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18)`,
    values,
  );
}

async function seedDispatchingIntent(database: Pool): Promise<void> {
  const invocationId = 'startup-recovery-dispatching-invocation';
  await database.query(
    `INSERT INTO remote_task_admission_intent(
       intent_id,invocation_id,binding_id,task_id,context_id,server_id,operation_name,
       arguments_hash,local_envelope_json,status,dispatch_hash,dispatched_at,
       created_at,updated_at,version)
     VALUES('startup-recovery-dispatching-intent',$1,
            'startup-recovery-dispatching-binding','startup-recovery-dispatching-task',
            'startup-recovery-context','startup-recovery-provider','remote_operation',$2,
            $3::jsonb,'dispatching',$4,$5,$5,$5,2)`,
    [
      invocationId,
      'c'.repeat(64),
      JSON.stringify({
        bindingId: 'startup-recovery-dispatching-binding',
        workflowInstanceId: 'startup-recovery-dispatching-instance',
      }),
      `sha256:${'d'.repeat(64)}`,
      observedAt,
    ],
  );
}

function continuationCapsule() {
  return {
    schemaVersion: '1.0',
    snapshotId: 'startup-recovery-receipt-snapshot',
    continuationId: 'startup-recovery-receipt-continuation',
    stateVersion: 1,
    lifecycle: 'active',
    agentTaskId: 'startup-recovery-receipt-task',
    contextId: 'startup-recovery-context',
    workflowControlId: 'startup-recovery-control',
    goalId: 'startup-recovery-goal',
    goalVersion: 1,
    workflowPlanId: 'startup-recovery-plan',
    workflowDefinitionId: 'startup-recovery-workflow',
    workflowDefinitionVersion: 1,
    workflowDefinitionHash: 'e'.repeat(64),
    inputHash: 'f'.repeat(64),
    workflowInstanceId: 'startup-recovery-receipt-instance',
    input: {},
    waitingNodeRuns: [
      {
        waitId: 'startup-recovery-receipt-binding',
        kind: 'remote_task',
        sourceId: 'startup-recovery-receipt-binding',
        nodeId: 'remote-node',
        nodeRunId: 'remote-node:1',
        state: 'waiting',
      },
    ],
    runnableFrontier: [],
    completedNodeRunIds: [],
    nodeRunCounts: { 'remote-node': 1 },
    outputs: {},
    errors: {},
    routes: {},
    loopCounts: {},
    recoveryCounts: {},
    parallelJoinState: [],
    failed: false,
    executionContext: { mode: 'live' },
    budgetLimits: {
      maxReplans: 3,
      maxDurationSeconds: 60,
      maxLlmCalls: 10,
      maxMcpCalls: 10,
      maxCost: 100,
    },
    budgetUsage: { replanCount: 0, durationMs: 0, llmCalls: 0, mcpCalls: 1, cost: 0 },
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}
