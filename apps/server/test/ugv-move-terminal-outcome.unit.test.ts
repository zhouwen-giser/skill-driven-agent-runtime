import { describe, expect, it, vi } from 'vitest';

import {
  ResultProcessor,
  type GovernedControlConfirmation,
  type RemoteTaskLifecycleEvidence,
} from '../../../packages/application/src/index.js';
import {
  createTaskCapabilityBinding,
  createTaskCapabilityExecutionAttempt,
  type Goal,
  type McpInvocation,
  type SkillVersion,
  type TaskCapabilityBinding,
  type WorkflowContinuationAttempt,
  type WorkflowInstance,
} from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  UgvMoveDeterministicGoalEvaluator,
  UgvMoveTerminalOutcomeAuthority,
  type UgvMoveTerminalOutcomeDependencies,
} from '../src/ugv-move-terminal-outcome.js';
import { createUgvSimulationTargetPolicy } from '../src/ugv-move-skill-usage.js';
import { UgvMoveWorkflowEvidenceError } from '../src/ugv-move-workflow-evidence.js';

import {
  selectedUgvTaskOperation,
  UGV_WORKFLOW_IDENTITY,
} from './ugv-move-workflow-test-fixture.js';

const TASK_ID = UGV_WORKFLOW_IDENTITY.taskId;
const INSTANCE_ID = 'workflow-instance-uap-p2-b03';
const CAPABILITY_BINDING_ID = 'capability-binding-uap-p2-b03';
const CAPABILITY_ATTEMPT_ID = 'capability-attempt-uap-p2-b03';
const NAVIGATE_INVOCATION_ID = 'invocation-navigate';
const NAVIGATE_OPERATION = 'vehicle_navigate';
const COMPLETED_AT = '2026-08-21T12:00:10.600Z';
const SKILL_RESULT = Object.freeze({
  resourceId: 'vehicle:ugv1',
  status: 'completed' as const,
  finalPosition: Object.freeze({ x: 112, y: 28, frame: 'EPSG:4326' as const }),
});

