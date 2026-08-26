import { describe, expect, it } from 'vitest';

import {
  UGV_B02_EXPOSURE_ID,
  UGV_B02_PROVIDER_ID,
  assertUgvB02CleanPreLedger,
  assertUgvB02CursorLineage,
  assertUgvB02FormalAdmission,
  assertUgvB02PlanConfirmation,
  assertUgvB02QualificationToInitial,
  buildUgvB02FormalAdmission,
  buildUgvLiveFormalAdmission,
  buildUgvB02PlanConfirmation,
  compareUgvB02DurableLineage,
  compareUgvB02ModelRuntime,
  compareUgvB02ProviderLedger,
  compareUgvB02SdarInvocations,
  sha256,
  validateUgvB02Qualification,
} from '../src/ugv-agent-profile-a2a-move-contract.js';
import { UAP_UGV_MOVE_EXPOSURE_ID } from '../src/ugv-agent-profile-authority-bootstrap-driver.js';
import { assertUgvB02ReportStringSafety } from '../src/ugv-agent-profile-a2a-move-driver.js';

const SIMULATION_ID = 'uap-p3-b02-test-run-0001';
const TASK_ID = 'task-1';
const CONTEXT_ID = 'context-1';
const PLAN_ID = 'plan-1';
const ATTEMPT_ID = 'attempt-1';
const NAVIGATE_ID = 'navigate-invocation-1';
const SERVER_ID = 'server-1';
const PROVIDER_BINDING_ID = 'provider-binding-1';
const REMOTE_TASK_ID = 'remote-task-1';
const REMOTE_BINDING_ID = 'remote-binding-1';
const MISSION_ID = 'mission-1';
const TARGET = Object.freeze({ x: 120.000_01, y: 30, frame: 'WGS84' as const });

