import { verifyGowmConsumerSyncCases } from './gowm-consumer-sync.postgres-cases.js';
import { verifyGowmContinuationCases } from './gowm-continuation.postgres-cases.js';
import { verifyGowmInputCases } from './gowm-input.postgres-cases.js';
import { verifyGowmCancellationCases } from './gowm-cancellation.postgres-cases.js';
import { verifyGowmAdmissionCases } from './gowm-admission.postgres-cases.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { GoalExecutionContract } from '../../domain/src/goal.js';
import type { McpInvocation } from '../../domain/src/mcp.js';
import { createRemoteTaskBinding } from '../../domain/src/remote-task.js';
import {
  PostgresMcpRegistryRepository,
  PostgresWorkflowPlanRepository,
  PostgresWorkflowExecutionRepository,
} from '../src/repositories.js';
import { PostgresRemoteTaskRepository } from '../src/remote-task-repository.js';

/** Synthetic peer is a different database role; consumer has no SMPP DML. */
export async function verifyGowmRemoteCases(
  pool: Pool,
  peer: Pool,
  scope: DeviceWorkScope,
  run: string,
  goal: GoalExecutionContract,
): Promise<string[]> {
  assert.equal(
    (await pool.query<{ role: string }>('SELECT current_user role')).rows[0]?.role,
    'sdar_gowm_consumer_test',
  );
  assert.equal(
    (await peer.query<{ role: string }>('SELECT current_user role')).rows[0]?.role,
    'sdar_gowm_peer_test',
  );
  assert.equal(
    (
      await pool.query<{ allowed: boolean }>(
        "SELECT has_table_privilege(current_user,'ugv_smpp.provider_task','INSERT,UPDATE,DELETE') allowed",
      )
    ).rows[0]?.allowed,
    false,
  );
  await assert.rejects(
    pool.query('UPDATE ugv_smpp.provider_task SET updated_at=updated_at WHERE false'),
    /permission denied/u,
  );
  const timestamp = new Date().toISOString();
  const serverId = `${run}-synthetic-server`;
  const snapshotId = `${run}-protocol`;
  const semantics = {
    effect: 'side_effecting',
    execution: 'task_required',
    cancellation: 'task_cancel',
    idempotency: 'client_request_key',
    replay: 'simulation_only',
    source: 'mcp_declared',
  } as const;
  const schema = {
    type: 'object',
    properties: { target: { type: 'object' }, frame: { type: 'string' } },
    required: ['target', 'frame'],
    additionalProperties: false,
    'x-sdar-targets': [
      { argumentPath: '/target', purpose: 'move', format: 'xy', crsPath: '/frame' },
    ],
  };
  const mcp = new PostgresMcpRegistryRepository(pool, scope);
  await assert.rejects(
    new PostgresMcpRegistryRepository(pool, {
      ...scope,
      allowedDeviceIds: [],
      includeNonDevice: true,
    }).assertTaskBindingForInvocation(undefined, serverId, {}),
    /MCP_NONDEVICE_SERVER_BINDING_FORBIDDEN/u,
  );
  await mcp.saveServerAndReplaceTools(
    {
      server: {
        serverId,
        name: 'synthetic peer directory endpoint',
        endpoint: 'http://127.0.0.1:1/mcp',
        transport: 'streamable_http',
        status: 'enabled',
        toolRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      encryptedCredential: 'fixture-no-network',
    },
    [
      {
        serverId,
        toolName: 'move',
        inputSchema: schema,
        outputSchema: { type: 'boolean' },
        executionSemantics: semantics,
        declaredExecutionSemantics: semantics,
        discoveredAt: timestamp,
      },
    ],
  );
  await mcp.saveProtocolSnapshot({
    snapshotId,
    serverId,
    protocolMode: 'frozen_v1',
    protocolVersion: '2026-07-28',
    baselineSha256: 'a'.repeat(64),
    supportedVersions: ['2026-07-28'],
    capabilities: {},
    serverInfo: { name: 'synthetic peer', version: '1' },
    taskNotifications: true,
    discoveredAt: timestamp,
    toolRevision: 1,
  });
  const plans = new PostgresWorkflowPlanRepository(pool, undefined, scope);
  const instances = new PostgresWorkflowExecutionRepository(pool, undefined, scope);
  const remote = new PostgresRemoteTaskRepository(pool, scope);
  for (const index of [0, 1]) {
    const planId = `${run}-remote-plan-${String(index)}`;
    await plans.savePlan({
      planId,
      executionTaskId: `${run}-task-${String(index)}`,
      goalId: goal.goalId,
      goalVersion: goal.version,
      goalContract: goal,
      confirmationStatus: 'awaiting_confirmation',
      attemptCount: 1,
      createdAt: timestamp,
      definition: {
        executionSemanticsVersion: '2.0',
        workflowDefinitionId: planId,
        version: 1,
        goalId: goal.goalId,
        goalVersion: goal.version,
        entryNodeId: 'move',
        exitNodeIds: ['done'],
        nodes: [
          {
            nodeId: 'move',
            name: 'move',
            type: 'mcp_tool',
            tool: { serverId, toolName: 'move' },
            arguments: { target: { x: 1, y: 2 }, frame: 'EPSG:4326' },
          },
          { nodeId: 'done', name: 'done', type: 'result', value: { op: 'literal', value: true } },
        ],
        edges: [{ sourceNodeId: 'move', targetNodeId: 'done' }],
      },
    });
    await instances.saveInstance({
      instanceId: `${run}-remote-instance-${String(index)}`,
      planId,
      workflowDefinitionId: planId,
      workflowVersion: 1,
      goalId: goal.goalId,
      goalVersion: goal.version,
      skillVersions: [],
      budgetLimits: {
        maxReplans: 0,
        maxDurationSeconds: 60,
        maxLlmCalls: 0,
        maxMcpCalls: 10,
        maxCost: 10,
      },
      budgetUsage: { replanCount: 0, durationMs: 0, llmCalls: 0, mcpCalls: 0, cost: 0 },
      status: 'running',
      input: {},
      errors: {},
      startedAt: timestamp,
    });
  }
  const admit = async (
    index: number,
    remoteTaskId: string,
    recordedSnapshot = snapshotId,
    freezeSchema = true,
  ) => {
    const suffix = randomUUID();
    const taskId = `${run}-task-${String(index)}`;
    const invocation: McpInvocation = {
      invocationId: `${run}-inv-${suffix}`,
      taskId,
      contextId: `${run}-context`,
      serverId,
      toolName: 'move',
      executionMode: 'live',
      executionSemantics: semantics,
      arguments: { target: { x: 3, y: 4 }, frame: 'EPSG:4326' },
      result: { remoteTask: { remoteTaskId } },
      status: 'succeeded',
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 0,
    };
    await mcp.saveInvocation(invocation);
    const binding = createRemoteTaskBinding({
      bindingId: `${run}-binding-${suffix}`,
      serverId,
      operationName: 'move',
      remoteTaskId,
      agentTaskId: taskId,
      contextId: `${run}-context`,
      goalId: goal.goalId,
      goalVersion: goal.version,
      workflowPlanId: `${run}-remote-plan-${String(index)}`,
      workflowDefinitionId: `${run}-remote-plan-${String(index)}`,
      workflowDefinitionVersion: 1,
      workflowInstanceId: `${run}-remote-instance-${String(index)}`,
      workflowNodeId: 'move',
      workflowNodeRunId: `move-${suffix}`,
      mcpInvocationId: invocation.invocationId,
      protocolStatus: 'working',
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'synthetic-v1',
      protocolContract: {
        mode: 'frozen_v1',
        protocolVersion: '2026-07-28',
        baselineSha256: 'a'.repeat(64),
        serverDiscoverySnapshotId: recordedSnapshot,
      },
      taskBehavior: 'task_required',
      taskCancellation: 'task_cancel',
      runtimeRevision: '1',
      executionContext: { mode: 'live' },
      authoritySnapshot: {
        schemaVersion: '1.0',
        capturedAt: timestamp,
        runtime: {
          serverId,
          endpoint: 'http://127.0.0.1:1/mcp',
          serverUpdatedAt: timestamp,
          toolRevision: 1,
          protocolSnapshotId: recordedSnapshot,
          catalogRevision: 'synthetic-1',
          catalogChecksum: 'c'.repeat(64),
          operationCount: 1,
          ...(freezeSchema ? { toolInput: { operationName: 'move', inputSchema: schema } } : {}),
        },
      },
      credentialRevision: timestamp,
      sessionRevision: 'synthetic-v1',
      lastProviderUpdatedAt: timestamp,
      pollIntervalMs: 200,
      createdAt: timestamp,
    });
    const saved = await remote.admit(binding, `${binding.bindingId}-accepted`);
    assert.equal(saved.created, true);
    const replay = await remote.admit(binding, `${binding.bindingId}-repeated`);
    assert.equal(replay.created, false);
    assert.equal((await remote.listObservations(binding.bindingId)).length, 1);
    return saved.binding;
  };
  // Directory refresh after dispatch must not remove the admitted target annotation.
  await pool.query(
    `UPDATE mcp_tool SET input_schema_json='{"type":"object"}'::jsonb WHERE server_id=$1 AND tool_name='move'`,
    [serverId],
  );
  const a = await admit(0, 'same-opaque-handle');
  assert.deepEqual(a.authoritySnapshot?.runtime.toolInput, {
    operationName: 'move',
    inputSchema: schema,
  });
  const b = await admit(1, 'same-opaque-handle');
  assert.notDeepEqual(a.deviceIdentity, b.deviceIdentity);
  assert.equal(
    (await remote.findByRemoteIdentity(serverId, 'same-opaque-handle', a.deviceIdentity))
      ?.bindingId,
    a.bindingId,
  );
  assert.equal(
    (await remote.findByRemoteIdentity(serverId, 'same-opaque-handle', b.deviceIdentity))
      ?.bindingId,
    b.bindingId,
  );
  await assert.rejects(
    remote.findByRemoteIdentity(serverId, 'same-opaque-handle'),
    /REMOTE_TASK_DEVICE_IDENTITY_REQUIRED/u,
  );
  const onlyA = { ...scope, allowedDeviceIds: [scope.allowedDeviceIds[0] ?? 'missing'] };
  const scoped = new PostgresRemoteTaskRepository(pool, onlyA);
  assert.equal(await scoped.findById(b.bindingId), undefined);
  assert.equal(
    await scoped.findByRemoteIdentity(serverId, b.remoteTaskId, b.deviceIdentity),
    undefined,
  );
  assert.deepEqual(await scoped.listObservations(b.bindingId), []);
  assert.equal(
    (
      await scoped.claimPoll({
        bindingId: b.bindingId,
        expectedVersion: b.version,
        claimToken: 'foreign-claim',
        claimedAt: timestamp,
        expiresAt: new Date(Date.parse(timestamp) + 30000).toISOString(),
      })
    ).claimed,
    false,
  );
  const aInvocations = await new PostgresMcpRegistryRepository(pool, onlyA).listInvocations(
    serverId,
  );
  assert.equal(aInvocations.length, 1);
  assert.equal(aInvocations[0]?.deviceId, a.deviceIdentity?.deviceId);
  const targets = await pool.query<{ native_geometry: unknown; owner_key: unknown }>(
    `SELECT g.native_geometry,b.owner_key FROM gowm_task.target_binding b JOIN gowm_task.target_geometry g USING(target_id,data_scope_key) WHERE b.owner_kind='NODE_RUN' AND b.device_id=ANY($1::text[])`,
    [scope.allowedDeviceIds],
  );
  assert.equal(targets.rowCount, 2);
  assert.deepEqual(targets.rows[0]?.native_geometry, { type: 'Point', coordinates: [3, 4] });
  const dispatchedA = targets.rows.find(
    (row) =>
      typeof row.owner_key === 'object' &&
      row.owner_key !== null &&
      'bindingId' in row.owner_key &&
      row.owner_key.bindingId === a.bindingId,
  );
  assert.deepEqual(dispatchedA?.owner_key, {
    nodeId: a.workflowNodeId,
    bindingId: a.bindingId,
    instanceId: a.workflowInstanceId,
    nodeRunId: a.workflowNodeRunId,
  });

  const publish = async (remoteId: string, index: number) => {
    const deviceId = scope.allowedDeviceIds[index];
    assert.ok(deviceId);
    const directory = await peer.query<{
      binding_id: string;
      smpp_service_key: string;
      provider_id: string;
    }>(
      'SELECT binding_id,smpp_service_key,provider_id FROM gowm_device.device_service_binding WHERE device_id=$1 AND valid_to IS NULL',
      [deviceId],
    );
    const owner = directory.rows[0];
    assert.ok(owner);
    const snapshot = randomUUID();
    const client = await peer.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ugv_smpp.operation_snapshot(snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition) VALUES($1,$2,$3,'move',$4,'{"fixture":true}'::jsonb)`,
        [snapshot, owner.provider_id, snapshot, 'a'.repeat(64)],
      );
      await client.query(
        `INSERT INTO ugv_smpp.provider_task(task_id,provider_id,operation_name,operation_snapshot_id,authorization_context_hash,execution_mode,arguments,argument_hash,internal_state,mcp_status,accepted_at,device_id,gowm_binding_id,smpp_service_key) VALUES($1,$2,'move',$3,$4,'live',$5::jsonb,$4,'RUNNING','working',$6,$7,$8,$9)`,
        [
          remoteId,
          owner.provider_id,
          snapshot,
          'a'.repeat(64),
          JSON.stringify({ target: { x: 3, y: 4 }, frame: 'EPSG:4326' }),
          timestamp,
          deviceId,
          owner.binding_id,
          owner.smpp_service_key,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const delayedId = randomUUID();
  const delayed = await admit(0, delayedId);
  assert.equal(delayed.canonicalMcpTaskId, undefined);
  const terminalAt = new Date(Date.parse(timestamp) + 1000).toISOString();
  await remote.recordExternalSnapshot({
    bindingId: delayed.bindingId,
    expectedVersion: delayed.version,
    snapshot: {
      remoteTaskId: delayed.remoteTaskId,
      status: 'completed',
      createdAt: timestamp,
      lastUpdatedAt: terminalAt,
      ttlMs: null,
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'synthetic-v1',
      runtimeRevision: '2',
      result: { content: [], structuredContent: true, isError: false },
    },
    source: 'notification',
    observationId: `${delayed.bindingId}-terminal`,
    controlEventId: `${delayed.bindingId}-control`,
    resultHash: 'd'.repeat(64),
    observedAt: terminalAt,
  });
  const terminal = await remote.findById(delayed.bindingId);
  assert.ok(terminal?.terminalAt);
  await publish(delayedId, 0);
  await remote.reconcileCanonicalLinks(256);
  const linked = await remote.findById(delayed.bindingId);
  assert.equal(linked?.canonicalMcpTaskId, delayedId);
  assert.equal(linked.version, terminal.version);
  assert.equal(linked.protocolStatus, terminal.protocolStatus);
  const conflictId = randomUUID();
  await publish(conflictId, 1);
  assert.equal((await admit(0, conflictId)).canonicalMcpTaskId, undefined);
  const unprovenId = randomUUID();
  await publish(unprovenId, 0);
  assert.equal(
    (await admit(0, unprovenId, `${run}-missing-discovery-proof`)).canonicalMcpTaskId,
    undefined,
  );
  assert.equal((await remote.findById(a.bindingId))?.canonicalMcpTaskId, undefined);
  assert.equal((await mcp.listInvocations(serverId)).length, 5);
  const continuationResults = await verifyGowmContinuationCases(pool, scope, [a, b]);
  // Continuation claim changes binding versions; later cases use current identities.
  const currentA = await remote.findById(a.bindingId);
  const currentB = await remote.findById(b.bindingId);
  assert.ok(currentA && currentB);
  const cancellationResults = await verifyGowmCancellationCases(pool, scope, [currentA, currentB]);
  const inputResults = await verifyGowmInputCases(pool, scope, [a, b]);
  const admissionResults = await verifyGowmAdmissionCases(pool, scope, [a, b]);
  const syncResults = await verifyGowmConsumerSyncCases(pool, scope, [a, b]);
  await assert.rejects(
    admit(0, 'missing-frozen-schema', snapshotId, false),
    /REMOTE_TASK_INVOCATION_FROZEN_SCHEMA_MISSING/u,
  );
  assert.equal(
    (
      await pool.query(
        `SELECT 1 FROM remote_task_binding WHERE server_id=$1 AND remote_task_id='missing-frozen-schema'`,
        [serverId],
      )
    ).rowCount,
    0,
  );

  const snapshotsBeforeDelete = await pool.query(
    'SELECT snapshot_id FROM mcp_protocol_snapshot WHERE server_id=$1 ORDER BY snapshot_id',
    [serverId],
  );
  await assert.rejects(mcp.deleteServer(serverId), {
    code: 'MCP_SHARED_HISTORY_RETENTION_REQUIRED',
  });
  assert.ok(await mcp.findServer(serverId));
  assert.deepEqual(
    (
      await pool.query(
        'SELECT snapshot_id FROM mcp_protocol_snapshot WHERE server_id=$1 ORDER BY snapshot_id',
        [serverId],
      )
    ).rows,
    snapshotsBeforeDelete.rows,
  );
  return [
    ...syncResults,
    ...admissionResults,
    ...cancellationResults,
    ...continuationResults,
    ...inputResults,
    'Restricted consumer cannot write SMPP; independent synthetic peer publishes only its native parent records',
    'Two devices admit the same opaque handle under exact source keys; scoped lookups, claims and Invocation reads exclude the other device',
    'Real Remote Binding creates exact DISPATCHED owner from actual Invocation arguments; repeated admission adds no observation or target',
    'Terminal remote binding links a delayed verified parent without MCP resend or lifecycle/version changes; other-device and unproven UUIDs stay unlinked',
  ];
}
