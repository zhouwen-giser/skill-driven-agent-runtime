import { describe, expect, it, vi } from 'vitest';

import type {
  DslExecutionReadiness,
  McpTaskOperationDefinition,
  RuntimeExecutionContext,
  TaskAvailabilityReadResult,
  TaskAvailabilitySnapshot,
  WorkflowDefinition,
} from '../../domain/src/index.js';
import { McpTaskReadinessService, type TaskAvailabilityEvidenceRepository } from '../src/index.js';

const definition: WorkflowDefinition = Object.freeze({
  workflowDefinitionId: 'workflow-ugv-unknown',
  version: 1,
  goalId: 'goal-ugv-unknown',
  goalVersion: 1,
  entryNodeId: 'navigate',
  exitNodeIds: Object.freeze(['done']),
  nodes: Object.freeze([
    Object.freeze({
      nodeId: 'navigate',
      name: 'Navigate once',
      type: 'mcp_tool' as const,
      tool: Object.freeze({ serverId: 'ugv-runtime', toolName: 'vehicle_navigate' }),
      arguments: Object.freeze({ resourceId: 'vehicle:ugv1' }),
      taskExecution: Object.freeze({
        protocolMode: 'frozen_v1' as const,
        availabilityCheck: 'required' as const,
      }),
    }),
    Object.freeze({
      nodeId: 'done',
      name: 'Done',
      type: 'result' as const,
      value: Object.freeze({ op: 'literal' as const, value: true }),
    }),
  ]),
  edges: Object.freeze([{ sourceNodeId: 'navigate', targetNodeId: 'done' }]),
});

const operation: McpTaskOperationDefinition = Object.freeze({
  protocolMode: 'frozen_v1',
  taskNotifications: true,
  taskExecutionProfile: Object.freeze({
    profileVersion: '1.0',
    taskBehavior: 'task_required',
    availability: 'dynamic',
    supportsScheduling: false,
    supportsMaxElapsed: false,
    supportsCancellation: true,
    supportsPauseResume: false,
    supportsObservations: true,
    supportsInputRequired: false,
    idempotency: 'server_managed',
  }),
});

const executionContext: RuntimeExecutionContext = Object.freeze({ mode: 'live' });

describe('MCP Task pre-invocation unknown availability policy', () => {
  it('records Provider-reported unknown as allowed_by_default after plan confirmation', async () => {
    const fixture = readinessFixture(providerUnknown('UGV_NO_FORECAST'));

    await expect(
      fixture.service.assertPreInvocation(preInvocationInput(true)),
    ).resolves.toMatchObject({ availabilityCheck: 'required' });

    expect(fixture.saved).toHaveLength(1);
    expect(fixture.saved[0]).toMatchObject({
      readiness: {
        disposition: 'ready',
        guardAction: 'proceed',
        guardReasonCodes: ['MCP_TASK_AVAILABILITY_UNKNOWN_ALLOWED_BY_DEFAULT'],
      },
      snapshots: [{ result: { availability: 'unknown', reasonCode: 'UGV_NO_FORECAST' } }],
    });
  });

  it('preserves explicitly stale unknown evidence and blocks before invocation', async () => {
    const fixture = readinessFixture(providerUnknown('UGV_STATE_STALE'), 'explicitly_not_ready');

    await expect(
      fixture.service.assertPreInvocation(preInvocationInput(true)),
    ).rejects.toMatchObject({ code: 'MCP_TASK_PRECALL_NOT_READY' });

    expect(fixture.saved[0]).toMatchObject({
      readiness: {
        disposition: 'blocked',
        guardAction: 'abort',
        guardReasonCodes: ['MCP_TASK_AVAILABILITY_UNKNOWN_EXPLICIT_NOT_READY'],
      },
      snapshots: [{ result: { availability: 'unknown', reasonCode: 'UGV_STATE_STALE' } }],
    });
  });

  it('rejects Provider transport unavailability instead of treating it as observed unknown', async () => {
    const fixture = readinessFixture({
      kind: 'provider_unreachable',
      errorCode: 'MCP_PROVIDER_UNREACHABLE',
    });

    await expect(
      fixture.service.assertPreInvocation(preInvocationInput(true)),
    ).rejects.toMatchObject({ code: 'MCP_TASK_PRECALL_NOT_READY' });
    expect(fixture.saved[0]?.readiness).toMatchObject({
      disposition: 'blocked',
      guardReasonCodes: ['MCP_TASK_AVAILABILITY_UNKNOWN'],
    });
  });

  it('rejects observed unknown without an already confirmed immutable plan', async () => {
    const fixture = readinessFixture(providerUnknown());

    await expect(
      fixture.service.assertPreInvocation(preInvocationInput(false)),
    ).rejects.toMatchObject({ code: 'MCP_TASK_PRECALL_NOT_READY' });
    expect(fixture.saved[0]?.readiness).toMatchObject({
      disposition: 'blocked',
      guardReasonCodes: ['MCP_TASK_AVAILABILITY_UNKNOWN'],
    });
  });
});