describe('UGV deterministic terminal outcome authority', () => {
  it('prepares an unpersisted exact-Skill result, Capability proof, and outcome references', async () => {
    const fixture = terminalFixture();
    const authority = new UgvMoveTerminalOutcomeAuthority(fixture.dependencies);

    const prepared = await authority.prepare(TASK_ID, fixture.instance);

    expect(prepared.processedResult).toMatchObject({
      resultId: `processed-result-terminal-${TASK_ID}`,
      taskId: TASK_ID,
      skillId: 'embodied.move_to',
      skillVersion: 1,
      output: { text: expect.stringContaining('durable final-position'), structured: SKILL_RESULT },
      valuable: true,
      memoryCandidates: [],
      createdAt: COMPLETED_AT,
    });
    expect(prepared.processedResult.normalized).toMatchObject({
      data: SKILL_RESULT,
      errors: [],
      contextTruncated: false,
    });
    expect(prepared.processedResult.facts).toEqual([
      { name: 'resourceId', value: 'vehicle:ugv1', confidence: 1 },
      { name: 'status', value: 'completed', confidence: 1 },
      {
        name: 'finalPosition',
        value: { x: 112, y: 28, frame: 'EPSG:4326' },
        confidence: 1,
      },
    ]);
    expect(prepared.capabilityTerminalProof).toEqual({
      taskId: TASK_ID,
      bindingId: CAPABILITY_BINDING_ID,
      bindingHash: fixture.binding.bindingHash,
      attemptId: CAPABILITY_ATTEMPT_ID,
      requestedCapabilityId: 'embodied.move',
      capabilityVersion: 2,
    });
    expect(prepared.verifiedOutcomeRefs).toEqual({
      effectRefs: ['effect.final_position'],
      evidenceRefs: ['evidence.final_position'],
      artifactRefs: [],
    });
    expect(fixture.verifyTerminalEvidence).toHaveBeenCalledOnce();
    expect(fixture.verifyTerminalEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        workflowResult: SKILL_RESULT,
        continuationAttempt: expect.objectContaining({ status: 'succeeded' }),
      }),
    );
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
    expect(fixture.legacyResultProcess).not.toHaveBeenCalled();
    expect(fixture.processedResultSave).not.toHaveBeenCalled();
  });

  it('adapts the raw Capability input before comparing it with selected Provider arguments', async () => {
    const fixture = terminalFixture();
    const driftedBinding = taskBinding({ targetX: 112.001 });
    const authority = new UgvMoveTerminalOutcomeAuthority({
      ...fixture.dependencies,
      taskCapabilities: {
        findBinding: () => Promise.resolve(driftedBinding),
        listAttempts: () => Promise.resolve([capabilityAttempt(driftedBinding)]),
      },
    });

    await expect(authority.prepare(TASK_ID, fixture.instance)).rejects.toMatchObject({
      code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    });
    expect(fixture.verifyTerminalEvidence).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'a legacy raw Capability input',
      input: capabilityInput(),
    },
    {
      label: 'a missing context authority',
      input: Object.freeze({ skillInput: capabilityInput(), evidence: Object.freeze({}) }),
    },
    {
      label: 'a drifted Skill input',
      input: Object.freeze({
        ...workflowExecutionInput(),
        skillInput: Object.freeze({
          ...capabilityInput(),
          target: Object.freeze({ x: 112.001, y: 28, frame: 'WGS84' }),
        }),
      }),
    },
    {
      label: 'an extra envelope field',
      input: Object.freeze({ ...workflowExecutionInput(), unexpected: true }),
    },
    {
      label: 'a false context authority',
      input: Object.freeze({
        ...workflowExecutionInput(),
        context: Object.freeze({
          'current-position': true,
          'resource-state': false,
          'permission-context': true,
        }),
      }),
    },
    {
      label: 'an extra context authority',
      input: Object.freeze({
        ...workflowExecutionInput(),
        context: Object.freeze({
          'current-position': true,
          'resource-state': true,
          'permission-context': true,
          unexpected: true,
        }),
      }),
    },
    {
      label: 'pre-populated execution evidence',
      input: Object.freeze({
        ...workflowExecutionInput(),
        evidence: Object.freeze({ 'position.observation': true }),
      }),
    },
  ])('rejects $label outside the exact Workflow execution envelope', async ({ input }) => {
    const fixture = terminalFixture();
    const instance = Object.freeze({ ...fixture.instance, input });

    await expect(
      new UgvMoveTerminalOutcomeAuthority(fixture.dependencies).prepare(TASK_ID, instance),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
    expect(fixture.verifyTerminalEvidence).not.toHaveBeenCalled();
  });

  it('rejects any drift from the exact frozen simulation target policy contract', async () => {
    const fixture = terminalFixture();
    const { bindingHash, ...draft } = fixture.binding;
    expect(bindingHash).toMatch(/^[0-9a-f]{64}$/u);
    const driftedBinding = createTaskCapabilityBinding({
      ...draft,
      constraintSnapshot: draft.constraintSnapshot.map((constraint) =>
        constraint['type'] === 'ugv_simulation_target_policy'
          ? { ...constraint, bearingDegrees: 0 }
          : constraint,
      ),
    });
    const authority = new UgvMoveTerminalOutcomeAuthority({
      ...fixture.dependencies,
      taskCapabilities: {
        findBinding: () => Promise.resolve(driftedBinding),
        listAttempts: () => Promise.resolve([capabilityAttempt(driftedBinding)]),
      },
    });

    await expect(authority.prepare(TASK_ID, fixture.instance)).rejects.toMatchObject({
      code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    });
    expect(fixture.verifyTerminalEvidence).not.toHaveBeenCalled();
  });

  it('maps deterministic post-continuation evidence rejection to the quarantine guard code', async () => {
    const fixture = terminalFixture();
    const verifyTerminalEvidence = vi.fn(() => {
      throw new UgvMoveWorkflowEvidenceError(
        'UGV_MOVE_WORKFLOW_EVIDENCE_RESULT_INVALID',
        'test evidence mismatch',
      );
    });
    const authority = new UgvMoveTerminalOutcomeAuthority({
      ...fixture.dependencies,
      verifyTerminalEvidence,
    });

    await expect(authority.prepare(TASK_ID, fixture.instance)).rejects.toMatchObject({
      code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    });
  });

  it('does not rewrite a transient repository failure as a deterministic terminal guard', async () => {
    const fixture = terminalFixture();
    const failure = new Error('POSTGRES_TEMPORARILY_UNAVAILABLE');
    const authority = new UgvMoveTerminalOutcomeAuthority({
      ...fixture.dependencies,
      invocations: { listInvocationsByTask: () => Promise.reject(failure) },
    });

    await expect(authority.prepare(TASK_ID, fixture.instance)).rejects.toBe(failure);
  });
});

