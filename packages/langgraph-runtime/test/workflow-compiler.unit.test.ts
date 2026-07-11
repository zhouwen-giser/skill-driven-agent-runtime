import { describe, expect, it, vi } from 'vitest';

import type { WorkflowDefinition } from '../../domain/src/index.js';
import { compileWorkflow, type WorkflowRuntimePorts } from '../src/workflow-compiler.js';

function ports(overrides: Partial<WorkflowRuntimePorts> = {}): WorkflowRuntimePorts {
  let tick = 0;
  return {
    executeLlm: vi.fn().mockResolvedValue({ answer: 42 }),
    callMcpTool: vi.fn().mockResolvedValue({ temperature: 21 }),
    executeSkill: vi.fn().mockResolvedValue({ skill: 'done' }),
    executeSubworkflow: vi.fn().mockResolvedValue({ child: 'done' }),
    requestHumanConfirmation: vi.fn().mockResolvedValue(true),
    decideExecutionError: vi.fn().mockResolvedValue({
      strategy: 'continue',
      summary: 'Continue within the validated graph.',
    }),
    now: () => `2026-07-12T00:00:${String(tick++).padStart(2, '0')}.000Z`,
    nowMilliseconds: () => tick * 100,
    ...overrides,
  };
}

const budget = {
  maxReplans: 3,
  maxDurationSeconds: 60,
  maxLlmCalls: 20,
  maxMcpCalls: 20,
  maxCost: 100,
};
const costs = { llm: 1, mcp: 1, skill: 1, subworkflow: 1 };

function definition(
  nodes: WorkflowDefinition['nodes'],
  edges: WorkflowDefinition['edges'],
  entryNodeId: string,
  exitNodeIds: readonly string[],
): WorkflowDefinition {
  return {
    workflowDefinitionId: 'workflow.compiler',
    version: 1,
    goalId: 'goal.compiler',
    goalVersion: 1,
    entryNodeId,
    exitNodeIds,
    nodes,
    edges,
  };
}