function readinessFixture(
  outcome: TaskAvailabilityReadResult,
  unknownDecision: 'allowed_by_default' | 'explicitly_not_ready' = 'allowed_by_default',
) {
  const saved: Readonly<{
    readiness: DslExecutionReadiness;
    snapshots: readonly TaskAvailabilitySnapshot[];
  }>[] = [];
  const evidence: TaskAvailabilityEvidenceRepository = {
    saveEvaluation(readiness, snapshots) {
      saved.push({ readiness, snapshots });
      return Promise.resolve();
    },
    listByPlan: () => Promise.resolve([]),
    findLatestPlanning: () => Promise.resolve(undefined),
  };
  return {
    saved,
    service: new McpTaskReadinessService({
      operations: { getTaskOperationDefinition: () => Promise.resolve(operation) },
      provider: { checkTaskAvailability: () => Promise.resolve(outcome) },
      evidence,
      riskDecider: {
        decide: vi.fn(() => Promise.reject(new Error('risk model must not run'))),
      },
      clock: { now: () => '2026-09-01T05:00:00.000Z' },
      ids: {
        nextReadinessId: () => 'readiness-ugv-unknown',
        nextSnapshotId: () => 'snapshot-ugv-unknown',
      },
      providerUnknownPreInvocationPolicy: { decide: () => unknownDecision },
    }),
  };
}

function preInvocationInput(planConfirmed: boolean) {
  return {
    planId: 'plan-ugv-unknown',
    planAttempt: 1,
    definition,
    planConfirmed,
    workflowInstanceId: 'instance-ugv-unknown',
    workflowNodeId: 'navigate',
    workflowNodeRunId: 'instance-ugv-unknown~navigate~1',
    serverId: 'ugv-runtime',
    operationName: 'vehicle_navigate',
    arguments: Object.freeze({ resourceId: 'vehicle:ugv1' }),
    taskExecution: Object.freeze({
      protocolMode: 'frozen_v1' as const,
      availabilityCheck: 'required' as const,
    }),
    executionContext,
  };
}

function providerUnknown(reasonCode = 'UGV_NO_FORECAST'): TaskAvailabilityReadResult {
  return Object.freeze({
    kind: 'results',
    protocolRevision: '2026-07-28',
    availabilitySchemaRevision: '1.0',
    results: Object.freeze([
      Object.freeze({
        nodeId: 'navigate',
        operationName: 'vehicle_navigate',
        availability: 'unknown',
        riskLevel: 'medium',
        reasonCode,
        validUntil: '2026-09-01T05:00:01.000Z',
        nextAvailableWindows: Object.freeze([]),
        reservationMode: 'none',
        possibleEffects: Object.freeze([]),
      }),
    ]),
  });
}
