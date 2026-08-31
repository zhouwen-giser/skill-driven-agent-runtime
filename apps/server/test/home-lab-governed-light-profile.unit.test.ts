import { describe, expect, it, vi } from 'vitest';

import {
  HOME_LAB_GOVERNED_LIGHT_BINDING_ID,
  HOME_LAB_GOVERNED_LIGHT_CONTROL_CAPABILITY_ID,
  HOME_LAB_GOVERNED_LIGHT_PROFILE,
  HOME_LAB_GOVERNED_LIGHT_READ_CAPABILITY_ID,
  HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID,
  HOME_LAB_GOVERNED_LIGHT_SERVER_ID,
  assertHomeLabGovernedLightRuntimeConfiguration,
  homeLabGovernedLightSkillUsageContext,
  homeLabGovernedLightTaskUnderstandingConfiguration,
  resolveHomeLabGovernedLightTaskAvailabilityArguments,
} from '../src/home-lab-task-understanding.js';
import {
  HOME_LAB_GOVERNED_LIGHT_CONTROL_PROMPT,
  assertHomeLabGovernedLightWorkflowContract,
  verifiedHomeLabGovernedLightOutcomeRefs,
} from '../src/home-lab-governed-light-workflow-contract.js';
import { resumeTaskOwnedHumanConfirmation } from '../src/runtime.js';

type Startup = Parameters<typeof assertHomeLabGovernedLightRuntimeConfiguration>[0];

const capabilityAuthorityReader: NonNullable<Startup['capabilityAuthorityReader']> = {
  load: () => Promise.reject(new Error('not called')),
};
const bindingAuthorityReader: NonNullable<Startup['currentMcpProviderBindingAuthorityReader']> = {
  loadCurrentMcpProviderBinding: () => Promise.reject(new Error('not called')),
};
const governedControlPrincipalResolver: NonNullable<Startup['governedControlPrincipalResolver']> = {
  resolve: () => Promise.reject(new Error('not called')),
};

function startup(overrides: Partial<Startup> = {}): Startup {
  return {
    taskUnderstanding: homeLabGovernedLightTaskUnderstandingConfiguration(),
    capabilityAuthorityReader,
    currentMcpProviderBindingAuthorityReader: bindingAuthorityReader,
    skillUsageContext: { resolve: homeLabGovernedLightSkillUsageContext },
    frozenMcpTasks: { isolationAcknowledged: true },
    governedControlPrincipalResolver,
    ...overrides,
  };
}

