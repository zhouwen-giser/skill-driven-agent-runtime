import { describe, expect, it, vi } from 'vitest';

import type {
  DslExecutionReadiness,
  DslRiskDecision,
  McpTaskOperationSemantics,
  TaskAvailabilityCheckResult,
  TaskAvailabilitySnapshot,
  WorkflowDefinition,
} from '../../domain/src/index.js';
import {
  McpTaskReadinessService,
  canonicalHash,
  type TaskAvailabilityBatchReader,
  type TaskRiskDecider,
} from '../src/index.js';

const semantics: McpTaskOperationSemantics = {
  execution: 'task_required',
  availability: 'dynamic',
  supportsScheduling: true,
  supportsMaxElapsed: true,
  supportsObservations: true,
  cancellation: 'task_cancel',
  revision: '1.0',
};
const now = '2026-07-16T22:00:00.000Z';

describe('McpTaskReadinessService', () => {
  it('batches available nodes and persists immutable ready evidence', async () => {
    const evidence = new MemoryEvidence();
    const reader = vi.fn().mockResolvedValue(results([availability('available')]));
    const decider = new FixedDecider({
      action: 'abort',
      summary: 'must not be called for available',
    });
    const service = createService(evidence, reader, decider);

    const assessment = await service.assess({
      planId: 'plan-1',
      attempt: 1,
      definition: workflow(),
    });

    expect(assessment).toMatchObject({
      accepted: true,
      readiness: { disposition: 'ready', confirmationRequired: false },
    });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(decider.calls).toBe(0);
    expect(evidence.items[0]?.snapshots[0]).toMatchObject({
      arguments: { unresolved: false, value: { route: 'A' } },
      result: { availability: 'available' },
    });
    expect(Object.isFrozen(evidence.items[0]?.snapshots[0]?.result)).toBe(true);
  });

  it('forces restricted risk into confirmation even when the model selects proceed', async () => {
    const evidence = new MemoryEvidence();
    const restricted = availability('restricted', {
      riskLevel: 'high',
      validUntil: '2026-07-16T22:10:00.000Z',
      earliestStartTime: '2026-07-16T22:02:00.000Z',
      reservationMode: 'best_effort',
      possibleEffects: ['start_rejection'],
    });
    const service = createService(
      evidence,
      vi.fn().mockResolvedValue(results([restricted])),
      new FixedDecider({
        action: 'proceed',
        acceptedRiskNodeIds: ['patrol'],
        summary: 'Proceed with explicit operator review.',
      }),
    );

    await expect(
      service.assess({ planId: 'plan-1', attempt: 1, definition: workflow() }),
    ).resolves.toMatchObject({
      accepted: true,
      readiness: {
        disposition: 'confirmation_required',
        guardAction: 'request_confirmation',
        confirmationRequired: true,
      },
    });
    expect(evidence.items[0]?.snapshots[0]?.result.reservationMode).toBe('best_effort');
  });

  it.each([
    ['missing hints', availability('restricted', { validUntil: undefined })],
    [
      'expired at the equality boundary',
      availability('restricted', {
        validUntil: now,
        earliestStartTime: '2026-07-16T22:02:00.000Z',
      }),
    ],
  ])('downgrades restricted %s to unknown/high', async (_label, forecast) => {
    const evidence = new MemoryEvidence();
    const service = createService(
      evidence,
      vi.fn().mockResolvedValue(results([forecast])),
      new FixedDecider({
        action: 'request_confirmation',
        riskNodeIds: ['patrol'],
        summary: 'Unknown forecast needs confirmation.',
      }),
    );

    const assessment = await service.assess({
      planId: 'plan-1',
      attempt: 1,
      definition: workflow(),
    });

    expect(assessment).toMatchObject({
      accepted: true,
      readiness: { disposition: 'confirmation_required' },
    });
    expect(evidence.items[0]?.snapshots[0]?.result).toMatchObject({
      availability: 'unknown',
      riskLevel: 'high',
      reservationMode: 'none',
    });
  });

  it.each([
    ['disabled', availability('disabled'), 'MCP_TASK_AVAILABILITY_DISABLED'],
    [
      'invalid guaranteed reservation',
      availability('restricted', {
        validUntil: '2026-07-16T22:10:00.000Z',
        earliestStartTime: '2026-07-16T22:02:00.000Z',
        reservationMode: 'guaranteed',
      }),
      'MCP_TASK_AVAILABILITY_RESERVATION_INVALID',
    ],
  ])('hard blocks %s before a model can override it', async (_label, forecast, code) => {
    const evidence = new MemoryEvidence();
    const decider = new FixedDecider({
      action: 'proceed',
      acceptedRiskNodeIds: ['patrol'],
      summary: 'bad',
    });
    const service = createService(
      evidence,
      vi.fn().mockResolvedValue(results([forecast])),
      decider,
    );

    const assessment = await service.assess({
      planId: 'plan-1',
      attempt: 1,
      definition: workflow(),
    });

    expect(assessment).toMatchObject({ accepted: false, readiness: { disposition: 'blocked' } });
    expect(assessment.readiness.guardReasonCodes.join(' ')).toContain(code);
    expect(decider.calls).toBe(0);
  });

  it('accepts only an in-window reschedule and returns a planner correction', async () => {
    const evidence = new MemoryEvidence();
    const service = createService(
      evidence,
      vi.fn().mockResolvedValue(
        results([
          availability('restricted', {
            validUntil: '2026-07-16T22:10:00.000Z',
            nextAvailableWindows: [
              {
                startTime: '2026-07-16T22:02:00.000Z',
                endTime: '2026-07-16T22:04:00.000Z',
              },
            ],
          }),
        ]),
      ),
      new FixedDecider({
        action: 'reschedule',
        nodeId: 'patrol',
        selectedStartTime: '2026-07-16T22:03:00.000Z',
        summary: 'Use the offered window.',
      }),
    );

    await expect(
      service.assess({ planId: 'plan-1', attempt: 1, definition: workflow() }),
    ).resolves.toMatchObject({
      accepted: false,
      terminal: false,
      readiness: { disposition: 'revision_required', guardAction: 'reschedule' },
    });
  });

  it('refreshes with the exact actual arguments and lets a confirmed restricted call reach Provider', async () => {
    const evidence = new MemoryEvidence();
    const reader = vi.fn().mockResolvedValue(
      results([
        availability('restricted', {
          validUntil: '2026-07-16T22:10:00.000Z',
          earliestStartTime: '2026-07-16T22:02:00.000Z',
        }),
      ]),
    );
    const service = createService(
      evidence,
      reader,
      new FixedDecider({
        action: 'proceed',
        acceptedRiskNodeIds: ['patrol'],
        summary: 'Confirm the forecasted restriction.',
      }),
    );
    const execution = {
      mode: 'require_task' as const,
      availabilityCheck: 'required' as const,
      timing: {
        start: { mode: 'immediate' as const, startToleranceMs: 0 },
        maxElapsedMs: null,
      },
    };

    await expect(
      service.assess({ planId: 'plan-1', attempt: 1, definition: workflow() }),
    ).resolves.toMatchObject({
      accepted: true,
      readiness: { disposition: 'confirmation_required' },
    });

    await expect(
      service.assertPreInvocation({
        planId: 'plan-1',
        planAttempt: 1,
        definition: workflow(),
        planConfirmed: true,
        workflowInstanceId: 'instance-1',
        workflowNodeId: 'patrol',
        workflowNodeRunId: 'instance-1:patrol:1',
        serverId: 'provider',
        operationName: 'vehicle_patrol',
        arguments: { route: 'B' },
        taskExecution: execution,
        executionContext: { mode: 'live' },
      }),
    ).resolves.toMatchObject(execution);
    expect(reader).toHaveBeenCalledWith(
      expect.objectContaining({
        requests: [
          expect.objectContaining({ arguments: { unresolved: false, value: { route: 'B' } } }),
        ],
      }),
    );
    expect(evidence.items.at(-1)?.readiness).toMatchObject({
      checkPhase: 'pre_invocation',
      disposition: 'ready',
    });
  });

  it('requires a new confirmation when a previously available call becomes restricted', async () => {
    const evidence = new MemoryEvidence();
    const reader = vi
      .fn()
      .mockResolvedValueOnce(results([availability('available')]))
      .mockResolvedValueOnce(
        results([
          availability('restricted', {
            validUntil: '2026-07-16T22:10:00.000Z',
            earliestStartTime: '2026-07-16T22:02:00.000Z',
          }),
        ]),
      );
    const service = createService(
      evidence,
      reader,
      new FixedDecider({ action: 'abort', summary: 'unused' }),
    );
    await service.assess({ planId: 'plan-1', attempt: 1, definition: workflow() });

    await expect(
      service.assertPreInvocation({
        planId: 'plan-1',
        planAttempt: 1,
        definition: workflow(),
        planConfirmed: true,
        workflowInstanceId: 'instance-1',
        workflowNodeId: 'patrol',
        workflowNodeRunId: 'instance-1:patrol:1',
        serverId: 'provider',
        operationName: 'vehicle_patrol',
        arguments: { route: 'B' },
        taskExecution: { mode: 'require_task', availabilityCheck: 'required' },
        executionContext: { mode: 'live' },
      }),
    ).rejects.toMatchObject({ code: 'MCP_TASK_PRECALL_NOT_READY' });
    expect(evidence.items.at(-1)?.readiness.guardReasonCodes).toContain(
      'MCP_TASK_AVAILABILITY_RECONFIRM_REQUIRED',
    );
  });

  it('fails closed before Tool invocation when the pre-call refresh becomes disabled', async () => {
    const evidence = new MemoryEvidence();
    const service = createService(
      evidence,
      vi.fn().mockResolvedValue(results([availability('disabled')])),
      new FixedDecider({ action: 'abort', summary: 'unused' }),
    );
    await expect(
      service.assertPreInvocation({
        planId: 'plan-1',
        planAttempt: 1,
        definition: workflow(),
        planConfirmed: true,
        workflowInstanceId: 'instance-1',
        workflowNodeId: 'patrol',
        workflowNodeRunId: 'instance-1:patrol:1',
        serverId: 'provider',
        operationName: 'vehicle_patrol',
        arguments: { route: 'C' },
        taskExecution: { mode: 'require_task', availabilityCheck: 'required' },
        executionContext: { mode: 'live' },
      }),
    ).rejects.toMatchObject({ code: 'MCP_TASK_PRECALL_NOT_READY' });
    expect(evidence.items.at(-1)?.readiness.guardReasonCodes).toContain(
      'MCP_TASK_AVAILABILITY_DISABLED',
    );
  });

  it('uses canonical argument hashes so different actual arguments cannot alias', () => {
    expect(canonicalHash({ route: 'A', speed: 1 })).toBe(canonicalHash({ speed: 1, route: 'A' }));
    expect(canonicalHash({ route: 'A' })).not.toBe(canonicalHash({ route: 'B' }));
  });
});

