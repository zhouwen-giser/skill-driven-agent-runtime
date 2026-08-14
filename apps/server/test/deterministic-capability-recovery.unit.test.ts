import { describe, expect, it, vi } from 'vitest';

import {
  createMcpProviderDispatchHash,
  type CognitiveManagementActionLeaseGuard,
} from '../../../packages/application/src/index.js';
import type { DeterministicCapabilityExecutionInput } from '../../../packages/management-api/src/index.js';
import type {
  AgentTask,
  McpInvocation,
  SkillExecutionView,
  SkillVersion,
  WorkflowInstance,
} from '../../../packages/domain/src/index.js';
import {
  DeterministicCapabilityRecoveryService,
  deterministicExecutionIdentity,
} from '../src/deterministic-capability-recovery.js';

describe('DeterministicCapabilityRecoveryService', () => {
  it('terminally rejects an interrupted pre-execution claim without running domain work', async () => {
    const harness = recoveryHarness({});

    await expect(harness.service.reconcile(INPUT, harness.lease('claimed'))).resolves.toEqual({
      disposition: 'orphaned',
      errorCode: 'DETERMINISTIC_RECOVERY_INTERRUPTED_BEFORE_EXECUTION',
    });
    expect(harness.recordTaskResult).not.toHaveBeenCalled();
    expect(harness.recordTaskFailure).not.toHaveBeenCalled();
    expect(harness.recordSkillEvidenceAndReferences).not.toHaveBeenCalled();
    expect(harness.recordSkillCompleted).not.toHaveBeenCalled();
    expect(harness.recordSkillFailure).not.toHaveBeenCalled();
  });

  it('keeps provider dispatch indeterminate when no exact durable receipt exists', async () => {
    const harness = recoveryHarness({ task: task('executing') });

    await expect(
      harness.service.reconcile(INPUT, harness.lease('provider_dispatch')),
    ).resolves.toEqual({
      disposition: 'indeterminate',
      errorCode: 'DETERMINISTIC_RECOVERY_PROVIDER_DISPATCH_INDETERMINATE',
    });
    expect(harness.recordTaskFailure).not.toHaveBeenCalled();
    expect(harness.recordSkillFailure).not.toHaveBeenCalled();
  });

  it('rebuilds the exact response and completes missing Task and Skill projections without Provider access', async () => {
    const instance = workflow();
    const invocation = succeededInvocation();
    const execution = skillExecution('executing');
    const harness = recoveryHarness({
      task: task('executing'),
      instance,
      execution,
      invocations: [invocation],
      skill: skill(),
    });

    const recovered = await harness.service.reconcile(INPUT, harness.lease('provider_dispatch'));

    expect(recovered).toMatchObject({
      disposition: 'completed',
      result: {
        status: 'succeeded',
        execution: {
          taskId: INPUT.taskId,
          workflowInstanceId: IDENTITY.workflowInstanceId,
          mcpInvocationId: IDENTITY.mcpInvocationId,
        },
        result: RESULT,
        safety: { physicalWrites: 0, modelCalls: 0, mcpCalls: 1 },
      },
    });
    expect(harness.recordTaskResult).toHaveBeenCalledTimes(1);
    expect(harness.recordTaskResult).toHaveBeenCalledWith({
      taskId: INPUT.taskId,
      structured: RESULT,
      outputSchema: OUTPUT_SCHEMA,
    });
    expect(harness.recordSkillCompleted).toHaveBeenCalledTimes(1);
    expect(harness.recordSkillEvidenceAndReferences).toHaveBeenCalledTimes(1);
    expect(harness.recordTaskFailure).not.toHaveBeenCalled();
    expect(harness.recordSkillFailure).not.toHaveBeenCalled();
  });

  it('recovers a successful frozen discovery receipt with the exact default_unknown semantics profile', async () => {
    const harness = recoveryHarness({
      task: task('executing'),
      instance: workflow(),
      execution: skillExecution('executing'),
      invocations: [
        {
          ...succeededInvocation(),
          executionSemantics: defaultUnknownExecutionSemantics(),
        },
      ],
      skill: skill(),
    });

    await expect(
      harness.service.reconcile(INPUT, harness.lease('provider_dispatch')),
    ).resolves.toMatchObject({ disposition: 'completed', result: { result: RESULT } });
    expect(harness.recordTaskResult).toHaveBeenCalledTimes(1);
    expect(harness.recordSkillCompleted).toHaveBeenCalledTimes(1);
    expect(harness.recordTaskFailure).not.toHaveBeenCalled();
    expect(harness.recordSkillFailure).not.toHaveBeenCalled();
  });

  it('replays an already terminal exact Task without writing another projection', async () => {
    const harness = recoveryHarness({
      task: task('completed'),
      instance: workflow(),
      execution: skillExecution('completed'),
      invocations: [succeededInvocation()],
      skill: skill(),
    });

    const recovered = await harness.service.reconcile(INPUT, harness.lease('provider_dispatch'));

    expect(recovered).toMatchObject({ disposition: 'completed', result: { result: RESULT } });
    expect(harness.recordTaskResult).not.toHaveBeenCalled();
    expect(harness.recordSkillCompleted).not.toHaveBeenCalled();
    expect(harness.recordSkillEvidenceAndReferences).toHaveBeenCalledTimes(1);
  });

  it('terminally orphans an exact failed receipt and never re-dispatches it', async () => {
    const harness = recoveryHarness({
      task: task('executing'),
      instance: { ...workflow(), status: 'failed', result: undefined },
      execution: skillExecution('executing'),
      invocations: [{ ...succeededInvocation(), status: 'failed', result: undefined }],
      skill: skill(),
    });

    await expect(
      harness.service.reconcile(INPUT, harness.lease('provider_dispatch')),
    ).resolves.toEqual({
      disposition: 'orphaned',
      errorCode: 'DETERMINISTIC_RECOVERY_ORPHANED',
    });
    expect(harness.recordTaskFailure).toHaveBeenCalledTimes(1);
    expect(harness.recordSkillFailure).toHaveBeenCalledTimes(1);
    expect(harness.recordTaskResult).not.toHaveBeenCalled();
  });

  it.each(['failed', 'canceled'] as const)(
    'terminally orphans a live-shaped default_unknown %s receipt',
    async (status) => {
      const harness = recoveryHarness({
        task: task('executing'),
        instance: { ...workflow(), status: 'failed', result: undefined },
        execution: skillExecution('executing'),
        invocations: [
          {
            ...succeededInvocation(),
            executionSemantics: defaultUnknownExecutionSemantics(),
            status,
            result: undefined,
          },
        ],
        skill: skill(),
      });

      await expect(
        harness.service.reconcile(INPUT, harness.lease('provider_dispatch')),
      ).resolves.toEqual({
        disposition: 'orphaned',
        errorCode: 'DETERMINISTIC_RECOVERY_ORPHANED',
      });
      expect(harness.recordTaskFailure).toHaveBeenCalledTimes(1);
      expect(harness.recordSkillFailure).toHaveBeenCalledTimes(1);
      expect(harness.recordTaskResult).not.toHaveBeenCalled();
      expect(harness.recordSkillCompleted).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'side-effecting',
      {
        ...defaultUnknownExecutionSemantics(),
        effect: 'side_effecting',
        execution: 'synchronous',
        source: 'mcp_declared',
      },
    ],
    [
      'asynchronous task-required',
      {
        ...defaultUnknownExecutionSemantics(),
        effect: 'read_only',
        execution: 'task_required',
        source: 'mcp_declared',
      },
    ],
  ] as const)(
    'refuses successful recovery with explicit %s execution semantics',
    async (_label, executionSemantics) => {
      const harness = recoveryHarness({
        task: task('executing'),
        instance: workflow(),
        execution: skillExecution('executing'),
        invocations: [{ ...succeededInvocation(), executionSemantics }],
        skill: skill(),
      });

      await expect(
        harness.service.reconcile(INPUT, harness.lease('provider_dispatch')),
      ).resolves.toEqual({
        disposition: 'orphaned',
        errorCode: 'DETERMINISTIC_RECOVERY_ORPHANED',
      });
      expect(harness.recordSkillEvidenceAndReferences).not.toHaveBeenCalled();
      expect(harness.recordTaskResult).not.toHaveBeenCalled();
      expect(harness.recordSkillCompleted).not.toHaveBeenCalled();
      expect(harness.recordTaskFailure).toHaveBeenCalledTimes(1);
      expect(harness.recordSkillFailure).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      'Workflow definition identity',
      () => ({ instance: { ...workflow(), workflowDefinitionId: 'workflow-drifted' } }),
    ],
    ['Workflow version', () => ({ instance: { ...workflow(), workflowVersion: 2 } })],
    ['Workflow Goal version', () => ({ instance: { ...workflow(), goalVersion: 2 } })],
    [
      'Workflow Skill versions',
      () => ({
        instance: {
          ...workflow(),
          skillVersions: [...workflow().skillVersions, { skillId: 'unrelated.skill', version: 1 }],
        },
      }),
    ],
    [
      'Workflow input',
      () => ({
        instance: {
          ...workflow(),
          input: {
            skillInput: { resourceId: 'different-public-resource' },
            context: { 'public-resource-id': true, 'provider-binding-freshness': true },
            evidence: {},
          },
        },
      }),
    ],
    [
      'Workflow budget limits',
      () => ({
        instance: {
          ...workflow(),
          budgetLimits: { ...workflow().budgetLimits, maxMcpCalls: 2 },
        },
      }),
    ],
    [
      'Workflow budget usage',
      () => ({
        instance: { ...workflow(), budgetUsage: { ...workflow().budgetUsage, cost: 2 } },
      }),
    ],
    [
      'Skill execution Goal version',
      () => ({ execution: { ...skillExecution('executing'), goalVersion: 2 } }),
    ],
    [
      'Skill execution Workflow identity',
      () => ({
        execution: {
          ...skillExecution('executing'),
          workflowDefinitionId: 'workflow-drifted',
        },
      }),
    ],
    [
      'Skill execution Workflow version',
      () => ({
        execution: { ...skillExecution('executing'), workflowDefinitionVersion: 2 },
      }),
    ],
    [
      'Skill selection lineage',
      () => ({
        execution: { ...skillExecution('executing'), selectionRef: 'selection-drifted' },
      }),
    ],
    [
      'Task request identity',
      () => ({ task: { ...task('executing'), requestText: 'deterministic:drifted' } }),
    ],
    [
      'Task metadata schema version',
      () => {
        const current = task('executing');
        const metadata = current.requestMetadata['io.sdar/deterministicCapabilityExecution'];
        return {
          task: {
            ...current,
            requestMetadata: {
              ...current.requestMetadata,
              'io.sdar/deterministicCapabilityExecution': {
                ...(metadata as Readonly<Record<string, unknown>>),
                schemaVersion: '2.0',
              },
            },
          },
        };
      },
    ],
    [
      'persisted evidence requirements deletion',
      () => {
        const execution = skillExecution('executing');
        return {
          execution: {
            ...execution,
            usagePolicy: { ...execution.usagePolicy, evidenceRequirements: [] },
          },
        };
      },
    ],
    [
      'persisted evidence type replacement',
      () => {
        const execution = skillExecution('executing');
        return {
          execution: {
            ...execution,
            usagePolicy: {
              ...execution.usagePolicy,
              evidenceRequirements: execution.usagePolicy.evidenceRequirements.map(
                (requirement) => ({
                  ...requirement,
                  evidenceType: 'home.light.untrusted-observation',
                }),
              ),
            },
          },
        };
      },
    ],
    [
      'persisted hard evidence gate downgrade',
      () => {
        const execution = skillExecution('executing');
        return {
          execution: {
            ...execution,
            usagePolicy: {
              ...execution.usagePolicy,
              evidenceRequirements: execution.usagePolicy.evidenceRequirements.map(
                (requirement) => ({ ...requirement, hardGate: false }),
              ),
            },
          },
        };
      },
    ],
    [
      'persisted extra Task operation',
      () => {
        const execution = skillExecution('executing');
        return {
          execution: {
            ...execution,
            usagePolicy: {
              ...execution.usagePolicy,
              taskOperations: [
                ...execution.usagePolicy.taskOperations,
                {
                  bindingId: 'binding-untrusted-extra',
                  taskType: INPUT.toolName,
                  providerId: INPUT.serverId,
                  operationName: INPUT.toolName,
                  protocolMode: 'frozen_v1' as const,
                },
              ],
            },
          },
        };
      },
    ],
  ] satisfies readonly (readonly [string, () => Partial<RecoveryHarnessInput>])[])(
    'fails closed when immutable %s drifts during recovery',
    async (_label, drift) => {
      const harness = recoveryHarness(completeRecoveryInput(drift()));
      const lease = harness.lease('provider_dispatch');

      await expect(harness.service.reconcile(INPUT, lease)).resolves.toEqual({
        disposition: 'orphaned',
        errorCode: 'DETERMINISTIC_RECOVERY_ORPHANED',
      });
      expect(harness.fencedProjectionCalls()).toBe(1);
      expect(harness.recordSkillEvidenceAndReferences).not.toHaveBeenCalled();
      expect(harness.recordTaskResult).not.toHaveBeenCalled();
      expect(harness.recordSkillCompleted).not.toHaveBeenCalled();
      expect(harness.recordTaskFailure).toHaveBeenCalledTimes(1);
      expect(harness.recordSkillFailure).toHaveBeenCalledTimes(1);
    },
  );
});

