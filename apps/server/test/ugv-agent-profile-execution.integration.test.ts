import { randomBytes, randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createA2ATestSendMessageBody } from '../../../packages/a2a-adapter/test-support/client.js';

import {
  assertUgvGovernedControlAuthority,
  McpRuntimeBindingAuthorityVerifier,
} from '../../../packages/application/src/index.js';
import {
  deriveFrozenMcpCatalogAuthority,
  hashCanonicalEvidenceJson,
  type EvidenceJsonValue,
  type McpToolExecutionSemantics,
} from '../../../packages/domain/src/index.js';
import {
  FrozenV1McpClient,
  FrozenV1RuntimeAvailabilityAdapter,
} from '../../../packages/mcp-adapter/src/index.js';
import {
  PostgresMcpRegistryRepository,
  PostgresUgvGovernedControlAuthorityReader,
} from '../../../packages/persistence-postgres/src/index.js';
import type {
  CapabilityAuthoritySnapshot,
  CurrentMcpProviderBindingAuthoritySnapshot,
} from '../../../packages/runtime-control-application/src/index.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../test-support/postgres.js';
import {
  startUgvFrozenMcpProvider,
  type UgvFrozenMcpProviderHandle,
} from '../test-support/ugv-frozen-mcp-provider.js';
import { ConfiguredTrustedIntranetGovernedControlIdentity } from '../src/governed-control-management-identity.js';
import { startServerRuntime, type ServerRuntimeHandle } from '../src/runtime.js';
import {
  UGV_AGENT_PROFILE_ID,
  ugvAgentProfileTaskUnderstandingConfiguration,
} from '../src/ugv-agent-profile.js';
import { createUgvSimulationTargetPolicy } from '../src/ugv-move-skill-usage.js';
import { adaptUgvMoveInput } from '../src/ugv-move-input-adapter.js';
import { UGV_MOVE_WORKFLOW_NODE_IDS } from '../src/ugv-move-workflow.js';

const postgresAdminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_uap_p2_b03_local_only@127.0.0.1:55444/sdar';
const databaseName = 'sdar_uap_p2_b03_runtime_execution';
const postgresUrl = isolatedDatabaseUrl(postgresAdminUrl, databaseName);
const redisPort = Number(process.env['SDAR_REDIS_PORT'] ?? '56379');
const serverId = 'ugv-runtime-p2-b03';
const providerBindingId = 'smpp-binding-ugv1-p2-b03';
const exposureId = 'a2a.embodied.move';
const implementationBindingId = 'embodied.move_to-primary-p2-b03';
const runId = 'uap-p3-b02-p2b03-runtime-e2e';
const masterKeyBase64 = randomBytes(32).toString('base64');
const queueName = `uap-p2-b03-context-${randomUUID()}`;
const remoteQueueName = `uap-p2-b03-remote-${randomUUID()}`;
const target = Object.freeze({ x: 106.8134463, y: 29.72034353, frame: 'WGS84' as const });
const capabilityInput = Object.freeze({
  resourceId: 'vehicle:ugv1',
  target: Object.freeze({ ...target }),
});

let runtime: ServerRuntimeHandle | undefined;
let pool: Pool | undefined;
let provider: UgvFrozenMcpProviderHandle | undefined;
let providerAuthority: CurrentMcpProviderBindingAuthoritySnapshot | undefined;
let capabilityAuthority: CapabilityAuthoritySnapshot | undefined;
let databaseCreated = false;

type EvidenceRecord = Readonly<Record<string, EvidenceJsonValue>>;

const oldSideEffectEnabled = process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'];
const oldSimulationRunId = process.env['UGV_SIMULATION_RUN_ID'];

const providerBindingAuthorityReader = Object.freeze({
  loadCurrentMcpProviderBinding(
    input: Readonly<{ bindingId?: string; localServerId: string }>,
  ): Promise<CurrentMcpProviderBindingAuthoritySnapshot> {
    if (
      providerAuthority === undefined ||
      input.localServerId !== serverId ||
      (input.bindingId !== undefined && input.bindingId !== providerBindingId)
    )
      return Promise.reject(new Error('UGV_P2_B03_PROVIDER_AUTHORITY_UNAVAILABLE'));
    return Promise.resolve(providerAuthority);
  },
});

const capabilityAuthorityReader = Object.freeze({
  load(capabilityId: string, version: number): Promise<CapabilityAuthoritySnapshot> {
    if (capabilityAuthority === undefined || capabilityId !== 'embodied.move' || version !== 2)
      return Promise.reject(new Error('UGV_P2_B03_CAPABILITY_AUTHORITY_UNAVAILABLE'));
    return Promise.resolve(capabilityAuthority);
  },
});

beforeAll(async () => {
  process.env['ALLOW_UGV_SIMULATION_SIDE_EFFECTS'] = 'YES';
  process.env['UGV_SIMULATION_RUN_ID'] = runId;
  await createIsolatedRuntimeDatabase(postgresAdminUrl, databaseName, { template: 'template0' });
  databaseCreated = true;
  provider = await startUgvFrozenMcpProvider();
  runtime = await startRuntime(true);
  pool = new Pool({ connectionString: postgresUrl, max: 4 });
}, 120_000);

afterAll(async () => {
  try {
    await runtime?.close();
  } finally {
    try {
      await pool?.end();
    } finally {
      try {
        await provider?.close();
      } finally {
        try {
          if (databaseCreated) await dropIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
        } finally {
          restoreEnvironment('ALLOW_UGV_SIMULATION_SIDE_EFFECTS', oldSideEffectEnabled);
          restoreEnvironment('UGV_SIMULATION_RUN_ID', oldSimulationRunId);
        }
      }
    }
  }
});

