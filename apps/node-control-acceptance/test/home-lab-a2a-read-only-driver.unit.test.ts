import { Task, TaskState } from '@a2a-js/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  HOME_LAB_A2A_READ_ONLY_SCENARIO,
  assertCompositeMcpInvocations,
  assertCompositeReadOnlyPlan,
  assertFrozenProviderBindingRequirements,
  assertModelInvocations,
  assertModelRuntimeReady,
  confirmCompositeReadOnlyPlanAfterZeroInvocationGate,
  interactiveCandidateUserGoalPlan,
  managementUserGoalPlan,
  runHomeLabA2AReadOnly,
  structuredOutcome,
  validateScenario,
} from '../src/home-lab-a2a-read-only-driver.js';
import {
  HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES,
  HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
  HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
  HOME_LAB_A2A_MODEL_STAGES,
} from '../src/home-lab-a2a-model-contract.js';

const timestamp = '2026-08-10T12:00:00.000Z';
const capabilityAttemptId = 'capability-attempt-task-g08-1';
const requiredModelStages = HOME_LAB_A2A_MODEL_STAGES;

describe('home-lab A2A read-only safety gates', () => {
  it('rejects every scenario mutation before network or A2A client access', async () => {
    const request = vi.fn<typeof fetch>();
    const createA2AClient = vi.fn();
    const scenario = {
      ...HOME_LAB_A2A_READ_ONLY_SCENARIO,
      operations: [
        { ...scenarioOperation('light'), toolName: 'light_set_power' },
        scenarioOperation('climate'),
      ],
    } as unknown as typeof HOME_LAB_A2A_READ_ONLY_SCENARIO;

    expect(() => validateScenario(scenario)).toThrow(
      expect.objectContaining({ code: 'A2A_WRITE_INTENT_FORBIDDEN' }),
    );
    await expect(
      runHomeLabA2AReadOnly(
        { ...baseConfiguration(), scenario },
        { fetch: request, createA2AClient },
      ),
    ).rejects.toMatchObject({ code: 'A2A_WRITE_INTENT_FORBIDDEN' });
    expect(request).not.toHaveBeenCalled();
    expect(createA2AClient).not.toHaveBeenCalled();
  });

  it('requires every cognitive route to use an enabled Model Provider', () => {
    expect(() => assertModelRuntimeReady([], [])).toThrow(
      expect.objectContaining({ code: 'A2A_MODEL_RUNTIME_NOT_CONFIGURED' }),
    );
    expect(() =>
      assertModelRuntimeReady(
        [fixtureProvider()],
        HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES.slice(1).map((stage) => ({
          stage,
          providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
        })),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_MODEL_RUNTIME_NOT_CONFIGURED' }));
    expect(
      assertModelRuntimeReady(
        [fixtureProvider()],
        HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES.map((stage) => ({
          stage,
          providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
        })),
      ),
    ).toEqual({ configuredProviderCount: 1 });
    expect(() =>
      assertModelRuntimeReady(
        [{ ...fixtureProvider(), model: 'wrong-model' }],
        HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES.map((stage) => ({
          stage,
          providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
        })),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_MODEL_RUNTIME_NOT_CONFIGURED' }));
  });

  it('binds every Task-linked Model invocation to the exact fixture identity', () => {
    const required = requiredModelStages.map((stage) => modelInvocation(stage));
    expect(assertModelInvocations({ items: required })).toEqual([...requiredModelStages].sort());
    expect(() =>
      assertModelInvocations({ items: [...required, modelInvocation('workflow_planning')] }),
    ).toThrow(expect.objectContaining({ code: 'A2A_MODEL_EVIDENCE_INCOMPLETE' }));
    expect(() =>
      assertModelInvocations({
        items: [
          ...required,
          { ...modelInvocation('evaluation'), status: 'failed', errorCode: 'UPSTREAM' },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'A2A_MODEL_INVOCATION_FAILED' }));
    expect(() =>
      assertModelInvocations({
        items: [...required.slice(0, -1), { ...required.at(-1), providerId: 'provider.external' }],
      }),
    ).toThrow(expect.objectContaining({ code: 'A2A_MODEL_AUTHORITY_MISMATCH' }));
  });

  it('accepts only the exact reachable two-read, two-evidence-gate topology', () => {
    const plan = exactPlan();
    expect(() => {
      assertCompositeReadOnlyPlan(plan);
    }).not.toThrow();

    expect(() => {
      assertCompositeReadOnlyPlan({
        ...plan,
        toolExecutionSemantics: plan.toolExecutionSemantics.map((item) =>
          item.reference.toolName === 'light_get_state'
            ? {
                ...item,
                executionSemantics: {
                  ...item.executionSemantics,
                  effect: 'unknown',
                  source: 'default_unknown',
                },
              }
            : item,
        ),
      });
    }).toThrow(expect.objectContaining({ code: 'A2A_PLAN_EXECUTION_SEMANTICS_INVALID' }));

    expect(() => {
      assertCompositeReadOnlyPlan(
        mutateNode(plan, 'mainLight', {
          arguments: {
            resourceId: { op: 'ref', path: ['input', 'mainLightResourceId'] },
          },
        }),
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_PLAN_UNQUALIFIED_OPERATION' }));

    expect(() => {
      assertCompositeReadOnlyPlan(
        mutateNode(plan, 'mainLight', {
          tool: { serverId: scenarioOperation('light').serverId, toolName: 'light_set_power' },
        }),
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_PLAN_UNQUALIFIED_OPERATION' }));

    expect(() => {
      assertCompositeReadOnlyPlan(
        mutateNode(plan, 'result', {
          value: {
            op: 'ref',
            path: ['outputs', 'mainLight', 'data', 'structuredContent'],
          },
        }),
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_PLAN_RESULT_MAPPING_INVALID' }));

    expect(() => {
      assertCompositeReadOnlyPlan({
        ...plan,
        definition: {
          ...plan.definition,
          edges: plan.definition.edges.map((edge) =>
            edge.sourceNodeId === 'evidenceMainLight' && edge.outcome === 'true'
              ? { ...edge, targetNodeId: 'result' }
              : edge,
          ),
        },
      });
    }).toThrow(expect.objectContaining({ code: 'A2A_PLAN_UNQUALIFIED_OPERATION' }));

    expect(() => {
      assertCompositeReadOnlyPlan({
        ...plan,
        definition: {
          ...plan.definition,
          nodes: [
            ...plan.definition.nodes,
            { nodeId: 'optional', type: 'mcp_tool', tool: { serverId: 'x', toolName: 'read' } },
          ],
        },
      });
    }).toThrow(expect.objectContaining({ code: 'A2A_PLAN_UNQUALIFIED_OPERATION' }));
  });

  it('requires the zero-invocation gate to finish before confirmation', async () => {
    const order: string[] = [];
    await expect(
      confirmCompositeReadOnlyPlanAfterZeroInvocationGate({
        assertNoMcpInvocations: () => {
          order.push('zero-mcp');
          return Promise.resolve();
        },
        confirm: () => {
          order.push('confirm');
          return Promise.resolve('confirmed');
        },
      }),
    ).resolves.toBe('confirmed');
    expect(order).toEqual(['zero-mcp', 'confirm']);

    const confirm = vi.fn(() => Promise.resolve('must-not-run'));
    await expect(
      confirmCompositeReadOnlyPlanAfterZeroInvocationGate({
        assertNoMcpInvocations: () => Promise.reject(new Error('MCP_ALREADY_OBSERVED')),
        confirm,
      }),
    ).rejects.toThrow('MCP_ALREADY_OBSERVED');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('validates the current interactive plan candidate before accepting review', () => {
    const plan = { planId: 'user-goal-plan-1' };
    const view = {
      session: {
        sessionId: 'planning-session-1',
        taskId: 'task-1',
        goalId: 'goal-1',
        goalVersion: 1,
        state: 'plan_review',
        currentCandidateId: 'candidate-1',
        currentCandidateRevision: 2,
      },
      candidate: {
        sessionId: 'planning-session-1',
        candidateId: 'candidate-1',
        revision: 2,
        status: 'candidate',
        plan,
      },
    };
    expect(interactiveCandidateUserGoalPlan(view, 'task-1', 'goal-1', 1)).toBe(plan);
    expect(() =>
      interactiveCandidateUserGoalPlan(
        {
          ...view,
          session: { ...view.session, currentCandidateId: 'candidate-other' },
        },
        'task-1',
        'goal-1',
        1,
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_USER_GOAL_PLAN_INVALID' }));
  });

  it('unwraps the UserGoalPlan from the management read envelope', () => {
    const plan = { planId: 'user-goal-plan-1', skillGoals: [] };

    expect(
      managementUserGoalPlan({ plan, lockVersion: 2, outcomes: [], completedEffects: [] }),
    ).toBe(plan);
    expect(() => managementUserGoalPlan({ item: plan })).toThrow(
      expect.objectContaining({ code: 'A2A_USER_GOAL_PLAN_INVALID' }),
    );
  });

  it('accepts exactly two live read invocations with Provider evidence', () => {
    const output = compositeState();
    const invocations = HOME_LAB_A2A_READ_ONLY_SCENARIO.operations.map((operation) =>
      providerInvocation(operation, output[operation.outputField]),
    );
    expect(() => {
      assertCompositeMcpInvocations(
        { items: invocations },
        HOME_LAB_A2A_READ_ONLY_SCENARIO,
        output,
        capabilityAttemptId,
      );
    }).not.toThrow();
    expect(() => {
      assertCompositeMcpInvocations(
        {
          items: [
            ...invocations,
            { ...invocations[0], invocationId: 'unexpected-third-invocation' },
          ],
        },
        HOME_LAB_A2A_READ_ONLY_SCENARIO,
        output,
        capabilityAttemptId,
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_MCP_INVOCATION_INVALID' }));
    expect(() => {
      assertCompositeMcpInvocations(
        {
          items: [
            {
              ...invocations[0],
              executionSemantics: { effect: 'side_effecting' },
            },
            invocations[1],
          ],
        },
        HOME_LAB_A2A_READ_ONLY_SCENARIO,
        output,
        capabilityAttemptId,
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_MCP_EVIDENCE_INVALID' }));
    expect(() => {
      assertCompositeMcpInvocations(
        {
          items: [
            { ...invocations[0], capabilityAttemptId: 'capability-attempt-previous' },
            invocations[1],
          ],
        },
        HOME_LAB_A2A_READ_ONLY_SCENARIO,
        output,
        capabilityAttemptId,
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_MCP_INVOCATION_INVALID' }));
  });

  it('freezes both declared requirements and both fresh current SMPP authorities', () => {
    const snapshot = providerPolicySnapshot();
    expect(() => {
      assertFrozenProviderBindingRequirements(snapshot, HOME_LAB_A2A_READ_ONLY_SCENARIO);
    }).not.toThrow();
    expect(() => {
      assertFrozenProviderBindingRequirements(
        {
          ...snapshot,
          currentProviderBindings: [
            snapshot.currentProviderBindings[0],
            {
              ...snapshot.currentProviderBindings[1],
              binding: {
                ...snapshot.currentProviderBindings[1]?.binding,
                localServerId: 'wrong-server',
              },
            },
          ],
        },
        HOME_LAB_A2A_READ_ONLY_SCENARIO,
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_FROZEN_PROVIDER_BINDINGS_INVALID' }));
  });

  it('returns only both public resource states and rejects physical entity identity', () => {
    const output = compositeState();
    expect(structuredOutcome(a2aTask(output))).toEqual(output);
    expect(() =>
      structuredOutcome(
        a2aTask({
          ...output,
          mainLight: { ...output.mainLight, entityId: 'light.private_physical_id' },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_SENSITIVE_EVIDENCE_FORBIDDEN' }));
  });
});

function baseConfiguration() {
  return {
    mode: 'execute' as const,
    a2aBaseUrl: 'http://127.0.0.1:29999',
    runtimeManagementBaseUrl: 'http://127.0.0.1:29998',
    nodeControlBaseUrl: 'http://127.0.0.1:20080',
    nodeControlBearerToken: 'node-control-token',
    runId: 'goal-run-g08-unit',
    pollIntervalMs: 10,
    maxPolls: 2,
  };
}

function exactPlan() {
  const light = scenarioOperation('light');
  const climate = scenarioOperation('climate');
  return {
    definition: {
      entryNodeId: 'mainLight',
      exitNodeIds: ['result', 'failure'],
      nodes: [
        {
          nodeId: 'mainLight',
          type: 'mcp_tool',
          tool: { serverId: light.serverId, toolName: light.toolName },
          arguments: {
            resourceId: {
              op: 'ref',
              path: ['input', 'skillInput', 'mainLightResourceId'],
            },
          },
        },
        {
          nodeId: 'evidenceMainLight',
          type: 'condition',
          expression: { op: 'exists', path: ['evidence', light.evidenceType] },
        },
        {
          nodeId: 'climate',
          type: 'mcp_tool',
          tool: { serverId: climate.serverId, toolName: climate.toolName },
          arguments: {
            resourceId: {
              op: 'ref',
              path: ['input', 'skillInput', 'climateResourceId'],
            },
          },
        },
        {
          nodeId: 'evidenceClimate',
          type: 'condition',
          expression: { op: 'exists', path: ['evidence', climate.evidenceType] },
        },
        { nodeId: 'result', type: 'result', value: { op: 'ref', path: ['outputs'] } },
        { nodeId: 'failure', type: 'result', value: { op: 'literal', value: false } },
      ],
      edges: [
        { sourceNodeId: 'mainLight', targetNodeId: 'evidenceMainLight' },
        { sourceNodeId: 'evidenceMainLight', targetNodeId: 'climate', outcome: 'true' },
        { sourceNodeId: 'evidenceMainLight', targetNodeId: 'failure', outcome: 'false' },
        { sourceNodeId: 'climate', targetNodeId: 'evidenceClimate' },
        { sourceNodeId: 'evidenceClimate', targetNodeId: 'result', outcome: 'true' },
        { sourceNodeId: 'evidenceClimate', targetNodeId: 'failure', outcome: 'false' },
      ],
    },
    toolExecutionSemantics: [
      ...[light, climate].map((operation) => ({
        reference: { serverId: operation.serverId, toolName: operation.toolName },
        executionSemantics: { effect: 'read_only', source: 'admin_override' },
      })),
      {
        reference: { serverId: light.serverId, toolName: 'light_set_power' },
        executionSemantics: { effect: 'side_effecting', source: 'admin_override' },
      },
    ],
  };
}

function scenarioOperation(kind: 'light' | 'climate') {
  const operation = HOME_LAB_A2A_READ_ONLY_SCENARIO.operations.find(
    (candidate) => candidate.kind === kind,
  );
  if (operation === undefined) throw new Error(`SCENARIO_OPERATION_MISSING:${kind}`);
  return operation;
}

function mutateNode(
  plan: ReturnType<typeof exactPlan>,
  nodeId: string,
  patch: Readonly<Record<string, unknown>>,
) {
  return {
    ...plan,
    definition: {
      ...plan.definition,
      nodes: plan.definition.nodes.map((node) =>
        node.nodeId === nodeId ? { ...node, ...patch } : node,
      ),
    },
  };
}

function compositeState() {
  return {
    mainLight: {
      resourceId: 'living-room-main-light',
      power: 'on',
      reachable: true,
      brightnessPercent: 72,
      observedAt: timestamp,
    },
    climate: {
      resourceId: 'living-room-air-conditioner',
      power: 'on',
      reachable: true,
      hvacMode: 'cool',
      currentTemperature: 25.2,
      targetTemperature: 24,
      temperatureUnit: 'C',
      observedAt: timestamp,
    },
  } as const;
}

function providerInvocation(
  operation: (typeof HOME_LAB_A2A_READ_ONLY_SCENARIO.operations)[number],
  output: Readonly<Record<string, unknown>>,
) {
  return {
    invocationId: `invocation-${operation.kind}`,
    capabilityAttemptId,
    executionMode: 'live',
    serverId: operation.serverId,
    toolName: operation.toolName,
    status: 'succeeded',
    executionSemantics: { effect: 'read_only' },
    arguments: { resourceId: operation.resourceId },
    result: {
      structuredContent: output,
      isError: false,
      evidence: [
        {
          evidenceId: `evidence-${operation.kind}`,
          evidenceType: operation.evidenceType,
          observedAt: timestamp,
          payloadRef: { kind: 'structured_content', jsonPointer: '' },
        },
      ],
    },
  } as const;
}

function providerPolicySnapshot() {
  const requirements = HOME_LAB_A2A_READ_ONLY_SCENARIO.operations.map((operation) => ({
    bindingId: operation.providerBindingId,
    localServerId: operation.serverId,
  }));
  const currentProviderBindings = HOME_LAB_A2A_READ_ONLY_SCENARIO.operations.map(
    (operation, index) => {
      const checksum = index === 0 ? 'a'.repeat(64) : 'b'.repeat(64);
      const endpointRef = `https://${operation.serverId}.example.test/mcp`;
      const externalProviderId = `ha-${operation.kind}-lab`;
      const externalServerId = `${operation.kind}-server`;
      return {
        observedAt: timestamp,
        binding: {
          bindingId: operation.providerBindingId,
          revision: index + 1,
          localServerId: operation.serverId,
          originType: 'smpp_registry',
          providerId: externalProviderId,
          externalProviderId,
          externalServerId,
          registryRevision: index + 11,
          registryChecksum: checksum,
          catalogRevision: `catalog-${operation.kind}-1`,
          catalogChecksum: checksum,
          endpointRef,
          availabilityValidUntil: '2026-08-10T13:00:00.000Z',
          catalogObservedAt: '2026-08-10T11:59:00.000Z',
          operationCount: 1,
        },
        sourceCandidateLineage: {
          smppSourceId: 'smpp-home-lab',
          externalProviderId,
          externalServerId,
          registryRevision: index + 11,
          registryChecksum: checksum,
          nativeRevision: index + 21,
          nativeChecksum: checksum,
          projectionContract: 'sdar-registry-v1',
          candidateEndpoint: endpointRef,
        },
      };
    },
  );
  return {
    resolution: {
      implementations: [
        {
          implementationRef: `skill:${HOME_LAB_A2A_READ_ONLY_SCENARIO.skillId}:1`,
          providerBindingRequirements: requirements,
        },
      ],
    },
    currentProviderBindings,
  };
}

function fixtureProvider() {
  return {
    providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
    kind: 'local',
    apiStyle: 'openai_chat_completions',
    baseUrl: 'http://127.0.0.1:18461/v1',
    model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
    enabled: true,
  } as const;
}

function modelInvocation(stage: string) {
  return {
    invocationId: `model-${stage}`,
    stage,
    providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
    model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
    operation: stage === 'goal' ? 'embedding' : 'structured_generation',
    ...(stage === 'goal'
      ? {}
      : { promptId: `prompt.home-lab-a2a-fixture.${stage}`, promptVersion: 1 }),
    status: 'succeeded',
  } as const;
}

function a2aTask(
  output: Readonly<{
    mainLight: Readonly<Record<string, unknown>>;
    climate: Readonly<Record<string, unknown>>;
  }>,
): Task {
  return Task.fromJSON({
    id: 'task-g08',
    contextId: 'context-g08',
    status: { state: TaskState.TASK_STATE_COMPLETED, timestamp },
    artifacts: [
      {
        artifactId: 'task-g08:result',
        name: 'result',
        parts: [{ data: output, mediaType: 'application/json' }],
      },
    ],
    metadata: { internalPhase: 'completed' },
  });
}