const INPUT: DeterministicCapabilityExecutionInput = {
  taskId: 'task-home-lab-read-recovery',
  contextId: 'context-home-lab-read-recovery',
  capabilityBindingId: 'capability-binding-home-light-read',
  capabilityBindingVersion: 1,
  capabilityId: 'home.light.read-state',
  capabilityVersion: 1,
  skillId: 'home.light.get-state',
  skillVersion: 1,
  mcpProviderBindingId: 'mcp-binding-home-light',
  providerId: 'home-assistant-light-provider',
  serverId: 'runtime-home-light',
  toolName: 'light_get_state',
  resourceId: 'living-room-main-light',
  idempotencyKey: 'task-home-lab-read-recovery',
};
const IDENTITY = deterministicExecutionIdentity(INPUT.taskId);
const RESULT = Object.freeze({ resourceId: INPUT.resourceId, state: 'on' });
const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['resourceId', 'state'],
  properties: { resourceId: { type: 'string' }, state: { type: 'string' } },
  additionalProperties: false,
});
const WORKFLOW_BUDGET_DEFAULTS = Object.freeze({
  maxReplans: 3,
  maxDurationSeconds: 300,
  maxLlmCalls: 20,
  maxMcpCalls: 20,
  maxCost: 100,
});

interface RecoveryHarnessInput {
  readonly task?: AgentTask;
  readonly instance?: WorkflowInstance;
  readonly execution?: SkillExecutionView;
  readonly invocations?: readonly McpInvocation[];
  readonly skill?: SkillVersion;
}