describe('UAP-P3-B02 exact contracts', () => {
  it('builds a LIVE formal request with exact durable reference and caller-owned target', () => {
    const { simulationId, ...base } = qualification();
    void simulationId;
    const receipt = {
      ...base,
      requestId: 'live-request',
      executionContext: { mode: 'live' as const },
    };
    const admission = buildUgvLiveFormalAdmission({
      messageId: 'live-message',
      idempotencyKey: 'live-request',
      qualification: receipt,
      target: TARGET,
    });
    expect(admission.message.metadata).toMatchObject({
      user_id: 'ugv-live-requester',
      structured_input: { resourceId: 'vehicle:ugv1', target: TARGET },
      'io.sdar/ugvQualification': {
        requestId: 'live-request',
        invocationId: receipt.invocationId,
        resultHash: receipt.resultHash,
      },
    });
    expect(JSON.stringify(admission)).not.toContain('simulation');
    expect(() =>
      buildUgvLiveFormalAdmission({
        messageId: 'live-message',
        idempotencyKey: 'other',
        qualification: receipt,
        target: TARGET,
      }),
    ).toThrow('UGV_LIVE_QUALIFICATION_REQUEST_CONFLICT');
    const malformedReceipt = {
      ...receipt,
      executionContext: { mode: 'live' as const, simulationId: '' },
    };
    expect(() =>
      buildUgvLiveFormalAdmission({
        messageId: 'live-message',
        idempotencyKey: 'live-request',
        qualification: malformedReceipt,
        target: TARGET,
      }),
    ).toThrow();
  });
  it('inherits the frozen B01 Exposure and rejects admission or confirmation shape drift', () => {
    expect(UGV_B02_EXPOSURE_ID).toBe(UAP_UGV_MOVE_EXPOSURE_ID);
    const admission = buildUgvB02FormalAdmission({
      messageId: 'message-1',
      idempotencyKey: 'admission-key-1',
      qualification: qualification(),
      target: TARGET,
    });
    expect(() => {
      assertUgvB02FormalAdmission(admission);
    }).not.toThrow();

    const wrongResource = clone(admission);
    const dataPart = wrongResource.message.parts[1] as unknown as {
      data: Record<string, unknown>;
    };
    dataPart.data['resourceId'] = 'vehicle:other';
    (wrongResource.message.metadata.structured_input as unknown as Record<string, unknown>)[
      'resourceId'
    ] = 'vehicle:other';
    expect(() => {
      assertUgvB02FormalAdmission(wrongResource);
    }).toThrow('UGV_B02_FORMAL_ADMISSION_INVALID');
    const extraTarget = clone(admission);
    (extraTarget.message.parts[1] as { data: { target: Record<string, unknown> } }).data.target[
      'altitude'
    ] = 1;
    (extraTarget.message.metadata.structured_input.target as Record<string, unknown>)['altitude'] =
      1;
    expect(() => {
      assertUgvB02FormalAdmission(extraTarget);
    }).toThrow('UGV_B02_FORMAL_ADMISSION_INVALID');

    const confirmation = buildUgvB02PlanConfirmation({
      messageId: 'confirmation-message-1',
      taskId: TASK_ID,
      contextId: CONTEXT_ID,
    });
    expect(() => {
      assertUgvB02PlanConfirmation(confirmation, { taskId: TASK_ID, contextId: CONTEXT_ID });
    }).not.toThrow();
    const confirmationDrift = clone(confirmation);
    (confirmationDrift.message.metadata as Record<string, unknown>)['extra'] = true;
    expect(() => {
      assertUgvB02PlanConfirmation(confirmationDrift, {
        taskId: TASK_ID,
        contextId: CONTEXT_ID,
      });
    }).toThrow('UGV_B02_CONFIRMATION_INVALID');
  });

  it('locks the qualification Provider and coherent qualification-to-initial telemetry', () => {
    expect(validateUgvB02Qualification(qualification()).providerId).toBe(UGV_B02_PROVIDER_ID);
    expect(() =>
      validateUgvB02Qualification({ ...qualification(), providerId: 'isr.vehicle.ugv.other' }),
    ).toThrow();
    expect(() => {
      assertUgvB02QualificationToInitial({
        qualification: qualification(),
        initial: {
          observedAt: '2026-08-21T12:00:01.000Z',
          revision: 'c'.repeat(64),
          mqttIngressSequence: 11,
          position: { longitude: 120, latitude: 30 },
        },
      });
    }).not.toThrow();
    expect(() => {
      assertUgvB02QualificationToInitial({
        qualification: qualification(),
        initial: {
          observedAt: '2026-08-21T12:00:01.000Z',
          revision: 'a'.repeat(64),
          mqttIngressSequence: 11,
          position: { longitude: 120, latitude: 30 },
        },
      });
    }).toThrow('UGV_B02_QUALIFICATION_INITIAL_LINEAGE_INVALID');
    expect(() => {
      assertUgvB02QualificationToInitial({
        qualification: qualification(),
        initial: {
          observedAt: '2026-08-21T12:00:01.000Z',
          revision: 'a'.repeat(64),
          mqttIngressSequence: 10,
          position: { longitude: 120.000_1, latitude: 30 },
        },
      });
    }).toThrow('UGV_B02_QUALIFICATION_INITIAL_LINEAGE_INVALID');
  });

  it('requires Provider-to-final cursor sequence and revision coherence', () => {
    const coherent = {
      initial: {
        observedAt: '2026-08-21T12:00:00.000Z',
        revision: 'a'.repeat(64),
        mqttIngressSequence: 10,
      },
      provider: {
        observedAt: '2026-08-21T12:00:01.000Z',
        revision: 'b'.repeat(64),
        mqttIngressSequence: 11,
      },
      final: {
        observedAt: '2026-08-21T12:00:02.000Z',
        revision: 'b'.repeat(64),
        mqttIngressSequence: 11,
      },
    };
    expect(() => {
      assertUgvB02CursorLineage(coherent);
    }).not.toThrow();
    expect(() => {
      assertUgvB02CursorLineage({
        ...coherent,
        final: { ...coherent.final, revision: 'c'.repeat(64) },
      });
    }).toThrow('UGV_B02_STATE_CURSOR_LINEAGE_INVALID');
    expect(() => {
      assertUgvB02CursorLineage({
        ...coherent,
        final: { ...coherent.final, mqttIngressSequence: 12 },
      });
    }).toThrow('UGV_B02_STATE_CURSOR_LINEAGE_INVALID');
  });

  it('requires a clean fresh SDAR execution ledger before YES', () => {
    const ledger = emptyLedger('2026-08-21T12:00:00.000Z');
    ledger.sdar.stageModelRoutes.push({ rowId: 'workflow_planning:structured_generation' });
    ledger.sdar.modelProviders.push({ providerId: 'model-provider-1' });
    expect(() => assertUgvB02CleanPreLedger(ledger)).not.toThrow();
    ledger.sdar.tasks.push({ taskId: 'stale-task' });
    expect(() => assertUgvB02CleanPreLedger(ledger)).toThrow('UGV_B02_PROVIDER_LEDGER_NOT_CLEAN');
  });

  it('locks all four SDAR MCP receipts to the qualification server and binding', () => {
    const before = emptyLedger('2026-08-21T12:00:00.000Z');
    const after = emptyLedger('2026-08-21T12:00:10.000Z');
    after.sdar.mcpInvocations.push(
      mcp('qualification-invocation-1', null, null, 'vehicle_get_state'),
      mcp('initial-invocation-1', TASK_ID, ATTEMPT_ID, 'vehicle_get_state'),
      {
        ...mcp(NAVIGATE_ID, TASK_ID, ATTEMPT_ID, 'vehicle_navigate'),
        controlProviderBindingId: PROVIDER_BINDING_ID,
      },
      mcp('final-invocation-1', TASK_ID, ATTEMPT_ID, 'vehicle_get_state'),
    );
    const expected = {
      simulationId: SIMULATION_ID,
      taskId: TASK_ID,
      qualificationInvocationId: 'qualification-invocation-1',
      serverId: SERVER_ID,
      providerBindingId: PROVIDER_BINDING_ID,
      admissionIdempotencyKey: 'admission-key-1',
    };
    expect(compareUgvB02SdarInvocations(before, after, expected).invocationCount).toBe(4);
    const drift = clone(after);
    requiredRow(drift.sdar.mcpInvocations, 2)['serverId'] = 'rogue-server';
    expect(() => compareUgvB02SdarInvocations(before, drift, expected)).toThrow(
      'UGV_B02_SDAR_INVOCATION_LEDGER_INVALID',
    );
  });

  it('accepts bounded model planning retries only when the final routed attempt succeeds', () => {
    const before = emptyLedger('2026-08-21T12:00:00.000Z');
    before.sdar.stageModelRoutes.push({
      rowId: 'workflow_planning:structured_generation',
      providerId: 'model-provider-1',
    });
    before.sdar.modelProviders.push({
      providerId: 'model-provider-1',
      enabled: true,
      model: 'model-1',
    });
    const after = clone(before);
    after.capturedAt = '2026-08-21T12:00:10.000Z';
    after.sdar.modelInvocations.push(
      {
        invocationId: 'model-invocation-1',
        taskId: TASK_ID,
        stage: 'workflow_planning',
        status: 'failed',
        providerId: 'model-provider-1',
        model: 'model-1',
        operation: 'structured_generation',
        errorCode: 'MODEL_TIMEOUT',
      },
      {
        invocationId: 'model-invocation-2',
        taskId: TASK_ID,
        stage: 'workflow_planning',
        status: 'succeeded',
        providerId: 'model-provider-1',
        model: 'model-1',
        operation: 'structured_generation',
        errorCode: null,
      },
    );
    expect(compareUgvB02ModelRuntime(before, after, TASK_ID)).toMatchObject({
      configurationLoaded: true,
      invocationCount: 2,
      failedCount: 1,
      succeededCount: 1,
    });
    requiredRow(after.sdar.modelInvocations, 1)['status'] = 'failed';
    requiredRow(after.sdar.modelInvocations, 1)['errorCode'] = 'MODEL_INVALID';
    expect(() => compareUgvB02ModelRuntime(before, after, TASK_ID)).toThrow(
      'UGV_B02_MODEL_RUNTIME_EVIDENCE_INVALID',
    );
  });

  it('locks Provider, Adapter, two-step southbound mission, and raw evidence IDs', () => {
    const { before, after, expected } = providerLedgerFixture();
    expect(compareUgvB02ProviderLedger(before, after, expected)).toMatchObject({
      externalExecutionId: 'external-execution-1',
      externalMissionId: MISSION_ID,
      correlationId: 'provider-correlation-1',
      deviceCallIds: [
        'state-call-1',
        'state-call-2',
        'state-call-3',
        'primary-call-1',
        'followup-call-1',
      ],
      southboundDeviceCallCount: 5,
      southboundMutationCallCount: 2,
    });
    expect(after.adapter.executions[0]?.['execution_context']).toMatchObject({
      correlationId: 'provider-correlation-1',
    });
    expect(
      (after.adapter.executions[0]?.['execution_context'] as Record<string, unknown>)[
        'correlationId'
      ],
    ).not.toBe(NAVIGATE_ID);
    const runtimeModeDrift = clone(after);
    requiredRow(runtimeModeDrift.runtime.providerTasks, 0)['executionMode'] = 'physical';
    expect(() => compareUgvB02ProviderLedger(before, runtimeModeDrift, expected)).toThrow(
      'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID',
    );
    const adapterIdentityDrift = clone(after);
    requiredRow(adapterIdentityDrift.adapter.executions, 0)['externalExecutionId'] =
      'jointly-wrong';
    expect(() => compareUgvB02ProviderLedger(before, adapterIdentityDrift, expected)).toThrow(
      'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID',
    );
    const payloadProviderDrift = clone(after);
    (requiredRow(payloadProviderDrift.adapter.executions, 0)['payload'] as Record<string, unknown>)[
      'providerId'
    ] = 'isr.vehicle.ugv.other';
    expect(() => compareUgvB02ProviderLedger(before, payloadProviderDrift, expected)).toThrow(
      'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID',
    );
    const correlationDrift = clone(after);
    requiredRow(correlationDrift.adapter.executions, 0)['execution_context'] = {
      ...(requiredRow(correlationDrift.adapter.executions, 0)['execution_context'] as Record<
        string,
        unknown
      >),
      correlationId: 'provider-correlation-drift',
    };
    expect(() => compareUgvB02ProviderLedger(before, correlationDrift, expected)).toThrow(
      'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID',
    );
    const correlationCollision = clone(after);
    const collisionContext = {
      ...(requiredRow(correlationCollision.adapter.executions, 0)['execution_context'] as Record<
        string,
        unknown
      >),
      correlationId: NAVIGATE_ID,
    };
    requiredRow(correlationCollision.adapter.executions, 0)['execution_context'] = collisionContext;
    (requiredRow(correlationCollision.adapter.executions, 0)['payload'] as Record<string, unknown>)[
      'executionContext'
    ] = collisionContext;
    expect(() => compareUgvB02ProviderLedger(before, correlationCollision, expected)).toThrow(
      'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID',
    );
  });

  it('requires the sealed active continuation to become the same terminal snapshot', () => {
    const { before, after, expected } = durableLineageFixture();
    expect(compareUgvB02DurableLineage(before, after, expected)).toMatchObject({
      goalId: 'goal-1',
      workflowInstanceId: 'workflow-instance-1',
      continuationSnapshotId: 'snapshot-1',
      continuationAttemptId: 'continuation-attempt-1',
      terminalOutcomeId: 'terminal-outcome-1',
    });
    const terminalDrift = clone(after);
    requiredRow(terminalDrift.sdar.continuationSnapshots, 0)['lifecycle'] = 'active';
    expect(() => compareUgvB02DurableLineage(before, terminalDrift, expected)).toThrow(
      'UGV_B02_DURABLE_LINEAGE_INVALID',
    );
    const confirmationTimeDrift = clone(after);
    requiredRow(confirmationTimeDrift.sdar.governedConfirmations, 0)['consumedAt'] =
      '2026-08-21T12:00:06.000Z';
    expect(() => compareUgvB02DurableLineage(before, confirmationTimeDrift, expected)).toThrow(
      'UGV_B02_DURABLE_LINEAGE_INVALID',
    );
    const definitionDrift = clone(after);
    requiredRow(definitionDrift.sdar.workflowPlans, 0)['definition_json'] = {
      nodes: ['drifted'],
    };
    expect(() => compareUgvB02DurableLineage(before, definitionDrift, expected)).toThrow(
      'UGV_B02_DURABLE_LINEAGE_INVALID',
    );
  });

  it('scans report string values without rejecting truthful credential flag keys', () => {
    expect(() => {
      assertUgvB02ReportStringSafety({ modelCredentialsIncluded: false, endpointsIncluded: false });
    }).not.toThrow();
    expect(() => {
      assertUgvB02ReportStringSafety({ value: 'Bearer sensitive' });
    }).toThrow('UGV_B02_REPORT_REDACTION_INVALID');
    expect(() => {
      assertUgvB02ReportStringSafety({ value: 'http://127.0.0.1:1' });
    }).toThrow('UGV_B02_REPORT_REDACTION_INVALID');
  });
});

