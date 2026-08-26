import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import type {
  RemoteTaskAdmissionIntent,
  RemoteTaskAdmissionReceipt,
} from '../../application/src/index.js';
import type { McpInvocation, RemoteTaskSnapshot } from '../../domain/src/index.js';
import {
  PostgresRemoteTaskAdmissionIntentStore,
  PostgresRemoteTaskRepository,
} from '../src/index.js';

// Run Controller only: an explicitly leased development PostgreSQL instance, no implicit localhost.
const databaseName = 'sdar_wi070_binding_authority_integration';
const at = '2026-08-26T08:00:00.000Z';
const identity = {
  profileVersion: '1.0' as const,
  providerId: 'provider-wi070',
  providerInstanceId: 'instance-not-server-wi070',
};
let pool: Pool;
let created = false;

function adminUrl(): string {
  const url = process.env['SDAR_TEST_POSTGRES_URL'];
  if (url === undefined) throw new Error('WI070_EXPLICIT_LEASED_POSTGRES_URL_REQUIRED');
  return url;
}

beforeAll(async () => {
  const admin = new Pool({ connectionString: adminUrl() });
  try {
    // Do not delete a pre-existing database. A collision requires the environment owner to decide.
    await admin.query(`CREATE DATABASE ${databaseName} TEMPLATE template0`);
    created = true;
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl());
  url.pathname = `/${databaseName}`;
  pool = new Pool({ connectionString: url.toString(), max: 3 });
  await applyRuntimeMigrations(pool);
  await seed();
}, 60_000);

