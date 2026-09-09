import type { Pool, PoolClient } from 'pg';
import type { McpInvocation } from '../../domain/src/mcp.js';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { readGowmMcpOwner } from './gowm-mcp-ownership.js';

/** Both synchronous results and durable remote receipts use the caller's client. */
export async function insertMcpInvocation(
  client: Pool | PoolClient,
  invocation: McpInvocation,
  scope?: DeviceWorkScope,
): Promise<void> {
  const owner =
    scope === undefined
      ? undefined
      : await readGowmMcpOwner(
          client,
          scope,
          invocation.taskId,
          invocation.serverId,
          invocation.arguments,
        );
  await client.query(
    `INSERT INTO mcp_invocation(
       invocation_id,task_id,capability_attempt_id,control_confirmation_id,
       control_provider_binding_id,control_arguments_hash,control_dispatch_hash,
       context_id,execution_mode,simulation_id,server_id,tool_name,arguments_json,
       execution_semantics_json,result_json,status,error_code,error_message,
       started_at,completed_at,duration_ms${scope === undefined ? '' : ',device_id'})
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,
            $16,$17,$18,$19,$20,$21${scope === undefined ? '' : ',$22'})`,
    [
      invocation.invocationId,
      invocation.taskId ?? null,
      invocation.capabilityAttemptId ?? null,
      invocation.controlConfirmationId ?? null,
      invocation.controlProviderBindingId ?? null,
      invocation.controlArgumentsHash ?? null,
      invocation.controlDispatchHash ?? null,
      invocation.contextId ?? null,
      invocation.executionMode,
      invocation.simulationId ?? null,
      invocation.serverId,
      invocation.toolName,
      JSON.stringify(invocation.arguments),
      JSON.stringify(invocation.executionSemantics),
      invocation.result === undefined ? null : JSON.stringify(invocation.result),
      invocation.status,
      invocation.errorCode ?? null,
      invocation.errorMessage ?? null,
      invocation.startedAt,
      invocation.completedAt,
      invocation.durationMs,
      ...(owner === undefined ? [] : [owner.deviceId]),
    ],
  );
}