describe('UGV Agent Profile real PostgreSQL / Runtime / A2A composition', () => {
  it('admits SACS text on the trusted intranet, dispatches once only after confirmation, and resumes from PostgreSQL after restart', async () => {
    const firstRuntime = required(runtime, 'RUNTIME_NOT_STARTED');
    const database = required(pool, 'DATABASE_NOT_STARTED');
    const frozenProvider = required(provider, 'PROVIDER_NOT_STARTED');

    const imported = await postJson(
      `${firstRuntime.management.baseUrl}/api/v1/skill-packages/import`,
      { packageRoot: 'skills/embodied.move_to' },
    );
    expect(imported.status).toBe(201);
    await eventually(async () => {
      const result = await database.query<{ published: boolean }>(
        `SELECT published_at IS NOT NULL AS published
           FROM cognitive_runtime_outbox
          WHERE event_id='skill.catalog_changed:embodied.move_to:1'`,
      );
      expect(result.rows).toEqual([{ published: true }]);
    });

    const registered = await firstRuntime.registerMcpServer({
      serverId,
      name: 'UGV SMPP P2-B03 composition fixture',
      endpoint: frozenProvider.endpoint.toString(),
      credentialHeaders: {},
    });
    const catalog = deriveFrozenMcpCatalogAuthority(
      registered.snapshot,
      registered.tools,
      registered.server.toolRevision,
    );
    const navigateTool = registered.tools.find((tool) => tool.toolName === 'vehicle_navigate');
    if (navigateTool === undefined) throw new Error('UGV_NAVIGATE_TOOL_NOT_DISCOVERED');
    const authorityObservedAt = new Date().toISOString();
    providerAuthority = createProviderAuthority(
      frozenProvider.endpoint,
      authorityObservedAt,
      catalog,
    );
    const constraints = fullCapabilityConstraints(catalog, navigateTool.executionSemantics);
    const successCriteria = fullSuccessCriteria();
    const requiredEvidence = hardEvidenceRequirements();
    const providerPolicyOverride = exactProviderPolicyOverride();
    capabilityAuthority = createCapabilityAuthority(constraints, providerPolicyOverride);
    await seedFormalCapabilityAuthority(
      database,
      constraints,
      successCriteria,
      requiredEvidence,
      providerPolicyOverride,
    );

    await firstRuntime.callMcpTool(
      serverId,
      'vehicle_get_state',
      { resourceId: 'vehicle:ugv1', include: ['chassis', 'health'] },
      undefined,
      { executionContext: { mode: 'simulation', simulationId: runId } },
    );
    const qualification = await firstRuntime.listMcpInvocations(serverId);
    expect(qualification).toEqual([
      expect.objectContaining({
        serverId,
        toolName: 'vehicle_get_state',
        executionMode: 'simulation',
        simulationId: runId,
        status: 'succeeded',
      }),
    ]);
    expect(qualification[0]).not.toHaveProperty('taskId');
    expect(frozenProvider.getStateCallCount).toBe(1);
    expect(frozenProvider.navigateCallCount).toBe(0);

    const publicCard = await fetch(`${firstRuntime.a2a.baseUrl}/.well-known/agent-card.json`).then(
      (response) => response.json(),
    );
    expect(JSON.stringify(publicCard)).toContain('io.sdar/naturalLanguageCapabilityAdmission');
    expect(JSON.stringify(publicCard)).toContain('a2a.embodied.move');
    expect(record(publicCard)['securityRequirements']).toEqual([]);

    const initialMessageId = `sacs-v03-natural-${randomUUID()}`;
    const submitted = await sendA2a(firstRuntime.a2a.baseUrl, initialRequest(initialMessageId));
    const task = responseTask(submitted);
    const taskId = text(task['id'], 'A2A_TASK_ID_MISSING');
    const contextId = text(task['contextId'], 'A2A_CONTEXT_ID_MISSING');
    const replayedSubmission = responseTask(
      await sendA2a(firstRuntime.a2a.baseUrl, initialRequest(initialMessageId)),
    );
    expect(replayedSubmission).toMatchObject({ id: taskId, contextId });
    const admissionCounts = await database.query<{
      admissions: number;
      tasks: number;
      bindings: number;
      attempts: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM initial_task_admission WHERE task_id=$1) admissions,
         (SELECT count(*)::integer FROM agent_task WHERE task_id=$1) tasks,
         (SELECT count(*)::integer FROM task_capability_binding WHERE task_id=$1) bindings,
         (SELECT count(*)::integer FROM task_capability_execution_attempt WHERE task_id=$1) attempts`,
      [taskId],
    );
    expect(admissionCounts.rows).toEqual([{ admissions: 1, tasks: 1, bindings: 1, attempts: 1 }]);

    const prepared = await eventually(async () => {
      const result = await database.query<{
        task: Readonly<Record<string, unknown>>;
        binding: Readonly<Record<string, unknown>>;
      }>(
        `SELECT to_jsonb(task) AS task,to_jsonb(binding) AS binding
           FROM agent_task task
           JOIN task_capability_binding binding ON binding.task_id=task.task_id
          WHERE task.task_id=$1`,
        [taskId],
      );
      const row = result.rows[0];
      if (row?.task['phase'] === 'failed')
        throw new Error(
          `UGV_PREPARATION_FAILED:${JSON.stringify({
            errorCode: row.task['error_code'],
            phaseMessage: row.task['phase_message'],
            goalId: row.task['goal_id'],
            userGoalPlanId: row.task['user_goal_plan_id'],
            selectedSkillId: row.task['selected_skill_id'],
            skillSelectionId: row.task['skill_selection_id'],
            skillInputResolutionId: row.task['skill_input_resolution_id'],
            planId: row.task['plan_id'],
          })}`,
        );
      expect(row?.task).toMatchObject({ phase: 'awaiting_plan_confirmation' });
      return required(row, 'PREPARED_TASK_NOT_FOUND');
    });

    expect(prepared.binding['constraint_snapshot']).toEqual(constraints);
    expect(prepared.binding['success_criteria_snapshot']).toEqual(successCriteria);
    expect(prepared.binding['evidence_requirement_snapshot']).toEqual(requiredEvidence);
    expect(prepared.binding['initial_implementation_refs']).toEqual(['skill:embodied.move_to:1']);
    expect(prepared.binding['input_snapshot']).toEqual(capabilityInput);
    const taskScopedBeforeConfirmation = await database.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM mcp_invocation WHERE task_id=$1',
      [taskId],
    );
    expect(taskScopedBeforeConfirmation.rows).toEqual([{ count: 0 }]);
    expect(frozenProvider.navigateCallCount).toBe(0);
    await assertFormalAdmissionAndPlanning(database, taskId);
    await assertGovernedControlIssueAuthority(database, frozenProvider.endpoint, taskId);

    const confirmed = await sendA2a(
      firstRuntime.a2a.baseUrl,
      confirmationRequest(taskId, contextId),
    );
    expect(responseTask(confirmed)['id']).toBe(taskId);

    const waiting = await eventually(async () => {
      const result = await database.query<{
        instance_id: string;
        status: string;
        task_phase: string;
        active_continuations: number;
        active_snapshot_id: string;
        admission_status: string;
        materialized_snapshot_id: string;
        remote_status: string;
        remote_state: string;
      }>(
        `SELECT instance.instance_id,instance.status,task.phase AS task_phase,
                (SELECT count(*)::integer FROM workflow_continuation_snapshot snapshot
                  WHERE snapshot.workflow_instance_id=instance.instance_id
                    AND snapshot.lifecycle='active') AS active_continuations,
                (SELECT min(snapshot.snapshot_id) FROM workflow_continuation_snapshot snapshot
                  WHERE snapshot.workflow_instance_id=instance.instance_id
                    AND snapshot.lifecycle='active') AS active_snapshot_id,
                intent.status AS admission_status,
                intent.materialized_snapshot_id,
                remote.protocol_status AS remote_status,remote.local_state AS remote_state
           FROM agent_task task
           JOIN workflow_instance instance ON instance.plan_id=task.plan_id
           JOIN remote_task_binding remote ON remote.workflow_instance_id=instance.instance_id
           JOIN remote_task_admission_intent intent ON intent.binding_id=remote.binding_id
          WHERE task.task_id=$1`,
        [taskId],
      );
      const row = result.rows[0];
      expect(row).toMatchObject({
        status: 'waiting_external',
        task_phase: 'executing',
        active_continuations: 1,
        admission_status: 'materialized',
        materialized_snapshot_id: expect.any(String),
        remote_status: 'working',
        remote_state: 'polling',
      });
      expect(row?.materialized_snapshot_id).toBe(row?.active_snapshot_id);
      return required(row, 'WAITING_EXTERNAL_EVIDENCE_NOT_FOUND');
    });
    const beforeRestartInvocations = await taskInvocations(database, taskId);
    expect(beforeRestartInvocations.map((item) => item.tool_name)).toEqual([
      'vehicle_get_state',
      'vehicle_navigate',
    ]);
    expect(beforeRestartInvocations[1]).toMatchObject({
      status: 'succeeded',
      control_provider_binding_id: providerBindingId,
      capability_attempt_id: expect.any(String),
    });
    expect(frozenProvider.getStateCallCount).toBe(2);
    expect(frozenProvider.navigateCallCount).toBe(1);
    expect(frozenProvider.navigateArguments).toEqual({
      resourceId: 'vehicle:ugv1',
      mission: {
        type: 'point',
        target: { longitude: target.x, latitude: target.y },
      },
      stopOnObstacle: true,
    });
    const consumed = await database.query<{
      actor_id: string;
      actor_kind: string;
      authentication_method: string;
      consumed_invocation_id: string | null;
    }>(
      `SELECT actor_id,actor_kind,authentication_method,consumed_invocation_id
         FROM governed_control_confirmation WHERE task_id=$1`,
      [taskId],
    );
    expect(consumed.rows).toEqual([
      {
        actor_id: 'uap-p2-b03-local-operator',
        actor_kind: 'human',
        authentication_method: 'trusted_intranet',
        consumed_invocation_id: beforeRestartInvocations[1]?.invocation_id,
      },
    ]);

    await firstRuntime.close();
    runtime = undefined;
    frozenProvider.releaseNavigation();
    runtime = await startRuntime(false);
    const restartedRuntime = runtime;

    await eventually(async () => {
      const result = await database.query<{
        phase: string;
        task_error_code: string | null;
        task_phase_message: string;
        instance_status: string;
        instance_errors: unknown;
        termination_reason: string | null;
        continuation_lifecycle: string | null;
        continuation_attempt_status: string | null;
        continuation_error_code: string | null;
        capability_attempt_status: string;
        remote_status: string;
        remote_state: string;
        outcome_kind: string | null;
      }>(
        `SELECT task.phase,task.error_code AS task_error_code,
                task.phase_message AS task_phase_message,
                instance.status AS instance_status,instance.errors_json AS instance_errors,
                instance.termination_reason,
                snapshot.lifecycle AS continuation_lifecycle,
                continuation_attempt.status AS continuation_attempt_status,
                continuation_attempt.error_code AS continuation_error_code,
                capability_attempt.status AS capability_attempt_status,
                remote.protocol_status AS remote_status,remote.local_state AS remote_state,
                outcome.outcome_kind
           FROM agent_task task
           JOIN workflow_instance instance ON instance.instance_id=$2
            AND instance.plan_id=task.plan_id
           LEFT JOIN workflow_continuation_snapshot snapshot
             ON snapshot.workflow_instance_id=instance.instance_id
            AND snapshot.state_version=(SELECT max(latest.state_version)
                                          FROM workflow_continuation_snapshot latest
                                         WHERE latest.continuation_id=snapshot.continuation_id)
           LEFT JOIN LATERAL (
             SELECT current_attempt.* FROM workflow_continuation_attempt current_attempt
              WHERE current_attempt.workflow_instance_id=instance.instance_id
              ORDER BY current_attempt.created_at DESC,current_attempt.attempt_id DESC LIMIT 1
           ) continuation_attempt ON true
           LEFT JOIN LATERAL (
             SELECT current_attempt.* FROM task_capability_execution_attempt current_attempt
              WHERE current_attempt.task_id=task.task_id
              ORDER BY current_attempt.attempt_no DESC LIMIT 1
           ) capability_attempt ON true
           LEFT JOIN remote_task_binding remote ON remote.workflow_instance_id=instance.instance_id
           LEFT JOIN runtime_terminal_outcome outcome ON outcome.task_id=task.task_id
          WHERE task.task_id=$1`,
        [taskId, waiting.instance_id],
      );
      const row = result.rows[0];
      if (row?.phase === 'failed') {
        const failedInvocations = await taskInvocations(database, taskId);
        expect(
          failedInvocations.filter((item) => item.tool_name === 'vehicle_navigate'),
        ).toHaveLength(1);
        expect(frozenProvider.navigateCallCount).toBe(1);
        throw new Error(
          `UGV_RESTART_TERMINAL_FAILED:${JSON.stringify({ row, failedInvocations, navigateCallCount: frozenProvider.navigateCallCount, getStateCallCount: frozenProvider.getStateCallCount })}`,
        );
      }
      expect(row).toMatchObject({
        phase: 'completed',
        instance_status: 'succeeded',
        continuation_lifecycle: 'terminal',
        continuation_attempt_status: 'succeeded',
        capability_attempt_status: 'succeeded',
        remote_status: 'completed',
        remote_state: 'reentered',
        outcome_kind: 'achieved',
      });
    }, 30_000);

    const finalInvocations = await taskInvocations(database, taskId);
    expect(finalInvocations.map((item) => item.tool_name)).toEqual([
      'vehicle_get_state',
      'vehicle_navigate',
      'vehicle_get_state',
    ]);
    expect(frozenProvider.navigateCallCount).toBe(1);
    expect(frozenProvider.getStateCallCount).toBe(3);
    const navigateStarts = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM workflow_node_event event
         JOIN workflow_instance instance ON instance.instance_id=event.instance_id
        WHERE instance.instance_id=$1 AND event.node_id=$2 AND event.event_type='node_started'`,
      [waiting.instance_id, UGV_MOVE_WORKFLOW_NODE_IDS.navigate],
    );
    expect(navigateStarts.rows).toEqual([{ count: 1 }]);

    const terminal = await database.query<{
      task_output: unknown;
      workflow_result: unknown;
      terminal_authority: string;
      terminal_summary: string;
      final_node_successes: number;
      final_state_invocation_id: string;
    }>(
      `SELECT task.output_structured AS task_output,instance.result_json AS workflow_result,
              outcome.authority AS terminal_authority,outcome.summary AS terminal_summary,
              (SELECT count(*)::integer FROM workflow_node_event event
                WHERE event.instance_id=instance.instance_id AND event.node_id=$2
                  AND event.event_type='node_succeeded') AS final_node_successes,
              (SELECT invocation_id FROM mcp_invocation
                WHERE task_id=task.task_id AND tool_name='vehicle_get_state'
                ORDER BY started_at DESC,invocation_id DESC LIMIT 1) AS final_state_invocation_id
         FROM agent_task task
         JOIN workflow_instance instance ON instance.instance_id=$3
         JOIN runtime_terminal_outcome outcome ON outcome.task_id=task.task_id
        WHERE task.task_id=$1`,
      [taskId, UGV_MOVE_WORKFLOW_NODE_IDS.finalPosition, waiting.instance_id],
    );
    const expectedResult = {
      resourceId: 'vehicle:ugv1',
      status: 'completed',
      finalPosition: { x: target.x, y: target.y, frame: 'EPSG:4326' },
    };
    expect(terminal.rows).toEqual([
      expect.objectContaining({
        task_output: expectedResult,
        workflow_result: expectedResult,
        terminal_authority: 'user_goal_plan_controller',
        terminal_summary: expect.stringContaining('final-position evidence'),
        final_node_successes: 1,
        final_state_invocation_id: finalInvocations[2]?.invocation_id,
      }),
    ]);

    const finalA2aTask = responseTask(await getA2aTask(restartedRuntime.a2a.baseUrl, taskId));
    expect(finalA2aTask['id']).toBe(taskId);
    expect(record(finalA2aTask['status'])['state']).toBe('TASK_STATE_COMPLETED');
    const artifacts = finalA2aTask['artifacts'];
    if (!Array.isArray(artifacts)) throw new Error('A2A_TERMINAL_ARTIFACTS_MISSING');
    expect(artifacts).toHaveLength(1);
    const artifact = record(artifacts[0]);
    expect(artifact).toMatchObject({
      artifactId: `${taskId}:result`,
      name: 'result',
      description: 'Natural-language and structured task result.',
    });
    const parts = artifact['parts'];
    if (!Array.isArray(parts)) throw new Error('A2A_TERMINAL_ARTIFACT_PARTS_MISSING');
    expect(parts).toEqual([
      {
        text: expect.stringContaining('durable final-position evidence'),
        mediaType: 'text/plain',
      },
      { data: expectedResult, mediaType: 'application/json' },
    ]);
  }, 120_000);
});