function qualification() {
  return {
    simulationId: SIMULATION_ID,
    invocationId: 'qualification-invocation-1',
    resultHash: `sha256:${'b'.repeat(64)}`,
    completedAt: '2026-08-21T12:00:00.000Z',
    observedAt: '2026-08-21T12:00:00.000Z',
    revision: 'a'.repeat(64),
    mqttIngressSequence: 10,
    serverId: SERVER_ID,
    providerBindingId: PROVIDER_BINDING_ID,
    providerId: UGV_B02_PROVIDER_ID,
    operationName: 'vehicle_get_state' as const,
    resourceId: 'vehicle:ugv1' as const,
    sourcePosition: { longitude: 120, latitude: 30 },
  };
}

function emptyLedger(capturedAt: string) {
  return {
    schemaVersion: 'sdar.ugv-agent-profile-provider-ledger/v1' as const,
    capturedAt,
    runtime: {
      idempotencyRecords: [] as Record<string, unknown>[],
      providerTasks: [] as Record<string, unknown>[],
      admissionIntents: [] as Record<string, unknown>[],
    },
    adapter: {
      executions: [] as Record<string, unknown>[],
      deviceToolCalls: [] as Record<string, unknown>[],
      mutationJournal: [] as Record<string, unknown>[],
      commandAcks: [] as Record<string, unknown>[],
    },
    sdar: {
      modelInvocations: [] as Record<string, unknown>[],
      mcpInvocations: [] as Record<string, unknown>[],
      stageModelRoutes: [] as Record<string, unknown>[],
      modelProviders: [] as Record<string, unknown>[],
      initialTaskAdmissions: [] as Record<string, unknown>[],
      capabilityAttempts: [] as Record<string, unknown>[],
      governedConfirmations: [] as Record<string, unknown>[],
      remoteAdmissionIntents: [] as Record<string, unknown>[],
      continuationSnapshots: [] as Record<string, unknown>[],
      continuationAttempts: [] as Record<string, unknown>[],
      terminalOutcomes: [] as Record<string, unknown>[],
      workflowNodeEvents: [] as Record<string, unknown>[],
      tasks: [] as Record<string, unknown>[],
      goals: [] as Record<string, unknown>[],
      goalContracts: [] as Record<string, unknown>[],
      userGoalPlans: [] as Record<string, unknown>[],
      workflowPlans: [] as Record<string, unknown>[],
      workflowInstances: [] as Record<string, unknown>[],
      skillExecutions: [] as Record<string, unknown>[],
      skillExecutionEvents: [] as Record<string, unknown>[],
      processedResults: [] as Record<string, unknown>[],
    },
  };
}

