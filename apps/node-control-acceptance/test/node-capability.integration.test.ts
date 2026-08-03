import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../node-control-api/src/runtime.js';
import { applyRuntimeMigrations } from '../../server/src/runtime.js';
import {
  a2aExposureEtag,
  createA2aExposureVersion,
  createNodeCapabilityDefinition,
  nodeCapabilityEtag,
} from '../../../packages/node-control-domain/src/index.js';
import { applyControlMigrations } from '../../../packages/node-control-persistence-postgres/src/index.js';
import { RuntimeTaskCapabilityService } from '../../../packages/application/src/index.js';
import { createAgentTask, createTaskExecutionAttempt } from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { PostgresTaskCapabilityRepository } from '../../../packages/persistence-postgres/src/index.js';

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
       '{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,
       '{"required":[{"serverId":"server.p07","toolName":"inspect"}],"optional":[],"forbidden":[]}'::jsonb,
       '{}'::jsonb,
       'enabled','admin',true,NULL,clock_timestamp())`,
  );
  await runtimePool.query(
    `INSERT INTO mcp_server(
       server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,created_at,updated_at)
     VALUES('server.p07','P07 provider','http://127.0.0.1:1','streamable_http','enabled',1,
            'encrypted-test-value',clock_timestamp(),clock_timestamp())`,
  );
  await runtimePool.query(
    `INSERT INTO mcp_tool(server_id,tool_name,title,description,input_schema_json,discovered_at)
     VALUES('server.p07','inspect','Inspect','Inspect a device','{}'::jsonb,clock_timestamp())`,
  );
  await runtimePool.query(
    `INSERT INTO model_provider(
       provider_id,name,kind,base_url,model,enabled,timeout_ms,encrypted_credential,created_at,updated_at)
     VALUES('model.p07','P07 model','local','http://127.0.0.1:2','model-p07',true,1000,
            'encrypted-test-value',clock_timestamp(),clock_timestamp())`,
  );
  await runtimePool.query(
    `INSERT INTO stage_model_route(stage,provider_id,updated_at)
     VALUES('skill_selection','model.p07',clock_timestamp())`,
  );
  controlApi = await startTestApi();
});

async function startTestApi() {
  return startNodeControlApi({
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
}

afterAll(async () => {
  await controlApi?.close();
  await cleanup();
  await Promise.all([runtimePool.end(), controlPool.end()]);
});

describe('P06 Capability Definition and implementation authority', { concurrent: false }, () => {
  it('publishes a stable immutable definition only through an exact executable implementation', async () => {
    const invalidSchema = createNodeCapabilityDefinition({
      capabilityId: 'device.invalid-schema.p06',
      version: 1,
      domain: 'device',
      name: 'Invalid schema capability',
      description: 'Proves schema compilation is mandatory.',
      inputSchema: { type: 42 },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'completed' }],
      requiredEvidence: [{ type: 'provider_result' }],
      riskLevel: 'low',
      status: 'draft',
    });
    await request('/api/v1/node-capabilities', {
      method: 'POST',
      body: invalidSchema,
      idempotencyKey: 'p06-create-invalid-schema',
      expectedStatus: 201,
    });
    await expect(
      command(
        '/api/v1/node-capabilities/device.invalid-schema.p06/versions/1/validate',
        'p06-reject-invalid-schema',
        'Reject malformed input JSON Schema.',
        nodeCapabilityEtag(invalidSchema),
        422,
      ),
    ).resolves.toMatchObject({ code: 'NODE_CAPABILITY_SCHEMA_INVALID' });

    const draft = createNodeCapabilityDefinition({
      capabilityId: 'device.inspect.p06',
      version: 1,
      domain: 'device',
      name: 'Inspect device',
      description: 'Read and verify current device condition.',
      inputSchema: {
        type: 'object',
        properties: { deviceId: { type: 'string' } },
        required: ['deviceId'],
      },
      outputSchema: {
        type: 'object',
        properties: { condition: { type: 'string' } },
        required: ['condition'],
      },
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
      idempotencyKey: 'p06-create-capability',
      expectedStatus: 201,
    });
    expect(created).toMatchObject({ status: 'draft', definitionHash: draft.definitionHash });
    await expect(
      request('/api/v1/node-capabilities', {
        method: 'POST',
        body: draft,
        idempotencyKey: 'p06-create-capability',
        expectedStatus: 201,
      }),
    ).resolves.toEqual(created);

    await expect(
      command(
        '/api/v1/node-capabilities/device.inspect.p06/versions/1/validate',
        'p06-reject-stale-etag',
        'Reject stale optimistic concurrency state.',
        '"node-capability:stale"',
        412,
      ),
    ).resolves.toMatchObject({ code: 'PRECONDITION_FAILED' });

    const noPath = await command(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/validate',
      'p06-validate-without-path',
      'Reject a Capability without an executable path.',
      nodeCapabilityEtag(draft),
      422,
    );
    expect(noPath).toMatchObject({ code: 'NODE_CAPABILITY_INVALID' });

    const resource = await request(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations',
      {
        method: 'POST',
        body: binding('resource', 'resource.p06', '1'),
        idempotencyKey: 'p06-reject-resource-binding',
        expectedStatus: 400,
      },
    );
    expect(resource).toMatchObject({ code: 'REQUEST_INVALID' });

    const missing = await request(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations',
      {
        method: 'POST',
        body: binding('skill', 'skill.p06.missing', '1'),
        idempotencyKey: 'p06-reject-missing-binding',
        expectedStatus: 422,
      },
    );
    expect(missing).toMatchObject({ code: 'CAPABILITY_IMPLEMENTATION_NOT_FOUND' });

    const activeBinding = await request(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations',
      {
        method: 'POST',
        body: binding('skill', 'skill.p06.inspect', '1'),
        idempotencyKey: 'p06-create-skill-binding',
        expectedStatus: 201,
      },
    );
    expect(activeBinding).toMatchObject({ role: 'primary', status: 'active' });
    await expect(
      request('/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations', {
        method: 'POST',
        body: binding('skill', 'skill.p06.inspect', '1'),
        idempotencyKey: 'p06-create-skill-binding',
        expectedStatus: 201,
      }),
    ).resolves.toEqual(activeBinding);

    await expect(
      command(
        '/api/v1/node-capabilities/device.inspect.p06/versions/1/validate',
        'p06-validate-capability',
        'Validate every business promise and exact implementation.',
        nodeCapabilityEtag(draft),
        200,
      ),
    ).resolves.toMatchObject({ status: 'validating', definitionHash: draft.definitionHash });
    const publishedOperation = await command(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/publish',
      'p06-publish-capability',
      'Publish the validated Capability Version.',
      nodeCapabilityEtag({ ...draft, status: 'validating' }),
      202,
    );
    expect(publishedOperation).toMatchObject({
      status: 'succeeded',
      result: { status: 'published' },
    });
    await expect(
      command(
        '/api/v1/node-capabilities/device.inspect.p06/versions/1/publish',
        'p06-publish-capability',
        'Publish the validated Capability Version.',
        nodeCapabilityEtag({ ...draft, status: 'validating' }),
        202,
      ),
    ).resolves.toEqual(publishedOperation);

    const published = await request('/api/v1/node-capabilities/device.inspect.p06/versions/1', {
      expectedStatus: 200,
    });
    expect(published).toMatchObject({ status: 'published', definitionHash: draft.definitionHash });

    const readiness = await request('/api/v1/capability-readiness/device.inspect.p06/1/evaluate', {
      method: 'POST',
      body: { reason: 'Evaluate P07 readiness from exact Runtime dependencies.' },
      idempotencyKey: 'p07-evaluate-readiness',
      expectedStatus: 202,
    });
    expect(readiness).toMatchObject({
      status: 'succeeded',
      result: { status: 'available', snapshotVersion: 1 },
    });
    await expect(
      request('/api/v1/capability-readiness/device.inspect.p06/1/evaluate', {
        method: 'POST',
        body: { reason: 'Evaluate P07 readiness from exact Runtime dependencies.' },
        idempotencyKey: 'p07-evaluate-readiness',
        expectedStatus: 202,
      }),
    ).resolves.toEqual(readiness);

    const exposureDraft = createA2aExposureVersion({
      exposureId: 'exposure.p08.inspect',
      version: 1,
      capabilityId: 'device.inspect.p06',
      capabilityVersion: 1,
      agentSkillId: 'capability.device.inspect',
      name: 'Inspect a device',
      description: 'Inspect a declared device and return structured evidence.',
      tags: ['inspection'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
      requestSchema: draft.inputSchema,
      resultSchema: draft.outputSchema,
      visibility: 'public',
      requesterPolicy: { allowAnonymous: true, allowedRequesterIds: [] },
      readinessPublicationPolicy: 'publish_when_available',
      status: 'draft',
    });
    await expect(
      request('/api/v1/a2a-exposures', {
        method: 'POST',
        body: exposureDraft,
        idempotencyKey: 'p08-create-public-exposure',
        expectedStatus: 201,
      }),
    ).resolves.toEqual(exposureDraft);
    const publishedExposure = await request(
      '/api/v1/a2a-exposures/exposure.p08.inspect/versions/1/publish',
      {
        method: 'POST',
        body: { reason: 'Publish the exact Capability exposure.' },
        idempotencyKey: 'p08-publish-public-exposure',
        ifMatch: a2aExposureEtag(exposureDraft),
        expectedStatus: 202,
      },
    );
    expect(publishedExposure).toMatchObject({
      status: 'succeeded',
      result: { status: 'published' },
    });
    const rebuiltCard = await request('/api/v1/a2a-agent-card-revisions/rebuild', {
      method: 'POST',
      body: { reason: 'Build the Capability-authoritative public Agent Card.' },
      idempotencyKey: 'p08-rebuild-agent-card',
      expectedStatus: 202,
    });
    const activeRevisionResult = await runtimePool.query<{ revision: string }>(
      "SELECT revision FROM runtime_agent_card_revision WHERE status='active'",
    );
    const activeRevision = Number(activeRevisionResult.rows[0]?.revision);
    expect(activeRevision).toBeGreaterThan(0);
    expect(rebuiltCard).toMatchObject({
      status: 'succeeded',
      result: { revision: activeRevision, status: 'active' },
    });
    await expect(
      request('/api/v1/a2a-agent-card-revisions/rebuild', {
        method: 'POST',
        body: { reason: 'Build the Capability-authoritative public Agent Card.' },
        idempotencyKey: 'p08-rebuild-agent-card',
        expectedStatus: 202,
      }),
    ).resolves.toEqual(rebuiltCard);
    const unchangedCard = await request('/api/v1/a2a-agent-card-revisions/rebuild', {
      method: 'POST',
      body: { reason: 'Build the Capability-authoritative public Agent Card.' },
      idempotencyKey: 'p08-rebuild-unchanged-card',
      expectedStatus: 202,
    });
    expect(unchangedCard).toMatchObject({ result: { revision: activeRevision, status: 'active' } });
    const revisionCount = await runtimePool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM runtime_agent_card_revision',
    );
    expect(revisionCount.rows[0]?.count).toBe('1');
    const runtimeCard = await runtimePool.query<{ card: { skills?: readonly { id?: string }[] } }>(
      "SELECT card FROM runtime_agent_card_revision WHERE status='active'",
    );
    expect(runtimeCard.rows[0]?.card.skills).toEqual([
      expect.objectContaining({ id: 'capability.device.inspect' }),
    ]);
    expect(JSON.stringify(runtimeCard.rows[0]?.card)).not.toContain('skill.p06.inspect');
    await expect(
      runtimePool.query(
        "UPDATE runtime_agent_card_exposure_snapshot SET capability_id='mutated' WHERE revision=$1",
        [activeRevision],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      request('/internal/v1/agent-card-revisions/stage', {
        method: 'POST',
        bearerToken: runtimeToken,
        idempotencyKey: 'p08-reject-invalid-runtime-card',
        body: {
          reason: 'Reject an invalid card without replacing Active.',
          payload: {
            revision: {
              revision: activeRevision + 1,
              nodeId: 'node-p06',
              exposureRefs: [],
              contentHash: 'a'.repeat(64),
              capabilityCatalogHash: 'b'.repeat(64),
              status: 'candidate',
              generatedAt: new Date().toISOString(),
            },
            card: {},
          },
        },
        expectedStatus: 422,
      }),
    ).resolves.toMatchObject({ code: 'AGENT_CARD_SCHEMA_INVALID' });
    const activeAfterInvalid = await runtimePool.query<{ revision: string }>(
      "SELECT revision FROM runtime_agent_card_revision WHERE status='active'",
    );
    expect(activeAfterInvalid.rows).toEqual([{ revision: String(activeRevision) }]);

    const capabilityStore = new PostgresTaskCapabilityRepository(runtimePool);
    const taskCapabilities = new RuntimeTaskCapabilityService({
      store: capabilityStore,
      schemas: new AjvJsonSchemaValidator(),
    });
    const boundAt = new Date().toISOString();
    const task = createAgentTask({
      taskId: 'task.p09.capability',
      contextId: 'context.p09.capability',
      userId: 'requester.p09',
      requestText: 'Inspect device alpha.',
      requestMetadata: {
        'io.sdar/requestedCapability': {
          exposureId: 'exposure.p08.inspect',
          versionConstraint: '1',
          requestId: 'request.p09',
        },
      },
      timestamp: boundAt,
    });
    await runtimePool.query(
      `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
       VALUES($1,$2,$3,$3)`,
      [task.contextId, task.userId, boundAt],
    );
    const inputAttempt = createTaskExecutionAttempt({
      attemptId: 'task-input-attempt.p09.1',
      taskId: task.taskId,
      contextId: task.contextId,
      reason: 'initial',
      createdAt: boundAt,
    });
    const prepared = await taskCapabilities.prepareAcceptance({
      task,
      metadata: task.requestMetadata,
      capabilityInput: { deviceId: 'alpha' },
      inputAttempt,
      bindingId: `binding-${task.taskId}`,
      capabilityAttemptId: `capability-attempt-${task.taskId}-1`,
      event: {
        eventId: 'event.p09.created',
        taskId: task.taskId,
        contextId: task.contextId,
        eventType: 'task.created',
        timestamp: boundAt,
        summary: 'Capability Task accepted.',
      },
    });
    if (prepared === undefined) throw new Error('P09_CAPABILITY_ACCEPTANCE_NOT_PREPARED');
    await expect(
      taskCapabilities.accept({
        ...prepared,
        event: { ...prepared.event, taskId: 'task.p09.missing' },
      }),
    ).rejects.toBeDefined();
    const rolledBack = await runtimePool.query<{ tasks: string; bindings: string }>(
      `SELECT (SELECT COUNT(*) FROM agent_task WHERE task_id=$1)::text AS tasks,
              (SELECT COUNT(*) FROM task_capability_binding WHERE task_id=$1)::text AS bindings`,
      [task.taskId],
    );
    expect(rolledBack.rows[0]).toEqual({ tasks: '0', bindings: '0' });

    await taskCapabilities.accept(prepared);
    const bindingEvent = await runtimePool.query<{
      event_type: string;
      outbox_sequence: string;
      payload: Readonly<Record<string, unknown>>;
    }>(
      `SELECT event_type,outbox_sequence::text,payload
         FROM cognitive_runtime_outbox
        WHERE aggregate_type='task_capability_binding' AND aggregate_id=$1`,
      [prepared.binding.bindingId],
    );
    expect(bindingEvent.rows).toEqual([
      expect.objectContaining({
        event_type: 'node.task.capability_bound',
        outbox_sequence: expect.stringMatching(/^[1-9][0-9]*$/u),
        payload: {
          resourceRef: { type: 'task_capability_binding', id: task.taskId, revision: 1 },
          changeCode: 'TASK_CAPABILITY_BOUND',
        },
      }),
    ]);
    const publicBinding = await request('/api/v1/tasks/task.p09.capability/capability-binding', {
      expectedStatus: 200,
    });
    expect(publicBinding).toMatchObject({
      taskId: task.taskId,
      requestedCapabilityId: 'device.inspect.p06',
      capabilityVersion: 1,
      exposureId: 'exposure.p08.inspect',
      initialImplementationRefs: ['skill:skill.p06.inspect:1'],
      providerPolicySnapshot: {
        implementations: [
          {
            bindingId: 'binding.p06.skill.p06.inspect',
            implementationRef: 'skill:skill.p06.inspect:1',
            toolPolicy: {
              required: [{ serverId: 'server.p07', toolName: 'inspect' }],
              optional: [],
              forbidden: [],
            },
            runtimePolicy: {},
          },
        ],
      },
    });
    await expect(
      request('/internal/v1/tasks/task.p09.capability/capability-binding', {
        bearerToken: runtimeToken,
        expectedStatus: 200,
      }),
    ).resolves.toEqual(publicBinding);
    await expect(
      runtimePool.query(
        "UPDATE task_capability_binding SET requested_capability_id='mutated' WHERE task_id=$1",
        [task.taskId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await taskCapabilities.appendAttempt(task.taskId, {
      attemptId: 'capability-attempt-task.p09-2',
      reason: 'replan',
      planId: 'plan.p09.2',
    });
    await taskCapabilities.appendAttempt(task.taskId, {
      attemptId: 'capability-attempt-task.p09-3',
      reason: 'provider_failover',
      providerBindingRefs: ['mcp:binding.p09.failover:2'],
    });
    await taskCapabilities.appendAttempt(task.taskId, {
      attemptId: 'capability-attempt-task.p09-4',
      reason: 'recovery',
      planId: 'plan.p09.recovery',
    });
    const capabilityAttempts = await taskCapabilities.listAttempts(task.taskId);
    expect(capabilityAttempts.map((attempt) => attempt.reason)).toEqual([
      'initial',
      'replan',
      'provider_failover',
      'recovery',
    ]);
    expect(capabilityAttempts.map((attempt) => attempt.status)).toEqual([
      'superseded',
      'superseded',
      'superseded',
      'prepared',
    ]);
    expect(capabilityAttempts[0]?.providerBindingRefs).toEqual(['mcp-tool:server.p07:inspect']);
    await expect(
      taskCapabilities.assertTerminalSuccess(task.taskId, {
        condition: 'nominal',
        verified: false,
      }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
    await expect(
      taskCapabilities.assertTerminalSuccess(task.taskId, {
        condition: 'nominal',
        verified: true,
        policyEvidence: [{ type: 'authorization', satisfied: true }],
      }),
    ).resolves.toBeUndefined();
    await expect(
      request('/api/v1/capability-readiness/device.inspect.p06/1/evaluate', {
        method: 'POST',
        body: { reason: 'A changed request must not reuse the same key.' },
        idempotencyKey: 'p07-evaluate-readiness',
        expectedStatus: 409,
      }),
    ).resolves.toMatchObject({ code: 'CAPABILITY_READINESS_IDEMPOTENCY_KEY_REUSED' });

    await runtimePool.query(
      `UPDATE mcp_server SET updated_at='2020-01-01T00:00:00.000Z' WHERE server_id='server.p07'`,
    );
    const expired = await request('/api/v1/capability-readiness/device.inspect.p06/1/evaluate', {
      method: 'POST',
      body: { reason: 'Provider Availability TTL expired.' },
      idempotencyKey: 'p07-evaluate-expired-provider',
      expectedStatus: 202,
    });
    expect(expired).toMatchObject({
      status: 'succeeded',
      result: {
        status: 'unavailable',
        snapshotVersion: 2,
        reasons: [{ code: 'PROVIDER_AVAILABILITY_EXPIRED' }],
      },
    });
    const internalEvaluation = await request('/internal/v1/capability-readiness/evaluations', {
      method: 'POST',
      bearerToken: runtimeToken,
      idempotencyKey: 'p07-internal-readiness-evaluation',
      body: {
        reason: 'Runtime evaluates the frozen dependency input.',
        payload: {
          definition: { ...draft, status: 'published' },
          implementations: [binding('skill', 'skill.p06.inspect', '1')],
          maintenanceMode: false,
          killSwitch: false,
          ttlMs: 60_000,
          minimumStableWindowMs: 10_000,
          trigger: 'node.capability.version_published',
        },
      },
      expectedStatus: 202,
    });
    expect(internalEvaluation).toMatchObject({
      status: 'succeeded',
      result: { status: 'unavailable', snapshotVersion: 3 },
    });
    const persisted = await request('/api/v1/capability-readiness/device.inspect.p06/1', {
      expectedStatus: 200,
    });
    expect(persisted).toMatchObject({ status: 'unavailable', snapshotVersion: 3 });
    await expect(
      runtimePool.query(
        `UPDATE capability_readiness_snapshot SET status='available'
          WHERE capability_id='device.inspect.p06' AND capability_version=1`,
      ),
    ).rejects.toMatchObject({ code: '55000' });
    const readinessEvidence = await runtimePool.query<{
      snapshot_hash: string;
      event_count: string;
    }>(
      `SELECT snapshot.snapshot_hash,
              (SELECT COUNT(*)::text FROM cognitive_runtime_outbox
                WHERE event_type='node.capability.readiness_changed'
                  AND aggregate_id='device.inspect.p06:1') AS event_count
         FROM capability_readiness_snapshot snapshot
        WHERE snapshot.capability_id='device.inspect.p06' AND snapshot.capability_version=1
        ORDER BY snapshot.snapshot_version DESC LIMIT 1`,
    );
    expect(readinessEvidence.rows[0]?.snapshot_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(readinessEvidence.rows[0]?.event_count).toBe('2');
    const controlCopy = await controlPool.query<{ exists: boolean }>(
      `SELECT to_regclass('sdar_control.capability_readiness_snapshot') IS NOT NULL AS exists`,
    );
    expect(controlCopy.rows[0]?.exists).toBe(false);

    await controlApi?.close();
    controlApi = await startTestApi();
    await expect(
      request('/api/v1/capability-readiness/device.inspect.p06/1', { expectedStatus: 200 }),
    ).resolves.toEqual(persisted);
    await expect(
      controlPool.query(
        `UPDATE sdar_control.node_capability_definition_version
            SET description='mutated promise'
          WHERE capability_id='device.inspect.p06' AND version=1`,
      ),
    ).rejects.toMatchObject({ code: '55000' });

    await expect(
      request('/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations', {
        method: 'POST',
        body: binding('skill', 'skill.p06.inspect', '1'),
        idempotencyKey: 'p06-create-skill-binding',
        expectedStatus: 201,
      }),
    ).resolves.toEqual(activeBinding);

    const lateBinding = await request(
      '/api/v1/node-capabilities/device.inspect.p06/versions/1/implementations',
      {
        method: 'POST',
        body: { ...binding('skill', 'skill.p06.inspect', '1'), bindingId: 'binding.p06.late' },
        idempotencyKey: 'p06-reject-late-binding',
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

async function command(
  path: string,
  key: string,
  reason: string,
  ifMatch: string,
  expectedStatus: number,
) {
  return request(path, {
    method: 'POST',
    body: { reason },
    idempotencyKey: key,
    ifMatch,
    expectedStatus,
  });
}

async function request(
  path: string,
  options: Readonly<{
    method?: string;
    body?: unknown;
    idempotencyKey?: string;
    ifMatch?: string;
    bearerToken?: string;
    expectedStatus: number;
  }>,
) {
  const response = await fetch(`${requireApi().baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${options.bearerToken ?? apiToken}`,
      'content-type': 'application/json',
      ...(options.idempotencyKey === undefined
        ? {}
        : { 'idempotency-key': options.idempotencyKey }),
      ...(options.ifMatch === undefined ? {} : { 'if-match': options.ifMatch }),
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
              sdar_control.agent_card_revision,
              sdar_control.a2a_exposure_version,
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
  await runtimePool.query(
    `DELETE FROM cognitive_runtime_outbox
      WHERE event_type IN ('node.capability.readiness_changed','node.task.capability_bound')`,
  );
  await runtimePool.query(
    'TRUNCATE capability_readiness_command_receipt,capability_readiness_snapshot',
  );
  await runtimePool.query('TRUNCATE task_capability_execution_attempt,task_capability_binding');
  await runtimePool.query("DELETE FROM task_execution_attempt WHERE task_id='task.p09.capability'");
  await runtimePool.query("DELETE FROM runtime_event WHERE task_id='task.p09.capability'");
  await runtimePool.query("DELETE FROM agent_task WHERE task_id='task.p09.capability'");
  await runtimePool.query(
    "DELETE FROM conversation_context WHERE context_id='context.p09.capability'",
  );
  await runtimePool.query(
    'TRUNCATE runtime_agent_card_exposure_snapshot,runtime_agent_card_command_receipt,runtime_agent_card_revision',
  );
  await runtimePool.query("DELETE FROM skill_version WHERE skill_id='skill.p06.inspect'");
  await runtimePool.query("DELETE FROM skill WHERE skill_id='skill.p06.inspect'");
  await runtimePool.query("DELETE FROM mcp_tool WHERE server_id='server.p07'");
  await runtimePool.query("DELETE FROM mcp_server WHERE server_id='server.p07'");
  await runtimePool.query("DELETE FROM stage_model_route WHERE provider_id='model.p07'");
  await runtimePool.query("DELETE FROM model_provider WHERE provider_id='model.p07'");
}