describe('LangGraph Workflow compiler', () => {
  it('rejects unconfirmed plans before any node can execute', () => {
    const runtime = ports();
    expect(() =>
      compileWorkflow(
        definition(
          [
            {
              nodeId: 'result',
              name: 'Result',
              type: 'result',
              value: { op: 'literal', value: 'ok' },
            },
          ],
          [],
          'result',
          ['result'],
        ),
        'awaiting_confirmation',
        runtime,
      ),
    ).toThrow('Only a confirmed Workflow plan may be compiled');
    expect(runtime.callMcpTool).not.toHaveBeenCalled();
  });

  it('compiles and executes LLM, MCP, Skill, subworkflow, confirmation and result nodes', async () => {
    const runtime = ports();
    const source = definition(
      [
        {
          nodeId: 'llm',
          name: 'LLM',
          type: 'llm',
          instruction: 'Answer',
          responseSchema: { type: 'object' },
        },
        {
          nodeId: 'mcp',
          name: 'MCP',
          type: 'mcp_tool',
          tool: { serverId: 'weather', toolName: 'current' },
          arguments: { city: 'Shanghai' },
        },
        {
          nodeId: 'skill',
          name: 'Skill',
          type: 'skill_call',
          skillId: 'summarize',
          input: { concise: true },
        },
        {
          nodeId: 'child',
          name: 'Child',
          type: 'subworkflow',
          workflowDefinitionId: 'workflow.child',
          workflowVersion: 2,
        },
        { nodeId: 'confirm', name: 'Confirm', type: 'human_confirmation', prompt: 'Continue?' },
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'ref', path: ['outputs', 'mcp', 'temperature'] },
        },
      ],
      [
        { sourceNodeId: 'llm', targetNodeId: 'mcp' },
        { sourceNodeId: 'mcp', targetNodeId: 'skill' },
        { sourceNodeId: 'skill', targetNodeId: 'child' },
        { sourceNodeId: 'child', targetNodeId: 'confirm' },
        { sourceNodeId: 'confirm', targetNodeId: 'result', outcome: 'success' },
        { sourceNodeId: 'confirm', targetNodeId: 'result', outcome: 'failure' },
      ],
      'llm',
      ['result'],
    );
    const compiled = compileWorkflow(source, 'confirmed', runtime);
    const interrupted = await compiled.invoke({ request: 'weather' }, budget, costs);
    expect(interrupted).toMatchObject({
      status: 'paused',
      pendingConfirmation: { nodeId: 'confirm', prompt: 'Continue?' },
    });
    const result = await compiled.resume('workflow.compiler', true);

    expect(result.status).toBe('succeeded');
    expect(result.result).toBe(21);
    expect(result.outputs).toMatchObject({
      llm: { answer: 42 },
      mcp: { temperature: 21 },
      skill: { skill: 'done' },
      child: { child: 'done' },
      confirm: true,
    });
    expect(
      [...interrupted.events, ...result.events].filter((event) => event.type === 'node_succeeded'),
    ).toHaveLength(6);
    expect(compiled.definition).not.toBe(source);
    expect(Object.isFrozen(compiled.definition)).toBe(true);
    expect(runtime.callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: { serverId: 'weather', toolName: 'current' },
        arguments: { city: 'Shanghai' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(runtime.callMcpTool).toHaveBeenCalledTimes(1);
    expect(runtime.requestHumanConfirmation).not.toHaveBeenCalled();
  });

  it('routes conditions and enforces an explicit loop bound in the immutable graph', async () => {
    const runtime = ports();
    const compiled = compileWorkflow(
      definition(
        [
          {
            nodeId: 'condition',
            name: 'Condition',
            type: 'condition',
            expression: { op: 'ref', path: ['input', 'run'] },
          },
          {
            nodeId: 'loop',
            name: 'Loop',
            type: 'loop',
            condition: { op: 'literal', value: true },
            bodyEntryNodeId: 'body',
            maxIterations: 3,
          },
          { nodeId: 'body', name: 'Body', type: 'llm', instruction: 'step', responseSchema: true },
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'ref', path: ['loopCounts', 'loop'] },
          },
          {
            nodeId: 'skipped',
            name: 'Skipped',
            type: 'result',
            value: { op: 'literal', value: 'skipped' },
          },
        ],
        [
          { sourceNodeId: 'condition', targetNodeId: 'loop', outcome: 'true' },
          { sourceNodeId: 'condition', targetNodeId: 'skipped', outcome: 'false' },
          { sourceNodeId: 'loop', targetNodeId: 'result', outcome: 'done' },
          { sourceNodeId: 'body', targetNodeId: 'loop' },
        ],
        'condition',
        ['result', 'skipped'],
      ),
      'confirmed',
      runtime,
    );

    await expect(compiled.invoke({ run: true }, budget, costs)).resolves.toMatchObject({
      status: 'succeeded',
      result: 3,
      loopCounts: { loop: 3 },
    });
    expect(runtime.executeLlm).toHaveBeenCalledTimes(3);
    await expect(compiled.invoke({ run: false }, budget, costs)).resolves.toMatchObject({
      result: 'skipped',
    });
  });

  it('fans out parallel branches, joins once, and merges their state updates', async () => {
    const runtime = ports();
    const result = await compileWorkflow(
      definition(
        [
          {
            nodeId: 'parallel',
            name: 'Parallel',
            type: 'parallel',
            branchEntryNodeIds: ['left', 'right'],
          },
          { nodeId: 'left', name: 'Left', type: 'llm', instruction: 'left', responseSchema: true },
          { nodeId: 'right', name: 'Right', type: 'skill_call', skillId: 'right', input: {} },
          {
            nodeId: 'joined',
            name: 'Joined result',
            type: 'result',
            value: { op: 'ref', path: ['outputs', 'left', 'answer'] },
          },
        ],
        [
          { sourceNodeId: 'left', targetNodeId: 'joined' },
          { sourceNodeId: 'right', targetNodeId: 'joined' },
        ],
        'parallel',
        ['joined'],
      ),
      'confirmed',
      runtime,
    ).invoke({}, budget, costs);

    expect(result.outputs).toMatchObject({ left: { answer: 42 }, right: { skill: 'done' } });
    expect(result.result).toBe(42);
    expect(result.events.filter((event) => event.nodeId === 'joined')).toHaveLength(2);
  });

  it.each(['terminate', 'continue', 'goto'] as const)(
    'routes a node failure through the %s error-handler strategy',
    async (strategy) => {
      const runtime = ports({
        callMcpTool: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('offline'), { code: 'MCP_OFFLINE' })),
        decideExecutionError: vi.fn().mockResolvedValue({
          strategy,
          summary: `LLM selected ${strategy}.`,
        }),
      });
      const handler = {
        nodeId: 'handler',
        name: 'Handler',
        type: 'error_handler' as const,
        handledNodeId: 'mcp',
        strategy,
        ...(strategy === 'goto' ? { gotoNodeId: 'result' } : {}),
      };
      const result = await compileWorkflow(
        definition(
          [
            {
              nodeId: 'mcp',
              name: 'MCP',
              type: 'mcp_tool',
              tool: { serverId: 'server', toolName: 'fail' },
              arguments: {},
            },
            handler,
            ...(strategy === 'terminate'
              ? []
              : [
                  {
                    nodeId: 'result',
                    name: 'Result',
                    type: 'result' as const,
                    value: { op: 'literal' as const, value: 'recovered' },
                  },
                ]),
          ],
          strategy === 'terminate' ? [] : [{ sourceNodeId: 'handler', targetNodeId: 'result' }],
          'mcp',
          strategy === 'terminate' ? ['handler'] : ['result'],
        ),
        'confirmed',
        runtime,
      ).invoke({}, budget, costs);

      expect(result.errors).toEqual({ mcp: { code: 'MCP_OFFLINE', message: 'offline' } });
      expect(runtime.decideExecutionError).toHaveBeenCalledWith(
        expect.objectContaining({
          handledNodeId: 'mcp',
          error: { code: 'MCP_OFFLINE', message: 'offline' },
        }),
      );
      if (strategy === 'terminate') expect(result.status).toBe('failed');
      else expect(result).toMatchObject({ status: 'succeeded', result: 'recovered' });
    },
  );

  it('rejects ambiguous static routing instead of guessing execution order', () => {
    expect(() =>
      compileWorkflow(
        definition(
          [
            { nodeId: 'llm', name: 'LLM', type: 'llm', instruction: 'x', responseSchema: true },
            { nodeId: 'a', name: 'A', type: 'result', value: { op: 'literal', value: 'a' } },
            { nodeId: 'b', name: 'B', type: 'result', value: { op: 'literal', value: 'b' } },
          ],
          [
            { sourceNodeId: 'llm', targetNodeId: 'a' },
            { sourceNodeId: 'llm', targetNodeId: 'b' },
          ],
          'llm',
          ['a', 'b'],
        ),
        'confirmed',
        ports(),
      ),
    ).toThrow('ambiguous outgoing routes');
  });

  it('atomically enforces the LLM call budget across parallel branches', async () => {
    const executeLlm = vi.fn().mockResolvedValue({ answer: 1 });
    const runtime = ports({ executeLlm });
    const result = await compileWorkflow(
      definition(
        [
          {
            nodeId: 'parallel',
            name: 'Parallel',
            type: 'parallel',
            branchEntryNodeIds: ['left', 'right'],
          },
          { nodeId: 'left', name: 'Left', type: 'llm', instruction: 'left', responseSchema: true },
          {
            nodeId: 'right',
            name: 'Right',
            type: 'llm',
            instruction: 'right',
            responseSchema: true,
          },
        ],
        [],
        'parallel',
        ['left', 'right'],
      ),
      'confirmed',
      runtime,
    ).invoke({}, { ...budget, maxLlmCalls: 1 }, costs);

    expect(result).toMatchObject({
      status: 'failed',
      terminationReason: 'llm_calls_exhausted',
      budgetUsage: { llmCalls: 1, mcpCalls: 0, cost: 1 },
      errors: { budget: { code: 'WORKFLOW_LLM_CALL_BUDGET_EXHAUSTED' } },
    });
    expect(executeLlm).toHaveBeenCalledTimes(1);
  });

  it('does not call an external Tool when the cost reservation would exceed the budget', async () => {
    const callMcpTool = vi.fn().mockResolvedValue({ status: 'online' });
    const result = await compileWorkflow(
      definition(
        [
          {
            nodeId: 'tool',
            name: 'Tool',
            type: 'mcp_tool',
            tool: { serverId: 'server', toolName: 'read' },
            arguments: {},
          },
        ],
        [],
        'tool',
        ['tool'],
      ),
      'confirmed',
      ports({ callMcpTool }),
    ).invoke({}, { ...budget, maxCost: 0 }, costs);

    expect(result).toMatchObject({
      status: 'failed',
      terminationReason: 'cost_exhausted',
      budgetUsage: { mcpCalls: 0, cost: 0 },
    });
    expect(callMcpTool).not.toHaveBeenCalled();
  });

  it('terminates before a node begins after the duration deadline', async () => {
    const executeLlm = vi.fn().mockResolvedValue({ answer: 1 });
    let nowCall = 0;
    const result = await compileWorkflow(
      definition(
        [{ nodeId: 'llm', name: 'LLM', type: 'llm', instruction: 'x', responseSchema: true }],
        [],
        'llm',
        ['llm'],
      ),
      'confirmed',
      ports({ executeLlm, nowMilliseconds: () => (nowCall++ === 0 ? 0 : 1000) }),
    ).invoke({}, { ...budget, maxDurationSeconds: 1 }, costs);

    expect(result.terminationReason).toBe('duration_exhausted');
    expect(executeLlm).not.toHaveBeenCalled();
  });
});
