import type { Pool, PoolClient } from 'pg';

import {
  assertDeviceWorkScope,
  DeviceScopeError,
  type DeviceTaskContext,
  type DeviceWorkScope,
} from '../../domain/src/device-task-context.js';

interface DeviceBindingRow {
  device_id: string;
  data_scope_key: string;
  binding_id: string;
  sdar_service_key: string;
  smpp_service_key: string;
  provider_id: string;
  resource_id: string;
  sdar_mcp_server_id: string | null;
  agent_profile_id: string | null;
}

/** Reads existing registrations; admission never creates or modifies a device. */
export class PostgresGowmDeviceContextReader {
  constructor(
    private readonly database: Pool | PoolClient,
    private readonly scope: DeviceWorkScope,
  ) {}

  async resolve(input: {
    readonly deviceId: string;
    readonly dataScopeKey: string;
    /** Historical Tasks use their frozen binding even after its validity ends. */
    readonly bindingId?: string;
  }): Promise<DeviceTaskContext> {
    assertDeviceWorkScope(this.scope, {
      deviceId: input.deviceId,
      sdarServiceKey: this.scope.sdarServiceKey,
    });
    const result = await this.database.query<DeviceBindingRow>(
      `SELECT b.device_id,b.data_scope_key,b.binding_id,b.sdar_service_key,
              b.smpp_service_key,b.provider_id,b.resource_id,
              b.sdar_mcp_server_id,b.agent_profile_id
         FROM gowm_device.device_service_binding b
         JOIN gowm_device.device d USING(device_id,data_scope_key)
        WHERE b.device_id=$1 AND b.data_scope_key=$2 AND b.sdar_service_key=$3
          AND (($4::uuid IS NULL AND b.valid_to IS NULL AND d.enabled)
            OR ($4::uuid IS NOT NULL AND b.binding_id=$4))
        LIMIT 2`,
      [input.deviceId, input.dataScopeKey, this.scope.sdarServiceKey, input.bindingId ?? null],
    );
    if (result.rows.length > 1) throw new DeviceScopeError('DEVICE_BINDING_AMBIGUOUS');
    const row = result.rows[0];
    if (row?.sdar_mcp_server_id == null) throw new DeviceScopeError('DEVICE_BINDING_UNAVAILABLE');
    return Object.freeze({
      deviceId: row.device_id,
      dataScopeKey: row.data_scope_key,
      bindingId: row.binding_id,
      sdarServiceKey: row.sdar_service_key,
      smppServiceKey: row.smpp_service_key,
      providerId: row.provider_id,
      resourceId: row.resource_id,
      sdarMcpServerId: row.sdar_mcp_server_id,
      ...(row.agent_profile_id === null ? {} : { agentProfileId: row.agent_profile_id }),
    });
  }
}