function startRuntime(applyMigrations: boolean): Promise<ServerRuntimeHandle> {
  return startServerRuntime({
    postgresUrl,
    redis: { host: '127.0.0.1', port: redisPort },
    masterKeyBase64,
    evidenceEnvironment: 'integration',
    queueName,
    applyMigrations,
    a2aPort: 0,
    managementPort: 0,
    capabilityAuthorityReader,
    currentMcpProviderBindingAuthorityReader: providerBindingAuthorityReader,
    governedControlPrincipalResolver: new ConfiguredTrustedIntranetGovernedControlIdentity({
      actorId: 'uap-p2-b03-local-operator',
      permissions: ['physical_control.confirm'],
    }),
    frozenMcpTasks: {
      isolationAcknowledged: true,
      queueName: remoteQueueName,
      reconcileIntervalMs: 25,
      polling: {
        minimumPollIntervalMs: 100,
        maximumPollIntervalMs: 100,
        providerFailureBackoffBaseMs: 100,
        providerFailureBackoffMaximumMs: 100,
      },
    },
    ugvMovePositionPolicy: {
      toleranceM: 2,
      minimumDisplacementM: 0.5,
      maxFinalStateAgeMs: 3_000,
    },
    taskUnderstanding: ugvAgentProfileTaskUnderstandingConfiguration(),
    a2aWaitTimeoutMs: 5_000,
    a2aSafetyPollIntervalMs: 100,
    a2aTerminalReconciliationIntervalMs: 1_000,
  });
}