function completeRecoveryInput(
  overrides: Partial<RecoveryHarnessInput> = {},
): RecoveryHarnessInput {
  return {
    task: task('executing'),
    instance: workflow(),
    execution: skillExecution('executing'),
    invocations: [succeededInvocation()],
    skill: skill(),
    ...overrides,
  };
}

function recoveryHarness(input: RecoveryHarnessInput) {
  const recordTaskResult = vi.fn(() => Promise.resolve(task('completed')));
  const recordTaskFailure = vi.fn(() => Promise.resolve());
  const recordSkillEvidenceAndReferences = vi.fn(() => Promise.resolve());
  const recordSkillCompleted = vi.fn(() => Promise.resolve());
  const recordSkillFailure = vi.fn(() => Promise.resolve());
  let fencedProjectionCalls = 0;
  const service = new DeterministicCapabilityRecoveryService({
    findTask: () => Promise.resolve(input.task),
    findWorkflow: () => Promise.resolve(input.instance),
    findSkillExecutionByPlan: () => Promise.resolve(input.execution),
    findSkillVersion: () => Promise.resolve(input.skill),
    listInvocationsByTask: () => Promise.resolve(input.invocations ?? []),
    workflowBudgetDefaults: WORKFLOW_BUDGET_DEFAULTS,
    mcpCallCost: 1,
    recordTaskResult,
    recordTaskFailure,
    recordSkillEvidenceAndReferences,
    recordSkillCompleted,
    recordSkillFailure,
  });
  return {
    service,
    recordTaskResult,
    recordTaskFailure,
    recordSkillEvidenceAndReferences,
    recordSkillCompleted,
    recordSkillFailure,
    fencedProjectionCalls: () => fencedProjectionCalls,
    lease: (
      phase: 'claimed' | 'execution_started' | 'provider_dispatch',
    ): CognitiveManagementActionLeaseGuard => {
      const controller = new AbortController();
      const dispatch =
        phase !== 'provider_dispatch'
          ? undefined
          : Object.freeze({
              dispatchId: IDENTITY.mcpInvocationId,
              dispatchHash: createMcpProviderDispatchHash({
                invocationId: IDENTITY.mcpInvocationId,
                taskId: INPUT.taskId,
                contextId: INPUT.contextId,
                providerBindingId: INPUT.mcpProviderBindingId,
                providerId: INPUT.providerId,
                serverId: INPUT.serverId,
                toolName: INPUT.toolName,
                arguments: { resourceId: INPUT.resourceId },
              }),
            });
      return Object.freeze({
        signal: controller.signal,
        assertCurrent: vi.fn(() => Promise.resolve()),
        runFencedProjection: <T>(projection: () => Promise<T>): Promise<T> => {
          fencedProjectionCalls += 1;
          return projection();
        },
        enterProviderDispatch: vi.fn(() => Promise.resolve()),
        executionPhase: () => phase,
        providerDispatchIdentity: () => dispatch,
        leaseIdentity: () => ({ actionId: 'action-test', attempt: 1, token: 'lease-test' }),
      });
    },
  };
}

