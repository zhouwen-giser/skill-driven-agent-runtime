import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { canonicalHash } from '../../../packages/application/src/mcp-task-readiness.js';

/** Independent synthetic peer, exclusively for the explicitly isolated runtime test database. */
export async function verifyDelayedCanonicalParent(input: {
  observer: Pool;
  peer: Pool;
  taskId: string;
  deviceId: string;
  toolCallCount: () => number;
}): Promise<Readonly<Record<string, unknown>>> {
  const { observer, peer, taskId, deviceId } = input;
  const permissions = await observer.query<{ database: string; can_write: boolean }>(
    `SELECT current_database() AS database,
       has_table_privilege(current_user,'ugv_smpp.provider_task','INSERT') OR
       has_table_privilege(current_user,'ugv_smpp.provider_task','UPDATE') OR
       has_table_privilege(current_user,'ugv_smpp.provider_task','DELETE') AS can_write`,
  );
  assert.equal(permissions.rows[0]?.database, 'sdar_gowm_runtime_test');
  assert.equal(permissions.rows[0].can_write, false);
  assert.equal(
    (await peer.query<{ database: string }>('SELECT current_database() AS database')).rows[0]
      ?.database,
    'sdar_gowm_runtime_test',
  );
  const selected = await observer.query<{
    binding_id: string;
    remote_task_id: string;
    device_id: string;
    smpp_service_key: string;
    operation_name: string;
    execution_mode: string;
    simulation_id: string | null;
    version: string;
    runtime_revision: string;
    canonical_mcp_task_id: string | null;
    provider_id: string;
    gowm_binding_id: string;
    arguments_json: unknown;
    result_snapshot_json: unknown;
  }>(
    `SELECT r.binding_id,r.remote_task_id,r.device_id,r.smpp_service_key,r.operation_name,
       r.execution_mode,r.simulation_id,r.version,r.runtime_revision,r.canonical_mcp_task_id,
       d.provider_id,t.gowm_binding_id,m.arguments_json,r.result_snapshot_json
     FROM ugv_sdar.remote_task_binding r JOIN ugv_sdar.agent_task t ON t.task_id=r.agent_task_id
     JOIN gowm_device.device_service_binding d ON d.binding_id=t.gowm_binding_id
     JOIN ugv_sdar.mcp_invocation m ON m.invocation_id=r.mcp_invocation_id
     WHERE r.agent_task_id=$1 AND r.device_id=$2 AND r.protocol_status='completed' AND r.local_state='reentered'`,
    [taskId, deviceId],
  );
  assert.equal(selected.rows.length, 1);
  const receipt = selected.rows[0];
  assert.ok(receipt);
  z.uuid().parse(receipt.remote_task_id);
  assert.equal(receipt.canonical_mcp_task_id, null);
  assert.equal(
    (
      await peer.query('SELECT 1 FROM ugv_smpp.provider_task WHERE task_id=$1', [
        receipt.remote_task_id,
      ])
    ).rowCount,
    0,
  );
  const callsBefore = input.toolCallCount();
  const snapshot = randomUUID();
  const now = new Date();
  const client = await peer.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO ugv_smpp.operation_snapshot(snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
       VALUES($1,$2,$3,$4,$5,'{"fixture":"local-frozen-protocol"}'::jsonb)`,
      [
        snapshot,
        receipt.provider_id,
        snapshot,
        receipt.operation_name,
        canonicalHash({ snapshot }),
      ],
    );
    await client.query(
      `INSERT INTO ugv_smpp.provider_task(task_id,provider_id,operation_name,operation_snapshot_id,
       authorization_context_hash,execution_mode,simulation_id,arguments,argument_hash,internal_state,mcp_status,
       accepted_at,terminal_at,handle_expires_at,result,device_id,gowm_binding_id,smpp_service_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'TERMINAL_COMPLETED','completed',$10,$10,$11,$12::jsonb,$13,$14,$15)`,
      [
        receipt.remote_task_id,
        receipt.provider_id,
        receipt.operation_name,
        snapshot,
        canonicalHash({ taskId, deviceId }),
        receipt.execution_mode,
        receipt.simulation_id,
        JSON.stringify(receipt.arguments_json),
        canonicalHash(receipt.arguments_json),
        now.toISOString(),
        new Date(now.getTime() + 3600000).toISOString(),
        JSON.stringify(receipt.result_snapshot_json),
        deviceId,
        receipt.gowm_binding_id,
        receipt.smpp_service_key,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  // Observe the normal Server reconciler. Never invoke the repository reconciler from this test.
  let linked:
    { canonical_mcp_task_id: string | null; version: string; runtime_revision: string } | undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    linked = (
      await observer.query<NonNullable<typeof linked>>(
        'SELECT canonical_mcp_task_id,version,runtime_revision FROM ugv_sdar.remote_task_binding WHERE binding_id=$1',
        [receipt.binding_id],
      )
    ).rows[0];
    if (linked?.canonical_mcp_task_id !== null && linked !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(linked?.canonical_mcp_task_id, receipt.remote_task_id);
  assert.equal(linked.version, receipt.version);
  assert.equal(linked.runtime_revision, receipt.runtime_revision);
  assert.equal(input.toolCallCount(), callsBefore);
  assert.equal(
    (await observer.query('SELECT 1 FROM ugv_sdar.mcp_invocation WHERE task_id=$1', [taskId]))
      .rowCount,
    1,
  );
  const readModel = await observer.query<{
    device_id: string;
    sdar_phase: string;
    mcp_task_id: string;
    smpp_service_key: string;
    provider_task_record_id: string | null;
    missing_stage: string;
  }>(
    `SELECT device_id,sdar_phase,mcp_task_id,smpp_service_key,provider_task_record_id,missing_stage
       FROM gowm_business_v1.task_execution_lineage WHERE sdar_task_id=$1 AND remote_binding_id=$2`,
    [taskId, receipt.binding_id],
  );
  assert.deepEqual(readModel.rows, [
    {
      device_id: deviceId,
      sdar_phase: 'completed',
      mcp_task_id: receipt.remote_task_id,
      smpp_service_key: receipt.smpp_service_key,
      provider_task_record_id: null,
      missing_stage: 'PROVIDER_PENDING',
    },
  ]);
  return {
    source: 'independent_local_synthetic_peer',
    gowmReadModel: readModel.rows[0],
    deviceId,
    remoteTaskId: receipt.remote_task_id,
    canonicalMcpTaskId: linked.canonical_mcp_task_id,
    linkedAfterTerminal: true,
    unchangedVersion: receipt.version,
    unchangedRuntimeRevision: receipt.runtime_revision,
    consumerSmppDml: false,
    additionalToolCalls: 0,
  };
}
