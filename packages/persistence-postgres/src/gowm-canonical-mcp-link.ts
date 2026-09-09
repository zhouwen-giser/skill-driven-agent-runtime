import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { remoteTaskScopeSql } from './gowm-mcp-ownership.js';

export type CanonicalMcpLinkResult =
  'linked' | 'pending' | 'unverifiable' | 'conflict' | 'not_applicable';
const Uuid = z.uuid();

/** Consumes the GOWM resolveRemoteTask contract, with SDAR receipt/provenance
 * checks before its nullable association update. No SMPP DML or remote call. */
export async function resolveGowmCanonicalMcpLink(
  client: PoolClient,
  scope: DeviceWorkScope,
  bindingId: string,
): Promise<CanonicalMcpLinkResult> {
  const filter = remoteTaskScopeSql(scope, 2, 'r');
  const selected = await client.query<{
    binding_id: string;
    remote_task_id: string;
    canonical_mcp_task_id: string | null;
    device_id: string | null;
    smpp_service_key: string | null;
    agent_task_id: string;
    context_id: string;
    operation_name: string;
    provider_id: string;
    execution_mode: string;
    simulation_id: string | null;
    evidence_valid: boolean | null;
  }>(
    `SELECT r.binding_id,r.remote_task_id,r.canonical_mcp_task_id,r.device_id,r.smpp_service_key,
       r.agent_task_id,r.context_id,r.operation_name,r.execution_mode,r.simulation_id,b.provider_id,
       (b.device_id=r.device_id AND b.smpp_service_key=r.smpp_service_key AND b.sdar_mcp_server_id=r.server_id
        AND b.sdar_service_key=t.sdar_service_key
        AND m.task_id=r.agent_task_id AND m.server_id=r.server_id AND m.tool_name=r.operation_name
        AND m.context_id=r.context_id AND m.execution_mode=r.execution_mode AND m.simulation_id IS NOT DISTINCT FROM r.simulation_id
        AND (r.authority_snapshot_json->'providerBinding' IS NULL OR r.authority_snapshot_json->'providerBinding'->>'providerId'=b.provider_id)
        AND m.result_json->'remoteTask'->>'remoteTaskId'=r.remote_task_id
        AND r.authority_snapshot_json->'runtime'->>'serverId'=r.server_id
        AND s.snapshot_id=r.authority_snapshot_json->'runtime'->>'protocolSnapshotId'
        AND s.server_id=r.server_id AND s.tool_revision=(r.authority_snapshot_json->'runtime'->>'toolRevision')::integer) AS evidence_valid
       FROM remote_task_binding r JOIN agent_task t ON t.task_id=r.agent_task_id
       LEFT JOIN gowm_device.device_service_binding b ON b.binding_id=t.gowm_binding_id
       JOIN mcp_invocation m ON m.invocation_id=r.mcp_invocation_id
       LEFT JOIN mcp_protocol_snapshot s ON s.snapshot_id=r.authority_snapshot_json->'runtime'->>'protocolSnapshotId'
       WHERE r.binding_id=$1 AND ${filter.predicate} FOR UPDATE OF r`,
    [bindingId, ...filter.values],
  );
  const row = selected.rows[0];
  if (row?.device_id == null) return 'not_applicable';
  let result: CanonicalMcpLinkResult;
  if (!Uuid.safeParse(row.remote_task_id).success || row.evidence_valid !== true)
    result = 'unverifiable';
  else if (
    row.canonical_mcp_task_id !== null &&
    row.canonical_mcp_task_id.toLowerCase() !== row.remote_task_id.toLowerCase()
  )
    result = 'conflict';
  else {
    const parent = await client.query<{ matches: boolean }>(
      `SELECT provider_id=$4 AND operation_name=$5 AND execution_mode=$6
         AND simulation_id IS NOT DISTINCT FROM $7::text AS matches
       FROM ugv_smpp.provider_task WHERE task_id=$1::uuid AND device_id=$2 AND smpp_service_key=$3`,
      [
        row.remote_task_id,
        row.device_id,
        row.smpp_service_key,
        row.provider_id,
        row.operation_name,
        row.execution_mode,
        row.simulation_id,
      ],
    );
    if (parent.rows[0]?.matches === true) {
      const updated = await client.query(
        `UPDATE remote_task_binding SET canonical_mcp_task_id=$2::uuid WHERE binding_id=$1
           AND device_id=$3 AND smpp_service_key=$4 AND (canonical_mcp_task_id IS NULL OR canonical_mcp_task_id=$2::uuid)
           AND EXISTS(SELECT 1 FROM ugv_smpp.provider_task p WHERE p.task_id=$2::uuid AND p.device_id=$3
             AND p.smpp_service_key=$4 AND p.provider_id=$5 AND p.operation_name=$6 AND p.execution_mode=$7
             AND p.simulation_id IS NOT DISTINCT FROM $8::text)`,
        [
          bindingId,
          row.remote_task_id,
          row.device_id,
          row.smpp_service_key,
          row.provider_id,
          row.operation_name,
          row.execution_mode,
          row.simulation_id,
        ],
      );
      if (updated.rowCount === 1) return 'linked';
      result = 'pending';
    } else if (parent.rows.length !== 0) result = 'conflict';
    else {
      // Existence-only check distinguishes unpublished from conflicting identity;
      // it never returns another device's provider data to SDAR.
      const exists = await client.query<{ present: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM ugv_smpp.provider_task WHERE task_id=$1::uuid) AS present',
        [row.remote_task_id],
      );
      result = exists.rows[0]?.present === true ? 'conflict' : 'pending';
    }
  }
  const diagnostic = JSON.stringify({ bindingId, code: `MCP_CANONICAL_${result.toUpperCase()}` });
  const eventId = `mcp-link-${createHash('sha256').update(diagnostic).digest('hex')}`;
  await client.query(
    `INSERT INTO runtime_event(event_id,task_id,context_id,event_type,event_timestamp,summary)
       VALUES($1,$2,$3,'task.mcp_link_diagnostic',clock_timestamp(),$4) ON CONFLICT(event_id) DO NOTHING`,
    [eventId, row.agent_task_id, row.context_id, diagnostic],
  );
  return result;
}
