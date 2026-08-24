import { describe, expect, it } from 'vitest';

import {
  canonicalHash,
  createMcpProviderDispatchHash,
  ugvGovernedControlConfirmationId,
  type GovernedControlConfirmation,
  type RemoteTaskLifecycleEvidence,
  type UgvGovernedControlConfirmationIssueInput,
} from '../../../packages/application/src/index.js';
import type {
  InternalToolResult,
  McpInvocation,
  McpToolExecutionSemantics,
  SelectedTaskOperation,
  WorkflowContinuationAttempt,
} from '../../../packages/domain/src/index.js';
import {
  projectUgvMoveWorkflowEvidence,
  UgvMoveWorkflowEvidenceError,
  verifyUgvMoveTerminalWorkflowEvidence,
} from '../src/ugv-move-workflow-evidence.js';

import { selectedUgvTaskOperation } from './ugv-move-workflow-test-fixture.js';

const TASK_ID = 'task-uap-p2-b03';
const CONTEXT_ID = 'context-uap-p2-b03';
const CAPABILITY_ATTEMPT_ID = 'capability-attempt-uap-p2-b03';
const BINDING_ID = 'remote-binding-invocation-navigate';
const CONTROL_EVENT_ID = 'remote-control-provider-task-1-completed';
const CONTINUATION_SNAPSHOT_ID = 'continuation-snapshot-provider-task-1';
const CONTINUATION_ID = 'continuation-workflow-instance-uap-p2-b03';
const WORKFLOW_INSTANCE_ID = 'workflow-instance-uap-p2-b03';
const NAVIGATE_NODE_RUN_ID = `${WORKFLOW_INSTANCE_ID}~ugv_navigate~1`;
const TERMINAL_AT = '2026-08-21T12:00:09.900Z';
const CLAIMED_AT = '2026-08-21T12:00:09.950Z';
const ATTEMPT_STARTED_AT = '2026-08-21T12:00:09.960Z';
const INITIAL_POSITION = Object.freeze({ longitude: 111.999, latitude: 28 });
const TARGET = Object.freeze({ longitude: 112, latitude: 28 });
const POLICY = Object.freeze({
  toleranceM: 2,
  minimumDisplacementM: 10,
  maxFinalStateAgeMs: 3_000,
});

