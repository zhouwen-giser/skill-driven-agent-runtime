import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../node-control-api/src/runtime.js';
import { applyRuntimeMigrations } from '../../server/src/runtime.js';
import { createNodeCapabilityDefinition } from '../../../packages/node-control-domain/src/index.js';
import { applyControlMigrations } from '../../../packages/node-control-persistence-postgres/src/index.js';

const runtimeConnectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const controlConnectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const apiToken = 'p06-control-api-token-000000000000000000000000';
const runtimeToken = 'p06-runtime-service-token-0000000000000000000';
const runtimePool = new Pool({ connectionString: runtimeConnectionString, max: 4 });
const controlPool = new Pool({ connectionString: controlConnectionString, max: 4 });
let controlApi: NodeControlApiRuntime | undefined;

beforeAll(async () => {
  await Promise.all([applyRuntimeMigrations(runtimePool), applyControlMigrations(controlPool)]);
  await cleanup();
  await runtimePool.query(
    `INSERT INTO skill(skill_id,current_version,created_at,updated_at)
     VALUES('skill.p06.inspect',1,clock_timestamp(),clock_timestamp())`,
  );
  await runtimePool.query(
    `INSERT INTO skill_version(
       skill_id,version,name,summary,description,capabilities_json,workflow_guidance,
       output_instruction,input_schema_json,output_schema_json,tool_policy_json,runtime_policy_json,
       status,source_kind,validation_passed,previous_version,created_at)
     VALUES(
       'skill.p06.inspect',1,'P06 inspection','Inspect a device','Validated P06 implementation',
       '["compatibility.projection.only"]'::jsonb,'Execute the inspection','Return evidence',
       '{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'{}'::jsonb,'{}'::jsonb,
       'enabled','admin',true,NULL,clock_timestamp())`,
  );
  controlApi = await startNodeControlApi({
    SDAR_CONTROL_DATABASE_URL: controlConnectionString,
    SDAR_CONTROL_RUNTIME_DATABASE_URL: runtimeConnectionString,
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: 0,
    SDAR_CONTROL_API_TOKEN: apiToken,
    SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: runtimeToken,
    SDAR_CONTROL_NODE_ID: 'node-p06',
    SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
    SDAR_CONTROL_NODE_DISPLAY_NAME: 'P06 Integration Node',
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://127.0.0.1:9998',
    SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_NODE_EVENTS_URL: 'http://127.0.0.1:10080/api/v1/events',
    SDAR_CONTROL_A2A_AGENT_CARD_URL: 'http://127.0.0.1:9999/.well-known/agent-card.json',
  });
});

afterAll(async () => {
  await controlApi?.close();
  await cleanup();
  await Promise.all([runtimePool.end(), controlPool.end()]);
});

