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
  it('pauses after the active node and resumes before starting the next node', async () => {
    let completeLlm: ((value: unknown) => void) | undefined;
    const executeLlm = vi.fn(
      () =>
        new Promise<unknown>((resolvePromise) => {
          completeLlm = resolvePromise;
        }),
    );
    const callMcpTool = vi.fn().mockResolvedValue({ done: true });
    const compiled = compileWorkflow(
      definition(
        [
          { nodeId: 'llm', name: 'LLM', type: 'llm', instruction: 'x', responseSchema: true },
          {
            nodeId: 'mcp',
            name: 'MCP',
            type: 'mcp_tool',
            tool: { serverId: 'server', toolName: 'write' },
            arguments: {},
          },
        ],
        [{ sourceNodeId: 'llm', targetNodeId: 'mcp' }],
        'llm',
        ['mcp'],
      ),
      'confirmed',
      ports({ executeLlm, callMcpTool }),
    );
    const executionContext = {
      mode: 'historical-replay' as const,
      simulationId: 'replay-paused-1',
    };
    const executing = compiled.invoke(
      {},
      budget,
      costs,
      undefined,
      'execution.pause',
      executionContext,
    );
    await vi.waitFor(() => {
      expect(executeLlm).toHaveBeenCalledTimes(1);
    });
    expect(compiled.requestPause('execution.pause')).toBe(true);
    completeLlm?.({ answer: 1 });
    await expect(executing).resolves.toMatchObject({
      status: 'paused',
      pendingConfirmation: { nodeId: 'mcp', kind: 'task_pause' },
    });
    expect(callMcpTool).not.toHaveBeenCalled();
    await expect(compiled.resume('execution.pause', true)).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(executeLlm).toHaveBeenCalledTimes(1);
    expect(callMcpTool).toHaveBeenCalledTimes(1);
    expect(callMcpTool).toHaveBeenCalledWith(expect.objectContaining({ executionContext }));
  });

  it('cancels after the active node without starting any subsequent node', async () => {
    let completeLlm: ((value: unknown) => void) | undefined;
    const executeLlm = vi.fn(
      () =>
        new Promise<unknown>((resolvePromise) => {
          completeLlm = resolvePromise;
        }),
    );
    const callMcpTool = vi.fn().mockResolvedValue({ done: true });
    const compiled = compileWorkflow(
      definition(
        [
          { nodeId: 'llm', name: 'LLM', type: 'llm', instruction: 'x', responseSchema: true },
          {
            nodeId: 'mcp',
            name: 'MCP',
            type: 'mcp_tool',
            tool: { serverId: 'server', toolName: 'write' },
            arguments: {},
          },
        ],
        [{ sourceNodeId: 'llm', targetNodeId: 'mcp' }],
        'llm',
        ['mcp'],
      ),
      'confirmed',
      ports({ executeLlm, callMcpTool }),
    );
    const executing = compiled.invoke({}, budget, costs, undefined, 'execution.cancel');
    await vi.waitFor(() => {
      expect(executeLlm).toHaveBeenCalledTimes(1);
    });
    expect(compiled.requestCancel('execution.cancel', false)).toBe(true);
    completeLlm?.({ answer: 1 });
    await expect(executing).resolves.toMatchObject({
      status: 'canceled',
      errors: { cancellation: { code: 'WORKFLOW_CANCELED' } },
    });
    expect(callMcpTool).not.toHaveBeenCalled();
  });

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
          input: { op: 'ref', path: ['input'] },
        },
        { nodeId: 'confirm', name: 'Confirm', type: 'human_confirmation', prompt: 'Continue?' },
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'ref', path: ['outputs', 'mcp', 'data', 'temperature'] },
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
    const executionContext = {
      mode: 'simulation' as const,
      simulationId: 'simulation-workflow-1',
    };
    const interrupted = await compiled.invoke(
      { request: 'weather' },
      budget,
      costs,
      undefined,
      'workflow.compiler',
      executionContext,
    );
    expect(interrupted).toMatchObject({
      status: 'paused',
      pendingConfirmation: { nodeId: 'confirm', prompt: 'Continue?' },
    });
    const result = await compiled.resume('workflow.compiler', true);

    expect(result.status).toBe('succeeded');
    expect(result.result).toBe(21);
    expect(result.outputs).toMatchObject({
      llm: { answer: 42 },
      mcp: expect.objectContaining({
        data: { temperature: 21 },
        errors: [],
        contextTruncated: false,
      }),
      skill: { skill: 'done' },
      child: { child: 'done' },
      confirm: true,
    });
    const succeededEvents = [...interrupted.events, ...result.events].filter(
      (event) => event.type === 'node_succeeded',
    );
    expect(succeededEvents).toHaveLength(6);
    expect(
      succeededEvents.every((event) => event.durationMs !== undefined && event.durationMs >= 0),
    ).toBe(true);
    expect(compiled.definition).not.toBe(source);
    expect(Object.isFrozen(compiled.definition)).toBe(true);
    expect(runtime.callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'workflow.compiler',
        tool: { serverId: 'weather', toolName: 'current' },
        arguments: { city: 'Shanghai' },
        signal: expect.any(AbortSignal),
        executionContext,
      }),
    );
    expect(runtime.callMcpTool).toHaveBeenCalledTimes(1);
    expect(runtime.executeSkill).toHaveBeenCalledWith(
      expect.objectContaining({ executionContext }),
    );
    expect(runtime.executeSubworkflow).toHaveBeenCalledWith(
      expect.objectContaining({ executionContext }),
    );
    expect(runtime.requestHumanConfirmation).not.toHaveBeenCalled();
  });

  it('binds initial and upstream data into immutable LLM, MCP, Skill and subworkflow snapshots', async () => {
    const originalArguments = {
      deviceId: { op: 'ref' as const, path: ['input', 'deviceId'] },
      target: { op: 'ref' as const, path: ['outputs', 'llm', 'target'] },
      samples: [3, { op: 'ref' as const, path: ['outputs', 'llm', 'samples', '1'] }],
    };
    const executeLlm = vi
      .fn()
      .mockResolvedValueOnce({ target: 21, samples: [5, 8] })
      .mockResolvedValueOnce({ summary: 'accepted' });
    const callMcpTool = vi.fn((input: Parameters<WorkflowRuntimePorts['callMcpTool']>[0]) => {
      expect(Object.isFrozen(input.arguments)).toBe(true);
      return Promise.resolve({ commandId: 'command-1' });
    });
    const executeSkill = vi.fn().mockResolvedValue({ commandId: 'command-1', accepted: true });
    const executeSubworkflow = vi.fn().mockResolvedValue({ verified: true });
    const runtime = ports({ executeLlm, callMcpTool, executeSkill, executeSubworkflow });
    const compiled = compileWorkflow(
      definition(
        [
          {
            nodeId: 'llm',
            name: 'Resolve target',
            type: 'llm',
            instruction: 'Resolve the target.',
            context: {
              request: { op: 'ref', path: ['input', 'request'] },
              nullable: null,
            },
            responseSchema: { type: 'object' },
          },
          {
            nodeId: 'mcp',
            name: 'Control',
            type: 'mcp_tool',
            tool: { serverId: 'devices', toolName: 'control' },
            arguments: originalArguments,
          },
          {
            nodeId: 'skill',
            name: 'Verify Skill',
            type: 'skill_call',
            skillId: 'verify',
            input: {
              commandId: { op: 'ref', path: ['outputs', 'mcp', 'data', 'commandId'] },
            },
          },
          {
            nodeId: 'summary',
            name: 'Summarize execution',
            type: 'llm',
            instruction: 'Summarize the execution.',
            context: {
              commandId: { op: 'ref', path: ['nodes', 'mcp', 'data', 'commandId'] },
              accepted: { op: 'ref', path: ['nodes', 'skill', 'accepted'] },
            },
            responseSchema: { type: 'object' },
          },
          {
            nodeId: 'child',
            name: 'Child',
            type: 'subworkflow',
            workflowDefinitionId: 'workflow.child',
            workflowVersion: 1,
            input: { op: 'ref', path: ['nodes', 'skill'] },
          },
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'ref', path: ['outputs', 'child', 'verified'] },
          },
        ],
        [
          { sourceNodeId: 'llm', targetNodeId: 'mcp' },
          { sourceNodeId: 'mcp', targetNodeId: 'skill' },
          { sourceNodeId: 'skill', targetNodeId: 'summary' },
          { sourceNodeId: 'summary', targetNodeId: 'child' },
          { sourceNodeId: 'child', targetNodeId: 'result' },
        ],
        'llm',
        ['result'],
      ),
      'confirmed',
      runtime,
    );

    await expect(
      compiled.invoke({ deviceId: 'device-1', request: 'set temperature' }, budget, costs),
    ).resolves.toMatchObject({ status: 'succeeded', result: true });
    expect(executeLlm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        instruction: 'Resolve the target.',
        context: { request: 'set temperature', nullable: null },
      }),
    );
    expect(executeLlm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        instruction: 'Summarize the execution.',
        context: { commandId: 'command-1', accepted: true },
      }),
    );
    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: { deviceId: 'device-1', target: 21, samples: [3, 8] },
      }),
    );
    expect(executeSkill).toHaveBeenCalledWith(
      expect.objectContaining({ input: { commandId: 'command-1' } }),
    );
    expect(executeSubworkflow).toHaveBeenCalledWith(
      expect.objectContaining({ input: { commandId: 'command-1', accepted: true } }),
    );
    expect(originalArguments).toEqual({
      deviceId: { op: 'ref', path: ['input', 'deviceId'] },
      target: { op: 'ref', path: ['outputs', 'llm', 'target'] },
      samples: [3, { op: 'ref', path: ['outputs', 'llm', 'samples', '1'] }],
    });
  });

  it('binds merged parallel outputs before invoking the convergence node', async () => {
    const callMcpTool = vi.fn().mockResolvedValue({ joined: true });
    const runtime = ports({ callMcpTool });
    await compileWorkflow(
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
            nodeId: 'join',
            name: 'Join',
            type: 'mcp_tool',
            tool: { serverId: 'join', toolName: 'combine' },
            arguments: {
              left: { op: 'ref', path: ['outputs', 'left', 'answer'] },
              right: { op: 'ref', path: ['outputs', 'right', 'skill'] },
            },
          },
        ],
        [
          { sourceNodeId: 'left', targetNodeId: 'join' },
          { sourceNodeId: 'right', targetNodeId: 'join' },
        ],
        'parallel',
        ['join'],
      ),
      'confirmed',
      runtime,
    ).invoke({}, budget, costs);

    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({ arguments: { left: 42, right: 'done' } }),
    );
  });

  it('resolves the current loop count for every repeated body invocation', async () => {
    const iterations: number[] = [];
    const callMcpTool = vi.fn((input: Parameters<WorkflowRuntimePorts['callMcpTool']>[0]) => {
      iterations.push((input.arguments as { iteration: number }).iteration);
      return Promise.resolve({ ok: true });
    });
    await compileWorkflow(
      definition(
        [
          {
            nodeId: 'loop',
            name: 'Loop',
            type: 'loop',
            condition: { op: 'literal', value: true },
            bodyEntryNodeId: 'body',
            maxIterations: 3,
          },
          {
            nodeId: 'body',
            name: 'Body',
            type: 'mcp_tool',
            tool: { serverId: 'loop', toolName: 'step' },
            arguments: { iteration: { op: 'ref', path: ['loopCounts', 'loop'] } },
          },
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'ref', path: ['loopCounts', 'loop'] },
          },
        ],
        [
          { sourceNodeId: 'loop', targetNodeId: 'result', outcome: 'done' },
          { sourceNodeId: 'body', targetNodeId: 'loop' },
        ],
        'loop',
        ['result'],
      ),
      'confirmed',
      ports({ callMcpTool }),
    ).invoke({}, budget, costs);

    expect(iterations).toEqual([1, 2, 3]);
  });

  it('surfaces runtime Schema rejection after dynamic MCP argument resolution', async () => {
    const schemaError = Object.assign(new Error('Resolved MCP input failed current schema.'), {
      code: 'MCP_ARGUMENT_SCHEMA_MISMATCH',
    });
    const compiled = compileWorkflow(
      definition(
        [
          {
            nodeId: 'mcp',
            name: 'MCP',
            type: 'mcp_tool',
            tool: { serverId: 'devices', toolName: 'query' },
            arguments: { deviceId: { op: 'ref', path: ['input', 'deviceId'] } },
          },
        ],
        [],
        'mcp',
        ['mcp'],
      ),
      'confirmed',
      ports({ callMcpTool: vi.fn().mockRejectedValue(schemaError) }),
    );

    await expect(compiled.invoke({ deviceId: 42 }, budget, costs)).rejects.toMatchObject({
      code: 'MCP_ARGUMENT_SCHEMA_MISMATCH',
    });
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

  it.each([
    ['retry', 'mcp'],
    ['change_arguments', 'changed'],
    ['alternative_tool', 'alternative'],
    ['invoke_skill', 'skill'],
  ] as const)(
    'executes the bounded %s recovery selected by the LLM',
    async (action, targetNodeId) => {
      const callMcpTool = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'MCP_OFFLINE' }))
        .mockResolvedValue({ recovered: true });
      const executeSkill = vi.fn().mockResolvedValue({ recovered: true });
      const decideExecutionError = vi.fn().mockResolvedValue({
        strategy: 'goto',
        summary: `Use ${action}.`,
        recoveryAction: action,
        targetNodeId,
      });
      const runtime = ports({ callMcpTool, executeSkill, decideExecutionError });
      const result = await compileWorkflow(
        recoveryDefinition({ action, targetNodeId, maxAttempts: 1 }),
        'confirmed',
        runtime,
      ).invoke({}, budget, costs);

      expect(result.status).toBe('succeeded');
      expect(result.recoveryCounts).toEqual({ [`handler:${action}:${targetNodeId}`]: 1 });
      expect(decideExecutionError).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedStrategies: ['terminate', 'goto'],
          allowedRecoveryOptions: [
            expect.objectContaining({ action, targetNodeId, maxAttempts: 1 }),
          ],
        }),
      );
      if (action === 'invoke_skill') expect(executeSkill).toHaveBeenCalledTimes(1);
      else expect(callMcpTool).toHaveBeenCalledTimes(2);
    },
  );

  it('removes an exhausted recovery from the LLM choices and terminates without an unbounded retry', async () => {
    const callMcpTool = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('offline'), { code: 'MCP_OFFLINE' }));
    const decideExecutionError = vi
      .fn()
      .mockResolvedValueOnce({
        strategy: 'goto',
        summary: 'Retry once.',
        recoveryAction: 'retry',
        targetNodeId: 'mcp',
      })
      .mockResolvedValueOnce({ strategy: 'terminate', summary: 'Retry budget exhausted.' });
    const result = await compileWorkflow(
      recoveryDefinition({ action: 'retry', targetNodeId: 'mcp', maxAttempts: 1 }),
      'confirmed',
      ports({ callMcpTool, decideExecutionError }),
    ).invoke({}, budget, costs);

    expect(result).toMatchObject({
      status: 'failed',
      recoveryCounts: { 'handler:retry:mcp': 1 },
    });
    expect(callMcpTool).toHaveBeenCalledTimes(2);
    expect(decideExecutionError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ allowedStrategies: ['terminate'], allowedRecoveryOptions: [] }),
    );
  });

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