function task(phase: AgentTask['phase']): AgentTask {
  return {
    taskId: INPUT.taskId,
    contextId: INPUT.contextId,
    userId: 'user-recovery',
    requestText: `deterministic:${INPUT.capabilityBindingId}:${INPUT.resourceId}`,
    requestMetadata: {
      'io.sdar/deterministicCapabilityExecution': {
        schemaVersion: '1.0',
        capabilityBindingId: INPUT.capabilityBindingId,
        capabilityBindingVersion: INPUT.capabilityBindingVersion,
        capabilityId: INPUT.capabilityId,
        capabilityVersion: INPUT.capabilityVersion,
        skillId: INPUT.skillId,
        skillVersion: INPUT.skillVersion,
        mcpProviderBindingId: INPUT.mcpProviderBindingId,
        providerId: INPUT.providerId,
        serverId: INPUT.serverId,
        toolName: INPUT.toolName,
        resourceId: INPUT.resourceId,
      },
    },
    phase,
    phaseMessage: phase,
    goalId: IDENTITY.goalId,
    goalVersion: 1,
    planId: IDENTITY.workflowPlanId,
    selectedSkillId: INPUT.skillId,
    selectedSkillVersion: INPUT.skillVersion,
    skillSelectionId: 'selection-recovery',
    ...(phase === 'completed'
      ? {
          output: {
            text: 'Schema-valid governed read-only Provider state returned.',
            structured: RESULT,
          },
        }
      : {}),
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:01.000Z',
  };
}