function createService(
  evidence: MemoryEvidence,
  reader: TaskAvailabilityBatchReader['checkTaskAvailability'],
  decider: FixedDecider,
) {
  let readiness = 0;
  let snapshot = 0;
  return new McpTaskReadinessService({
    operations: { getTaskOperationDefinition: () => Promise.resolve({ semantics }) },
    provider: { checkTaskAvailability: reader },
    evidence,
    riskDecider: decider,
    clock: { now: () => now },
    ids: {
      nextReadinessId: () => `readiness-${String(++readiness)}`,
      nextSnapshotId: () => `snapshot-${String(++snapshot)}`,
    },
  });
}

function workflow(): WorkflowDefinition {
  return {
    workflowDefinitionId: 'workflow-1',
    version: 1,
    goalId: 'goal-1',
    goalVersion: 1,
    entryNodeId: 'patrol',
    exitNodeIds: ['patrol'],
    nodes: [
      {
        nodeId: 'patrol',
        name: 'Patrol',
        type: 'mcp_tool',
        tool: { serverId: 'provider', toolName: 'vehicle_patrol' },
        arguments: { route: 'A' },
        taskExecution: {
          mode: 'require_task',
          availabilityCheck: 'required',
          timing: {
            start: { mode: 'immediate', startToleranceMs: 0 },
            maxElapsedMs: null,
          },
        },
      },
    ],
    edges: [],
  };
}

