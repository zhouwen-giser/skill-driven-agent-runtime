import { describe, expect, it } from 'vitest';
import type { SkillRepository } from '../src/index.js';
import { WorkflowValidator } from '../src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';

describe('WorkflowValidator', () => {
  it('accepts all whitelisted node kinds with restricted expressions and validated catalogs', async () => {
    const result = await validator().validate(validWorkflow());
    expect(result.valid).toBe(true);
    expect(result.definition?.nodes.map((node) => node.type)).toEqual([
      'llm',
      'mcp_tool',
      'condition',
      'parallel',
      'subworkflow',
      'loop',
      'skill_call',
      'human_confirmation',
      'error_handler',
      'result',
    ]);
  });

  it.each([
    [
      'unknown node',
      (value: ReturnType<typeof validWorkflow>) => ({
        ...value,
        nodes: [{ nodeId: 'evil', name: 'evil', type: 'javascript', source: 'process.exit()' }],
      }),
    ],
    [
      'unbounded loop',
      (value: ReturnType<typeof validWorkflow>) => ({
        ...value,
        nodes: value.nodes.map((node) =>
          node.type === 'loop' ? { ...node, maxIterations: 0 } : node,
        ),
      }),
    ],
    [
      'arbitrary expression',
      (value: ReturnType<typeof validWorkflow>) => ({
        ...value,
        nodes: value.nodes.map((node) =>
          node.type === 'condition'
            ? { ...node, expression: { op: 'eval', code: 'globalThis' } }
            : node,
        ),
      }),
    ],
    [
      'missing edge endpoint',
      (value: ReturnType<typeof validWorkflow>) => ({
        ...value,
        edges: [...value.edges, { sourceNodeId: 'missing', targetNodeId: 'result' }],
      }),
    ],
    [
      'invalid tool arguments',
      (value: ReturnType<typeof validWorkflow>) => ({
        ...value,
        nodes: value.nodes.map((node) =>
          node.type === 'mcp_tool' ? { ...node, arguments: {} } : node,
        ),
      }),
    ],
  ])('rejects %s', async (_label, mutate) => {
    const result = await validator().validate(mutate(validWorkflow()));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

function validator() {
  return new WorkflowValidator({
    tools: {
      exists: () => Promise.resolve(true),
      getInputSchema: () =>
        Promise.resolve({
          type: 'object',
          required: ['deviceId'],
          properties: { deviceId: { type: 'string' } },
          additionalProperties: false,
        }),
    },
    skills: skillRepository(),
    schemas: new AjvJsonSchemaValidator(),
  });
}

function skillRepository(): SkillRepository {
  const version = {
    skillId: 'skill.device',
    version: 1,
    name: 'Device',
    summary: 'Device',
    description: 'Device',
    capabilities: ['device'],
    workflowGuidance: 'Inspect.',
    outputInstruction: 'Return.',
    inputSchema: {
      type: 'object',
      required: ['deviceId'],
      properties: { deviceId: { type: 'string' } },
    },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled' as const,
    sourceKind: 'admin' as const,
    validationPassed: true,
    createdAt: '2026-07-12T00:00:00.000Z',
  };
  return {
    find: () => Promise.resolve(undefined),
    findCurrentVersion: (id) => Promise.resolve(id === version.skillId ? version : undefined),
    findVersion: () => Promise.resolve(undefined),
    listVersions: () => Promise.resolve([]),
    listEnabledVersions: () => Promise.resolve([version]),
    listCurrentVersions: () => Promise.resolve([version]),
    saveVersionAndSetCurrent: () => Promise.resolve(),
  };
}

function validWorkflow() {
  const literal = { op: 'literal' as const, value: true };
  return {
    workflowDefinitionId: 'workflow.device',
    version: 1,
    goalId: 'goal.device',
    goalVersion: 1,
    entryNodeId: 'llm',
    exitNodeIds: ['result'],
    nodes: [
      {
        nodeId: 'llm',
        name: 'Plan detail',
        type: 'llm' as const,
        instruction: 'Structure details.',
        responseSchema: { type: 'object' },
      },
      {
        nodeId: 'tool',
        name: 'Read device',
        type: 'mcp_tool' as const,
        tool: { serverId: 'mcp.devices', toolName: 'device_status' },
        arguments: { deviceId: 'device-1' },
      },
      {
        nodeId: 'condition',
        name: 'Check',
        type: 'condition' as const,
        expression: {
          op: 'eq' as const,
          left: { op: 'ref' as const, path: ['nodes', 'tool', 'status'] },
          right: { op: 'literal' as const, value: 'online' },
        },
      },
      {
        nodeId: 'parallel',
        name: 'Parallel',
        type: 'parallel' as const,
        branchEntryNodeIds: ['loop', 'skill'],
      },
      {
        nodeId: 'sub',
        name: 'Subflow',
        type: 'subworkflow' as const,
        workflowDefinitionId: 'workflow.child',
        workflowVersion: 1,
      },
      {
        nodeId: 'loop',
        name: 'Bounded loop',
        type: 'loop' as const,
        condition: literal,
        bodyEntryNodeId: 'skill',
        maxIterations: 3,
      },
      {
        nodeId: 'skill',
        name: 'Child Skill',
        type: 'skill_call' as const,
        skillId: 'skill.device',
        input: { deviceId: 'device-1' },
      },
      {
        nodeId: 'confirm',
        name: 'Confirm',
        type: 'human_confirmation' as const,
        prompt: 'Continue?',
      },
      {
        nodeId: 'handler',
        name: 'Handle',
        type: 'error_handler' as const,
        handledNodeId: 'tool',
        strategy: 'continue' as const,
      },
      {
        nodeId: 'result',
        name: 'Result',
        type: 'result' as const,
        value: { op: 'ref' as const, path: ['nodes', 'tool'] },
      },
    ],
    edges: [
      { sourceNodeId: 'llm', targetNodeId: 'tool' },
      { sourceNodeId: 'tool', targetNodeId: 'condition' },
      { sourceNodeId: 'condition', targetNodeId: 'parallel', outcome: 'true' as const },
      { sourceNodeId: 'condition', targetNodeId: 'sub', outcome: 'false' as const },
      { sourceNodeId: 'parallel', targetNodeId: 'loop' },
      { sourceNodeId: 'sub', targetNodeId: 'loop' },
      { sourceNodeId: 'loop', targetNodeId: 'skill' },
      { sourceNodeId: 'skill', targetNodeId: 'confirm' },
      { sourceNodeId: 'confirm', targetNodeId: 'handler' },
      { sourceNodeId: 'handler', targetNodeId: 'result' },
    ],
  };
}