describe('UGV move durable Workflow evidence projection', () => {
  it('projects schema-valid Skill output only after exact 3-call and terminal position proof', () => {
    const fixture = evidenceFixture();

    const projected = projectUgvMoveWorkflowEvidence(fixture);

    expect(projected.assessment.status).toBe('completed');
    expect(projected.result.validatedEvidence).toEqual({ 'final-position': true });
    expect(projected.result.metadata).toMatchObject({
      'io.sdar/evidence': {
        items: [
          {
            evidenceId: 'ugv-position-invocation-navigate',
            evidenceType: 'position.observation',
            resourceId: 'vehicle:ugv1',
            correlationId: 'invocation-navigate',
            remoteTaskId: 'provider-task-1',
            finalPosition: TARGET,
          },
        ],
      },
      'io.sdar/ugv-move-assessment': {
        status: 'completed',
        reasonCode: 'UGV_MOVE_FINAL_POSITION_CONFIRMED',
      },
      ugvSkillResult: {
        resourceId: 'vehicle:ugv1',
        status: 'completed',
        finalPosition: { x: 112, y: 28, frame: 'EPSG:4326' },
      },
    });
    expect(projected.result.evidence).toEqual([
      expect.objectContaining({
        evidenceId: 'ugv-position-invocation-navigate',
        evidenceType: 'position.observation',
        subjectRef: 'vehicle:ugv1',
        payloadRef: { kind: 'structured_content', jsonPointer: '/chassis/position' },
      }),
    ]);
  });

  it('keeps Provider completed insufficient when the final position misses the hard gate', () => {
    const fixture = evidenceFixture({
      finalToolResult: stateResult({
        observedAt: '2026-08-21T12:00:10.400Z',
        revision: 'state-revision-102',
        cursor: 102,
        position: { longitude: 112.001, latitude: 28 },
      }),
    });
    const finalInvocation = fixture.invocations[2];
    if (finalInvocation === undefined) throw new Error('fixture final invocation missing');
    const invocations = [
      fixture.invocations[0],
      fixture.invocations[1],
      { ...finalInvocation, result: fixture.finalToolResult },
    ].filter((value): value is McpInvocation => value !== undefined);

    const projected = projectUgvMoveWorkflowEvidence({ ...fixture, invocations });

    expect(projected.assessment).toEqual({
      status: 'failed',
      reasonCode: 'UGV_MOVE_FINAL_POSITION_OUT_OF_TOLERANCE',
    });
    expect(projected.result.validatedEvidence).toEqual({ 'final-position': false });
    expect(projected.result.metadata).not.toHaveProperty('io.sdar/evidence');
    expect(projected.result.metadata).not.toHaveProperty('ugvSkillResult');
  });

  it.each([
    [
      'missing final read',
      (fixture: ReturnType<typeof evidenceFixture>) => fixture.invocations.slice(0, 2),
    ],
    [
      'second navigation dispatch',
      (fixture: ReturnType<typeof evidenceFixture>) => [
        ...fixture.invocations,
        { ...requiredInvocation(fixture, 1), invocationId: 'invocation-navigate-replay' },
      ],
    ],
    [
      'forbidden operation',
      (fixture: ReturnType<typeof evidenceFixture>) => [
        requiredInvocation(fixture, 0),
        { ...requiredInvocation(fixture, 1), toolName: 'vehicle_fire_weapon' },
        requiredInvocation(fixture, 2),
      ],
    ],
  ])('rejects an invalid call ledger: %s', (_label, mutate) => {
    const fixture = evidenceFixture();
    expect(() =>
      projectUgvMoveWorkflowEvidence({ ...fixture, invocations: mutate(fixture) }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATIONS_INVALID' }));
  });

  it('rejects invocation arguments or execution authority that drifted from selection', () => {
    const fixture = evidenceFixture();
    const navigate = fixture.invocations[1];
    if (navigate === undefined) throw new Error('fixture navigation invocation missing');
    const invocations = [
      fixture.invocations[0],
      { ...navigate, arguments: { ...navigate.arguments, stopOnObstacle: false } },
      fixture.invocations[2],
    ].filter((value): value is McpInvocation => value !== undefined);

    expect(() => projectUgvMoveWorkflowEvidence({ ...fixture, invocations })).toThrow(
      expect.objectContaining({
        code: 'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATION_LINEAGE_INVALID',
      }),
    );
  });

  it('rejects a claimed terminal binding without its exact durable continuation snapshot', () => {
    const fixture = evidenceFixture();
    const lifecycle = requiredLifecycle(fixture);

    expect(() =>
      projectUgvMoveWorkflowEvidence({
        ...fixture,
        remoteTaskLifecycle: [{ ...lifecycle, continuations: [] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_CONTINUATION_INVALID' }));
  });

  it('rejects a final state read that started before the terminal control claim and running attempt', () => {
    const fixture = evidenceFixture();
    const final = requiredInvocation(fixture, 2);
    const invocations = [
      requiredInvocation(fixture, 0),
      requiredInvocation(fixture, 1),
      {
        ...final,
        startedAt: '2026-08-21T12:00:09.940Z',
        completedAt: '2026-08-21T12:00:09.945Z',
        durationMs: 5,
      },
    ];

    expect(() => projectUgvMoveWorkflowEvidence({ ...fixture, invocations })).toThrow(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_CONTINUATION_INVALID' }),
    );
  });

  it.each(['attempt_succeeded', 'control_processed', 'binding_reentered'] as const)(
    'rejects future continuation state at the final-read boundary: %s',
    (futureState) => {
      const fixture = evidenceFixture();
      const lifecycle = requiredLifecycle(fixture);
      const control = lifecycle.controls[0];
      if (control === undefined) throw new Error('fixture control missing');
      const remoteTaskLifecycle = [
        futureState === 'control_processed'
          ? {
              ...lifecycle,
              controls: [
                {
                  ...control,
                  status: 'processed' as const,
                  processedAt: '2026-08-21T12:00:10.600Z',
                },
              ],
            }
          : futureState === 'binding_reentered'
            ? { ...lifecycle, binding: { ...lifecycle.binding, localState: 'reentered' as const } }
            : lifecycle,
      ];
      const continuationAttempt =
        futureState === 'attempt_succeeded'
          ? ({
              ...fixture.continuationAttempt,
              status: 'succeeded' as const,
              completedAt: '2026-08-21T12:00:10.600Z',
            } satisfies WorkflowContinuationAttempt)
          : fixture.continuationAttempt;

      expect(() =>
        projectUgvMoveWorkflowEvidence({
          ...fixture,
          remoteTaskLifecycle,
          continuationAttempt,
        }),
      ).toThrow(
        expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_CONTINUATION_INVALID' }),
      );
    },
  );

  it('rejects a navigate invocation without persisted governed-control receipt fields', () => {
    const fixture = evidenceFixture();
    const navigate = requiredInvocation(fixture, 1);
    const {
      controlConfirmationId,
      controlProviderBindingId,
      controlArgumentsHash,
      controlDispatchHash,
      ...withoutControl
    } = navigate;
    expect([
      controlConfirmationId,
      controlProviderBindingId,
      controlArgumentsHash,
      controlDispatchHash,
    ]).not.toContain(undefined);

    expect(() =>
      projectUgvMoveWorkflowEvidence({
        ...fixture,
        invocations: [
          requiredInvocation(fixture, 0),
          withoutControl,
          requiredInvocation(fixture, 2),
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_CONFIRMATION_INVALID' }));
  });

  it.each([
    ['confirmation', { controlConfirmationId: 'ugv-control-tampered' }],
    ['Provider Binding', { controlProviderBindingId: 'binding-tampered' }],
    ['arguments hash', { controlArgumentsHash: '0'.repeat(64) }],
    ['dispatch hash', { controlDispatchHash: `sha256:${'0'.repeat(64)}` }],
  ])('rejects a tampered navigate %s receipt field', (_label, mutation) => {
    const fixture = evidenceFixture();
    const navigate = requiredInvocation(fixture, 1);

    expect(() =>
      projectUgvMoveWorkflowEvidence({
        ...fixture,
        invocations: [
          requiredInvocation(fixture, 0),
          { ...navigate, ...mutation },
          requiredInvocation(fixture, 2),
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_CONFIRMATION_INVALID' }));
  });

  it('rejects governed side-effect authority attached to either read-only invocation', () => {
    const fixture = evidenceFixture();
    const initial = requiredInvocation(fixture, 0);

    expect(() =>
      projectUgvMoveWorkflowEvidence({
        ...fixture,
        invocations: [
          { ...initial, controlConfirmationId: fixture.confirmation.confirmationId },
          requiredInvocation(fixture, 1),
          requiredInvocation(fixture, 2),
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_CONFIRMATION_INVALID' }));
  });

  it('rejects a selected snapshot whose content no longer reproduces its self-hash', () => {
    const fixture = evidenceFixture();
    const selectedTaskOperation = {
      ...fixture.selectedTaskOperation,
      resolvedArguments: {
        ...fixture.selectedTaskOperation.resolvedArguments,
        stopOnObstacle: false,
      },
    } as SelectedTaskOperation;

    expect(() => projectUgvMoveWorkflowEvidence({ ...fixture, selectedTaskOperation })).toThrow(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_SELECTED_OPERATION_INVALID' }),
    );
  });

  it('rejects full execution-semantics, context, node-run, or remote Task drift', () => {
    const fixture = evidenceFixture();
    const navigate = requiredInvocation(fixture, 1);
    expect(() =>
      projectUgvMoveWorkflowEvidence({
        ...fixture,
        invocations: [
          requiredInvocation(fixture, 0),
          {
            ...navigate,
            executionSemantics: { ...navigate.executionSemantics, replay: 'allowed' },
          },
          requiredInvocation(fixture, 2),
        ],
      }),
    ).toThrow(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATION_LINEAGE_INVALID' }),
    );

    expect(() =>
      projectUgvMoveWorkflowEvidence({
        ...fixture,
        invocations: [
          requiredInvocation(fixture, 0),
          {
            ...navigate,
            result: { remoteTask: { remoteTaskId: 'provider-task-tampered', status: 'working' } },
          },
          requiredInvocation(fixture, 2),
        ],
      }),
    ).toThrow(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATION_LINEAGE_INVALID' }),
    );

    const lifecycle = requiredLifecycle(fixture);
    expect(() =>
      projectUgvMoveWorkflowEvidence({
        ...fixture,
        remoteTaskLifecycle: [
          {
            ...lifecycle,
            binding: { ...lifecycle.binding, workflowNodeRunId: 'wrong-node-run' },
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATION_LINEAGE_INVALID' }),
    );
  });

  it('rejects ambiguous remote bindings and a final result that differs from PostgreSQL', () => {
    const fixture = evidenceFixture();
    expect(() =>
      projectUgvMoveWorkflowEvidence({
        ...fixture,
        remoteTaskLifecycle: [
          ...fixture.remoteTaskLifecycle,
          remoteLifecycle(fixture.remoteTaskLifecycle[0]?.binding.resultSnapshot),
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_REMOTE_TASK_INVALID' }));

    expect(() =>
      projectUgvMoveWorkflowEvidence({
        ...fixture,
        finalToolResult: stateResult({
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: 'forged-final-revision',
          cursor: 102,
          position: TARGET,
        }),
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_RESULT_INVALID' }));
  });

  it('exposes stable typed errors without leaking provider payloads', () => {
    const fixture = evidenceFixture();
    try {
      projectUgvMoveWorkflowEvidence({ ...fixture, taskId: '   ' });
      throw new Error('expected projector rejection');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(UgvMoveWorkflowEvidenceError);
      expect(error).toMatchObject({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_TASK_INVALID' });
      expect(String(error)).not.toContain('vehicle:ugv1');
    }
  });
});

describe('UGV move deterministic terminal Workflow evidence', () => {
  it('accepts the exact persisted Skill result only after the continuation attempt succeeded', () => {
    const fixture = terminalEvidenceFixture();

    const verified = verifyUgvMoveTerminalWorkflowEvidence(fixture);

    expect(verified.assessment.status).toBe('completed');
    expect(verified.skillResult).toEqual({
      resourceId: 'vehicle:ugv1',
      status: 'completed',
      finalPosition: { x: 112, y: 28, frame: 'EPSG:4326' },
    });
  });

  it('rejects the running final-read attempt before it has durably succeeded', () => {
    const fixture = terminalEvidenceFixture();

    expect(() =>
      verifyUgvMoveTerminalWorkflowEvidence({
        ...fixture,
        continuationAttempt: evidenceFixture().continuationAttempt,
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_CONTINUATION_INVALID' }));
  });

  it('rejects a persisted Workflow result that was not derived from the durable final position', () => {
    const fixture = terminalEvidenceFixture();

    expect(() =>
      verifyUgvMoveTerminalWorkflowEvidence({
        ...fixture,
        workflowResult: {
          resourceId: 'vehicle:ugv1',
          status: 'completed',
          finalPosition: { x: 112.001, y: 28, frame: 'EPSG:4326' },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_RESULT_INVALID' }));
  });

  it('rejects succeeded status when the persisted final position fails the hard gate', () => {
    const missedFinal = stateResult({
      observedAt: '2026-08-21T12:00:10.400Z',
      revision: 'state-revision-102',
      cursor: 102,
      position: { longitude: 112.001, latitude: 28 },
    });
    const fixture = evidenceFixture({ finalToolResult: missedFinal });
    const terminalAttempt = Object.freeze({
      ...fixture.continuationAttempt,
      status: 'succeeded' as const,
      completedAt: '2026-08-21T12:00:10.600Z',
    }) satisfies WorkflowContinuationAttempt;
    const invocations = [
      requiredInvocation(fixture, 0),
      requiredInvocation(fixture, 1),
      { ...requiredInvocation(fixture, 2), result: missedFinal },
    ];

    expect(() =>
      verifyUgvMoveTerminalWorkflowEvidence({
        ...fixture,
        invocations,
        continuationAttempt: terminalAttempt,
        workflowResult: {
          resourceId: 'vehicle:ugv1',
          status: 'completed',
          finalPosition: { x: 112, y: 28, frame: 'EPSG:4326' },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_RESULT_INVALID' }));
  });

  it.each(['control_processed', 'binding_reentered'] as const)(
    'rejects post-acknowledgement state at the in-callback terminal boundary: %s',
    (futureState) => {
      const fixture = terminalEvidenceFixture();
      const lifecycle = requiredLifecycle(fixture);
      const control = lifecycle.controls[0];
      if (control === undefined) throw new Error('fixture control missing');
      const remoteTaskLifecycle = [
        futureState === 'control_processed'
          ? {
              ...lifecycle,
              controls: [
                {
                  ...control,
                  status: 'processed' as const,
                  processedAt: '2026-08-21T12:00:10.700Z',
                },
              ],
            }
          : { ...lifecycle, binding: { ...lifecycle.binding, localState: 'reentered' as const } },
      ];

      expect(() =>
        verifyUgvMoveTerminalWorkflowEvidence({ ...fixture, remoteTaskLifecycle }),
      ).toThrow(
        expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_EVIDENCE_CONTINUATION_INVALID' }),
      );
    },
  );
});

function terminalEvidenceFixture() {
  const fixture = evidenceFixture();
  const projected = projectUgvMoveWorkflowEvidence(fixture);
  const workflowResult = projected.result.metadata?.['ugvSkillResult'];
  if (workflowResult === undefined) throw new Error('fixture Skill result missing');
  return {
    ...fixture,
    continuationAttempt: Object.freeze({
      ...fixture.continuationAttempt,
      status: 'succeeded' as const,
      completedAt: '2026-08-21T12:00:10.600Z',
    }) satisfies WorkflowContinuationAttempt,
    workflowResult,
  };
}

function evidenceFixture(overrides: Readonly<{ finalToolResult?: InternalToolResult }> = {}) {
  const selectedTaskOperation = selectedUgvTaskOperation();
  const confirmation = governedConfirmation(selectedTaskOperation);
  const initial = stateResult({
    observedAt: '2026-08-21T11:59:59.000Z',
    revision: 'state-revision-100',
    cursor: 100,
    position: INITIAL_POSITION,
  });
  const finalToolResult =
    overrides.finalToolResult ??
    stateResult({
      observedAt: '2026-08-21T12:00:10.400Z',
      revision: 'state-revision-102',
      cursor: 102,
      position: TARGET,
    });
  const terminal = terminalResult();
  return {
    taskId: TASK_ID,
    selectedTaskOperation,
    invocations: Object.freeze([
      invocation({
        invocationId: 'invocation-initial',
        toolName: 'vehicle_get_state',
        arguments: selectedTaskOperation.finalStateRead.resolvedArguments,
        result: initial,
        startedAt: '2026-08-21T11:59:58.500Z',
        completedAt: '2026-08-21T11:59:59.000Z',
        semantics: selectedTaskOperation.finalStateRead.executionSemantics,
      }),
      invocation({
        invocationId: 'invocation-navigate',
        toolName: 'vehicle_navigate',
        arguments: selectedTaskOperation.resolvedArguments,
        result: { remoteTask: { remoteTaskId: 'provider-task-1', status: 'working' } },
        startedAt: '2026-08-21T12:00:00.000Z',
        completedAt: '2026-08-21T12:00:00.100Z',
        semantics: selectedTaskOperation.operation.executionSemantics,
        confirmation,
      }),
      invocation({
        invocationId: 'invocation-final',
        toolName: 'vehicle_get_state',
        arguments: selectedTaskOperation.finalStateRead.resolvedArguments,
        result: finalToolResult,
        startedAt: '2026-08-21T12:00:10.000Z',
        completedAt: '2026-08-21T12:00:10.500Z',
        semantics: selectedTaskOperation.finalStateRead.executionSemantics,
      }),
    ]),
    remoteTaskLifecycle: Object.freeze([remoteLifecycle(terminal)]),
    confirmation,
    continuationAttempt: continuationAttempt(),
    finalToolResult,
    assessedAt: '2026-08-21T12:00:11.000Z',
    policy: POLICY,
  };
}

function invocation(
  input: Readonly<{
    invocationId: string;
    toolName: string;
    arguments: Readonly<Record<string, unknown>>;
    result: unknown;
    startedAt: string;
    completedAt: string;
    semantics: McpToolExecutionSemantics;
    confirmation?: GovernedControlConfirmation;
  }>,
): McpInvocation {
  return Object.freeze({
    invocationId: input.invocationId,
    taskId: TASK_ID,
    ...(input.confirmation === undefined
      ? {}
      : {
          capabilityAttemptId: input.confirmation.capabilityAttemptId,
          controlConfirmationId: input.confirmation.confirmationId,
          controlProviderBindingId: input.confirmation.providerBindingId,
          controlArgumentsHash: input.confirmation.argumentsHash,
          controlDispatchHash: input.confirmation.consumedDispatchHash,
        }),
    contextId: CONTEXT_ID,
    executionMode: 'simulation',
    simulationId: 'sim-uap-p2-b03',
    serverId: 'ugv-runtime-1',
    toolName: input.toolName,
    executionSemantics: input.semantics,
    arguments: input.arguments,
    result: input.result,
    status: 'succeeded',
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Date.parse(input.completedAt) - Date.parse(input.startedAt),
  });
}

function requiredInvocation(
  fixture: ReturnType<typeof evidenceFixture>,
  index: number,
): McpInvocation {
  const value = fixture.invocations[index];
  if (value === undefined) throw new Error(`fixture invocation ${String(index)} missing`);
  return value;
}

function requiredLifecycle(
  fixture: ReturnType<typeof evidenceFixture>,
): RemoteTaskLifecycleEvidence {
  const value = fixture.remoteTaskLifecycle[0];
  if (value === undefined) throw new Error('fixture remote lifecycle missing');
  return value;
}

function remoteLifecycle(
  resultSnapshot: InternalToolResult | undefined,
): RemoteTaskLifecycleEvidence {
  const controlPayload = completedRemoteTaskSnapshot(resultSnapshot);
  return Object.freeze({
    binding: Object.freeze({
      bindingId: BINDING_ID,
      serverId: 'ugv-runtime-1',
      operationName: 'vehicle_navigate',
      remoteTaskId: 'provider-task-1',
      agentTaskId: TASK_ID,
      contextId: CONTEXT_ID,
      goalId: 'goal-uap-p2-b03',
      goalVersion: 1,
      workflowPlanId: 'plan-uap-p2-b03',
      workflowDefinitionId: 'workflow-uap-p2-b03',
      workflowDefinitionVersion: 1,
      workflowInstanceId: WORKFLOW_INSTANCE_ID,
      workflowNodeId: 'ugv_navigate',
      workflowNodeRunId: NAVIGATE_NODE_RUN_ID,
      mcpInvocationId: 'invocation-navigate',
      protocolStatus: 'completed',
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'smpp-tasks/1.0',
      protocolContract: Object.freeze({
        mode: 'frozen_v1',
        protocolVersion: '2026-07-28',
        baselineSha256: 'd'.repeat(64),
        taskExecutionProfileVersion: '1.0',
        evidenceProfileVersion: '1.0',
        serverDiscoverySnapshotId: 'snapshot-ugv-runtime-1',
      }),
      taskBehavior: 'task_required',
      taskCancellation: 'task_cancel',
      runtimeRevision: 'runtime-revision-7',
      providerRevision: 'provider-revision-101',
      remoteRevision: 'provider-task-revision-101',
      localState: 'terminal_event_claimed' as const,
      executionContext: Object.freeze({ mode: 'simulation', simulationId: 'sim-uap-p2-b03' }),
      authoritySnapshot: Object.freeze({
        schemaVersion: '1.0' as const,
        capturedAt: '2026-08-21T12:00:00.000Z',
        runtime: Object.freeze({
          serverId: 'ugv-runtime-1',
          endpoint: 'http://ugv-runtime.invalid/mcp',
          serverUpdatedAt: '2026-08-21T11:55:00.000Z',
          toolRevision: 9,
          protocolSnapshotId: 'snapshot-ugv-runtime-1',
          catalogRevision: 'catalog-revision-9',
          catalogChecksum: 'c'.repeat(64),
          operationCount: 2,
        }),
        providerBinding: Object.freeze({
          bindingId: 'binding-ugv-runtime-1',
          revision: 7,
          originType: 'smpp_registry' as const,
          providerId: 'isr.vehicle.ugv.ugv1',
          smppSourceId: 'smpp-source-ugv-1',
          endpointRef: 'node-control:binding-ugv-runtime-1',
          catalogRevision: 'catalog-revision-9',
          catalogChecksum: 'c'.repeat(64),
          operationCount: 2,
          availabilityValidUntil: '2026-08-21T12:05:00.000Z',
          observedAt: '2026-08-21T11:59:59.000Z',
        }),
      }),
      credentialRevision: '2026-08-21T11:55:00.000Z',
      sessionRevision: '2026-07-28/smpp-tasks/1.0',
      lastProviderUpdatedAt: '2026-08-21T12:00:09.900Z',
      pollIntervalMs: 1_000,
      pollAttempt: 1,
      providerFailureCount: 0,
      ...(resultSnapshot === undefined ? {} : { resultSnapshot }),
      createdAt: '2026-08-21T12:00:00.100Z',
      updatedAt: CLAIMED_AT,
      terminalAt: TERMINAL_AT,
      version: 3,
    }),
    observations: Object.freeze([]),
    controls: Object.freeze([
      Object.freeze({
        eventId: CONTROL_EVENT_ID,
        bindingId: BINDING_ID,
        type: 'task.completed' as const,
        remoteRevision: 'provider-task-revision-101',
        runtimeRevision: 'runtime-revision-7',
        resultHash: canonicalHash(controlPayload),
        payload: controlPayload,
        status: 'claimed' as const,
        createdAt: TERMINAL_AT,
        claimedAt: CLAIMED_AT,
      }),
    ]),
    protocolAttempts: Object.freeze([]),
    continuations: Object.freeze([
      Object.freeze({
        snapshotId: CONTINUATION_SNAPSHOT_ID,
        continuationId: CONTINUATION_ID,
        stateVersion: 1,
        lifecycle: 'active' as const,
        waitId: BINDING_ID,
        waitState: 'waiting' as const,
        nodeId: 'ugv_navigate',
        nodeRunId: NAVIGATE_NODE_RUN_ID,
        createdAt: '2026-08-21T12:00:00.100Z',
        updatedAt: '2026-08-21T12:00:00.100Z',
      }),
    ]),
    inputRounds: Object.freeze([]),
    cancellations: Object.freeze([]),
  });
}

function continuationAttempt(): WorkflowContinuationAttempt {
  return Object.freeze({
    attemptId: 'continuation-attempt-provider-task-1',
    eventId: CONTROL_EVENT_ID,
    snapshotId: CONTINUATION_SNAPSHOT_ID,
    continuationId: CONTINUATION_ID,
    workflowInstanceId: WORKFLOW_INSTANCE_ID,
    snapshotStateVersion: 1,
    claimToken: 'continuation-claim-provider-task-1',
    status: 'running',
    createdAt: CLAIMED_AT,
    startedAt: ATTEMPT_STARTED_AT,
  });
}

function completedRemoteTaskSnapshot(result: InternalToolResult | undefined) {
  return Object.freeze({
    protocolMode: 'frozen_v1' as const,
    remoteTaskId: 'provider-task-1',
    status: 'completed' as const,
    createdAt: '2026-08-21T12:00:00.100Z',
    lastUpdatedAt: TERMINAL_AT,
    ttlMs: 60_000,
    pollIntervalMs: 1_000,
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'smpp-tasks/1.0',
    runtimeRevision: 'runtime-revision-7',
    providerRevision: 'provider-revision-101',
    providerObservation: Object.freeze({
      revision: '1.0' as const,
      remoteRevision: 'provider-task-revision-101',
      observedAt: TERMINAL_AT,
    }),
    ...(result === undefined ? {} : { result }),
  });
}

function governedConfirmation(selected: SelectedTaskOperation): GovernedControlConfirmation {
  const consumedDispatchHash = createMcpProviderDispatchHash({
    invocationId: 'invocation-navigate',
    taskId: TASK_ID,
    contextId: CONTEXT_ID,
    providerBindingId: selected.providerBinding.bindingId,
    providerId: selected.provider.providerId,
    serverId: selected.server.serverId,
    toolName: selected.operation.operationName,
    arguments: selected.resolvedArguments,
  });
  const issueInput: UgvGovernedControlConfirmationIssueInput = Object.freeze({
    taskId: TASK_ID,
    capabilityBindingId: 'capability-binding-uap-p2-b03',
    capabilityId: selected.task.semanticTaskType,
    capabilityVersion: 2,
    capabilityAttemptId: CAPABILITY_ATTEMPT_ID,
    planId: 'plan-uap-p2-b03',
    planHash: 'f'.repeat(64),
    skillId: selected.skill.skillId,
    skillVersion: selected.skill.version,
    providerBindingId: selected.providerBinding.bindingId,
    serverId: selected.server.serverId,
    toolName: selected.operation.operationName,
    argumentsHash: selected.argumentsHash.slice('sha256:'.length),
    actorId: 'operator-uap-p2-b03',
    actorKind: 'human',
    authenticationMethod: 'bearer',
    actorRoles: Object.freeze(['physical_control_approver']),
    reason: 'Confirm the exact simulated UGV point-navigation plan.',
    expiresAt: '2026-08-21T12:10:00.000Z',
    selectedTaskOperationSnapshotHash: selected.snapshotHash,
  });
  const { selectedTaskOperationSnapshotHash, ...scope } = issueInput;
  if (selectedTaskOperationSnapshotHash !== selected.snapshotHash)
    throw new Error('fixture selected snapshot hash mismatch');
  return Object.freeze({
    ...scope,
    confirmationId: ugvGovernedControlConfirmationId(issueInput),
    confirmedAt: '2026-08-21T11:59:50.000Z',
    consumedInvocationId: 'invocation-navigate',
    consumedDispatchHash,
    consumedAt: '2026-08-21T12:00:00.010Z',
  });
}

function terminalResult(): InternalToolResult {
  const observedAt = '2026-08-21T12:00:09.900Z';
  return Object.freeze({
    content: Object.freeze([]),
    structuredContent: Object.freeze({
      resourceId: 'vehicle:ugv1',
      status: 'completed',
      observedAt,
      snapshotRevision: 'provider-snapshot-101',
      correlationStrength: 'STRICT_CORRELATED',
      observationAuthority: 'post_dispatch',
      positionAuthority: Object.freeze({
        field: 'chassis.position.geodetic',
        topic: '/ugv/gnss',
        observedAt,
        timeAuthority: 'source',
        cursor: providerCursor(101, observedAt),
      }),
    }),
    isError: false,
  });
}

function stateResult(
  input: Readonly<{
    observedAt: string;
    revision: string;
    cursor: number;
    position: Readonly<{ longitude: number; latitude: number }>;
  }>,
): InternalToolResult {
  return Object.freeze({
    content: Object.freeze([]),
    structuredContent: Object.freeze({
      identity: Object.freeze({
        providerId: 'isr.vehicle.ugv.ugv1',
        resourceId: 'vehicle:ugv1',
        vehicleType: 'ugv',
        executionMode: 'simulation',
      }),
      connectivity: Object.freeze({ mqttConnected: true, deviceMcpConnected: true }),
      observedAt: input.observedAt,
      freshness: Object.freeze({ chassisObservedAt: input.observedAt }),
      revision: input.revision,
      mqttIngressSequence: input.cursor,
      chassis: Object.freeze({ position: input.position }),
    }),
    isError: false,
  });
}

function providerCursor(sequence: number, observedAt: string): string {
  return `oc1.${Buffer.from(
    JSON.stringify({
      version: 1,
      kind: 'field',
      field: 'chassis.position.geodetic',
      topic: '/ugv/gnss',
      observedAt,
      timeAuthority: 'source',
      ingestSequence: sequence,
      payloadHash: 'e'.repeat(64),
    }),
  ).toString('base64url')}`;
}