function createProviderAuthority(
  endpoint: URL,
  observedAt: string,
  catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>,
): CurrentMcpProviderBindingAuthoritySnapshot {
  const registryChecksum = 'd'.repeat(64);
  return Object.freeze({
    observedAt,
    binding: Object.freeze({
      bindingId: providerBindingId,
      revision: 7,
      localServerId: serverId,
      originType: 'smpp_registry' as const,
      providerId: 'isr.vehicle.ugv.ugv1',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'ugv1-external-smpp-server',
      registryRevision: 11,
      registryChecksum,
      catalogRevision: catalog.catalogRevision,
      catalogChecksum: catalog.catalogChecksum,
      endpointRef: endpoint.toString(),
      availabilityValidUntil: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
      catalogObservedAt: observedAt,
      operationCount: catalog.operationCount,
    }),
    sourceCandidateLineage: Object.freeze({
      smppSourceId: 'smpp-source-ugv1-p2-b03',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'ugv1-external-smpp-server',
      registryRevision: 11,
      registryChecksum,
      nativeRevision: 3,
      nativeChecksum: 'e'.repeat(64),
      projectionContract: 'sdar-registry-v1' as const,
      candidateEndpoint: endpoint.toString(),
    }),
  });
}

function fullCapabilityConstraints(
  catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>,
  executionSemantics: McpToolExecutionSemantics,
): readonly EvidenceRecord[] {
  const targetPolicy = createUgvSimulationTargetPolicy({
    policyId: 'ugv-agent-profile/explicit-wgs84-target',
    revision: 2,
  });
  const targetPolicyEvidence: EvidenceRecord = Object.freeze({
    type: 'ugv_simulation_target_policy',
    policyId: 'ugv-agent-profile/explicit-wgs84-target',
    revision: 2,
    executionMode: 'simulation',
    resourceId: 'vehicle:ugv1',
    frame: 'WGS84',
    targetAuthority: 'task_capability_input_snapshot',
    targetDerivation: 'forbidden',
    distanceLimit: 'none',
    altitudePolicy: 'not_commanded_not_terminally_evaluated',
    forbiddenRegions: Object.freeze([]),
  });
  if (hashCanonicalEvidenceJson(targetPolicy) !== hashCanonicalEvidenceJson(targetPolicyEvidence))
    throw new Error('UGV_TARGET_POLICY_FIXTURE_DRIFT');
  return Object.freeze([
    Object.freeze({
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: Object.freeze(['vehicle:ugv1']),
      downstreamResourceBinding: 'forbidden',
    }),
    Object.freeze({
      type: 'provider_binding_policy',
      mcpProviderBindingId: providerBindingId,
      localServerId: serverId,
      mcpToolName: 'vehicle_navigate',
      allowedResourceIds: Object.freeze(['vehicle:ugv1']),
      bindingRevision: 7,
      catalogRevision: catalog.catalogRevision,
      catalogChecksum: catalog.catalogChecksum,
      taskBehavior: 'task_required',
      executionSemantics: Object.freeze({
        effect: executionSemantics.effect,
        execution: executionSemantics.execution,
        cancellation: executionSemantics.cancellation,
        idempotency: executionSemantics.idempotency,
        replay: executionSemantics.replay,
        source: executionSemantics.source,
      }),
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    }),
    Object.freeze({
      type: 'exact_skill_version',
      skillId: 'embodied.move_to',
      skillVersion: 1,
      taskType: 'embodied.move',
    }),
    Object.freeze({
      type: 'confirmation_policy',
      required: true,
      stage: 'before_execution',
      autoConfirmPlan: false,
    }),
    Object.freeze({
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      dispatchMaximum: 1,
      uncertainDispatchPolicy: 'reconcile_never_redispatch',
      remoteTaskTerminalEvidenceRequired: true,
    }),
    Object.freeze({
      type: 'runtime_execution_mode_policy',
      mode: 'simulation',
      simulationId: runId,
    }),
    targetPolicyEvidence,
  ]);
}

