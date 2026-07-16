import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createRemoteTaskBinding,
  createWorkflowContinuationAttempt,
  createWorkflowContinuationSnapshot,
  transitionWorkflowContinuationAttempt,
  type WorkflowContinuationSnapshot,
} from '../../domain/src/index.js';
import {
  PostgresRemoteTaskRepository,
  PostgresWorkflowContinuationRepository,
} from '../src/index.js';

const databaseName = 'sdar_v11_continuation_integration';
const adminConnection = 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseConnection = `postgresql://sdar:sdar_local_only@127.0.0.1:55432/${databaseName}`;
let pool: Pool;

beforeAll(async () => {
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
  pool = new Pool({ connectionString: databaseConnection, max: 4 });
  await pool.query(
    await readFile(
      new URL('../../../infra/postgres/init/0001_sdar_bootstrap.up.sql', import.meta.url),
      'utf8',
    ),
  );
  await applyRuntimeMigrations(pool, {
    profile: 'v1.1-isolated',
    isolationAcknowledged: true,
  });
  const applied = await pool.query<{ applied: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM schema_migration WHERE version='0102_remote_task_continuation'
     ) AS applied`,
  );
  if (applied.rows[0]?.applied !== true) await apply0102('up');
  await seedAuthority();
}, 60_000);

afterAll(async () => {
  await pool.end();
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

describe('PostgreSQL remote Task continuation authority', () => {
  it('round-trips versioned snapshots, leases controls, records attempts and fails closed on rollback', async () => {
    const remoteTasks = new PostgresRemoteTaskRepository(pool);
    const continuations = new PostgresWorkflowContinuationRepository(pool);
    await remoteTasks.admit(
      createRemoteTaskBinding({
        bindingId: 'continuation-binding',
        serverId: 'continuation-server',
        operationName: 'long_operation',
        remoteTaskId: 'provider-task-continuation-1',
        agentTaskId: 'continuation-agent-task',
        contextId: 'continuation-context',
        goalId: 'continuation-goal',
        goalVersion: 1,
        workflowPlanId: 'continuation-plan',
        workflowDefinitionId: 'continuation-workflow',
        workflowDefinitionVersion: 1,
        workflowInstanceId: 'continuation-instance',
        workflowNodeId: 'remote-node',
        workflowNodeRunId: 'remote-node:1',
        mcpInvocationId: 'continuation-invocation',
        protocolStatus: 'working',
        protocolRevision: '2026-07-28',
        tasksSchemaRevision: 'tasks-schema-revision-1',
        providerSubstate: 'running',
        remoteRevision: 'remote-revision-1',
        executionContext: { mode: 'live' },
        credentialRevision: 'credential-revision-1',
        sessionRevision: 'session-revision-1',
        lastProviderUpdatedAt: '2026-07-16T08:00:00.000Z',
        pollIntervalMs: 100,
        createdAt: '2026-07-16T08:00:00.000Z',
      }),
      'continuation-admission-observation',
    );
    await pool.query(
      `INSERT INTO remote_task_control_event (
         event_id,binding_id,event_type,remote_revision,result_hash,payload_json,
         status,created_at)
       VALUES (
         'continuation-control','continuation-binding','task.completed','remote-revision-2',
         $1,'{"status":"completed"}'::jsonb,'pending','2026-07-16T08:01:00.000Z')`,
      ['a'.repeat(64)],
    );

    const initial = continuationSnapshot();
    await continuations.saveSnapshot(initial);
    await expect(continuations.findCurrent('continuation-instance')).resolves.toEqual(initial);
    await expect(continuations.findCurrentByBinding('continuation-binding')).resolves.toEqual(
      initial,
    );
    await expect(
      pool.query<{ status: string }>(
        "SELECT status FROM workflow_instance WHERE instance_id='continuation-instance'",
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'waiting_external' }] });

    const inbox = await continuations.listInbox('2026-07-16T08:01:01.000Z', 10);
    expect(inbox).toEqual([
      expect.objectContaining({
        eventId: 'continuation-control',
        status: 'pending',
      }),
    ]);

    const firstClaim = await continuations.claimControl({
      eventId: 'continuation-control',
      claimToken: 'continuation-claim-1',
      claimedAt: '2026-07-16T08:01:01.000Z',
      expiresAt: '2026-07-16T08:01:11.000Z',
    });
    expect(firstClaim).toMatchObject({ eventId: 'continuation-control', status: 'claimed' });
    const abandonedAttempt = createWorkflowContinuationAttempt({
      attemptId: 'continuation-attempt-1',
      eventId: 'continuation-control',
      snapshotId: initial.snapshotId,
      continuationId: initial.continuationId,
      workflowInstanceId: initial.workflowInstanceId,
      snapshotStateVersion: initial.stateVersion,
      claimToken: 'continuation-claim-1',
      status: 'claimed',
      createdAt: '2026-07-16T08:01:01.000Z',
    });
    await continuations.saveAttempt(abandonedAttempt);
    await expect(
      continuations.claimControl({
        eventId: 'continuation-control',
        claimToken: 'continuation-claim-collision',
        claimedAt: '2026-07-16T08:01:02.000Z',
        expiresAt: '2026-07-16T08:01:12.000Z',
      }),
    ).resolves.toBeUndefined();

    const reclaimed = await continuations.claimControl({
      eventId: 'continuation-control',
      claimToken: 'continuation-claim-2',
      claimedAt: '2026-07-16T08:01:12.000Z',
      expiresAt: '2026-07-16T08:01:22.000Z',
    });
    expect(reclaimed).toMatchObject({ eventId: 'continuation-control', status: 'claimed' });
    const staleAttempt = transitionWorkflowContinuationAttempt(
      abandonedAttempt,
      'stale',
      '2026-07-16T08:01:12.000Z',
    );
    await continuations.updateAttempt(staleAttempt, 'claimed');
    await expect(
      pool.query<{ continuation_claim_attempt: number }>(
        "SELECT continuation_claim_attempt FROM remote_task_control_event WHERE event_id='continuation-control'",
      ),
    ).resolves.toMatchObject({ rows: [{ continuation_claim_attempt: 2 }] });

    const claimedAttempt = createWorkflowContinuationAttempt({
      attemptId: 'continuation-attempt-2',
      eventId: 'continuation-control',
      snapshotId: initial.snapshotId,
      continuationId: initial.continuationId,
      workflowInstanceId: initial.workflowInstanceId,
      snapshotStateVersion: initial.stateVersion,
      claimToken: 'continuation-claim-2',
      status: 'claimed',
      createdAt: '2026-07-16T08:01:12.000Z',
    });
    await continuations.saveAttempt(claimedAttempt);
    const runningAttempt = transitionWorkflowContinuationAttempt(
      claimedAttempt,
      'running',
      '2026-07-16T08:01:13.000Z',
    );
    await expect(continuations.updateAttempt(runningAttempt, 'claimed')).resolves.toBeUndefined();
    const waitingAttempt = transitionWorkflowContinuationAttempt(
      runningAttempt,
      'waiting_external',
      '2026-07-16T08:01:14.000Z',
    );
    await expect(continuations.updateAttempt(waitingAttempt, 'running')).resolves.toBeUndefined();
    await expect(continuations.listAttempts(initial.workflowInstanceId)).resolves.toEqual([
      staleAttempt,
      waitingAttempt,
    ]);
    await expect(
      pool.query<{ indexed: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM workflow_continuation_attempt
           WHERE status IN ('claimed','running') AND attempt_id='continuation-attempt-2'
         ) AS indexed`,
      ),
    ).resolves.toMatchObject({ rows: [{ indexed: false }] });
    await expect(
      continuations.finishControl({
        eventId: 'continuation-control',
        claimToken: 'continuation-claim-2',
        status: 'processed',
        processedAt: '2026-07-16T08:01:14.000Z',
      }),
    ).resolves.toBeUndefined();

    const successor = createWorkflowContinuationSnapshot({
      ...initial,
      snapshotId: 'continuation-snapshot-2',
      stateVersion: 2,
      predecessorSnapshotId: initial.snapshotId,
      waitingNodeRuns: [
        {
          waitId: 'continuation-child-wait-1',
          kind: 'child_workflow',
          sourceId: 'continuation-child-instance',
          nodeId: 'child-skill-node',
          nodeRunId: 'child-skill-node:1',
          state: 'waiting',
        },
      ],
      completedNodeRunIds: ['remote-node:1'],
      nodeRunCounts: { 'remote-node': 1, 'child-skill-node': 1 },
      outputs: { 'remote-node': { accepted: true } },
      lifecycle: 'active',
      updatedAt: '2026-07-16T08:01:15.000Z',
    });
    await continuations.saveSnapshot(successor);
    await expect(continuations.findCurrent('continuation-instance')).resolves.toEqual(successor);
    await expect(continuations.findById(initial.snapshotId)).resolves.toMatchObject({
      lifecycle: 'superseded',
    });
    await pool.query(
      `INSERT INTO skill_call_workflow(
         call_id,parent_plan_id,parent_instance_id,parent_node_id,child_instance_id,child_plan_id,
         skill_id,skill_version,confirmation_status,status,evaluation_summary,created_at)
       VALUES(
         'continuation-child-call','continuation-plan','continuation-instance','child-skill-node',
         'continuation-child-instance','continuation-child-plan','continuation-child-skill',1,
         'confirmed','waiting_external','Child Workflow is waiting for external work.',
         '2026-07-16T08:01:15.000Z')`,
    );

    await expect(apply0102('down')).rejects.toThrow(
      '0102 rollback refused: remote Task continuation evidence or waiting execution exists',
    );
    await pool.query('DELETE FROM workflow_continuation_attempt');
    await pool.query('DELETE FROM workflow_continuation_wait_binding');
    await pool.query('DELETE FROM workflow_continuation_snapshot');
    await pool.query("DELETE FROM remote_task_control_event WHERE event_id='continuation-control'");
    await pool.query(
      "UPDATE workflow_instance SET status='running' WHERE instance_id='continuation-instance'",
    );
    await expect(apply0102('down')).rejects.toThrow(
      '0102 rollback refused: remote Task continuation evidence or waiting execution exists',
    );
    await pool.query("DELETE FROM skill_call_workflow WHERE call_id='continuation-child-call'");
    await apply0102('down');
    await expect(
      pool.query<{ exists: boolean }>(
        "SELECT to_regclass('public.workflow_continuation_snapshot') IS NOT NULL AS exists",
      ),
    ).resolves.toMatchObject({ rows: [{ exists: false }] });
    await apply0102('up');
  });
});