afterAll(async () => {
  if (created) await pool.end();
  if (!created) return;
  const admin = new Pool({ connectionString: adminUrl() });
  try {
    await admin.query(`DROP DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
});

describe('WI070 actual PostgreSQL binding authority', () => {
  it('uses the same revision classifier through claimed polls, including duplicate and terminal snapshots', async () => {
    const store = new PostgresRemoteTaskAdmissionIntentStore(pool);
    const repository = new PostgresRemoteTaskRepository(pool);
    const item = intent('poll');
    const response = receipt('poll');
    await store.prepare(item);
    await store.markDispatching({
      intentId: item.intentId,
      invocationId: item.invocationId,
      dispatchHash: `sha256:${'d'.repeat(64)}`,
      authoritySnapshot: response.authoritySnapshot,
      at,
    });
    await store.recordRemoteReceiptAndInvocation(item.intentId, invocation('poll'), response, at);
    const working: RemoteTaskSnapshot = {
      ...response.remoteTask,
      status: 'working',
      runtimeRevision: '9007199254740994',
    };
    const completed: RemoteTaskSnapshot = {
      ...working,
      status: 'completed',
      runtimeRevision: '9007199254740995',
      result: { content: [], isError: false },
    };
    for (const [index, snapshot] of [working, working, completed].entries()) {
      const current = await repository.findById(item.envelope.bindingId);
      if (current === undefined) throw new Error('WI070_BINDING_REQUIRED');
      const observedAt = new Date(Date.parse(at) + (index + 1) * 1000).toISOString();
      const claimToken = `poll-claim-${String(index)}`;
      const claim = await repository.claimPoll({
        bindingId: current.bindingId,
        expectedVersion: current.version,
        claimToken,
        claimedAt: observedAt,
        expiresAt: new Date(Date.parse(observedAt) + 1000).toISOString(),
      });
      if (!claim.claimed) throw new Error(`WI070_POLL_CLAIM_${claim.reason}`);
      const result = await repository.recordSnapshot({
        bindingId: current.bindingId,
        expectedVersion: claim.binding.version,
        claimToken,
        snapshot,
        observationId: `poll-observation-${String(index)}`,
        observedAt,
        ...(snapshot.status === 'working'
          ? { nextPollAt: new Date(Date.parse(observedAt) + 100).toISOString() }
          : { controlEventId: 'poll-completed', resultHash: 'b'.repeat(64) }),
        protocolAttempt: {
          attemptId: `poll-attempt-${String(index)}`,
          bindingId: current.bindingId,
          method: 'tasks/get',
          expectedBindingVersion: claim.binding.version,
          protocolRevision: snapshot.protocolRevision,
          status: 'succeeded',
          startedAt: observedAt,
          completedAt: observedAt,
          durationMs: 0,
        },
      });
      expect(result).toMatchObject({
        applied: true,
        snapshotAccepted: index !== 1,
        binding: { version: 3 + 2 * index },
      });
    }
    expect(await repository.findById(item.envelope.bindingId)).toMatchObject({
      protocolStatus: 'completed',
      runtimeRevision: '9007199254740995',
      version: 7,
    });
  });

  it('rolls back invocation, binding and observation if accepting the receipt fails', async () => {
    const store = new PostgresRemoteTaskAdmissionIntentStore(pool);
    const item = intent('rollback');
    await store.prepare(item);
    await store.markDispatching({
      intentId: item.intentId,
      invocationId: item.invocationId,
      dispatchHash: `sha256:${'d'.repeat(64)}`,
      authoritySnapshot: receipt('rollback').authoritySnapshot,
      at,
    });
    await pool.query(`CREATE FUNCTION wi070_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.intent_id='wi070-intent-rollback' AND NEW.status='receipt_recorded' THEN
        RAISE EXCEPTION 'WI070_INJECTED_RECEIPT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER wi070_reject_receipt BEFORE UPDATE ON remote_task_admission_intent
        FOR EACH ROW EXECUTE FUNCTION wi070_reject_receipt()`);
    try {
      await expect(
        store.recordRemoteReceiptAndInvocation(
          item.intentId,
          invocation('rollback'),
          receipt('rollback'),
          at,
        ),
      ).rejects.toThrow('WI070_INJECTED_RECEIPT_FAILURE');
      for (const [table, column, id] of [
        ['mcp_invocation', 'invocation_id', item.invocationId],
        ['remote_task_binding', 'binding_id', item.envelope.bindingId],
        ['remote_task_observation', 'binding_id', item.envelope.bindingId],
      ] as const) {
        const result = await pool.query(
          `SELECT count(*)::int AS count FROM ${table} WHERE ${column}=$1`,
          [id],
        );
        expect(result.rows).toEqual([{ count: 0 }]);
      }
      expect((await store.findByBindingId(item.envelope.bindingId))?.status).toBe('dispatching');
    } finally {
      await pool.query(
        'DROP TRIGGER wi070_reject_receipt ON remote_task_admission_intent; DROP FUNCTION wi070_reject_receipt()',
      );
    }
  });

  it('commits all 20 fields atomically and preserves exact identity and revision semantics after restart', async () => {
    const store = new PostgresRemoteTaskAdmissionIntentStore(pool);
    const item = intent('accepted');
    const response = receipt('accepted');
    await store.prepare(item);
    await store.markDispatching({
      intentId: item.intentId,
      invocationId: item.invocationId,
      dispatchHash: `sha256:${'d'.repeat(64)}`,
      authoritySnapshot: response.authoritySnapshot,
      at,
    });
    expect(
      (
        await store.recordRemoteReceiptAndInvocation(
          item.intentId,
          invocation('accepted'),
          response,
          at,
        )
      ).applied,
    ).toBe(true);
    const row = (
      await pool.query<Record<string, unknown>>(
        `SELECT tenant_id,project_id,environment,binding_id,episode_id,sdar_task_id,
      sdar_invocation_id,a2a_task_id,remote_task_id,provider_origin_type,provider_origin_source_id,
      external_provider_id,external_provider_instance_id,external_server_id,registry_revision,registry_checksum,
      binding_revision,protocol_status,created_at,updated_at FROM remote_task_binding WHERE binding_id=$1`,
        [item.envelope.bindingId],
      )
    ).rows[0];
    if (row === undefined) throw new Error('WI070_CANONICAL_ROW_REQUIRED');
    expect(Object.keys(row)).toHaveLength(20);
    expect(Object.values(row).every((value) => value !== null && value !== '')).toBe(true);
    expect(row).toMatchObject({
      tenant_id: 'tenant-wi070',
      project_id: 'project-wi070',
      environment: 'development',
      episode_id: 'wi070-task',
      sdar_task_id: 'wi070-task',
      a2a_task_id: 'wi070-task',
      external_provider_id: identity.providerId,
      external_provider_instance_id: identity.providerInstanceId,
      external_server_id: 'external-server-wi070',
      registry_revision: '7',
      registry_checksum: 'a'.repeat(64),
      binding_revision: '1',
    });
    expect(
      (
        await pool.query(
          `SELECT intent.accepted_binding_id,binding.mcp_invocation_id FROM remote_task_admission_intent intent
      JOIN remote_task_binding binding ON binding.binding_id=intent.accepted_binding_id
      JOIN mcp_invocation invocation ON invocation.invocation_id=binding.mcp_invocation_id WHERE intent.intent_id=$1`,
          [item.intentId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await store.recordRemoteReceiptAndInvocation(
          item.intentId,
          invocation('accepted'),
          response,
          at,
        )
      ).applied,
    ).toBe(true);
    expect(
      await store.recordRemoteReceiptAndInvocation(
        item.intentId,
        invocation('accepted'),
        {
          ...response,
          remoteTask: {
            ...response.remoteTask,
            providerIdentity: { ...identity, providerInstanceId: 'conflicting-instance' },
          },
        },
        at,
      ),
    ).toMatchObject({ applied: false, reason: 'conflict' });

    const repository = new PostgresRemoteTaskRepository(pool);
    let binding = await repository.findById(item.envelope.bindingId);
    if (binding === undefined) throw new Error('WI070_BINDING_REQUIRED');
    const snapshot: RemoteTaskSnapshot = { ...response.remoteTask, status: 'working' };
    let sequence = 0;
    const observe = async (value: RemoteTaskSnapshot) => {
      const current = await repository.findById(item.envelope.bindingId);
      if (current === undefined) throw new Error('WI070_BINDING_REQUIRED');
      const id = `wi070-observation-${String(++sequence)}`;
      return repository.recordExternalSnapshot({
        bindingId: current.bindingId,
        expectedVersion: current.version,
        snapshot: value,
        observationId: id,
        source: 'reconciliation',
        observedAt: at,
        ...(value.status === 'working'
          ? {}
          : { controlEventId: `${id}-control`, resultHash: 'b'.repeat(64) }),
      });
    };
    expect(await observe(snapshot)).toMatchObject({ applied: true, snapshotAccepted: true });
    expect(await observe(snapshot)).toMatchObject({
      applied: true,
      snapshotAccepted: false,
      binding: { version: 2 },
    });
    const next = {
      ...snapshot,
      runtimeRevision: '9007199254740994',
      lastUpdatedAt: '2026-08-26T07:59:59.000Z',
    };
    expect(await observe(next)).toMatchObject({
      applied: true,
      snapshotAccepted: true,
      binding: { version: 3 },
    });
    expect(await observe({ ...snapshot, lastUpdatedAt: '2099-01-01T00:00:00.000Z' })).toMatchObject(
      { snapshotAccepted: false, binding: { version: 3 } },
    );
    expect(await observe({ ...next, statusMessage: 'same-revision-conflict' })).toMatchObject({
      snapshotAccepted: false,
      binding: { version: 3 },
    });
    expect(
      await observe({ ...next, providerIdentity: { ...identity, providerInstanceId: 'changed' } }),
    ).toMatchObject({ snapshotAccepted: false, binding: { version: 3 } });
    const terminal: RemoteTaskSnapshot = {
      ...next,
      status: 'completed',
      runtimeRevision: '9007199254740995',
      result: { content: [], isError: false },
    };
    expect(await observe(terminal)).toMatchObject({
      snapshotAccepted: true,
      binding: { version: 4 },
    });
    expect(await observe(terminal)).toMatchObject({
      snapshotAccepted: false,
      binding: { version: 4 },
    });
    expect(await observe({ ...next, runtimeRevision: '9007199254740996' })).toMatchObject({
      snapshotAccepted: false,
      binding: { version: 4 },
    });
    expect(
      (await repository.listObservations(item.envelope.bindingId))
        .filter((value) => !value.accepted)
        .map((value) => value.rejectionReason),
    ).toEqual([
      'stale_provider_revision',
      'revision_content_conflict',
      'identity_conflict',
      'terminal_conflict',
    ]);
    expect(
      (await repository.listObservations(item.envelope.bindingId)).filter(
        (value) => value.accepted,
      ),
    ).toHaveLength(4);
    await expect(
      pool.query(
        `UPDATE remote_task_binding SET binding_authority_json=jsonb_set(binding_authority_json,'{registryRevision}','"8"'),version=version+1 WHERE binding_id=$1`,
        [item.envelope.bindingId],
      ),
    ).rejects.toThrow('REMOTE_TASK_IMMUTABLE_AUTHORITY_CONFLICT');
    await expect(
      pool.query(
        `UPDATE remote_task_admission_intent SET dispatch_authority_snapshot_json='{}'::jsonb WHERE intent_id=$1`,
        [item.intentId],
      ),
    ).rejects.toThrow('REMOTE_TASK_DISPATCH_AUTHORITY_CONFLICT');
    binding = await new PostgresRemoteTaskRepository(pool).findById(item.envelope.bindingId);
    expect(binding).toMatchObject({
      version: 4,
      runtimeRevision: '9007199254740995',
      providerRevision: 'adapter:opaque',
      bindingAuthority: {
        registryRevision: '7',
        externalProviderInstanceId: identity.providerInstanceId,
      },
    });
  });
});

function intent(suffix: string): RemoteTaskAdmissionIntent {
  const invocationId = `wi070-invocation-${suffix}`;
  return {
    intentId: `wi070-intent-${suffix}`,
    invocationId,
    taskId: 'wi070-task',
    contextId: 'wi070-context',
    serverId: 'wi070-server',
    operationName: 'operation',
    argumentsHash: 'b'.repeat(64),
    envelope: {
      bindingId: `wi070-binding-${suffix}`,
      serverId: 'wi070-server',
      operationName: 'operation',
      agentTaskId: 'wi070-task',
      contextId: 'wi070-context',
      goalId: 'wi070-goal',
      goalVersion: 1,
      workflowPlanId: 'wi070-plan',
      workflowDefinitionId: 'wi070-workflow',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'wi070-instance',
      workflowNodeId: 'operation',
      workflowNodeRunId: `operation-${suffix}`,
      mcpInvocationId: invocationId,
      executionContext: { mode: 'live' },
      createdAt: at,
    },
    status: 'prepared',
    createdAt: at,
    updatedAt: at,
    version: 1,
  };
}

function receipt(suffix: string): RemoteTaskAdmissionReceipt {
  return {
    remoteTask: {
      protocolMode: 'frozen_v1',
      remoteTaskId: `wi070-remote-${suffix}`,
      providerIdentity: identity,
      status: 'working',
      createdAt: at,
      lastUpdatedAt: at,
      ttlMs: null,
      pollIntervalMs: 100,
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'frozen-1.0',
      runtimeRevision: '9007199254740993',
      providerRevision: 'adapter:opaque',
      providerObservation: { revision: '1.0', eventId: 'same-provider-event', observedAt: at },
    },
    credentialRevision: at,
    sessionRevision: '2026-07-28/frozen-1.0',
    protocolContract: {
      mode: 'frozen_v1',
      protocolVersion: '2026-07-28',
      baselineSha256: 'd'.repeat(64),
      serverDiscoverySnapshotId: 'wi070-discovery',
    },
    taskBehavior: 'task_required',
    taskCancellation: 'task_cancel',
    authoritySnapshot: {
      schemaVersion: '1.0',
      capturedAt: at,
      runtime: {
        serverId: 'wi070-server',
        endpoint: 'http://127.0.0.1/never-called',
        serverUpdatedAt: at,
        toolRevision: 2,
        protocolSnapshotId: 'wi070-discovery',
        catalogRevision: 'catalog:2',
        catalogChecksum: 'c'.repeat(64),
        operationCount: 1,
      },
      providerBinding: {
        bindingId: 'wi070-provider-binding',
        revision: 4,
        originType: 'smpp_registry',
        providerId: identity.providerId,
        externalServerId: 'external-server-wi070',
        smppSourceId: 'source-wi070',
        endpointRef: 'http://127.0.0.1/never-called',
        catalogRevision: 'catalog:2',
        catalogChecksum: 'c'.repeat(64),
        operationCount: 1,
        availabilityValidUntil: '2026-08-26T09:00:00.000Z',
        observedAt: at,
        registry: {
          externalProviderId: identity.providerId,
          revision: '7',
          checksum: 'a'.repeat(64),
        },
        scope: { tenantId: 'tenant-wi070', projectId: 'project-wi070', environment: 'development' },
      },
    },
    continuation: {
      completeness: 'exact_single',
      snapshot: {
        schemaVersion: '1.0',
        snapshotId: `wi070-snapshot-${suffix}`,
        continuationId: `wi070-continuation-${suffix}`,
        stateVersion: 1,
        lifecycle: 'active',
        agentTaskId: 'wi070-task',
        contextId: 'wi070-context',
        workflowControlId: 'wi070-control',
        goalId: 'wi070-goal',
        goalVersion: 1,
        workflowPlanId: 'wi070-plan',
        workflowDefinitionId: 'wi070-workflow',
        workflowDefinitionVersion: 1,
        workflowDefinitionHash: 'b'.repeat(64),
        inputHash: 'b'.repeat(64),
        workflowInstanceId: 'wi070-instance',
        input: {},
        waitingNodeRuns: [
          {
            waitId: `wi070-binding-${suffix}`,
            kind: 'remote_task',
            sourceId: `wi070-binding-${suffix}`,
            nodeId: 'operation',
            nodeRunId: `operation-${suffix}`,
            state: 'waiting',
          },
        ],
        runnableFrontier: [],
        completedNodeRunIds: [],
        nodeRunCounts: { operation: 1 },
        outputs: {},
        errors: {},
        routes: { operation: '__end__' },
        loopCounts: {},
        recoveryCounts: {},
        parallelJoinState: [],
        failed: false,
        executionContext: { mode: 'live' },
        budgetLimits: {
          maxReplans: 1,
          maxDurationSeconds: 60,
          maxLlmCalls: 1,
          maxMcpCalls: 2,
          maxCost: 1,
        },
        budgetUsage: { replanCount: 0, durationMs: 0, llmCalls: 0, mcpCalls: 1, cost: 0 },
        createdAt: at,
        updatedAt: at,
      },
    },
  };
}

function invocation(suffix: string): McpInvocation {
  return {
    invocationId: intent(suffix).invocationId,
    taskId: 'wi070-task',
    contextId: 'wi070-context',
    serverId: 'wi070-server',
    toolName: 'operation',
    executionMode: 'live',
    executionSemantics: {
      effect: 'side_effecting',
      execution: 'task_required',
      cancellation: 'task_cancel',
      idempotency: 'server_managed',
      replay: 'simulation_only',
      source: 'mcp_declared',
    },
    arguments: {},
    result: { remoteTask: receipt(suffix).remoteTask },
    status: 'succeeded',
    startedAt: at,
    completedAt: at,
    durationMs: 0,
  };
}

async function seed() {
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at) VALUES('wi070-context','wi070-user',$1,$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO goal(goal_id,context_id,version,title,description,status,created_at,updated_at)
    VALUES('wi070-goal','wi070-context',1,'WI070','Development authority test','active',$1,$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO workflow_plan(plan_id,goal_id,goal_version,goal_contract_json,definition_json,confirmation_status,attempt_count,created_at)
    VALUES('wi070-plan','wi070-goal',1,'{}','{}','confirmed',1,$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO agent_task(task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,goal_id,goal_version,plan_id,created_at,updated_at)
    VALUES('wi070-task','wi070-context','wi070-user','No external calls','{}','executing','Testing','wi070-goal',1,'wi070-plan',$1,$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO workflow_instance(instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,status,input_json,errors_json,started_at)
    VALUES('wi070-instance','wi070-plan','wi070-workflow',1,'wi070-goal',1,'running','{}','{}',$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO mcp_server(server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,created_at,updated_at)
    VALUES('wi070-server','WI070','http://127.0.0.1/never-called','streamable_http','enabled',2,'fixture-only',$1,$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO mcp_tool(server_id,tool_name,input_schema_json,discovered_at) VALUES('wi070-server','operation','{"type":"object"}',$1)`,
    [at],
  );
}