function fullSuccessCriteria(): readonly EvidenceRecord[] {
  return Object.freeze([
    Object.freeze({ type: 'output_schema_valid', required: true }),
    Object.freeze({ type: 'resource_identity_matches_request', required: true }),
    Object.freeze({ type: 'required_evidence_complete', required: true }),
    Object.freeze({ type: 'remote_task_identity_present', required: true }),
    Object.freeze({ type: 'remote_terminal_observation_present', required: true }),
    Object.freeze({ type: 'external_command_dispatch_count', maximum: 1 }),
  ]);
}

function hardEvidenceRequirements(): readonly EvidenceRecord[] {
  return Object.freeze([
    Object.freeze({
      type: 'required_evidence',
      evidenceType: 'position.observation',
      required: true,
      hardGate: true,
    }),
  ]);
}

function exactProviderPolicyOverride(): EvidenceRecord {
  return Object.freeze({
    selection: 'required',
    mcpProviderBindingId: providerBindingId,
    localServerId: serverId,
    mcpToolName: 'vehicle_navigate',
    allowedResourceIds: Object.freeze(['vehicle:ugv1']),
    requireActive: true,
    requireAvailable: true,
    requireUnexpiredFreshness: true,
    denyFallback: true,
  });
}

function createCapabilityAuthority(
  constraints: readonly EvidenceRecord[],
  providerPolicyOverride: EvidenceRecord,
): CapabilityAuthoritySnapshot {
  return Object.freeze({
    definition: Object.freeze({
      capability_id: 'embodied.move',
      version: 2,
      status: 'published',
      risk_level: 'high',
      supported_modes: Object.freeze(['plan_confirmed', 'remote_task']),
      constraints,
    }),
    implementationBindings: Object.freeze([
      Object.freeze({
        capability_id: 'embodied.move',
        capability_version: 2,
        implementation_type: 'skill',
        implementation_id: 'embodied.move_to',
        implementation_version: '1',
        role: 'primary',
        status: 'active',
        provider_policy_override: providerPolicyOverride,
      }),
    ]),
  });
}