function mcp(
  invocationId: string,
  taskId: string | null,
  capabilityAttemptId: string | null,
  toolName: string,
) {
  return {
    invocationId,
    taskId,
    capabilityAttemptId,
    toolName,
    serverId: SERVER_ID,
    executionMode: 'simulation',
    simulationId: SIMULATION_ID,
    status: 'succeeded',
  };
}

function providerLedgerFixture() {
  const before = emptyLedger('2026-08-21T12:00:00.000Z');
  const after = emptyLedger('2026-08-21T12:00:10.000Z');
  const arguments_ = {
    resourceId: 'vehicle:ugv1',
    mission: { type: 'point', target: { longitude: TARGET.x, latitude: TARGET.y } },
    stopOnObstacle: true,
  };
  const argumentHash = sha256(arguments_).slice('sha256:'.length);
  const authorizationHash = 'd'.repeat(64);
  const executionContext = {
    executionMode: 'SIMULATION',
    simulationId: SIMULATION_ID,
    authorizationContextHash: authorizationHash,
    correlationId: 'provider-correlation-1',
  };
  after.runtime.idempotencyRecords.push({
    rowId: `${authorizationHash}:vehicle_navigate:${NAVIGATE_ID}:simulation:${SIMULATION_ID}`,
    operationName: 'vehicle_navigate',
    idempotencyKey: NAVIGATE_ID,
    argumentHash,
    executionMode: 'simulation',
    taskId: REMOTE_TASK_ID,
    authorization_context_hash: authorizationHash,
    simulation_key: SIMULATION_ID,
    state: 'COMPLETE',
    stable_task_id: REMOTE_TASK_ID,
    lease_owner: null,
    lease_expires_at: null,
    synchronous_result: null,
    claim_attempt: 1,
  });
  after.runtime.providerTasks.push({
    taskId: REMOTE_TASK_ID,
    providerId: UGV_B02_PROVIDER_ID,
    authorization_context_hash: authorizationHash,
    operationName: 'vehicle_navigate',
    executionMode: 'simulation',
    simulationId: SIMULATION_ID,
    arguments: arguments_,
    argumentHash,
    internalState: 'TERMINAL_COMPLETED',
    mcpStatus: 'completed',
    externalExecutionId: 'external-execution-1',
  });
  after.runtime.admissionIntents.push({
    taskId: REMOTE_TASK_ID,
    providerId: UGV_B02_PROVIDER_ID,
    authorization_context_hash: authorizationHash,
    operationName: 'vehicle_navigate',
    executionMode: 'simulation',
    simulationId: SIMULATION_ID,
    arguments: arguments_,
    argumentHash,
    state: 'PUBLISHED',
  });
  after.adapter.executions.push({
    taskId: REMOTE_TASK_ID,
    externalExecutionId: 'external-execution-1',
    operationName: 'vehicle_navigate',
    argumentHash,
    resourceId: 'vehicle:ugv1',
    state: 'SUCCEEDED',
    execution_context: executionContext,
    downstream_mission_ids: [MISSION_ID],
    payload: {
      providerId: UGV_B02_PROVIDER_ID,
      arguments: arguments_,
      executionContext,
      downstreamMissionIds: [MISSION_ID],
    },
  });
  after.adapter.deviceToolCalls.push(
    {
      callId: 'state-call-1',
      taskId: 'provider-sync-1',
      toolName: 'get_status',
      argumentHash: '1'.repeat(64),
      outcome: 'accepted',
    },
    {
      callId: 'state-call-2',
      taskId: 'provider-sync-2',
      toolName: 'get_status',
      argumentHash: '2'.repeat(64),
      outcome: 'accepted',
    },
    {
      callId: 'state-call-3',
      taskId: 'provider-sync-3',
      toolName: 'get_status',
      argumentHash: '3'.repeat(64),
      outcome: 'accepted',
    },
    {
      callId: 'primary-call-1',
      taskId: REMOTE_TASK_ID,
      toolName: 'ugv_path_follow_mission',
      argumentHash: '4'.repeat(64),
      outcome: 'accepted',
    },
    {
      callId: 'followup-call-1',
      taskId: REMOTE_TASK_ID,
      toolName: 'ugv_mission_control',
      argumentHash: '5'.repeat(64),
      outcome: 'accepted',
    },
  );
  after.adapter.mutationJournal.push(
    {
      rowId: `${REMOTE_TASK_ID}:start:01:primary`,
      taskId: REMOTE_TASK_ID,
      stepId: 'start:01:primary',
      phase: 'PRIMARY',
      toolName: 'ugv_path_follow_mission',
      argumentHash: '4'.repeat(64),
      state: 'ACCEPTED',
      externalMissionId: MISSION_ID,
      result_hash: '6'.repeat(64),
      payload: {
        taskId: REMOTE_TASK_ID,
        stepId: 'start:01:primary',
        toolName: 'ugv_path_follow_mission',
        argumentHash: '4'.repeat(64),
        externalMissionId: MISSION_ID,
      },
    },
    {
      rowId: `${REMOTE_TASK_ID}:start:02:followup`,
      taskId: REMOTE_TASK_ID,
      stepId: 'start:02:followup',
      phase: 'FOLLOWUP',
      toolName: 'ugv_mission_control',
      argumentHash: '5'.repeat(64),
      state: 'ACCEPTED',
      externalMissionId: MISSION_ID,
      result_hash: '7'.repeat(64),
      payload: {
        taskId: REMOTE_TASK_ID,
        stepId: 'start:02:followup',
        toolName: 'ugv_mission_control',
        argumentHash: '5'.repeat(64),
        externalMissionId: MISSION_ID,
      },
    },
  );
  return {
    before,
    after,
    expected: {
      simulationId: SIMULATION_ID,
      navigateInvocationId: NAVIGATE_ID,
      remoteTaskId: REMOTE_TASK_ID,
      resourceId: 'vehicle:ugv1' as const,
      expectedProviderId: UGV_B02_PROVIDER_ID,
      target: TARGET,
      expectedArgumentHash: argumentHash,
      expectedMissionId: MISSION_ID,
    },
  };
}

