import { verifyDelayedCanonicalParent } from '../test-support/gowm-canonical-peer.js';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  cancelA2ATestTaskAtUrl,
  submitA2ATestMessageAtUrl,
} from '../../../packages/a2a-adapter/test-support/client.js';
import { startFrozenMcpTasksMockProvider } from '../../../packages/mcp-adapter/src/frozen-v1-mock-provider.js';
import { canonicalHash } from '../../../packages/application/src/mcp-task-readiness.js';
import { startServerRuntime, type ServerRuntimeHandle } from '../src/runtime.js';
import { startGowmModelProvider } from '../test-support/gowm-model-provider.js';

const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);

/** Real composition/API/SQL regression. Directory provisioning alone uses the fixture admin. */
export async function verifyGowmRuntimeExecution(
  outcome: 'immediate_success' | 'task_success' = 'immediate_success',
  scenario: 'success' | 'cancel' | 'parent-cancel' = 'success',
): Promise<number> {
  assert.equal(process.env['GOWM_BUSINESS_SMOKE_ENABLE'], 'true');
  const consumer = process.env['GOWM_RUNTIME_CONSUMER_TEST_DATABASE_URL'];
  const admin = process.env['GOWM_RUNTIME_TEST_DATABASE_URL'];
  const peerUrl = process.env['GOWM_RUNTIME_PEER_TEST_DATABASE_URL'];
  assert.ok(consumer && admin && peerUrl);
  for (const raw of [consumer, admin, peerUrl]) {
    const url = new URL(raw);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55490');
    assert.equal(url.pathname, '/sdar_gowm_runtime_test');
  }
  const run = `gowm-runtime-${randomUUID()}`;
  const devices = [`${run}-a`, `${run}-b`];
  const dataScope = `TEST:${run}`;
  const serverId = `${run}-mcp`;
  const skillId = `${run}-skill`;
  const taskTypeId = `${run}-read`;
  const capabilityId = `${run}-state`;
  const spatialTarget = { x: 12, y: 34, frame: 'LOCAL:synthetic-grid' };
  const spatialInputSchema = {
    type: 'object',
    properties: {
      resourceId: { type: 'string', minLength: 1 },
      target: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          frame: { type: 'string', minLength: 1 },
        },
        required: ['x', 'y', 'frame'],
        additionalProperties: false,
      },
    },
    required: ['resourceId', 'target'],
    additionalProperties: false,
    'x-sdar-targets': [
      { argumentPath: '/target', purpose: 'observation', format: 'xy', crsPath: '/target/frame' },
    ],
  };
  const fixture = new Pool({ connectionString: admin });
  const observer = new Pool({ connectionString: consumer });
  const peer = new Pool({ connectionString: peerUrl });
  const provider = await startFrozenMcpTasksMockProvider({
    outcome,
    holdUntilCancelled: scenario !== 'success',
    genericReadEffects: ['effect.gowm.state_read'],
    genericReadInputSchema: spatialInputSchema,
    taskIdFormat: 'uuid',
  });
  const model = await startGowmModelProvider({
    expectedWorkflowStatus: scenario !== 'success' ? 'failed' : 'succeeded',
    taskTypeId,
    capabilityId,
    skillId,
    serverId,
    toolName: 'task_success',
    deviceIds: devices,
    spatialTarget,
  });
  let runtime: ServerRuntimeHandle | undefined;
  const tasks: string[] = [];
  const report: Record<string, unknown> = {
    run,
    mcpOutcome: outcome,
    scenario,
    status: 'INCOMPLETE',
    acceptanceStatus: 'INCOMPLETE',
    remainingCoverage: [
      'Remote cancellation/process-loss/reconnection combinations',
      'Normal Polygon/LineString and target revision/rollback combinations',
      'all background consumers and retention',
      'final prescribed checks and single-repository delivery',
    ],
    scope: 'Normal Server dual-device Task/Skill/Workflow via local Model and Frozen MCP fixtures',
    modelBoundary: 'simulated_local_protocol_fixture',
  };
  try {
    await fixture.query(
      "INSERT INTO public.data_scope(scope_key,operational_domain,description) VALUES($1,'TEST','Normal SDAR Server protocol fixture')",
      [dataScope],
    );
    for (const device of devices) {
      await fixture.query(
        "INSERT INTO public.world_object(id,object_type,data_scope_key) VALUES($1,'VEHICLE',$2)",
        [device, dataScope],
      );
      await fixture.query(
        "INSERT INTO gowm_device.device(device_id,data_scope_key,identifier_namespace,device_identifier,device_name,device_type) VALUES($1,$2,$3,$1,'Synthetic fixture','UGV')",
        [device, dataScope, run],
      );
      await fixture.query(
        'INSERT INTO gowm_device.device_service_binding(binding_id,data_scope_key,device_id,smpp_service_key,provider_id,resource_id,sdar_service_key,sdar_mcp_server_id) VALUES($1,$2,$3,$4,$5,$3,$6,$7)',
        [randomUUID(), dataScope, device, run, 'synthetic-peer', 'sdar-test', serverId],
      );
    }
    const keyPath = '.state/gowm-storage/runtime-master-key';
    let masterKey: string;
    try {
      masterKey = await readFile(keyPath, 'utf8');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      masterKey = randomBytes(32).toString('base64');
      await writeFile(keyPath, masterKey, { mode: 0o600, flag: 'wx' });
    }
    runtime = await startServerRuntime({
      postgresUrl: 'postgresql://unused.invalid/no-fallback',
      gowmStorage: {
        databaseUrl: consumer,
        serviceKey: 'sdar-test',
        allowedDeviceIds: devices,
        dataScopeKey: dataScope,
        includeNonDevice: false,
        contractDirectory: 'contracts/gowm-shared-storage/current',
      },
      redis: { host: '127.0.0.1', port: 56490 },
      masterKeyBase64: masterKey,
      queueName: run,
      applyMigrations: true,
      a2aHost: '127.0.0.1',
      a2aPort: 0,
      managementHost: '127.0.0.1',
      managementPort: 0,
      frozenMcpTasks: {
        isolationAcknowledged: true,
        queueName: `${run}-remote`,
        reconcileIntervalMs: 1000,
      },
      outboundEndpointPolicy: {
        unsafeTestOpen: false,
        mcpAllowedAuthorities: [provider.endpoint.host],
        providerAllowedAuthorities: [new URL(model.baseUrl).host],
      },
    });
    const post = async (path: string, body: unknown, method = 'POST') => {
      assert.ok(runtime);
      const response = await fetch(runtime.management.baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      assert.ok(response.ok, `${path}:${String(response.status)}:${raw}`);
      return raw === '' ? undefined : (JSON.parse(raw) as unknown);
    };
    const providerId = `${run}-model`;
    // The pinned GOWM schema installer does not seed standalone deployment policy rows.
    // Configure the same existing 300-second baseline via its normal management API.
    await post('/api/v1/system/task-wait-policy', { timeoutSeconds: 300 }, 'PUT');
    await post(
      `/api/v1/models/providers/${providerId}`,
      {
        providerId,
        name: providerId,
        kind: 'openai_compatible',
        apiStyle: 'openai_chat_completions',
        baseUrl: model.baseUrl,
        model: 'gowm-isolated-fixture',
        enabled: true,
        timeoutMs: 30000,
        credentialHeaders: {},
      },
      'PUT',
    );
    const { MODEL_STAGES } = await import('../../../packages/domain/src/model-runtime.js');
    for (const stage of MODEL_STAGES) {
      await post(
        `/api/v1/models/routes/${stage}`,
        { providerId, operation: 'structured_generation' },
        'PUT',
      );
      await post(`/api/v1/models/routes/${stage}`, { providerId, operation: 'embedding' }, 'PUT');
    }
    await runtime.registerMcpServer({
      serverId,
      name: serverId,
      endpoint: provider.endpoint.href,
      credentialHeaders: {},
    });
    const outcomeSpecification = {
      schemaVersion: '1.0' as const,
      skillId,
      skillVersion: 1,
      effects: ['effect.gowm.state_read'],
      evidence: ['evidence.gowm.state'],
      artifacts: [],
      taskGoalPolicy: {},
      confidencePolicy: {},
      sideEffectPolicy: { classification: 'read_only' },
    };
    await runtime.registerSkill({
      skillId,
      name: 'Read synthetic device state',
      summary: 'Read one synthetic device state',
      description: 'Isolated protocol fixture',
      capabilities: [capabilityId],
      workflowGuidance: `Call ${serverId}/task_success exactly once using input resourceId`,
      outputInstruction: 'Return actual structuredContent',
      inputSchema: {
        ...spatialInputSchema,
        properties: {
          ...spatialInputSchema.properties,
          resourceId: { type: 'string', enum: devices },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { const: 'online' },
          resourceId: { type: 'string', enum: devices },
          effectRefs: { type: 'array', items: { const: 'effect.gowm.state_read' }, minItems: 1 },
        },
        required: ['status', 'resourceId', 'effectRefs'],
        additionalProperties: false,
      },
      toolPolicy: {
        required: [{ serverId, toolName: 'task_success' }],
        optional: [],
        forbidden: [],
      },
      runtimePolicy: { autoConfirmPlan: false },
      usageSpecification: {
        apiVersion: 'sdar.io/v1alpha1',
        visibility: { userSelectable: true, composable: true, internalOnly: false },
        normative: {
          constraints: ['Read only'],
          forbiddenActions: ['Write operations'],
          requiredConfirmations: [],
          noApplicableSkill: 'reject',
        },
        adaptive: {
          instructions: [`Call ${serverId}/task_success once`],
          optimizationHints: [],
          allowPreferredProviderFallback: false,
        },
        contextRequirements: [],
        modes: {
          supported: ['guidance'],
          defaultMode: 'guidance',
          guidance: {
            summary: 'Read synthetic state',
            instructions: ['Use explicit resourceId and return actual observation'],
          },
        },
        taskBindings: [],
        evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
      },
      outcomeSpecification: {
        ...outcomeSpecification,
        specificationHash: canonicalHash(outcomeSpecification),
      },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
    });
    // Retire only previous registrations owned by this isolated test. Equal synthetic
    // embeddings must not crowd the bounded production recall window across reruns.
    const previousTypes = await observer.query<{ knowledge_id: string; version: number }>(
      `SELECT knowledge_id,version FROM ugv_sdar.task_type_definition
       WHERE definition_origin='configured' AND status='active'
         AND knowledge_id ~ '^gowm-runtime-[0-9a-f-]{36}-read$' ORDER BY knowledge_id`,
    );
    for (const previous of previousTypes.rows) {
      await post(
        `/api/v1/knowledge/task_type/${encodeURIComponent(previous.knowledge_id)}/deprecate`,
        {
          expectedVersion: previous.version,
          actorId: 'isolated-fixture',
          idempotencyKey: `${run}:retire:${previous.knowledge_id}`,
          reason: 'Retire a prior isolated protocol fixture; retain its immutable Task history',
        },
      );
    }
    report['retiredPriorFixtureTypes'] = previousTypes.rows.length;
    await post('/api/v1/task-types/configured', {
      actorId: 'isolated-fixture',
      idempotencyKey: run,
      reason: 'Isolated normal Server integration',
      humanApproved: true,
      policyAllowed: true,
      definition: {
        taskTypeId,
        version: 1,
        title: 'Read synthetic device state',
        recognitionHints: devices,
        requiredDimensions: ['target', 'criteria'],
        capabilityRequirements: [capabilityId],
        risks: [],
      },
    });
    for (const device of devices) {
      const result = await submitA2ATestMessageAtUrl(runtime.a2a.baseUrl, {
        message: {
          messageId: randomUUID(),
          role: 'ROLE_USER',
          parts: [{ text: `Read synthetic device ${device} state once` }],
          metadata: {
            'io.sdar/deviceId': device,
            structured_input: { resourceId: device, target: spatialTarget },
          },
        },
        configuration: { returnImmediately: true },
      });
      const taskId = result.id;
      tasks.push(taskId);
      let task: Record<string, unknown> = {};
      for (let attempt = 0; attempt < 100; attempt++) {
        task = record(
          await (await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${taskId}`)).json(),
        );
        if (['awaiting_plan_confirmation', 'failed', 'completed'].includes(String(task['phase'])))
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(task['phase'], 'awaiting_plan_confirmation', JSON.stringify(task));
      assert.equal(provider.toolCallCount, tasks.length - 1, 'No tools before confirmation');
      await post(`/api/v1/tasks/${taskId}/actions`, {
        action: 'confirm_plan',
        messageText: 'Confirm the exact single read plan',
      });
      if (scenario !== 'success') {
        const canceledPlanId = task['planId'];
        let bindingId: string | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          bindingId = (
            await observer.query<{ binding_id: string }>(
              'SELECT binding_id FROM ugv_sdar.remote_task_binding WHERE agent_task_id=$1',
              [taskId],
            )
          ).rows[0]?.binding_id;
          if (bindingId !== undefined) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(bindingId, 'Confirmed Task must persist its remote binding');
        if (scenario === 'parent-cancel') {
          for (let repeat = 0; repeat < 2; repeat++) {
            const canceled = await cancelA2ATestTaskAtUrl(runtime.a2a.baseUrl, taskId);
            assert.equal(canceled.state, 'canceled');
          }
          const persisted = (
            await observer.query<{ phase: string; device_id: string }>(
              'SELECT phase,device_id FROM ugv_sdar.agent_task WHERE task_id=$1',
              [taskId],
            )
          ).rows[0];
          assert.deepEqual(persisted, { phase: 'canceled', device_id: device });
          const instances = (
            await observer.query<{ status: string; device_id: string }>(
              'SELECT status,device_id FROM ugv_sdar.workflow_instance WHERE plan_id=$1',
              [canceledPlanId],
            )
          ).rows;
          assert.ok(instances.length > 0);
          assert.ok(
            instances.every(
              (instance) => instance.status === 'canceled' && instance.device_id === device,
            ),
          );
          assert.equal(provider.toolCallCount, tasks.length);
          report[`parentCancellation:${device}`] = { task: persisted, instances };
          continue;
        }
        const cancel = {
          idempotencyKey: `${run}:${device}:cancel`,
          reasonCode: 'ISOLATED_READ_CANCEL',
          summary: 'Cancel held synthetic read',
        };
        await post(`/api/v1/remote-task-bindings/${bindingId}/cancel`, cancel);
        await post(`/api/v1/remote-task-bindings/${bindingId}/cancel`, cancel);
        let state: Record<string, unknown> | undefined;
        for (let attempt = 0; attempt < 150; attempt++) {
          state = (
            await observer.query<Record<string, unknown>>(
              `SELECT b.device_id,b.protocol_status,b.local_state,c.delivery_status,c.provider_terminal_status,
             (SELECT count(*)::integer FROM ugv_sdar.remote_task_cancel_request x WHERE x.binding_id=b.binding_id) AS requests,
             (SELECT count(*)::integer FROM ugv_sdar.remote_task_cancel_attempt x WHERE x.binding_id=b.binding_id) AS attempts,
             (SELECT count(*)::integer FROM ugv_sdar.mcp_invocation x WHERE x.task_id=b.agent_task_id) AS invocations
             FROM ugv_sdar.remote_task_binding b JOIN ugv_sdar.remote_task_cancel_request c USING(binding_id)
             WHERE b.binding_id=$1`,
              [bindingId],
            )
          ).rows[0];
          if (state?.['provider_terminal_status'] === 'cancelled') break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(state);
        assert.equal(state['device_id'], device);
        assert.equal(state['protocol_status'], 'cancelled', JSON.stringify(state));
        assert.equal(state['provider_terminal_status'], 'cancelled');
        assert.equal(state['delivery_status'], 'acknowledged');
        assert.equal(state['requests'], 1);
        assert.equal(state['attempts'], 1);
        assert.equal(state['invocations'], 1);
        assert.equal(provider.toolCallCount, tasks.length);
        for (let attempt = 0; attempt < 150; attempt++) {
          task = record(
            await (await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${taskId}`)).json(),
          );
          if (task['phase'] === 'awaiting_plan_confirmation' && task['planId'] !== canceledPlanId)
            break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(task['phase'], 'awaiting_plan_confirmation', JSON.stringify(task));
        assert.notEqual(task['planId'], canceledPlanId);
        assert.equal(
          provider.toolCallCount,
          tasks.length,
          'Replacement plan must not execute without confirmation',
        );
        const terminal = (
          await observer.query<{ local_state: string }>(
            'SELECT local_state FROM ugv_sdar.remote_task_binding WHERE binding_id=$1',
            [bindingId],
          )
        ).rows[0];
        assert.equal(terminal?.local_state, 'reentered');
        report[`cancellation:${device}`] = {
          ...state,
          local_state: terminal.local_state,
          taskPhase: task['phase'],
        };
        continue;
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        task = record(
          await (await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${taskId}`)).json(),
        );
        if (['completed', 'failed'].includes(String(task['phase']))) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(task['phase'], 'completed', JSON.stringify(task));
      const lineage = await observer.query<{ layer: string; device_id: string; count: string }>(
        `SELECT 'task' AS layer,device_id,count(*)::text AS count FROM ugv_sdar.agent_task WHERE task_id=$1 GROUP BY device_id
         UNION ALL SELECT 'plan',device_id,count(*)::text FROM ugv_sdar.workflow_plan WHERE plan_id=$2 GROUP BY device_id
         UNION ALL SELECT 'instance',device_id,count(*)::text FROM ugv_sdar.workflow_instance WHERE plan_id=$2 GROUP BY device_id
         UNION ALL SELECT 'node_event',e.device_id,count(*)::text FROM ugv_sdar.workflow_node_event e JOIN ugv_sdar.workflow_instance i USING(instance_id) WHERE i.plan_id=$2 GROUP BY e.device_id
         UNION ALL SELECT 'invocation',device_id,count(*)::text FROM ugv_sdar.mcp_invocation WHERE task_id=$1 GROUP BY device_id
         UNION ALL SELECT 'a2a_projection',device_id,count(*)::text FROM ugv_sdar.external_task_projection WHERE task_id=$1 GROUP BY device_id`,
        [taskId, task['planId']],
      );
      assert.deepEqual(lineage.rows.map((row) => row.layer).sort(), [
        'a2a_projection',
        'instance',
        'invocation',
        'node_event',
        'plan',
        'task',
      ]);
      for (const row of lineage.rows) {
        assert.equal(row.device_id, device);
        assert.ok(Number(row.count) > 0);
      }
      assert.equal(lineage.rows.find((row) => row.layer === 'invocation')?.count, '1');
      const persisted = await observer.query<{
        result_json: unknown;
        budget_usage_json: { mcpCalls: number };
      }>('SELECT result_json,budget_usage_json FROM ugv_sdar.workflow_instance WHERE plan_id=$1', [
        task['planId'],
      ]);
      assert.deepEqual(persisted.rows[0]?.result_json, {
        status: 'online',
        resourceId: device,
        effectRefs: ['effect.gowm.state_read'],
      });
      assert.equal(persisted.rows[0].budget_usage_json.mcpCalls, 1);
      report[`lineage:${device}`] = lineage.rows;
      let interaction;
      for (let attempt = 0; attempt < 30; attempt++) {
        const rows = await observer.query<{
          device_id: string;
          outcome_ref: string;
          revision: number;
        }>(
          'SELECT device_id,outcome_ref,revision FROM ugv_sdar.planning_interaction_episode WHERE task_id=$1 ORDER BY revision',
          [taskId],
        );
        interaction = rows.rows[0];
        if (interaction !== undefined) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(interaction, 'Terminal planning interaction must actually be captured');
      assert.equal(interaction.device_id, device);
      assert.equal(interaction.outcome_ref, `runtime-outcome:terminal-outcome-task-${taskId}`);
      report[`planningInteraction:${device}`] = interaction;
      const judged = await observer.query<{ decisions: number; effects: number }>(
        `SELECT (SELECT count(*)::integer FROM ugv_sdar.outcome_decision WHERE decision_json->>'executionTaskId'=$1) AS decisions,
          (SELECT count(*)::integer FROM ugv_sdar.completed_effect WHERE effect_json->>'executionTaskId'=$1) AS effects`,
        [taskId],
      );
      assert.equal(judged.rows[0]?.decisions, 3);
      assert.equal(judged.rows[0].effects, 1);
      report[`outcomeProvenance:${device}`] = judged.rows[0];

      let evidence;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await observer.query<{ device_id: string; record_type: string }>(
          "SELECT device_id,record_type FROM ugv_sdar.evidence_outbox WHERE task_id=$1 AND record_type='runtime.episode'",
          [taskId],
        );
        evidence = rows.rows[0];
        if (evidence !== undefined) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(evidence, 'Normal background projector must persist the Task episode');
      assert.equal(evidence.device_id, device);
      report[`runtimeEvidence:${device}`] = evidence;

      const targetRows = await observer.query<{
        usage_role: string;
        owner_kind: string;
        native_geometry: unknown;
        native_crs: string;
        geometry_wgs84: unknown;
        owner_key: unknown;
      }>(
        `SELECT usage_role,owner_kind,native_geometry,native_crs,geometry_wgs84,owner_key
         FROM gowm_business_v1.task_target_geometries WHERE device_id=$1 ORDER BY usage_role`,
        [device],
      );
      assert.deepEqual(
        targetRows.rows.map((row) => row.usage_role),
        outcome === 'task_success'
          ? ['DISPATCHED', 'PLANNED', 'REQUESTED']
          : ['PLANNED', 'REQUESTED'],
      );
      for (const targetRow of targetRows.rows) {
        assert.deepEqual(targetRow.native_geometry, { type: 'Point', coordinates: [12, 34] });
        assert.equal(targetRow.native_crs, spatialTarget.frame);
        assert.equal(targetRow.geometry_wgs84, null);
        assert.equal(
          targetRow.owner_kind,
          { REQUESTED: 'TASK', PLANNED: 'PLAN_NODE', DISPATCHED: 'NODE_RUN' }[targetRow.usage_role],
        );
      }
      const invoked = await observer.query<{ arguments_json: unknown }>(
        'SELECT arguments_json FROM ugv_sdar.mcp_invocation WHERE task_id=$1',
        [taskId],
      );
      assert.deepEqual(
        invoked.rows.map((row) => row.arguments_json),
        [{ resourceId: device, target: spatialTarget }],
      );
      if (outcome === 'immediate_success')
        assert.equal(
          (
            await observer.query(
              'SELECT 1 FROM ugv_sdar.remote_task_binding WHERE agent_task_id=$1',
              [taskId],
            )
          ).rowCount,
          0,
        );
      report[`targets:${device}`] = targetRows.rows;

      if (outcome === 'task_success') {
        // Task terminal commit precedes the continuation worker's final acknowledgement.
        // Observe that acknowledgement; do not weaken the final state assertions below.
        let acknowledged = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          const current = await observer.query<{ done: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM ugv_sdar.remote_task_binding b
              JOIN ugv_sdar.workflow_continuation_snapshot s ON s.agent_task_id=b.agent_task_id
              JOIN ugv_sdar.workflow_continuation_attempt a USING(snapshot_id)
              WHERE b.agent_task_id=$1 AND b.local_state='reentered' AND a.status='succeeded') AS done`,
            [taskId],
          );
          acknowledged = current.rows[0]?.done === true;
          if (acknowledged) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(acknowledged, 'Continuation acknowledgement did not complete');
        const remote = await observer.query<{
          device_id: string;
          smpp_service_key: string;
          protocol_status: string;
          local_state: string;
          canonical_mcp_task_id: string | null;
        }>(
          'SELECT device_id,smpp_service_key,protocol_status,local_state,canonical_mcp_task_id FROM ugv_sdar.remote_task_binding WHERE agent_task_id=$1',
          [taskId],
        );
        assert.deepEqual(remote.rows, [
          {
            device_id: device,
            smpp_service_key: run,
            protocol_status: 'completed',
            local_state: 'reentered',
            canonical_mcp_task_id: null,
          },
        ]);
        const capturedTool = await observer.query<{
          operation_name: string;
          input_schema: unknown;
        }>(
          `SELECT authority_snapshot_json->'runtime'->'toolInput'->>'operationName' AS operation_name,
                  authority_snapshot_json->'runtime'->'toolInput'->'inputSchema' AS input_schema
             FROM ugv_sdar.remote_task_binding WHERE agent_task_id=$1`,
          [taskId],
        );
        assert.equal(capturedTool.rows.length, 1);
        assert.ok(capturedTool.rows[0]?.operation_name);
        assert.equal(record(capturedTool.rows[0].input_schema)['type'], 'object');
        report[`frozenTool:${device}`] = {
          operation: capturedTool.rows[0].operation_name,
          inputSchemaHash: canonicalHash(capturedTool.rows[0].input_schema),
        };
        const snapshots = await observer.query<{
          schema_version: string;
          lifecycle: string;
          workflow_instance_id: string;
        }>(
          'SELECT schema_version,lifecycle,workflow_instance_id FROM ugv_sdar.workflow_continuation_snapshot WHERE agent_task_id=$1',
          [taskId],
        );
        assert.equal(snapshots.rows.length, 1);
        assert.equal(snapshots.rows[0]?.schema_version, '2.0');
        assert.equal(snapshots.rows[0].lifecycle, 'terminal');
        const attempts = await observer.query<{ status: string; error_code: string | null }>(
          'SELECT a.status,a.error_code FROM ugv_sdar.workflow_continuation_attempt a JOIN ugv_sdar.workflow_continuation_snapshot s USING(snapshot_id) WHERE s.agent_task_id=$1',
          [taskId],
        );
        assert.deepEqual(attempts.rows, [{ status: 'succeeded', error_code: null }]);
        report[`canonical:${device}`] = await verifyDelayedCanonicalParent({
          observer,
          peer,
          taskId,
          deviceId: device,
          toolCallCount: () => provider.toolCallCount,
        });
        report[`remote:${device}`] = {
          binding: remote.rows[0],
          snapshots: snapshots.rows,
          attempts: attempts.rows,
        };
      }
    }
    assert.equal(provider.toolCallCount, 2);
    assert.deepEqual(model.failures, []);
    report['status'] = 'PASS';
  } catch (error) {
    report['status'] = 'FAIL';
    report['error'] = error instanceof Error ? error.message : 'UNKNOWN_FAILURE';
  } finally {
    report['taskIds'] = tasks;
    report['modelStages'] = model.calls;
    report['modelFixtureFailures'] = model.failures;
    report['toolCalls'] = provider.toolCallCount;
    const cleanupErrors: string[] = [];
    for (const close of [
      () => runtime?.close(),
      () => model.close(),
      () => provider.close(),
      () => fixture.end(),
      () => observer.end(),
      () => peer.end(),
    ]) {
      try {
        await close();
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : 'UNKNOWN_CLEANUP_FAILURE');
      }
    }
    report['cleanupErrors'] = cleanupErrors;
    if (cleanupErrors.length > 0) report['status'] = 'FAIL';
    const directory = 'reports/sdar-gowm-shared-storage-integration-v0.1';
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/execution-${run}.json`, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report) + '\n');
  }
  return report['status'] === 'PASS' ? 0 : 1;
}