async function seedFormalCapabilityAuthority(
  database: Pool,
  constraints: readonly EvidenceRecord[],
  successCriteria: readonly EvidenceRecord[],
  requiredEvidence: readonly EvidenceRecord[],
  providerPolicyOverride: EvidenceRecord,
): Promise<void> {
  const now = new Date().toISOString();
  const validUntil = new Date(Date.now() + 30 * 60 * 1_000).toISOString();
  const revisionResult = await database.query<{ revision: string }>(
    'SELECT (COALESCE(max(revision),0)+1)::text AS revision FROM runtime_agent_card_revision',
  );
  const revision = Number(revisionResult.rows[0]?.revision ?? '1');
  const requestSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['resourceId', 'target'],
    properties: {
      resourceId: { const: 'vehicle:ugv1' },
      target: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y', 'frame'],
        properties: {
          x: { type: 'number', minimum: -180, maximum: 180 },
          y: { type: 'number', minimum: -90, maximum: 90 },
          frame: { const: 'WGS84' },
        },
      },
    },
  };
  const resultSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['resourceId', 'status', 'finalPosition'],
    properties: {
      resourceId: { const: 'vehicle:ugv1' },
      status: { const: 'completed' },
      finalPosition: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y', 'frame'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          frame: { const: 'EPSG:4326' },
        },
      },
    },
  };
  const evaluationInput = {
    definition: { successCriteria, requiredEvidence, constraints },
    implementations: [
      {
        bindingId: implementationBindingId,
        implementationType: 'skill',
        implementationId: 'embodied.move_to',
        implementationVersion: '1',
        providerPolicyOverride,
      },
    ],
  };
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE runtime_agent_card_revision SET status='superseded' WHERE status='active'",
    );
    await client.query(
      `INSERT INTO runtime_agent_card_revision(
         revision,node_id,exposure_refs,content_hash,capability_catalog_hash,status,card,
         generated_at,activated_at)
       VALUES($1,'node-ugv-p2-b03',$2::jsonb,$3,$4,'active',$5::jsonb,$6,$6)`,
      [
        revision,
        JSON.stringify([`${exposureId}:2`]),
        randomBytes(32).toString('hex'),
        randomBytes(32).toString('hex'),
        JSON.stringify({
          name: UGV_AGENT_PROFILE_ID,
          description: 'UGV P2-B03 formal Capability integration fixture.',
          supportedInterfaces: [
            {
              url: 'http://127.0.0.1/a2a',
              protocolBinding: 'HTTP+JSON',
              tenant: '',
              protocolVersion: '1.0',
            },
          ],
          version: '1.0.0',
          capabilities: { streaming: true, pushNotifications: false, extensions: [] },
          securitySchemes: {},
          securityRequirements: [],
          defaultInputModes: ['text/plain', 'application/json'],
          defaultOutputModes: ['text/plain', 'application/json'],
          skills: [],
          signatures: [],
        }),
        now,
      ],
    );
    await client.query(
      `INSERT INTO runtime_agent_card_exposure_snapshot(
         revision,exposure_id,exposure_version,capability_id,capability_version,agent_skill_id,
         request_schema,result_schema,requester_policy,exposure_hash)
       VALUES($1,$2,2,'embodied.move',2,'embodied.move_to',$3::jsonb,$4::jsonb,
              '{"allowAnonymous":true,"allowedRequesterIds":[]}'::jsonb,$5)`,
      [
        revision,
        exposureId,
        JSON.stringify(requestSchema),
        JSON.stringify(resultSchema),
        randomBytes(32).toString('hex'),
      ],
    );
    await client.query(
      `INSERT INTO capability_readiness_snapshot(
         capability_id,capability_version,snapshot_version,status,raw_status,evaluated_at,
         valid_until,catalog_hash,policy_hash,snapshot_hash,reasons,available_implementations,
         unavailable_implementations,evaluation_input,trigger_reason)
       VALUES('embodied.move',2,1,'available','available',$1,$2,$3,$4,$5,'[]'::jsonb,
              $6::jsonb,'[]'::jsonb,$7::jsonb,'integration')`,
      [
        now,
        validUntil,
        hashCanonicalEvidenceJson({ catalog: 'ugv-p2-b03' }),
        hashCanonicalEvidenceJson({ policy: 'ugv-p2-b03' }),
        hashCanonicalEvidenceJson(evaluationInput),
        JSON.stringify([implementationBindingId]),
        JSON.stringify(evaluationInput),
      ],
    );
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function assertFormalAdmissionAndPlanning(database: Pool, taskId: string): Promise<void> {
  const result = await database.query<{
    task: Readonly<Record<string, unknown>>;
    user_plan: Readonly<Record<string, unknown>>;
    selection: Readonly<Record<string, unknown>>;
    resolution: Readonly<Record<string, unknown>>;
    workflow_plan: Readonly<Record<string, unknown>>;
    capability_attempt: Readonly<Record<string, unknown>>;
  }>(
    `SELECT to_jsonb(task) AS task,to_jsonb(user_plan) AS user_plan,
            to_jsonb(selection) AS selection,to_jsonb(resolution) AS resolution,
            to_jsonb(workflow_plan) AS workflow_plan,
            to_jsonb(capability_attempt) AS capability_attempt
       FROM agent_task task
       JOIN user_goal_plan user_plan ON user_plan.plan_id=task.user_goal_plan_id
       JOIN skill_selection_record selection ON selection.selection_id=task.skill_selection_id
       JOIN skill_input_resolution resolution
         ON resolution.resolution_id=task.skill_input_resolution_id
       JOIN workflow_plan workflow_plan ON workflow_plan.plan_id=task.plan_id
       JOIN task_capability_execution_attempt capability_attempt
         ON capability_attempt.task_id=task.task_id
      WHERE task.task_id=$1`,
    [taskId],
  );
  const row = required(result.rows[0], 'FORMAL_CHAIN_NOT_PERSISTED');
  expect(row.task).toMatchObject({
    selected_skill_id: 'embodied.move_to',
    selected_skill_version: 1,
    phase: 'awaiting_plan_confirmation',
  });
  expect(row.user_plan).toMatchObject({ status: 'active', revision_kind: 'initial' });
  const userPlan = record(row.user_plan['plan_json']);
  expect(JSON.stringify(userPlan)).toContain('effect.final_position');
  const userPlanSkillGoals = Array.isArray(userPlan['skillGoals']) ? userPlan['skillGoals'] : [];
  const userPlanConstraints = record(userPlanSkillGoals[0])['constraints'];
  expect(userPlanConstraints).toContain('profile.ugv-agent-profile.side_effect_replay=forbidden');
  expect(userPlanConstraints).not.toContain('policy.replay=forbidden');
  expect(row.selection).toMatchObject({
    selected_skill_id: 'embodied.move_to',
    selected_skill_version: 1,
  });
  expect(JSON.stringify(row.selection['candidates_json'])).toContain(
    'provider-context-hash:sha256:',
  );
  expect(JSON.stringify(row.selection['candidates_json'])).not.toContain('mcp-invocation:');
  expect(row.resolution).toMatchObject({
    skill_id: 'embodied.move_to',
    skill_version: 1,
    structured_input_json: capabilityInput,
    status: 'resolved',
  });
  expect(row.resolution['source_refs_json']).toEqual([
    expect.stringMatching(
      /^task-capability-binding:[A-Za-z0-9._-]+:hash:[0-9a-f]{64}:input-snapshot$/u,
    ),
  ]);
  expect(row.workflow_plan).toMatchObject({
    confirmation_status: 'awaiting_confirmation',
    attempt_count: 1,
  });
  const definition = record(row.workflow_plan['definition_json']);
  const nodes = Array.isArray(definition['nodes']) ? definition['nodes'] : [];
  expect(nodes.map((node) => record(node)['nodeId'])).toEqual([
    UGV_MOVE_WORKFLOW_NODE_IDS.initialState,
    UGV_MOVE_WORKFLOW_NODE_IDS.currentPosition,
    UGV_MOVE_WORKFLOW_NODE_IDS.resourceState,
    UGV_MOVE_WORKFLOW_NODE_IDS.permissionContext,
    UGV_MOVE_WORKFLOW_NODE_IDS.navigate,
    UGV_MOVE_WORKFLOW_NODE_IDS.finalState,
    UGV_MOVE_WORKFLOW_NODE_IDS.finalPosition,
    UGV_MOVE_WORKFLOW_NODE_IDS.success,
    UGV_MOVE_WORKFLOW_NODE_IDS.failure,
  ]);
  expect(row.capability_attempt).toMatchObject({
    status: 'prepared',
    plan_id: row.task['plan_id'],
    skill_version_refs: ['skill:embodied.move_to:1'],
    provider_binding_refs: [providerBindingId],
  });
  const modelCalls = await database.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM model_invocation WHERE task_id=$1',
    [taskId],
  );
  expect(modelCalls.rows).toEqual([{ count: 0 }]);
}