describe('G09 governed main-light profile', () => {
  it('locks the two v3 Task Types and every required Runtime authority', () => {
    const configuration = homeLabGovernedLightTaskUnderstandingConfiguration();
    expect(configuration).toMatchObject({
      profile: HOME_LAB_GOVERNED_LIGHT_PROFILE,
      entryPolicy: 'all_requests',
      skillSelectionMode: 'exact_compatible_only',
      taskTypes: [
        {
          taskTypeId: 'task-type.home-lab-main-light-read-state',
          version: 3,
          capabilityRequirements: [HOME_LAB_GOVERNED_LIGHT_READ_CAPABILITY_ID],
          risks: [],
        },
        {
          taskTypeId: 'task-type.home-lab-main-light-set-power',
          version: 3,
          capabilityRequirements: [HOME_LAB_GOVERNED_LIGHT_CONTROL_CAPABILITY_ID],
          risks: ['physical_side_effect', 'explicit_confirmation_required'],
        },
      ],
    });
    expect(() => {
      assertHomeLabGovernedLightRuntimeConfiguration(startup());
    }).not.toThrow();
    const { frozenMcpTasks, ...withoutFrozenMcpTasks } = startup();
    void frozenMcpTasks;
    expect(() => {
      assertHomeLabGovernedLightRuntimeConfiguration(withoutFrozenMcpTasks);
    }).toThrow('HOME_LAB_GOVERNED_LIGHT_FROZEN_MCP_TASKS_REQUIRED');
    const { governedControlPrincipalResolver, ...withoutGovernedControlPrincipalResolver } =
      startup();
    void governedControlPrincipalResolver;
    expect(() => {
      assertHomeLabGovernedLightRuntimeConfiguration(withoutGovernedControlPrincipalResolver);
    }).toThrow('HOME_LAB_GOVERNED_LIGHT_CONTROL_IDENTITY_REQUIRED');
  });

  it('uses only the fresh G09 server and leaves set-power availability unresolved until input', () => {
    const providerPolicy = (taskBehavior: string) => ({
      selection: 'required' as const,
      preferredProviderIds: [],
      requiredProviderId: HOME_LAB_GOVERNED_LIGHT_SERVER_ID,
      forbiddenProviderIds: [],
      requiredAttributes: [`task_behavior:${taskBehavior}`],
    });
    expect(
      resolveHomeLabGovernedLightTaskAvailabilityArguments({
        bindingId: 'task-binding-home.light.get-state-v3',
        taskType: 'light_get_state',
        providerPolicy: providerPolicy('synchronous_only'),
      }),
    ).toEqual({
      unresolved: false,
      value: { resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID },
    });
    expect(
      resolveHomeLabGovernedLightTaskAvailabilityArguments({
        bindingId: 'task-binding-home.light.set-power-v3',
        taskType: 'light_set_power',
        providerPolicy: providerPolicy('task_required'),
      }),
    ).toEqual({
      unresolved: true,
      knownArguments: { resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID },
      unresolvedPaths: ['$.power'],
    });
    expect(HOME_LAB_GOVERNED_LIGHT_BINDING_ID).toBe('mcp-binding-ha-light-g09');
  });

  it('binds exact read and requested power values into pre-selection availability', () => {
    const goalContract = {
      goalId: 'goal-g09',
      version: 1,
      title: 'Governed main-light control',
      description: 'Use the exact G09 main-light authority.',
      constraints: [],
      successCriteria: [],
    };
    const task = (requestText: string) => ({
      taskId: 'task-g09',
      contextId: 'context-g09',
      userId: 'user-g09',
      requestText,
      requestMetadata: {},
      phase: 'skill_resolution' as const,
      phaseMessage: 'Selecting.',
      goalId: goalContract.goalId,
      goalVersion: goalContract.version,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    });
    expect(
      homeLabGovernedLightSkillUsageContext({
        goalContract,
        task: task('设置主灯电源为 off'),
      }).taskAvailabilityArguments,
    ).toEqual({
      unresolved: false,
      value: { resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID, power: 'off' },
    });
    expect(
      homeLabGovernedLightSkillUsageContext({
        goalContract,
        task: task('读取主灯基线'),
      }).taskAvailabilityArguments,
    ).toEqual({
      unresolved: false,
      value: { resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID },
    });
    expect(() =>
      homeLabGovernedLightSkillUsageContext({
        goalContract,
        task: task('设置辅助灯电源为 off'),
      }),
    ).toThrow('HOME_LAB_GOVERNED_LIGHT_USAGE_REQUEST_NOT_EXACT');
  });

  it('requires the exact pre-dispatch barrier and frozen RemoteTask execution contract', () => {
    expect(() => {
      assertHomeLabGovernedLightWorkflowContract(controlWorkflow(), {
        skillId: 'home.light.set-power',
        skillVersion: 3,
      });
    }).not.toThrow();
    expect(() => {
      assertHomeLabGovernedLightWorkflowContract(readWorkflow(), {
        skillId: 'home.light.get-state',
        skillVersion: 3,
      });
    }).not.toThrow();
    const withoutBarrier = structuredClone(controlWorkflow());
    const confirmation = withoutBarrier.nodes.find((node) => node.nodeId === 'confirmControl');
    if (confirmation !== undefined && 'prompt' in confirmation) confirmation.prompt = 'Continue?';
    expect(() => {
      assertHomeLabGovernedLightWorkflowContract(withoutBarrier, {
        skillId: 'home.light.set-power',
        skillVersion: 3,
      });
    }).toThrow('exact pre-dispatch governed-control barrier');
  });

  it('resumes the barrier with existing Task, Context and WorkflowControl authority', async () => {
    const resume = vi.fn((value: unknown) => Promise.resolve(value));
    const result = await resumeTaskOwnedHumanConfirmation(
      { instanceId: 'instance-g09', confirmed: true },
      {
        findInstance: () => Promise.resolve({ planId: 'plan-g09' }),
        findTaskByPlanId: () => Promise.resolve({ taskId: 'task-g09', contextId: 'context-g09' }),
        taskIdentity: (task) => task,
        resolveWorkflowControlId: () => Promise.resolve('control-g09'),
        resume,
      },
    );
    expect(result).toEqual({
      instanceId: 'instance-g09',
      confirmed: true,
      continuationAuthority: {
        agentTaskId: 'task-g09',
        contextId: 'context-g09',
        workflowControlId: 'control-g09',
      },
    });
    expect(resume).toHaveBeenCalledOnce();
  });

  it('projects only the exact v3 governed outcome authority into layered Goal evidence', () => {
    expect(
      verifiedHomeLabGovernedLightOutcomeRefs({
        skillId: 'home.light.get-state',
        version: 3,
        outcomeSpecification: {
          effects: ['effect.home.light.state_read'],
          evidence: ['light.state.observation'],
          artifacts: [],
        },
      }),
    ).toEqual({
      effectRefs: ['effect.home.light.state_read'],
      evidenceRefs: ['light.state.observation'],
      artifactRefs: [],
    });
    expect(
      verifiedHomeLabGovernedLightOutcomeRefs({
        skillId: 'home.light.set-power',
        version: 3,
        outcomeSpecification: {
          effects: ['effect.home.light.power_changed'],
          evidence: ['light.state.observation'],
          artifacts: [],
        },
      }),
    ).toEqual({
      effectRefs: ['effect.home.light.power_changed'],
      evidenceRefs: ['light.state.observation'],
      artifactRefs: [],
    });
    expect(() =>
      verifiedHomeLabGovernedLightOutcomeRefs({
        skillId: 'home.light.get-state',
        version: 3,
        outcomeSpecification: {
          effects: [],
          evidence: ['light.state.observation'],
          artifacts: [],
        },
      }),
    ).toThrow('must exactly cover its governed effect and observation evidence');
  });
});