function continuationSnapshot(): WorkflowContinuationSnapshot {
  return createWorkflowContinuationSnapshot({
    schemaVersion: '1.0',
    snapshotId: 'continuation-snapshot-1',
    continuationId: 'continuation-1',
    stateVersion: 1,
    lifecycle: 'active',
    agentTaskId: 'continuation-agent-task',
    contextId: 'continuation-context',
    workflowControlId: 'continuation-control-root',
    goalId: 'continuation-goal',
    goalVersion: 1,
    workflowPlanId: 'continuation-plan',
    workflowDefinitionId: 'continuation-workflow',
    workflowDefinitionVersion: 1,
    workflowDefinitionHash: 'b'.repeat(64),
    inputHash: 'c'.repeat(64),
    workflowInstanceId: 'continuation-instance',
    input: { request: 'continue' },
    waitingNodeRuns: [
      {
        waitId: 'continuation-wait-1',
        kind: 'remote_task',
        sourceId: 'continuation-binding',
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
      maxReplans: 2,
      maxDurationSeconds: 60,
      maxLlmCalls: 4,
      maxMcpCalls: 4,
      maxCost: 1,
    },
    budgetUsage: { replanCount: 0, durationMs: 100, llmCalls: 0, mcpCalls: 1, cost: 0 },
    createdAt: '2026-07-16T08:00:00.000Z',
    updatedAt: '2026-07-16T08:00:00.000Z',
  });
}

async function seedAuthority(): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('continuation-context','continuation-user','2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO goal(goal_id,context_id,version,title,description,status,created_at,updated_at)
     VALUES('continuation-goal','continuation-context',1,'Continuation Goal',
            'Remote Task continuation integration','active',
            '2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_plan(
       plan_id,goal_id,goal_version,goal_contract_json,definition_json,
       confirmation_status,attempt_count,created_at)
     VALUES('continuation-plan','continuation-goal',1,
            '{"goalId":"continuation-goal","version":1,"title":"Continuation Goal","description":"Remote Task continuation integration","constraints":[],"successCriteria":[]}'::jsonb,
            '{"workflowDefinitionId":"continuation-workflow","version":1}'::jsonb,
            'confirmed',1,'2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_plan_attempt(
       plan_id,attempt,goal_contract_json,candidate_json,validation_errors_json,valid,created_at)
     VALUES('continuation-plan',1,
            '{"goalId":"continuation-goal","version":1,"title":"Continuation Goal","description":"Remote Task continuation integration","constraints":[],"successCriteria":[]}'::jsonb,
            '{}'::jsonb,'[]'::jsonb,true,'2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_plan(
       plan_id,goal_id,goal_version,goal_contract_json,definition_json,
       confirmation_status,attempt_count,created_at)
     VALUES('continuation-child-plan','continuation-goal',1,
            '{"goalId":"continuation-goal","version":1,"title":"Continuation Goal","description":"Remote Task continuation integration","constraints":[],"successCriteria":[]}'::jsonb,
            '{"workflowDefinitionId":"continuation-child-workflow","version":1}'::jsonb,
            'confirmed',1,'2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,
       goal_id,goal_version,plan_id,created_at,updated_at)
     VALUES('continuation-agent-task','continuation-context','continuation-user',
            'Run remote continuation','{}'::jsonb,'executing','Remote operation accepted',
            'continuation-goal',1,'continuation-plan',
            '2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_instance(
       instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
       status,input_json,errors_json,started_at)
     VALUES('continuation-instance','continuation-plan','continuation-workflow',1,
            'continuation-goal',1,'running','{}'::jsonb,'{}'::jsonb,
            '2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_instance(
       instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
       status,input_json,errors_json,started_at)
     VALUES('continuation-child-instance','continuation-child-plan',
            'continuation-child-workflow',1,'continuation-goal',1,'running',
            '{}'::jsonb,'{}'::jsonb,'2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO skill(skill_id,current_version,created_at,updated_at)
     VALUES('continuation-child-skill',1,
            '2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO skill_version(
       skill_id,version,name,summary,description,capabilities_json,workflow_guidance,
       output_instruction,input_schema_json,output_schema_json,tool_policy_json,
       runtime_policy_json,status,source_kind,validation_passed,created_at)
     VALUES('continuation-child-skill',1,'Continuation Child','Child Skill','Child Skill',
            '[]'::jsonb,'Run child Workflow.','Return child result.','{"type":"object"}'::jsonb,
            '{"type":"object"}'::jsonb,
            '{"required":[],"optional":[],"forbidden":[]}'::jsonb,
            '{"autoConfirmPlan":true}'::jsonb,'enabled','admin',true,
            '2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_control(
       control_id,context_id,goal_id,goal_version,task_id,status,current_plan_id,input_json,
       skill_ids_json,planning_instruction,round_count,replan_count,created_at,updated_at)
     VALUES('continuation-control-root','continuation-context','continuation-goal',1,
            'continuation-agent-task','running','continuation-plan','{}'::jsonb,'[]'::jsonb,
            'Run the immutable continuation fixture.',0,0,
            '2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO mcp_server(
       server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,
       created_at,updated_at)
     VALUES('continuation-server','Continuation Provider','http://127.0.0.1:1',
            'streamable_http','enabled',1,'encrypted-test-value',
            '2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO mcp_invocation(
       invocation_id,task_id,context_id,server_id,tool_name,arguments_json,result_json,
       status,started_at,completed_at,duration_ms,execution_mode,simulation_id)
     VALUES('continuation-invocation','continuation-agent-task','continuation-context',
            'continuation-server','long_operation','{}'::jsonb,'{"kind":"remote_task"}'::jsonb,
            'succeeded','2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.001Z',1,
            'live',NULL)`,
  );
}

async function apply0102(direction: 'up' | 'down'): Promise<void> {
  await pool.query(
    await readFile(
      new URL(
        `../../../infra/postgres/migrations/0102_remote_task_continuation.${direction}.sql`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
}