describe('P06 Capability Definition and implementation authority', { concurrent: false }, () => {
  it('publishes a stable immutable definition only through an exact executable implementation', async () => {
    const draft = createNodeCapabilityDefinition({
      capabilityId: 'device.inspect.p06',
      version: 1,
      domain: 'device',
      name: 'Inspect device',
      description: 'Read and verify current device condition.',
      inputSchema: { type: 'object', required: ['deviceId'] },
      outputSchema: { type: 'object', required: ['condition'] },
      successCriteria: [{ type: 'field_equals', field: 'verified', value: true }],
      requiredEvidence: [{ type: 'provider_result', field: 'condition' }],
      constraints: [{ type: 'authorization', level: 'read' }],
      riskLevel: 'low',
      status: 'draft',
      createdBy: 'p06-integration',
      createdAt: '2026-08-02T02:00:00.000Z',
    });
    const created = await request('/api/v1/node-capabilities', {
      method: 'POST',
      body: draft,
      expectedStatus: 201,
    });
    expect(created).toMatchObject({ status: 'draft', definitionHash: draft.definitionHash });

    const noPath = await command(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/validate',
      'p06-validate-without-path',
      'Reject a Capability without an executable path.',
      422,
    );
    expect(noPath).toMatchObject({ code: 'NODE_CAPABILITY_INVALID' });

    const resource = await request(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations',
      {
        method: 'POST',
        body: binding('resource', 'resource.p06', '1'),
        expectedStatus: 400,
      },
    );
    expect(resource).toMatchObject({ code: 'REQUEST_INVALID' });

    const missing = await request(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations',
      {
        method: 'POST',
        body: binding('skill', 'skill.p06.missing', '1'),
        expectedStatus: 422,
      },
    );
    expect(missing).toMatchObject({ code: 'CAPABILITY_IMPLEMENTATION_NOT_FOUND' });

    await expect(
      request('/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations', {
        method: 'POST',
        body: binding('skill', 'skill.p06.inspect', '1'),
        expectedStatus: 201,
      }),
    ).resolves.toMatchObject({ role: 'primary', status: 'active' });

    await expect(
      command(
        '/api/v1/node-capabilities/device.inspect.p06/versions/1/validate',
        'p06-validate-capability',
        'Validate every business promise and exact implementation.',
        200,
      ),
    ).resolves.toMatchObject({ status: 'validating', definitionHash: draft.definitionHash });
    await expect(
      command(
        '/api/v1/node-capabilities/device.inspect.p06/versions/1/publish',
        'p06-publish-capability',
        'Publish the validated Capability Version.',
        202,
      ),
    ).resolves.toMatchObject({ status: 'succeeded', result: { status: 'published' } });

    const published = await request('/api/v1/node-capabilities/device.inspect.p06/versions/1', {
      expectedStatus: 200,
    });
    expect(published).toMatchObject({ status: 'published', definitionHash: draft.definitionHash });
    await expect(
      controlPool.query(
        `UPDATE sdar_control.node_capability_definition_version
            SET description='mutated promise'
          WHERE capability_id='device.inspect.p06' AND version=1`,
      ),
    ).rejects.toMatchObject({ code: '55000' });

    const lateBinding = await request(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations',
      {
        method: 'POST',
        body: { ...binding('skill', 'skill.p06.inspect', '1'), bindingId: 'binding.p06.late' },
        expectedStatus: 409,
      },
    );
    expect(lateBinding).toMatchObject({ code: 'NODE_CAPABILITY_CONFLICT' });
  });
});

function binding(
  implementationType: string,
  implementationId: string,
  implementationVersion: string,
) {
  return {
    bindingId: `binding.p06.${implementationId}`,
    capabilityId: 'device.inspect.p06',
    capabilityVersion: 1,
    implementationType,
    implementationId,
    implementationVersion,
    role: 'primary',
    priority: 0,
    status: 'active',
    revision: 1,
  };
}

async function command(path: string, key: string, reason: string, expectedStatus: number) {
  return request(path, {
    method: 'POST',
    body: { reason },
    idempotencyKey: key,
    expectedStatus,
  });
}

async function request(
  path: string,
  options: Readonly<{
    method?: string;
    body?: unknown;
    idempotencyKey?: string;
    expectedStatus: number;
  }>,
) {
  const response = await fetch(`${requireApi().baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
      ...(options.idempotencyKey === undefined
        ? {}
        : { 'idempotency-key': options.idempotencyKey }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(options.expectedStatus);
  return body;
}

function requireApi(): NodeControlApiRuntime {
  if (controlApi === undefined) throw new Error('P06_CONTROL_API_NOT_STARTED');
  return controlApi;
}

async function cleanup() {
  await controlPool.query(
    `TRUNCATE sdar_control.capability_implementation_binding,
              sdar_control.node_capability_definition_version,
              sdar_control.mcp_provider_catalog_observation,
              sdar_control.mcp_provider_binding,
              sdar_control.smpp_registry_sync_attempt,
              sdar_control.smpp_provider_candidate,
              sdar_control.smpp_registry_snapshot,
              sdar_control.smpp_registry_source,
              sdar_control.configuration_application,
              sdar_control.configuration_command_receipt,
              sdar_control.configuration_target_state,
              sdar_control.configuration_revision,
              sdar_control.model_route_definition,
              sdar_control.llm_provider_definition,
              sdar_control.control_audit_event,
              sdar_control.management_operation,
              sdar_control.node_profile`,
  );
  await runtimePool.query("DELETE FROM skill_version WHERE skill_id='skill.p06.inspect'");
  await runtimePool.query("DELETE FROM skill WHERE skill_id='skill.p06.inspect'");
}