function recoveryDefinition(option: {
  readonly action: 'retry' | 'change_arguments' | 'alternative_tool' | 'invoke_skill';
  readonly targetNodeId: string;
  readonly maxAttempts: number;
}): WorkflowDefinition {
  return definition(
    [
      {
        nodeId: 'mcp',
        name: 'Primary Tool',
        type: 'mcp_tool',
        tool: { serverId: 'server', toolName: 'primary' },
        arguments: { mode: 'original' },
      },
      {
        nodeId: 'handler',
        name: 'Bounded recovery',
        type: 'error_handler',
        handledNodeId: 'mcp',
        strategy: 'goto',
        recoveryOptions: [{ ...option, description: `Use ${option.action}.` }],
      },
      ...(option.targetNodeId === 'changed'
        ? [
            {
              nodeId: 'changed',
              name: 'Changed arguments',
              type: 'mcp_tool' as const,
              tool: { serverId: 'server', toolName: 'primary' },
              arguments: { mode: 'fallback' },
            },
          ]
        : []),
      ...(option.targetNodeId === 'alternative'
        ? [
            {
              nodeId: 'alternative',
              name: 'Alternative Tool',
              type: 'mcp_tool' as const,
              tool: { serverId: 'server', toolName: 'secondary' },
              arguments: { mode: 'fallback' },
            },
          ]
        : []),
      ...(option.targetNodeId === 'skill'
        ? [
            {
              nodeId: 'skill',
              name: 'Recovery Skill',
              type: 'skill_call' as const,
              skillId: 'skill.recovery',
              input: { reason: 'tool-failure' },
            },
          ]
        : []),
      {
        nodeId: 'result',
        name: 'Result',
        type: 'result',
        value: { op: 'literal', value: 'recovered' },
      },
    ],
    [
      { sourceNodeId: 'mcp', targetNodeId: 'result' },
      ...(option.targetNodeId === 'mcp'
        ? []
        : [{ sourceNodeId: option.targetNodeId, targetNodeId: 'result' }]),
    ],
    'mcp',
    ['result'],
  );
}