function durableLineageFixture() {
  const before = emptyLedger('2026-08-21T12:00:00.000Z');
  const after = emptyLedger('2026-08-21T12:00:10.000Z');
  const definitionHash = sha256({ nodes: ['frozen'] });
  const expected = {
    admissionIdempotencyKey: 'admission-key-1',
    taskId: TASK_ID,
    contextId: CONTEXT_ID,
    planId: PLAN_ID,
    planDefinitionSha256: definitionHash,
    workflowInstanceId: 'workflow-instance-1',
    capabilityAttemptId: ATTEMPT_ID,
    navigateInvocationId: NAVIGATE_ID,
    confirmationId: 'confirmation-1',
    providerBindingId: PROVIDER_BINDING_ID,
    serverId: SERVER_ID,
    argumentsHash: '8'.repeat(64),
    dispatchHash: '9'.repeat(64),
    remoteBindingId: REMOTE_BINDING_ID,
    activeContinuation: {
      snapshotId: 'snapshot-1',
      continuationId: 'continuation-1',
      stateVersion: 1,
    },
  };
  after.sdar.initialTaskAdmissions.push({
    idempotencyKey: expected.admissionIdempotencyKey,
    taskId: TASK_ID,
    contextId: CONTEXT_ID,
    capabilityAttemptId: ATTEMPT_ID,
    capabilityBindingId: 'capability-binding-1',
    created_context: true,
    requestHash: `sha256:${'a'.repeat(64)}`,
  });
  after.sdar.capabilityAttempts.push({
    attemptId: ATTEMPT_ID,
    taskId: TASK_ID,
    capabilityBindingId: 'capability-binding-1',
    attemptNo: 1,
    planId: PLAN_ID,
    reason: 'initial',
    status: 'succeeded',
    skill_version_refs: ['skill:embodied.move_to:1'],
    provider_binding_refs: [PROVIDER_BINDING_ID],
    started_at: '2026-08-21T12:00:01.000Z',
    completedAt: '2026-08-21T12:00:06.000Z',
  });
  after.sdar.governedConfirmations.push({
    confirmationId: 'confirmation-1',
    taskId: TASK_ID,
    capabilityBindingId: 'capability-binding-1',
    capabilityAttemptId: ATTEMPT_ID,
    capability_id: 'embodied.move',
    capability_version: 2,
    planId: PLAN_ID,
    planHash: definitionHash.slice('sha256:'.length),
    skill_id: 'embodied.move_to',
    skill_version: 1,
    actor_id: 'uap-p3-b01-human-operator',
    actor_kind: 'human',
    authentication_method: 'configured_bearer',
    actor_roles_json: ['physical_control_approver'],
    revoked_at: null,
    revoked_by: null,
    providerBindingId: PROVIDER_BINDING_ID,
    serverId: SERVER_ID,
    toolName: 'vehicle_navigate',
    argumentsHash: expected.argumentsHash,
    consumedInvocationId: NAVIGATE_ID,
    consumedDispatchHash: expected.dispatchHash,
    confirmed_at: '2026-08-21T12:00:02.000Z',
    consumedAt: '2026-08-21T12:00:03.000Z',
    expires_at: '2026-08-21T12:01:00.000Z',
  });
  after.sdar.remoteAdmissionIntents.push({
    intentId: 'intent-1',
    invocationId: NAVIGATE_ID,
    bindingId: REMOTE_BINDING_ID,
    taskId: TASK_ID,
    capabilityAttemptId: ATTEMPT_ID,
    contextId: CONTEXT_ID,
    serverId: SERVER_ID,
    operationName: 'vehicle_navigate',
    argumentsHash: expected.argumentsHash,
    status: 'materialized',
    recordedInvocationId: NAVIGATE_ID,
    materializedBindingId: REMOTE_BINDING_ID,
    materializedSnapshotId: 'snapshot-1',
    reason_code: null,
  });
  after.sdar.continuationSnapshots.push({
    snapshotId: 'snapshot-1',
    continuationId: 'continuation-1',
    stateVersion: 1,
    predecessorSnapshotId: null,
    lifecycle: 'terminal',
    taskId: TASK_ID,
    contextId: CONTEXT_ID,
    planId: PLAN_ID,
    workflowInstanceId: 'workflow-instance-1',
  });
  after.sdar.continuationAttempts.push({
    attemptId: 'continuation-attempt-1',
    snapshotId: 'snapshot-1',
    continuationId: 'continuation-1',
    snapshotStateVersion: 1,
    workflowInstanceId: 'workflow-instance-1',
    status: 'succeeded',
    errorCode: null,
    completedAt: '2026-08-21T12:00:06.000Z',
  });
  after.sdar.tasks.push({
    taskId: TASK_ID,
    contextId: CONTEXT_ID,
    phase: 'completed',
    planId: PLAN_ID,
    selectedSkillId: 'embodied.move_to',
    selectedSkillVersion: 1,
    userGoalPlanId: 'user-goal-plan-1',
  });
  after.sdar.goals.push({
    goalId: 'goal-1',
    goalVersion: 1,
    contextId: CONTEXT_ID,
    status: 'achieved',
  });
  after.sdar.goalContracts.push({
    rowId: 'goal-1:1',
    goalId: 'goal-1',
    goalVersion: 1,
    contractHash: `sha256:${'b'.repeat(64)}`,
  });
  after.sdar.userGoalPlans.push({
    planId: 'user-goal-plan-1',
    goalId: 'goal-1',
    goalVersion: 1,
    revision: 1,
    status: 'completed',
    contractHash: `sha256:${'b'.repeat(64)}`,
  });
  after.sdar.workflowPlans.push({
    planId: PLAN_ID,
    goalId: 'goal-1',
    goalVersion: 1,
    confirmation_status: 'confirmed',
    attempt_count: 1,
    definition_json: { nodes: ['frozen'] },
  });
  after.sdar.workflowInstances.push({
    instanceId: 'workflow-instance-1',
    planId: PLAN_ID,
    goalId: 'goal-1',
    goalVersion: 1,
    status: 'succeeded',
    completedAt: '2026-08-21T12:00:06.000Z',
    workflowDefinitionId: 'ugv-move-workflow',
    workflowDefinitionVersion: 1,
  });
  after.sdar.skillExecutions.push({
    executionId: 'skill-execution-1',
    taskId: TASK_ID,
    goalId: 'goal-1',
    goalVersion: 1,
    skillId: 'embodied.move_to',
    skillVersion: 1,
    workflowPlanId: PLAN_ID,
    workflowDefinitionId: 'ugv-move-workflow',
    workflowDefinitionVersion: 1,
  });
  after.sdar.skillExecutionEvents.push({
    eventId: 'skill-event-1',
    executionId: 'skill-execution-1',
    eventType: 'skill.execution_completed',
    statusAfter: 'completed',
  });
  after.sdar.terminalOutcomes.push({
    outcomeId: 'terminal-outcome-1',
    taskId: TASK_ID,
    goalId: 'goal-1',
    goalVersion: 1,
    outcome_kind: 'achieved',
    controlStatus: 'achieved',
    authority: 'user_goal_plan_controller',
    summary: 'durable final-position evidence',
    finalInstanceId: 'workflow-instance-1',
    capability_attempt_id: ATTEMPT_ID,
    resultId: 'terminal-evidence-1',
  });
  after.sdar.processedResults.push({
    resultId: 'terminal-evidence-1',
    taskId: TASK_ID,
    skillId: 'embodied.move_to',
    skillVersion: 1,
  });
  after.sdar.workflowNodeEvents.push(
    {
      eventId: 'node-event-1',
      instanceId: 'workflow-instance-1',
      nodeId: 'ugv_navigate',
      eventType: 'node_started',
    },
    {
      eventId: 'node-event-2',
      instanceId: 'workflow-instance-1',
      nodeId: 'ugv_evidence_final_position',
      eventType: 'node_succeeded',
    },
  );
  after.sdar.mcpInvocations.push(
    mcp('initial-invocation-1', TASK_ID, ATTEMPT_ID, 'vehicle_get_state'),
    {
      ...mcp(NAVIGATE_ID, TASK_ID, ATTEMPT_ID, 'vehicle_navigate'),
      controlConfirmationId: 'confirmation-1',
      controlProviderBindingId: PROVIDER_BINDING_ID,
      controlArgumentsHash: expected.argumentsHash,
      controlDispatchHash: expected.dispatchHash,
      startedAt: '2026-08-21T12:00:02.500Z',
      completedAt: '2026-08-21T12:00:05.000Z',
    },
    mcp('final-invocation-1', TASK_ID, ATTEMPT_ID, 'vehicle_get_state'),
  );
  return { before, after, expected };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requiredRow<T>(rows: T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`missing fixture row ${String(index)}`);
  return row;
}
