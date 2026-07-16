import { describe, expect, it } from 'vitest';

import { createAgentTask, type TemporarySkill } from '../../domain/src/index.js';
import { TemporarySkillResolver } from '../src/index.js';

const task = createAgentTask({
  taskId: 'task-1',
  contextId: 'context-1',
  userId: 'anonymous',
  requestText: 'Read device status.',
  requestMetadata: {},
  timestamp: '2026-07-12T00:00:00.000Z',
});
const goalContract = {
  goalId: 'goal-1',
  version: 1,
  title: 'Read device status',
  description: 'Read the device status.',
  constraints: ['read-only'],
  successCriteria: ['status returned'],
} as const;

describe('TemporarySkillResolver', () => {
  it('authors a task-scoped Skill only from an enabled registered MCP Tool', async () => {
    let created: unknown;
    let modelGoalContract: unknown;
    const resolver = new TemporarySkillResolver({
      mcp: registry(),
      model: {
        generateStructured: ({ instruction }) => {
          modelGoalContract = (JSON.parse(instruction) as Readonly<{ goalContract: unknown }>)
            .goalContract;
          return Promise.resolve({
            serverId: 'mcp.devices',
            toolName: 'device_status',
            name: 'Temporary device status',
            description: 'Read status for this Task only.',
            outputSchema: { type: 'object' },
            decisionSummary: 'The registered Tool directly satisfies the capability gap.',
          });
        },
      },
      temporarySkills: {
        create: (input) => {
          created = input;
          return Promise.resolve({ temporarySkillId: 'temporary-1', ...input } as TemporarySkill);
        },
      },
    });

    const mutableContract = {
      ...goalContract,
      constraints: ['read-only'],
      successCriteria: ['status returned'],
    };
    const pending = resolver.resolve(mutableContract, task);
    mutableContract.constraints.push('caller mutation');
    mutableContract.successCriteria.push('caller mutation');
    const result = await pending;

    expect(result).toMatchObject({
      skill: { temporarySkillId: 'temporary-1', taskId: 'task-1', contextId: 'context-1' },
    });
    expect(created).toMatchObject({
      tools: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
      inputSchema: { type: 'object', required: ['deviceId'] },
    });
    expect(modelGoalContract).toMatchObject({
      constraints: ['read-only'],
      successCriteria: ['status returned'],
    });
  });

  it('rejects a model decision that names an unregistered Tool', async () => {
    const resolver = new TemporarySkillResolver({
      mcp: registry(),
      model: {
        generateStructured: () =>
          Promise.resolve({
            serverId: 'mcp.devices',
            toolName: 'invented_tool',
            name: 'Invented',
            description: 'Must be rejected.',
            outputSchema: { type: 'object' },
            decisionSummary: 'Invalid model decision.',
          }),
      },
      temporarySkills: { create: () => Promise.reject(new Error('MUST_NOT_CREATE')) },
    });

    await expect(resolver.resolve(goalContract, task)).rejects.toThrow(
      'TEMPORARY_SKILL_MODEL_SELECTED_UNKNOWN_TOOL',
    );
  });
});

function registry() {
  return {
    listServers: () =>
      Promise.resolve([
        {
          serverId: 'mcp.devices',
          name: 'Devices',
          endpoint: 'http://127.0.0.1/mcp',
          transport: 'streamable_http' as const,
          status: 'enabled' as const,
          toolRevision: 1,
          createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
      ]),
    listTools: () =>
      Promise.resolve([
        {
          serverId: 'mcp.devices',
          toolName: 'device_status',
          title: 'Device status',
          description: 'Read device status.',
          inputSchema: { type: 'object', required: ['deviceId'] },
          discoveredAt: '2026-07-12T00:00:00.000Z',
        },
      ]),
  };
}