function workflow(): WorkflowInstance {
  return {
    instanceId: IDENTITY.workflowInstanceId,
    planId: IDENTITY.workflowPlanId,
    workflowDefinitionId: IDENTITY.workflowDefinitionId,
    workflowVersion: 1,
    goalId: IDENTITY.goalId,
    goalVersion: 1,
    skillVersions: [{ skillId: INPUT.skillId, version: INPUT.skillVersion }],
    budgetLimits: {
      maxReplans: 3,
      maxDurationSeconds: 300,
      maxLlmCalls: 0,
      maxMcpCalls: 1,
      maxCost: 100,
    },
    budgetUsage: { replanCount: 0, durationMs: 10, llmCalls: 0, mcpCalls: 1, cost: 1 },
    status: 'succeeded',
    input: {
      skillInput: { resourceId: INPUT.resourceId },
      context: { 'public-resource-id': true, 'provider-binding-freshness': true },
      evidence: {},
    },
    result: RESULT,
    errors: {},
    startedAt: '2026-08-11T00:00:00.000Z',
    completedAt: '2026-08-11T00:00:01.000Z',
  };
}

function skillExecution(status: SkillExecutionView['status']): SkillExecutionView {
  return {
    executionId: IDENTITY.skillExecutionId,
    taskId: INPUT.taskId,
    goalId: IDENTITY.goalId,
    goalVersion: 1,
    skillId: INPUT.skillId,
    skillVersion: INPUT.skillVersion,
    selectionRef: 'selection-recovery',
    applicabilityStatus: 'satisfied',
    usagePolicy: {
      skill: { skillId: INPUT.skillId, skillVersion: INPUT.skillVersion },
      mode: 'procedure',
      modeDecision: {
        decision: 'selected',
        mode: 'procedure',
        confirmationRequired: false,
        confirmationSatisfied: true,
        reasonCodes: [],
      },
      constraints: [],
      forbiddenActions: [],
      adaptiveInstructions: [],
      requiredConfirmations: [],
      requiredContextIds: ['public-resource-id', 'provider-binding-freshness'],
      allowedTools: [{ serverId: INPUT.serverId, toolName: INPUT.toolName }],
      taskOperations: [
        {
          bindingId: 'binding-home-light',
          taskType: INPUT.toolName,
          providerId: INPUT.serverId,
          operationName: INPUT.toolName,
          protocolMode: 'frozen_v1',
        },
      ],
      childPolicies: [],
      evidenceRequirements: [
        {
          requirementId: 'state-observed',
          evidenceType: 'home.light.state-observed',
          required: true,
          hardGate: true,
        },
      ],
      rejectSuccessWithoutRequiredEvidence: true,
      composition: {
        root: { skillId: INPUT.skillId, skillVersion: INPUT.skillVersion },
        expandedSkills: [{ skillId: INPUT.skillId, skillVersion: INPUT.skillVersion }],
        edges: [],
        maxDepth: 3,
        consumedDepth: 0,
        consumedSkills: 1,
        consumedNodes: 0,
      },
      context: {
        requirements: [
          {
            requirementId: 'public-resource-id',
            required: true,
            status: 'satisfied',
            source: 'authoritative_context',
            attemptedSources: ['authoritative_context'],
          },
          {
            requirementId: 'provider-binding-freshness',
            required: true,
            status: 'satisfied',
            source: 'authoritative_context',
            attemptedSources: ['authoritative_context'],
          },
        ],
        satisfied: 2,
        total: 2,
        complete: true,
        inputRequiredIds: [],
        unsatisfiedIds: [],
        unknownIds: [],
      },
      readiness: {
        overall: 'ready',
        bindings: [
          {
            bindingId: 'binding-home-light',
            taskType: INPUT.toolName,
            disposition: 'ready',
            confirmationRequired: false,
            reasonCodes: [],
            selectedProviderId: INPUT.serverId,
            selectedOperationName: INPUT.toolName,
            selectedProtocolMode: 'frozen_v1',
          },
        ],
      },
    },
    workflowPlanId: IDENTITY.workflowPlanId,
    workflowDefinitionId: IDENTITY.workflowDefinitionId,
    workflowDefinitionVersion: 1,
    createdAt: '2026-08-11T00:00:00.000Z',
    status,
    events: [],
    references: [],
  };
}