describe('UGV deterministic Goal evaluator', () => {
  it('returns achieved only after the same terminal authority succeeds, without a model decision', async () => {
    const fixture = terminalFixture();
    const prepared = await new UgvMoveTerminalOutcomeAuthority(fixture.dependencies).prepare(
      TASK_ID,
      fixture.instance,
    );
    const prepare = vi.fn(() => Promise.resolve(prepared));
    const evaluator = new UgvMoveDeterministicGoalEvaluator({ prepare });

    await expect(
      evaluator.evaluate({ taskId: TASK_ID, goal: activeGoal(), instance: fixture.instance }),
    ).resolves.toEqual({
      decision: 'achieved',
      summary:
        'UGV movement completed with durable final-position evidence under the exact simulation authority.',
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith(TASK_ID, fixture.instance);
  });

  it('fails closed on Goal identity drift and never invokes the terminal authority', async () => {
    const fixture = terminalFixture();
    const prepared = await new UgvMoveTerminalOutcomeAuthority(fixture.dependencies).prepare(
      TASK_ID,
      fixture.instance,
    );
    const prepare = vi.fn(() => Promise.resolve(prepared));
    const evaluator = new UgvMoveDeterministicGoalEvaluator({ prepare });

    await expect(
      evaluator.evaluate({
        taskId: TASK_ID,
        goal: { ...activeGoal(), version: 2 },
        instance: fixture.instance,
      }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
    expect(prepare).not.toHaveBeenCalled();
  });
});

function terminalFixture() {
  const binding = taskBinding();
  const selected = selectedUgvTaskOperation();
  const instance = workflowInstance();
  const verifyTerminalEvidence = vi.fn(() => terminalVerification());
  // These legacy/model persistence paths intentionally have no slot in the profile authority DI.
  const modelGenerate = vi.fn();
  const legacyResultProcess = vi.fn();
  const processedResultSave = vi.fn();
  const dependencies: UgvMoveTerminalOutcomeDependencies = {
    taskCapabilities: {
      findBinding: () => Promise.resolve(binding),
      listAttempts: () => Promise.resolve([capabilityAttempt(binding)]),
    },
    skills: { findVersion: () => Promise.resolve(skillVersion()) },
    workflowAuthority: { loadExact: () => Promise.resolve(selected) },
    invocations: { listInvocationsByTask: () => Promise.resolve(invocations(selected)) },
    remoteTasks: { listByAgentTaskId: () => Promise.resolve([remoteLifecycle()]) },
    confirmations: {
      findConsumedByInvocation: () => Promise.resolve(confirmation()),
    },
    continuations: { listAttempts: () => Promise.resolve([continuationAttempt()]) },
    resultProcessor: new ResultProcessor(new AjvJsonSchemaValidator()),
    positionPolicy: { toleranceM: 2, minimumDisplacementM: 10, maxFinalStateAgeMs: 3_000 },
    verifyTerminalEvidence,
  };
  return {
    binding,
    dependencies,
    instance,
    verifyTerminalEvidence,
    modelGenerate,
    legacyResultProcess,
    processedResultSave,
  };
}

function taskBinding(overrides: Readonly<{ targetX?: number }> = {}): TaskCapabilityBinding {
  const target = Object.freeze({
    x: overrides.targetX ?? 112,
    y: 28,
    frame: 'WGS84' as const,
  });
  return createTaskCapabilityBinding({
    bindingId: CAPABILITY_BINDING_ID,
    taskId: TASK_ID,
    requestedCapabilityId: 'embodied.move',
    capabilityVersion: 2,
    exposureId: 'a2a.vehicle.ugv.navigate',
    exposureVersion: 1,
    inputSnapshot: Object.freeze({ resourceId: 'vehicle:ugv1', target }),
    successCriteriaSnapshot: Object.freeze([
      Object.freeze({ type: 'output_schema_valid', required: true }),
      Object.freeze({ type: 'resource_identity_matches_request', required: true }),
      Object.freeze({ type: 'required_evidence_complete', required: true }),
      Object.freeze({ type: 'remote_task_identity_present', required: true }),
      Object.freeze({ type: 'remote_terminal_observation_present', required: true }),
      Object.freeze({ type: 'external_command_dispatch_count', maximum: 1 }),
    ]),
    evidenceRequirementSnapshot: Object.freeze([
      Object.freeze({
        type: 'required_evidence',
        evidenceType: 'position.observation',
        required: true,
        hardGate: true,
      }),
    ]),
    constraintSnapshot: Object.freeze([
      Object.freeze({
        type: 'resource_policy',
        selection: 'exact_value',
        allowedResourceIds: Object.freeze(['vehicle:ugv1']),
        downstreamResourceBinding: 'forbidden',
      }),
      Object.freeze({
        type: 'provider_binding_policy',
        mcpProviderBindingId: 'binding-ugv-runtime-1',
        localServerId: 'ugv-runtime-1',
        mcpToolName: 'vehicle_navigate',
        bindingRevision: 7,
        catalogRevision: 'catalog-revision-9',
        catalogChecksum: 'c'.repeat(64),
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
        simulationId: 'sim-uap-p2-b03',
      }),
      createUgvSimulationTargetPolicy({
        policyId: 'ugv-agent-profile/explicit-wgs84-target',
        revision: 2,
      }),
    ]),
    initialImplementationRefs: Object.freeze(['skill:embodied.move_to:1']),
    boundAt: '2026-08-21T11:59:50.000Z',
  });
}

function capabilityAttempt(binding: TaskCapabilityBinding) {
  return createTaskCapabilityExecutionAttempt({
    attemptId: CAPABILITY_ATTEMPT_ID,
    taskId: TASK_ID,
    capabilityBindingId: binding.bindingId,
    attemptNo: 1,
    planId: UGV_WORKFLOW_IDENTITY.workflowPlanId,
    skillVersionRefs: Object.freeze(['skill:embodied.move_to:1']),
    providerBindingRefs: Object.freeze(['binding-ugv-runtime-1']),
    reason: 'initial',
    status: 'waiting',
    startedAt: '2026-08-21T11:59:58.000Z',
  });
}

function workflowInstance(): WorkflowInstance {
  return Object.freeze({
    instanceId: INSTANCE_ID,
    planId: UGV_WORKFLOW_IDENTITY.workflowPlanId,
    workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
    workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
    goalId: UGV_WORKFLOW_IDENTITY.goalId,
    goalVersion: UGV_WORKFLOW_IDENTITY.goalVersion,
    skillVersions: Object.freeze([{ skillId: 'embodied.move_to', version: 1 }]),
    budgetLimits: Object.freeze({
      maxReplans: 1,
      maxDurationSeconds: 600,
      maxLlmCalls: 0,
      maxMcpCalls: 8,
      maxCost: 1,
    }),
    budgetUsage: Object.freeze({
      replanCount: 0,
      durationMs: 12_000,
      llmCalls: 0,
      mcpCalls: 3,
      cost: 0,
    }),
    status: 'succeeded',
    input: workflowExecutionInput(),
    result: SKILL_RESULT,
    errors: Object.freeze({}),
    startedAt: '2026-08-21T11:59:58.500Z',
    completedAt: COMPLETED_AT,
  });
}

function capabilityInput() {
  return Object.freeze({
    resourceId: 'vehicle:ugv1',
    target: Object.freeze({ x: 112, y: 28, frame: 'WGS84' }),
  });
}

function workflowExecutionInput() {
  return Object.freeze({
    skillInput: capabilityInput(),
    context: Object.freeze({
      'current-position': true,
      'resource-state': true,
      'permission-context': true,
    }),
    evidence: Object.freeze({}),
  });
}

function activeGoal(): Goal {
  return Object.freeze({
    goalId: UGV_WORKFLOW_IDENTITY.goalId,
    contextId: 'context-uap-p2-b03',
    version: UGV_WORKFLOW_IDENTITY.goalVersion,
    title: 'Move the simulated UGV',
    description: 'Move the exact resource and prove final position.',
    constraints: Object.freeze(['simulation only']),
    successCriteria: Object.freeze(['final position verified']),
    status: 'active',
    createdAt: '2026-08-21T11:59:00.000Z',
    updatedAt: '2026-08-21T11:59:00.000Z',
  });
}

function skillVersion(): SkillVersion {
  return Object.freeze({
    skillId: 'embodied.move_to',
    version: 1,
    name: 'Move To',
    summary: 'Move with proof.',
    description: 'Move with final-position evidence.',
    capabilities: Object.freeze(['embodied.move']),
    workflowGuidance: 'Use deterministic workflow.',
    outputInstruction: 'Return exact result.',
    inputSchema: Object.freeze({ type: 'object' }),
    outputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['resourceId', 'status', 'finalPosition']),
      properties: Object.freeze({
        resourceId: Object.freeze({ const: 'vehicle:ugv1' }),
        status: Object.freeze({ const: 'completed' }),
        finalPosition: Object.freeze({
          type: 'object',
          additionalProperties: false,
          required: Object.freeze(['x', 'y', 'frame']),
          properties: Object.freeze({
            x: Object.freeze({ type: 'number' }),
            y: Object.freeze({ type: 'number' }),
            frame: Object.freeze({ const: 'EPSG:4326' }),
          }),
        }),
      }),
    }),
    toolPolicy: Object.freeze({ required: [], optional: [], forbidden: [] }),
    runtimePolicy: Object.freeze({ autoConfirmPlan: false, maxMcpCalls: 8 }),
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-17T00:00:00.000Z',
    usageSpecification: Object.freeze({
      apiVersion: 'sdar.io/v1alpha1',
      visibility: Object.freeze({ userSelectable: true, composable: true, internalOnly: false }),
      normative: Object.freeze({
        constraints: Object.freeze([]),
        forbiddenActions: Object.freeze([]),
        requiredConfirmations: Object.freeze([]),
        noApplicableSkill: 'reject',
      }),
      contextRequirements: Object.freeze([]),
      taskBindings: Object.freeze([]),
      adaptive: Object.freeze({
        instructions: Object.freeze([]),
        optimizationHints: Object.freeze([]),
        allowPreferredProviderFallback: false,
      }),
      modes: Object.freeze({
        supported: Object.freeze(['template'] as const),
        defaultMode: 'template' as const,
        template: Object.freeze({ summary: 'Exact template.', instructions: Object.freeze([]) }),
      }),
      evidencePolicy: Object.freeze({
        requirements: Object.freeze([
          Object.freeze({
            requirementId: 'final-position',
            evidenceType: 'position.observation',
            required: true,
            hardGate: true,
          }),
        ]),
        rejectSuccessWithoutRequiredEvidence: true,
      }),
    }),
    outcomeSpecification: Object.freeze({
      schemaVersion: '1.0',
      skillId: 'embodied.move_to',
      skillVersion: 1,
      effects: Object.freeze(['effect.final_position']),
      evidence: Object.freeze(['evidence.final_position']),
      artifacts: Object.freeze([]),
      taskGoalPolicy: Object.freeze({}),
      confidencePolicy: Object.freeze({}),
      sideEffectPolicy: Object.freeze({}),
      specificationHash: `sha256:${'b'.repeat(64)}`,
    }),
  });
}

function invocations(
  selected: ReturnType<typeof selectedUgvTaskOperation>,
): readonly McpInvocation[] {
  const base = Object.freeze({
    taskId: TASK_ID,
    contextId: 'context-uap-p2-b03',
    executionMode: 'simulation' as const,
    simulationId: 'sim-uap-p2-b03',
    serverId: selected.server.serverId,
    status: 'succeeded' as const,
  });
  return Object.freeze([
    Object.freeze({
      ...base,
      invocationId: 'invocation-initial',
      toolName: 'vehicle_get_state',
      executionSemantics: selected.finalStateRead.executionSemantics,
      arguments: selected.finalStateRead.resolvedArguments,
      result: Object.freeze({}),
      startedAt: '2026-08-21T11:59:58.500Z',
      completedAt: '2026-08-21T11:59:59.000Z',
      durationMs: 500,
    }),
    Object.freeze({
      ...base,
      invocationId: NAVIGATE_INVOCATION_ID,
      capabilityAttemptId: CAPABILITY_ATTEMPT_ID,
      toolName: NAVIGATE_OPERATION,
      executionSemantics: selected.operation.executionSemantics,
      arguments: selected.resolvedArguments,
      result: Object.freeze({}),
      startedAt: '2026-08-21T12:00:00.000Z',
      completedAt: '2026-08-21T12:00:00.100Z',
      durationMs: 100,
    }),
    Object.freeze({
      ...base,
      invocationId: 'invocation-final',
      toolName: 'vehicle_get_state',
      executionSemantics: selected.finalStateRead.executionSemantics,
      arguments: selected.finalStateRead.resolvedArguments,
      result: Object.freeze({}),
      startedAt: '2026-08-21T12:00:10.000Z',
      completedAt: '2026-08-21T12:00:10.500Z',
      durationMs: 500,
    }),
  ]);
}

function remoteLifecycle(): RemoteTaskLifecycleEvidence {
  return Object.freeze({
    binding: Object.freeze({
      workflowPlanId: UGV_WORKFLOW_IDENTITY.workflowPlanId,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowDefinitionVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      workflowInstanceId: INSTANCE_ID,
      goalId: UGV_WORKFLOW_IDENTITY.goalId,
      goalVersion: UGV_WORKFLOW_IDENTITY.goalVersion,
    }),
  }) as unknown as RemoteTaskLifecycleEvidence;
}

function confirmation(): GovernedControlConfirmation {
  return Object.freeze({
    capabilityBindingId: CAPABILITY_BINDING_ID,
    capabilityAttemptId: CAPABILITY_ATTEMPT_ID,
  }) as unknown as GovernedControlConfirmation;
}

function continuationAttempt(): WorkflowContinuationAttempt {
  return Object.freeze({
    attemptId: 'continuation-attempt-provider-task-1',
    eventId: 'remote-control-provider-task-1-completed',
    snapshotId: 'continuation-snapshot-provider-task-1',
    continuationId: 'continuation-workflow-instance-uap-p2-b03',
    workflowInstanceId: INSTANCE_ID,
    snapshotStateVersion: 1,
    claimToken: 'continuation-claim-provider-task-1',
    status: 'succeeded',
    createdAt: '2026-08-21T12:00:09.950Z',
    startedAt: '2026-08-21T12:00:09.960Z',
    completedAt: COMPLETED_AT,
  });
}

function terminalVerification() {
  return Object.freeze({
    assessment: Object.freeze({
      status: 'completed' as const,
      reasonCode: 'UGV_MOVE_FINAL_POSITION_CONFIRMED' as const,
      evidence: Object.freeze({
        evidenceType: 'position.observation' as const,
        resourceId: 'vehicle:ugv1',
        correlationId: NAVIGATE_INVOCATION_ID,
        remoteTaskId: 'provider-task-1',
        providerRuntimeRevision: 'runtime-revision-7',
        providerSnapshotRevision: 'provider-snapshot-101',
        initialStateRevision: 'state-revision-100',
        finalStateRevision: 'state-revision-102',
        initialCursor: 'cursor-100',
        providerCursor: 'cursor-101',
        finalCursor: 'cursor-102',
        observedAt: '2026-08-21T12:00:10.400Z',
        coordinateReferenceSystem: 'WGS84' as const,
        coordinateOrder: 'longitude_latitude' as const,
        target: Object.freeze({ longitude: 112, latitude: 28 }),
        finalPosition: Object.freeze({ longitude: 112, latitude: 28 }),
        distanceToTargetM: 0,
        toleranceM: 2,
        displacementM: 98,
        minimumDisplacementM: 10,
      }),
    }),
    skillResult: SKILL_RESULT,
  });
}