async function assertGovernedControlIssueAuthority(
  database: Pool,
  providerEndpoint: URL,
  taskId: string,
): Promise<void> {
  const clock = { now: () => new Date().toISOString() };
  const runtimeBindings = new McpRuntimeBindingAuthorityVerifier({
    repository: new PostgresMcpRegistryRepository(database),
    clock,
  });
  const availability = new FrozenV1RuntimeAvailabilityAdapter(new FrozenV1McpClient());
  const reader = new PostgresUgvGovernedControlAuthorityReader({
    pool: database,
    capabilities: capabilityAuthorityReader,
    providerBindings: providerBindingAuthorityReader,
    runtimeBindings,
    availability: {
      checkTaskAvailability(input) {
        if (input.serverId !== serverId)
          return Promise.reject(new Error('UGV_P2_B03_AVAILABILITY_SERVER_MISMATCH'));
        return availability.check({
          endpoint: providerEndpoint.toString(),
          headers: {},
          requests: input.requests,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
      },
    },
    inputAdapter: { adapt: adaptUgvMoveInput },
    clock,
  });
  const authority = required(
    await reader.loadForIssue(taskId),
    'UGV_GOVERNED_CONTROL_ISSUE_AUTHORITY_NOT_FOUND',
  );
  assertUgvGovernedControlAuthority(authority, 'issue', Date.parse(clock.now()));
  expect(authority).toMatchObject({
    task: { taskId, phase: 'awaiting_plan_confirmation' },
    binding: { providerBindingId, providerBindingRevision: 7 },
    skill: { skillId: 'embodied.move_to', skillVersion: 1 },
    providerBinding: { bindingId: providerBindingId, revision: 7, availability: 'available' },
    readiness: { disposition: 'ready', operationName: 'vehicle_navigate' },
  });
}

function initialRequest(messageId: string): unknown {
  return createA2ATestSendMessageBody({
    message: {
      messageId,
      role: 'ROLE_USER',
      parts: [
        {
          text: `Move the UGV to WGS84 longitude ${String(target.x)}, latitude ${String(target.y)}.`,
          mediaType: 'text/plain',
        },
      ],
      metadata: {},
    },
    configuration: { returnImmediately: false },
  });
}

function confirmationRequest(taskId: string, contextId: string): unknown {
  return createA2ATestSendMessageBody({
    message: {
      messageId: `ugv-p2-b03-confirm-${randomUUID()}`,
      taskId,
      contextId,
      role: 'ROLE_USER',
      parts: [
        { text: 'Confirm this exact plan and its single UGV dispatch.', mediaType: 'text/plain' },
      ],
      metadata: { sdar_action: 'confirm_plan' },
    },
    configuration: { returnImmediately: false },
  });
}

async function sendA2a(baseUrl: string, request: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/a2a/v1/message:send`, {
    method: 'POST',
    headers: {
      'A2A-Version': '1.0',
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`A2A_MESSAGE_FAILED:${String(response.status)}:${body}`);
  return JSON.parse(body) as unknown;
}

async function getA2aTask(baseUrl: string, taskId: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}/a2a/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { 'A2A-Version': '1.0' },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`A2A_GET_TASK_FAILED:${String(response.status)}:${body}`);
  return JSON.parse(body) as unknown;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function responseTask(value: unknown): Readonly<Record<string, unknown>> {
  const body = record(value);
  const task = body['task'];
  return task === undefined ? body : record(task);
}

async function taskInvocations(database: Pool, taskId: string) {
  return (
    await database.query<{
      invocation_id: string;
      tool_name: string;
      status: string;
      capability_attempt_id: string | null;
      control_provider_binding_id: string | null;
    }>(
      `SELECT invocation_id,tool_name,status,capability_attempt_id,control_provider_binding_id
         FROM mcp_invocation WHERE task_id=$1 ORDER BY started_at,invocation_id`,
      [taskId],
    )
  ).rows;
}

async function eventually<T>(operation: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('EVENTUALLY_TIMEOUT', { cause: lastError });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('EXPECTED_RECORD');
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(errorCode);
  return value;
}

function required<T>(value: T | null | undefined, errorCode: string): T {
  if (value === null || value === undefined) throw new Error(errorCode);
  return value;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}