function availability(
  state: TaskAvailabilityCheckResult['availability'],
  overrides: Partial<TaskAvailabilityCheckResult> = {},
): TaskAvailabilityCheckResult {
  return {
    nodeId: 'patrol',
    operationName: 'vehicle_patrol',
    availability: state,
    riskLevel: state === 'available' ? 'low' : state === 'disabled' ? 'critical' : 'high',
    nextAvailableWindows: [],
    reservationMode: 'none',
    possibleEffects: [],
    ...overrides,
  };
}

function results(values: readonly TaskAvailabilityCheckResult[]) {
  return {
    kind: 'results' as const,
    protocolRevision: '2026-07-28',
    availabilitySchemaRevision: '1.0',
    results: values,
  };
}

class FixedDecider implements TaskRiskDecider {
  calls = 0;
  readonly #decision: DslRiskDecision;
  constructor(decision: DslRiskDecision) {
    this.#decision = decision;
  }
  decide(): Promise<DslRiskDecision> {
    this.calls += 1;
    return Promise.resolve(this.#decision);
  }
}

class MemoryEvidence {
  readonly items: {
    readiness: DslExecutionReadiness;
    snapshots: readonly TaskAvailabilitySnapshot[];
  }[] = [];
  saveEvaluation(readiness: DslExecutionReadiness, snapshots: readonly TaskAvailabilitySnapshot[]) {
    this.items.push({ readiness, snapshots });
    return Promise.resolve();
  }
  listByPlan() {
    return Promise.resolve(this.items);
  }
  findLatestPlanning() {
    return Promise.resolve(this.items.find((item) => item.readiness.checkPhase === 'planning'));
  }
}
