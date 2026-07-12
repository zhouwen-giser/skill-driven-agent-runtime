import { describe, expect, it } from 'vitest';

import type { EvolutionExperience } from '../../domain/src/index.js';
import { EvolutionExperienceService } from '../src/index.js';

describe('EvolutionExperienceService', () => {
  it('projects the Goal, Tool combination, immutable Workflow, result and evaluation', async () => {
    let saved: EvolutionExperience | undefined;
    const service = new EvolutionExperienceService({
      repository: {
        save: (value) => {
          saved = value;
          return Promise.resolve();
        },
        find: () => Promise.resolve(undefined),
        listByGoal: () => Promise.resolve([]),
        listBySkill: () => Promise.resolve([]),
        listByTool: () => Promise.resolve([]),
      },
      nextId: () => 'experience-1',
    });

    await service.record({
      controlId: 'control-1',
      roundIndex: 0,
      taskId: 'task-1',
      contextId: 'context-1',
      goal: {
        goalId: 'goal-1',
        contextId: 'context-1',
        version: 1,
        title: 'Inspect device',
        description: 'Read current device status.',
        constraints: ['read-only'],
        successCriteria: ['Status returned'],
        status: 'active',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
      workflow: {
        workflowDefinitionId: 'workflow-1',
        version: 1,
        goalId: 'goal-1',
        goalVersion: 1,
        entryNodeId: 'tool',
        exitNodeIds: ['result'],
        nodes: [
          {
            nodeId: 'tool',
            name: 'Read device',
            type: 'mcp_tool',
            tool: { serverId: 'mcp.devices', toolName: 'device_status' },
            arguments: { deviceId: 'device-1' },
          },
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'ref', path: ['nodes', 'tool'] },
          },
        ],
        edges: [{ sourceNodeId: 'tool', targetNodeId: 'result' }],
      },
      instance: {
        instanceId: 'instance-1',
        planId: 'plan-1',
        workflowDefinitionId: 'workflow-1',
        workflowVersion: 1,
        goalId: 'goal-1',
        goalVersion: 1,
        skillVersions: [{ skillId: 'skill-1', version: 2 }],
        budgetLimits: {
          maxReplans: 1,
          maxDurationSeconds: 60,
          maxLlmCalls: 5,
          maxMcpCalls: 5,
          maxCost: 5,
        },
        budgetUsage: { replanCount: 0, durationMs: 1000, llmCalls: 0, mcpCalls: 1, cost: 1 },
        status: 'succeeded',
        input: { request: 'inspect' },
        result: { status: 'online' },
        errors: {},
        startedAt: '2026-07-12T00:00:00.000Z',
        completedAt: '2026-07-12T00:00:01.000Z',
      },
      evaluation: { decision: 'achieved', summary: 'Goal satisfied.' },
      createdAt: '2026-07-12T00:00:01.000Z',
    });

    expect(saved).toMatchObject({
      successful: true,
      durationMs: 1000,
      goal: { goalId: 'goal-1', constraints: ['read-only'] },
      skillVersions: [{ skillId: 'skill-1', version: 2 }],
      tools: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
      result: { status: 'online' },
      evaluation: { decision: 'achieved' },
    });
  });
});
