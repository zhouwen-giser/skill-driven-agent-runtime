// GOWM target SQL/API contract: a1a86186ea866911124de72374e17fe19897fa9e,
// packages/integrations/device-business-storage/src/repository.ts (MIT).
// Copyright (c) 2026 GOWM contributors; full notice retained in
// contracts/gowm-shared-storage/current/LICENSE. Narrow SDAR consumer adaptation.
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { TargetExtraction } from '../../domain/src/structured-target.js';
import { taskDeviceScopeSql } from './gowm-work-scope.js';

export type GowmTargetOwner =
  | { kind: 'TASK'; key: { taskId: string }; role: 'REQUESTED' }
  | { kind: 'PLAN_NODE'; key: { planId: string; nodeId: string }; role: 'PLANNED' }
  | {
      kind: 'NODE_RUN';
      key: { bindingId: string; instanceId: string; nodeId: string; nodeRunId: string };
      role: 'DISPATCHED';
    };

/** Narrow consumer of the pinned GOWM target contract. The caller owns the
 * business transaction. No pool, inferred owner, remote call, or schema repair. */
export async function writeGowmTargets(
  client: PoolClient,
  scope: DeviceWorkScope,
  taskId: string,
  owner: GowmTargetOwner,
  extraction: TargetExtraction,
  source: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (extraction.targets.length === 0 && extraction.diagnostics.length === 0) return;
  const filter = taskDeviceScopeSql(scope, 2, 't');
  const parent = await client.query<{
    device_id: string | null;
    data_scope_key: string | null;
    context_id: string;
  }>(
    `SELECT t.device_id,b.data_scope_key,t.context_id FROM agent_task t
       LEFT JOIN gowm_device.device_service_binding b ON b.binding_id=t.gowm_binding_id
         AND b.device_id=t.device_id AND b.sdar_service_key=t.sdar_service_key
       WHERE t.task_id=$1 AND ${filter.predicate} FOR KEY SHARE OF t`,
    [taskId, ...filter.values],
  );
  const task = parent.rows[0];
  if (task === undefined) throw new GowmTargetError('TARGET_DEVICE_SCOPE_DENIED');
  if (task.device_id === null) return;
  if (task.data_scope_key === null) throw new GowmTargetError('TARGET_DEVICE_BINDING_MISSING');
  // Ensure the supplied owner is in this exact Task lineage, not merely the
  // same device. The GOWM trigger independently verifies its exact node/run.
  const owns =
    owner.kind === 'TASK'
      ? { rowCount: owner.key.taskId === taskId ? 1 : 0 }
      : await client.query(
          owner.kind === 'PLAN_NODE'
            ? 'SELECT 1 FROM workflow_plan WHERE plan_id=$1 AND gowm_task_id=$2 FOR KEY SHARE'
            : `SELECT 1 FROM remote_task_binding r JOIN workflow_instance i ON i.instance_id=r.workflow_instance_id
           JOIN workflow_plan p ON p.plan_id=i.plan_id WHERE r.binding_id=$1 AND p.gowm_task_id=$2 FOR KEY SHARE OF r`,
          [owner.kind === 'PLAN_NODE' ? owner.key.planId : owner.key.bindingId, taskId],
        );
  if (owns.rowCount !== 1) throw new GowmTargetError('TARGET_TASK_OWNER_MISMATCH');
  const key = JSON.stringify(owner.key);
  for (const target of [...extraction.targets].sort((a, b) =>
    a.argumentPath.localeCompare(b.argumentPath),
  )) {
    const lock = JSON.stringify(['SDAR', owner.kind, owner.key, owner.role, target.argumentPath]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lock]);
    const geometry = JSON.stringify(target.geometry);
    const parameters = [
      owner.kind,
      key,
      owner.role,
      target.argumentPath,
      task.device_id,
      task.data_scope_key,
      target.purpose,
      geometry,
      target.nativeCrs,
    ];
    const old = await client.query<{ same: boolean }>(
      `SELECT b.device_id=$5 AND b.data_scope_key=$6 AND b.target_purpose=$7
         AND g.native_geometry=$8::jsonb AND g.native_crs=$9 AS same
       FROM gowm_task.target_binding b JOIN gowm_task.target_geometry g USING(target_id,data_scope_key)
       WHERE b.owner_domain='SDAR' AND b.owner_kind=$1 AND b.owner_key=$2::jsonb
         AND b.usage_role=$3 AND b.argument_path=$4`,
      parameters,
    );
    if (old.rows.length !== 0) {
      if (old.rows.length !== 1 || old.rows[0]?.same !== true)
        throw new GowmTargetError('TARGET_BINDING_CONFLICT');
      continue;
    }
    const targetId = randomUUID();
    const normalized = target.nativeCrs === 'EPSG:4326';
    await client.query(
      `INSERT INTO gowm_task.target_geometry(target_id,target_group_id,revision,data_scope_key,
         source_domain,source_record_identity,geometry_kind,native_geometry,native_crs,geometry_wgs84,normalization_state)
       VALUES($1,$1,1,$2,'SDAR',$3::jsonb,$4,$5::jsonb,$6,
         CASE WHEN $7 THEN public.ST_SetSRID(public.ST_GeomFromGeoJSON($5::jsonb::text),4326) ELSE NULL END,$8)`,
      [
        targetId,
        task.data_scope_key,
        JSON.stringify({
          ...source,
          ownerKind: owner.kind,
          ownerKey: owner.key,
          argumentPath: target.argumentPath,
        }),
        target.geometry.type.toUpperCase(),
        geometry,
        target.nativeCrs,
        normalized,
        normalized ? 'NORMALIZED' : 'NATIVE_ONLY',
      ],
    );
    await client.query(
      `INSERT INTO gowm_task.target_binding(target_id,device_id,data_scope_key,owner_domain,owner_kind,
         owner_key,usage_role,target_purpose,argument_path) VALUES($1,$2,$3,'SDAR',$4,$5::jsonb,$6,$7,$8)`,
      [
        targetId,
        task.device_id,
        task.data_scope_key,
        owner.kind,
        key,
        owner.role,
        target.purpose,
        target.argumentPath,
      ],
    );
  }
  for (const diagnostic of extraction.diagnostics) {
    const summary = JSON.stringify({
      ...diagnostic,
      ownerKind: owner.kind,
      ownerKey: owner.key,
      source,
    });
    const eventId = `target-diagnostic-${createHash('sha256').update(summary).digest('hex')}`;
    await client.query(
      `INSERT INTO runtime_event(event_id,task_id,context_id,event_type,event_timestamp,summary)
       VALUES($1,$2,$3,'task.target_diagnostic',clock_timestamp(),$4) ON CONFLICT(event_id) DO NOTHING`,
      [eventId, taskId, task.context_id, summary],
    );
  }
}

export class GowmTargetError extends Error {
  constructor(
    readonly code:
      | 'TARGET_DEVICE_SCOPE_DENIED'
      | 'TARGET_DEVICE_BINDING_MISSING'
      | 'TARGET_TASK_OWNER_MISMATCH'
      | 'TARGET_BINDING_CONFLICT',
  ) {
    super(code);
    this.name = 'GowmTargetError';
  }
}