function controlWorkflow() {
  return {
    entryNodeId: 'contextPublicResource',
    exitNodeIds: ['result', 'failure'],
    nodes: [
      ...contextNodes(),
      {
        nodeId: 'confirmControl',
        type: 'human_confirmation',
        prompt: HOME_LAB_GOVERNED_LIGHT_CONTROL_PROMPT,
      },
      {
        nodeId: 'setPower',
        type: 'mcp_tool',
        tool: { serverId: HOME_LAB_GOVERNED_LIGHT_SERVER_ID, toolName: 'light_set_power' },
        arguments: {
          resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID,
          power: 'off',
        },
        taskExecution: { protocolMode: 'frozen_v1', availabilityCheck: 'required' },
      },
      {
        nodeId: 'evidenceLight',
        type: 'condition',
        expression: { op: 'exists', path: ['evidence', 'light.state.observation'] },
      },
      {
        nodeId: 'result',
        type: 'result',
        value: { op: 'ref', path: ['nodes', 'setPower', 'data', 'structuredContent'] },
      },
      { nodeId: 'failure', type: 'result', value: { op: 'literal', value: false } },
    ],
    edges: [
      ...contextEdges('confirmControl'),
      { sourceNodeId: 'confirmControl', targetNodeId: 'setPower', outcome: 'success' },
      { sourceNodeId: 'confirmControl', targetNodeId: 'failure', outcome: 'failure' },
      { sourceNodeId: 'setPower', targetNodeId: 'evidenceLight' },
      { sourceNodeId: 'evidenceLight', targetNodeId: 'result', outcome: 'true' },
      { sourceNodeId: 'evidenceLight', targetNodeId: 'failure', outcome: 'false' },
    ],
  };
}

function readWorkflow() {
  return {
    entryNodeId: 'contextPublicResource',
    exitNodeIds: ['result', 'failure'],
    nodes: [
      ...contextNodes(),
      {
        nodeId: 'readLight',
        type: 'mcp_tool',
        tool: { serverId: HOME_LAB_GOVERNED_LIGHT_SERVER_ID, toolName: 'light_get_state' },
        arguments: {
          resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID,
        },
      },
      {
        nodeId: 'evidenceLight',
        type: 'condition',
        expression: { op: 'exists', path: ['evidence', 'light.state.observation'] },
      },
      {
        nodeId: 'result',
        type: 'result',
        value: { op: 'ref', path: ['nodes', 'readLight', 'data', 'structuredContent'] },
      },
      { nodeId: 'failure', type: 'result', value: { op: 'literal', value: false } },
    ],
    edges: [
      ...contextEdges('readLight'),
      { sourceNodeId: 'readLight', targetNodeId: 'evidenceLight' },
      { sourceNodeId: 'evidenceLight', targetNodeId: 'result', outcome: 'true' },
      { sourceNodeId: 'evidenceLight', targetNodeId: 'failure', outcome: 'false' },
    ],
  };
}

function contextNodes() {
  return [
    {
      nodeId: 'contextPublicResource',
      type: 'condition',
      expression: { op: 'ref', path: ['context', 'public-resource-id'] },
    },
    {
      nodeId: 'contextProviderBinding',
      type: 'condition',
      expression: { op: 'ref', path: ['context', 'provider-binding-freshness'] },
    },
  ];
}

function contextEdges(targetNodeId: 'confirmControl' | 'readLight') {
  return [
    {
      sourceNodeId: 'contextPublicResource',
      targetNodeId: 'contextProviderBinding',
      outcome: 'true',
    },
    { sourceNodeId: 'contextPublicResource', targetNodeId: 'failure', outcome: 'false' },
    { sourceNodeId: 'contextProviderBinding', targetNodeId, outcome: 'true' },
    { sourceNodeId: 'contextProviderBinding', targetNodeId: 'failure', outcome: 'false' },
  ];
}