function succeededInvocation(): McpInvocation {
  return {
    invocationId: IDENTITY.mcpInvocationId,
    taskId: INPUT.taskId,
    contextId: INPUT.contextId,
    executionMode: 'live',
    serverId: INPUT.serverId,
    toolName: INPUT.toolName,
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'none',
      replay: 'forbidden',
      source: 'mcp_declared',
    },
    arguments: { resourceId: INPUT.resourceId },
    result: {
      content: [{ type: 'text', text: 'on' }],
      structuredContent: RESULT,
      isError: false,
      evidence: [
        {
          evidenceId: 'evidence-state-1',
          evidenceType: 'home.light.state-observed',
          observedAt: '2026-08-11T00:00:01.000Z',
          payloadRef: { kind: 'structured_content', jsonPointer: '/state' },
        },
      ],
    },
    status: 'succeeded',
    startedAt: '2026-08-11T00:00:00.500Z',
    completedAt: '2026-08-11T00:00:01.000Z',
    durationMs: 500,
  };
}

function defaultUnknownExecutionSemantics(): McpInvocation['executionSemantics'] {
  return {
    effect: 'unknown',
    execution: 'unknown',
    cancellation: 'unknown',
    idempotency: 'unknown',
    replay: 'unknown',
    source: 'default_unknown',
  };
}

function skill(): SkillVersion {
  return {
    skillId: INPUT.skillId,
    version: INPUT.skillVersion,
    outputSchema: OUTPUT_SCHEMA,
    runtimePolicy: { autoConfirmPlan: true, maxLlmCalls: 0, maxMcpCalls: 1 },
    usageSpecification: {
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: [],
        forbiddenActions: [],
        requiredConfirmations: [],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: [],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [
        {
          requirementId: 'public-resource-id',
          description: 'The admitted public resource identifier.',
          required: true,
          sourceOrder: ['authoritative_context'],
        },
        {
          requirementId: 'provider-binding-freshness',
          description: 'The current Provider binding authority.',
          required: true,
          sourceOrder: ['authoritative_context'],
        },
      ],
      modes: {
        supported: ['procedure'],
        defaultMode: 'procedure',
        procedure: { summary: 'Read state once.', instructions: [] },
      },
      taskBindings: [
        {
          bindingId: 'binding-home-light',
          taskType: INPUT.toolName,
          providerPolicy: {
            selection: 'required',
            preferredProviderIds: [],
            requiredProviderId: INPUT.serverId,
            forbiddenProviderIds: [],
            requiredAttributes: ['task_behavior:synchronous_only'],
          },
        },
      ],
      evidencePolicy: {
        requirements: [
          {
            requirementId: 'state-observed',
            evidenceType: 'home.light.state-observed',
            required: true,
            hardGate: true,
          },
        ],
        rejectSuccessWithoutRequiredEvidence: true,
      },
    },
  } as unknown as SkillVersion;
}
