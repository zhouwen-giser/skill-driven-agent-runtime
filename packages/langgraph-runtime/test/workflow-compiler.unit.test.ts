import { LangGraphWorkflowExecutor } from '../src/workflow-executor-adapter.js';
import { describe, expect, it, vi } from 'vitest';

import type {
  WorkflowContinuationSnapshot,
  WorkflowDefinition,
  WorkflowMcpCallOutcome,
} from '../../domain/src/index.js';
import type { WorkflowExternalWaitSnapshotPreparer } from '../../application/src/ports.js';
import { compileWorkflow, type WorkflowRuntimePorts } from '../src/workflow-compiler.js';

function ports(overrides: Partial<WorkflowRuntimePorts> = {}): WorkflowRuntimePorts {
  let tick = 0;
  return {
    executeLlm: vi.fn().mockResolvedValue({ answer: 42 }),
    callMcpTool: vi.fn().mockResolvedValue(immediate({ temperature: 21 })),
    executeSkill: vi.fn().mockResolvedValue({
      status: 'completed',
      output: { skill: 'done' },
    }),
    executeSubworkflow: vi
      .fn()
      .mockResolvedValue({ status: 'completed', output: { child: 'done' } }),
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

function immediate(value: Readonly<Record<string, unknown>>): WorkflowMcpCallOutcome {
  return { kind: 'immediate', result: { ...value, content: [], isError: false } };
}

function externalWait(
  executionId: string,
  nodeId: string,
  sourceId = `binding-${nodeId}`,
): WorkflowMcpCallOutcome {
  const nodeRunId = `${executionId}~${encodeURIComponent(nodeId)}~1`;
  return {
    kind: 'waiting_external',
    wait: {
      waitId: `wait-${sourceId}`,
      kind: 'remote_task',
      sourceId,
      nodeId,
      nodeRunId,
      state: 'waiting',
    },
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
  it('preserves a child deadline across human pause and disposes its timers after resume', async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const runtime = ports({
        nowMilliseconds: () => Date.now(),
        executeSubworkflow: (request) => {
          if (request.signal !== undefined) signals.push(request.signal);
          return Promise.resolve(
            request.resumeChild === true
              ? { status: 'completed', output: true }
              : { status: 'paused', childInstanceId: 'child', prompt: 'Review' },
          );
        },
      });
      const graph = definition(
        [
          {
            nodeId: 'child',
            name: 'Child',
            type: 'subworkflow',
            workflowDefinitionId: 'child',
            workflowVersion: 1,
            input: {},
          },
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        [{ sourceNodeId: 'child', targetNodeId: 'result' }],
        'child',
        ['result'],
      );
      const executor = new LangGraphWorkflowExecutor(runtime, costs);
      expect(
        (
          await executor.execute(
            graph,
            {},
            { ...budget, maxDurationSeconds: 1 },
            undefined,
            'deadline-parent',
          )
        ).status,
      ).toBe('paused');
      await vi.advanceTimersByTimeAsync(2000);
      expect(signals.every((signal) => !signal.aborted)).toBe(true);
      expect(await executor.resumeHumanConfirmation('deadline-parent', true)).toMatchObject({
        status: 'succeeded',
        budgetUsage: { cost: 1, durationMs: 0 },
      });
      expect(signals.every((signal) => !signal.aborted)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('joins nested scoped forks once at each level', async () => {
    const runtime = ports({ nowMilliseconds: () => 0 });
    const graph: WorkflowDefinition = {
      ...definition(
        [
          {
            nodeId: 'outer',
            name: 'Outer',
            type: 'parallel',
            branchEntryNodeIds: ['inner', 'right'],
            joinNodeId: 'result',
            mergeStrategy: 'reject_conflicts',
          },
          {
            nodeId: 'inner',
            name: 'Inner',
            type: 'parallel',
            branchEntryNodeIds: ['a', 'b'],
            joinNodeId: 'innerJoin',
            mergeStrategy: 'reject_conflicts',
          },
          ...['a', 'b', 'right', 'innerJoin'].map((nodeId) => ({
            nodeId,
            name: nodeId,
            type: 'llm' as const,
            instruction: nodeId,
            responseSchema: { type: 'object' },
          })),
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        [
          { sourceNodeId: 'a', targetNodeId: 'innerJoin' },
          { sourceNodeId: 'b', targetNodeId: 'innerJoin' },
          { sourceNodeId: 'innerJoin', targetNodeId: 'result' },
          { sourceNodeId: 'right', targetNodeId: 'result' },
        ],
        'outer',
        ['result'],
      ),
      executionSemanticsVersion: '2.0',
    };
    const result = await compileWorkflow(graph, 'confirmed', runtime).invoke({}, budget, costs);
    expect(result.status).toBe('succeeded');
    expect(runtime.executeLlm).toHaveBeenCalledTimes(4);
    for (const nodeId of ['innerJoin', 'result'])
      expect(
        result.events.filter((event) => event.nodeId === nodeId && event.type === 'node_succeeded'),
      ).toHaveLength(1);
  });

  it.each(['1.0', '2.0'] as const)(
    'retains the actual continuation graph through two confirmations (%s)',
    async (executionSemanticsVersion) => {
      const executionId = `session-${executionSemanticsVersion}`;
      const runtime = ports({
        callMcpTool: vi.fn().mockResolvedValue(externalWait(executionId, 'remote')),
        nowMilliseconds: () => 0,
      });
      const graph: WorkflowDefinition = {
        ...definition(
          [
            {
              nodeId: 'remote',
              name: 'Remote',
              type: 'mcp_tool',
              tool: { serverId: 'test', toolName: 'remote' },
              arguments: {},
            },
            { nodeId: 'confirm1', name: 'Confirm 1', type: 'human_confirmation', prompt: 'First?' },
            {
              nodeId: 'confirm2',
              name: 'Confirm 2',
              type: 'human_confirmation',
              prompt: 'Second?',
            },
            {
              nodeId: 'result',
              name: 'Result',
              type: 'result',
              value: { op: 'ref', path: ['outputs', 'remote'] },
            },
            {
              nodeId: 'rejected',
              name: 'Rejected',
              type: 'result',
              value: { op: 'literal', value: false },
            },
          ],
          [
            { sourceNodeId: 'remote', targetNodeId: 'confirm1' },
            { sourceNodeId: 'confirm1', targetNodeId: 'confirm2', outcome: 'success' },
            { sourceNodeId: 'confirm1', targetNodeId: 'rejected', outcome: 'failure' },
            { sourceNodeId: 'confirm2', targetNodeId: 'result', outcome: 'success' },
            { sourceNodeId: 'confirm2', targetNodeId: 'rejected', outcome: 'failure' },
          ],
          'remote',
          ['result', 'rejected'],
        ),
        executionSemanticsVersion,
      };
      const executor = new LangGraphWorkflowExecutor(runtime, costs);
      const waiting = await executor.execute(graph, {}, budget, undefined, executionId);
      expect(waiting.status).toBe('waiting_external');
      if (waiting.continuation === undefined) throw new Error('Expected continuation');
      const wait = waiting.continuation.waitingNodeRuns[0];
      if (wait === undefined) throw new Error('Expected wait');
      const resumed = await executor.continueExternal(
        graph,
        executionId,
        waiting.continuation,
        {
          kind: 'completed',
          waitId: wait.waitId,
          nodeRunId: wait.nodeRunId,
          result: { answer: 42, content: [], isError: false },
        },
        'continuation-thread-1',
      );
      expect(resumed.status).toBe('paused');
      expect(resumed.pendingConfirmation?.nodeId).toBe('confirm1');
      const second = await executor.resumeHumanConfirmation(executionId, true);
      expect(second.status).toBe('paused');
      expect(second.pendingConfirmation?.nodeId).toBe('confirm2');
      const done = await executor.resumeHumanConfirmation(executionId, true);
      expect(done.status).toBe('succeeded');
      expect(done.result).toMatchObject({ data: { answer: 42 } });
      expect(runtime.callMcpTool).toHaveBeenCalledTimes(1);
      expect(done.budgetUsage.mcpCalls).toBe(1);
      expect(executor.requestPause(executionId)).toBe(false);
    },
  );

  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ] as const)('restores scoped remote forks in %s/%s order', async (first, second) => {
    const executionId = 'scoped-remote';
    const runtime = ports({
      callMcpTool: vi.fn((input: Parameters<WorkflowRuntimePorts['callMcpTool']>[0]) =>
        Promise.resolve(externalWait(executionId, input.workflowNodeId)),
      ),
      nowMilliseconds: () => 0,
    });
    const graph: WorkflowDefinition = {
      ...definition(
        [
          {
            nodeId: 'fork',
            name: 'Fork',
            type: 'parallel',
            branchEntryNodeIds: ['a', 'b'],
            joinNodeId: 'result',
            mergeStrategy: 'reject_conflicts',
          },
          ...['a', 'b'].map((nodeId) => ({
            nodeId,
            name: nodeId,
            type: 'mcp_tool' as const,
            tool: { serverId: 'test', toolName: nodeId },
            arguments: {},
          })),
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        [
          { sourceNodeId: 'a', targetNodeId: 'result' },
          { sourceNodeId: 'b', targetNodeId: 'result' },
        ],
        'fork',
        ['result'],
      ),
      executionSemanticsVersion: '2.0',
    };
    let result = await compileWorkflow(graph, 'confirmed', runtime).invoke(
      {},
      budget,
      costs,
      undefined,
      executionId,
    );
    for (const nodeId of [first, second]) {
      expect(result.status).toBe('waiting_external');
      const continuation = result.continuation;
      const wait = continuation?.waitingNodeRuns.find((item) => item.nodeId === nodeId);
      if (continuation === undefined || wait === undefined)
        throw new Error('Expected durable wait');
      result = await compileWorkflow(graph, 'confirmed', runtime).continueExternal(
        executionId,
        continuation,
        {
          kind: 'completed',
          waitId: wait.waitId,
          nodeRunId: wait.nodeRunId,
          result: { content: [], isError: false },
        },
        costs,
      );
    }
    expect(result.status).toBe('succeeded');
    expect(
      result.events.filter((event) => event.nodeId === 'result' && event.type === 'node_succeeded'),
    ).toHaveLength(1);
    expect(runtime.callMcpTool).toHaveBeenCalledTimes(2);
    expect(result.budgetUsage.mcpCalls).toBe(2);
  });

  it.each([true, false])(
    'executes scoped conditional forks and 3x2 loops exactly once per activation (%s)',
    async (chooseLeft) => {
      const runtime = ports({ nowMilliseconds: () => 0 });
      const node = (nodeId: string): WorkflowDefinition['nodes'][number] => ({
        nodeId,
        name: nodeId,
        type: 'mcp_tool',
        tool: { serverId: 'test', toolName: nodeId },
        arguments: {},
      });
      const loop = (
        nodeId: string,
        bodyEntryNodeId: string,
        maxIterations: number,
      ): WorkflowDefinition['nodes'][number] => ({
        nodeId,
        name: nodeId,
        type: 'loop',
        condition: { op: 'literal', value: true },
        bodyEntryNodeId,
        maxIterations,
      });
      const graph: WorkflowDefinition = {
        ...definition(
          [
            loop('outer', 'fork', 3),
            {
              nodeId: 'fork',
              name: 'Fork',
              type: 'parallel',
              branchEntryNodeIds: ['choose', 'inner'],
              joinNodeId: 'after',
              mergeStrategy: 'reject_conflicts',
            },
            {
              nodeId: 'choose',
              name: 'Choose',
              type: 'condition',
              expression: { op: 'literal', value: chooseLeft },
            },
            node('leftTrue'),
            node('leftFalse'),
            loop('inner', 'right', 2),
            node('right'),
            node('after'),
            {
              nodeId: 'result',
              name: 'Result',
              type: 'result',
              value: { op: 'literal', value: 'complete' },
            },
          ],
          [
            { sourceNodeId: 'outer', targetNodeId: 'result', outcome: 'done' },
            { sourceNodeId: 'choose', targetNodeId: 'leftTrue', outcome: 'true' },
            { sourceNodeId: 'choose', targetNodeId: 'leftFalse', outcome: 'false' },
            { sourceNodeId: 'leftTrue', targetNodeId: 'after' },
            { sourceNodeId: 'leftFalse', targetNodeId: 'after' },
            { sourceNodeId: 'inner', targetNodeId: 'after', outcome: 'done' },
            { sourceNodeId: 'right', targetNodeId: 'inner' },
            { sourceNodeId: 'after', targetNodeId: 'outer' },
          ],
          'outer',
          ['result'],
        ),
        executionSemanticsVersion: '2.0',
      };
      const result = await compileWorkflow(graph, 'confirmed', runtime).invoke({}, budget, costs);
      expect(result.status).toBe('succeeded');
      expect(result.result).toBe('complete');
      expect(result.loopCounts).toEqual({ outer: 3, inner: 2 });
      for (const [id, count] of [
        [chooseLeft ? 'leftTrue' : 'leftFalse', 3],
        ['right', 6],
        ['after', 3],
        ['fork', 3],
        ['inner', 9],
      ] as const)
        expect(
          result.events.filter((event) => event.nodeId === id && event.type === 'node_succeeded'),
        ).toHaveLength(count);
      expect(
        result.events.some((event) => event.nodeId === (chooseLeft ? 'leftFalse' : 'leftTrue')),
      ).toBe(false);
      expect(runtime.callMcpTool).toHaveBeenCalledTimes(12);
      expect(result.budgetUsage.mcpCalls).toBe(12);
    },
  );

  it('rejects scoped crossed branches before any Tool call', () => {
    const runtime = ports();
    const graph: WorkflowDefinition = {
      ...definition(
        [
          {
            nodeId: 'fork',
            name: 'Fork',
            type: 'parallel',
            branchEntryNodeIds: ['a', 'b'],
            joinNodeId: 'result',
            mergeStrategy: 'reject_conflicts',
          },
          ...['a', 'b'].map((nodeId) => ({
            nodeId,
            name: nodeId,
            type: 'llm' as const,
            instruction: 'Run',
            responseSchema: {},
          })),
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        [
          { sourceNodeId: 'a', targetNodeId: 'b' },
          { sourceNodeId: 'b', targetNodeId: 'result' },
        ],
        'fork',
        ['result'],
      ),
      executionSemanticsVersion: '2.0',
    };
    expect(() => compileWorkflow(graph, 'confirmed', runtime)).toThrow(/branch/i);
    expect(runtime.callMcpTool).not.toHaveBeenCalled();
    expect(runtime.executeLlm).not.toHaveBeenCalled();
  });

  it.each(['initial', 'human_resume', 'external_continuation'] as const)(
    'preserves long-loop execution and call budgets after %s entry',
    async (entry) => {
      const runtime = ports({ nowMilliseconds: () => 0 });
      const nodes: WorkflowDefinition['nodes'] = [
        ...(entry === 'human_resume'
          ? [
              {
                nodeId: 'confirm',
                name: 'Confirm',
                type: 'human_confirmation' as const,
                prompt: 'Proceed?',
              },
            ]
          : []),
        ...(entry === 'external_continuation'
          ? [
              {
                nodeId: 'remote',
                name: 'Remote',
                type: 'mcp_tool' as const,
                tool: { serverId: 'test', toolName: 'remote' },
                arguments: {},
              },
            ]
          : []),
        {
          nodeId: 'loop',
          name: 'Loop',
          type: 'loop',
          condition: { op: 'literal', value: true },
          bodyEntryNodeId: 'body',
          maxIterations: 100,
        },
        {
          nodeId: 'body',
          name: 'Body',
          type: 'mcp_tool',
          tool: { serverId: 'test', toolName: 'step' },
          arguments: {},
        },
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'ref', path: ['loopCounts', 'loop'] },
        },
      ];
      const start =
        entry === 'human_resume'
          ? 'confirm'
          : entry === 'external_continuation'
            ? 'remote'
            : 'loop';
      const source = definition(
        nodes,
        [
          ...(start === 'confirm'
            ? [
                { sourceNodeId: start, targetNodeId: 'loop', outcome: 'success' as const },
                { sourceNodeId: start, targetNodeId: 'result', outcome: 'failure' as const },
              ]
            : start === 'loop'
              ? []
              : [{ sourceNodeId: start, targetNodeId: 'loop' }]),
          { sourceNodeId: 'loop', targetNodeId: 'result', outcome: 'done' },
          { sourceNodeId: 'body', targetNodeId: 'loop' },
        ],
        start,
        ['result'],
      );
      const callMcpTool = vi.fn<WorkflowRuntimePorts['callMcpTool']>((input) =>
        Promise.resolve(
          input.workflowNodeId === 'remote'
            ? externalWait('execution.long-entry', 'remote')
            : immediate({ ok: true }),
        ),
      );
      const compiled = compileWorkflow(source, 'confirmed', { ...runtime, callMcpTool });
      const limitedBudget = { ...budget, maxMcpCalls: 31 };
      let result = await compiled.invoke(
        {},
        limitedBudget,
        costs,
        undefined,
        'execution.long-entry',
      );
      if (entry === 'human_resume') {
        expect(result.status).toBe('paused');
        result = await compiled.resume('execution.long-entry', true);
      }
      if (entry === 'external_continuation') {
        expect(result.status).toBe('waiting_external');
        if (result.continuation === undefined) throw new Error('TEST_CONTINUATION_REQUIRED');
        result = await compiled.continueExternal(
          'execution.long-entry',
          result.continuation,
          {
            kind: 'completed',
            waitId: 'wait-binding-remote',
            nodeRunId: 'execution.long-entry~remote~1',
            result: { content: [], isError: false },
          },
          costs,
        );
      }
      expect(result.status).toBe('failed');
      expect(result.terminationReason).toBe('mcp_calls_exhausted');
      expect(callMcpTool).toHaveBeenCalledTimes(31);
    },
  );

  it('rejects an oversized bound before any call and accepts an explicit larger ceiling', async () => {
    const source = definition(
      [
        {
          nodeId: 'loop',
          name: 'Loop',
          type: 'loop',
          condition: { op: 'literal', value: false },
          bodyEntryNodeId: 'body',
          maxIterations: 100,
        },
        {
          nodeId: 'body',
          name: 'Body',
          type: 'llm',
          instruction: 'Body',
          responseSchema: { type: 'object' },
        },
        { nodeId: 'result', name: 'Result', type: 'result', value: { op: 'literal', value: true } },
      ],
      [
        { sourceNodeId: 'loop', targetNodeId: 'result', outcome: 'done' },
        { sourceNodeId: 'body', targetNodeId: 'loop' },
      ],
      'loop',
      ['result'],
    );
    const runtime = ports();
    expect(() => compileWorkflow(source, 'confirmed', runtime, { maxSupersteps: 500 })).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_COMPLEXITY_LIMIT_EXCEEDED' }),
    );
    expect(runtime.executeLlm).not.toHaveBeenCalled();
    expect(
      (
        await compileWorkflow(source, 'confirmed', runtime, { maxSupersteps: 505 }).invoke(
          {},
          budget,
          costs,
        )
      ).status,
    ).toBe('succeeded');
  });

  it.each([
    [30, '1.0'],
    [100, '1.0'],
    [30, '2.0'],
    [100, '2.0'],
  ] as const)(
    'executes all %i authorized loop iterations (%s)',
    async (maxIterations, executionSemanticsVersion) => {
      const callMcpTool = vi.fn<WorkflowRuntimePorts['callMcpTool']>(() =>
        Promise.resolve(immediate({ done: true })),
      );
      const result = await compileWorkflow(
        {
          ...definition(
            [
              {
                nodeId: 'loop',
                name: 'Loop',
                type: 'loop',
                condition: { op: 'literal', value: true },
                bodyEntryNodeId: 'body',
                maxIterations,
              },
              {
                nodeId: 'body',
                name: 'Body',
                type: 'mcp_tool',
                tool: { serverId: 'test', toolName: 'step' },
                arguments: {},
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
          executionSemanticsVersion,
        },
        'confirmed',
        ports({ callMcpTool, nowMilliseconds: () => 0 }),
      ).invoke({}, { ...budget, maxMcpCalls: 100, maxCost: 100 }, costs);
      expect(result.status).toBe('succeeded');
      expect(result.result).toBe(maxIterations);
      expect(callMcpTool).toHaveBeenCalledTimes(maxIterations);
    },
  );

  it.each(['1.0', '2.0'] as const)(
    'runs a legal serial graph longer than the engine default recursion limit (%s)',
    async (executionSemanticsVersion) => {
      const nodes: WorkflowDefinition['nodes'] = Array.from({ length: 30 }, (_, index) => ({
        nodeId: `step-${String(index)}`,
        name: 'Step',
        type: 'llm',
        instruction: 'Read',
        responseSchema: { type: 'object' },
      }));
      const executeLlm = vi.fn<WorkflowRuntimePorts['executeLlm']>(() =>
        Promise.resolve({ ok: true }),
      );
      const result = await compileWorkflow(
        {
          ...definition(
            nodes,
            nodes.slice(1).map((node, index) => ({
              sourceNodeId: `step-${String(index)}`,
              targetNodeId: node.nodeId,
            })),
            'step-0',
            ['step-29'],
          ),
          executionSemanticsVersion,
        },
        'confirmed',
        ports({ executeLlm, nowMilliseconds: () => 0 }),
      ).invoke({}, { ...budget, maxLlmCalls: 30 }, costs);
      expect(result.status).toBe('succeeded');
      expect(executeLlm).toHaveBeenCalledTimes(30);
      expect(result.outputs['step-29']).toEqual({ ok: true });
    },
  );

  it.each([
    ['fail_fast', 'terminate', 'continue'],
    ['recoverable', 'goto', 'continue'],
    ['optional', 'continue', 'goto'],
    ['degraded', 'continue', 'goto'],
  ] as const)(
    'enforces the %s Skill failure policy against an unauthorized model decision',
    async (skillFailurePolicy, strategy, modelStrategy) => {
      const executeSkill = vi.fn<WorkflowRuntimePorts['executeSkill']>(() =>
        Promise.reject(new Error('CHILD_FAILED')),
      );
      const decideExecutionError = vi.fn<WorkflowRuntimePorts['decideExecutionError']>(() =>
        Promise.resolve({ strategy: modelStrategy, summary: 'Override policy' }),
      );
      const executeLlm = vi.fn<WorkflowRuntimePorts['executeLlm']>(() =>
        Promise.resolve({ ok: true }),
      );
      const compiled = compileWorkflow(
        definition(
          [
            {
              nodeId: 'child',
              name: 'Child',
              type: 'skill_call',
              skillId: 'skill.child',
              input: {},
            },
            {
              nodeId: 'handler',
              name: 'Handler',
              type: 'error_handler',
              handledNodeId: 'child',
              strategy,
              skillFailurePolicy,
              ...(strategy === 'goto' ? { gotoNodeId: 'after' } : {}),
            },
            {
              nodeId: 'after',
              name: 'After',
              type: 'llm',
              instruction: 'Continue',
              responseSchema: { type: 'object' },
            },
          ],
          [
            { sourceNodeId: 'child', targetNodeId: 'after' },
            { sourceNodeId: 'handler', targetNodeId: 'after' },
          ],
          'child',
          ['after'],
        ),
        'confirmed',
        ports({ executeSkill, decideExecutionError, executeLlm }),
      );
      await expect(compiled.invoke({}, budget, costs)).rejects.toMatchObject({
        code: 'WORKFLOW_ERROR_DECISION_INVALID',
      });
      expect(executeLlm).not.toHaveBeenCalled();
      expect(decideExecutionError.mock.calls[0]?.[0].allowedStrategies).not.toContain(
        modelStrategy,
      );
    },
  );

  it('exposes an exact single external-wait capsule before returning the Provider receipt', async () => {
    const prepareExternalWait = vi.fn<WorkflowExternalWaitSnapshotPreparer>((preparation) =>
      Promise.resolve({
        snapshot: {} as WorkflowContinuationSnapshot,
        completeness: preparation.completeness,
      }),
    );
    const callMcpTool = vi.fn(async (input: Parameters<WorkflowRuntimePorts['callMcpTool']>[0]) => {
      const outcome = externalWait('execution.prepared-single', 'remote');
      if (outcome.kind !== 'waiting_external') throw new Error('TEST_WAIT_REQUIRED');
      await input.prepareExternalWait(outcome.wait);
      return outcome;
    });

    const result = await compileWorkflow(
      definition(
        [
          {
            nodeId: 'remote',
            name: 'Remote',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'long_running' },
            arguments: {},
          },
        ],
        [],
        'remote',
        ['remote'],
      ),
      'confirmed',
      ports({ callMcpTool }),
    ).invoke(
      {},
      budget,
      costs,
      undefined,
      'execution.prepared-single',
      undefined,
      prepareExternalWait,
    );

    expect(result.status).toBe('waiting_external');
    expect(prepareExternalWait).toHaveBeenCalledOnce();
    expect(prepareExternalWait).toHaveBeenCalledWith(
      expect.objectContaining({
        completeness: 'exact_single',
        continuation: expect.objectContaining({
          waitingNodeRuns: [expect.objectContaining({ nodeId: 'remote' })],
          nodeRunCounts: { remote: 1 },
        }),
      }),
    );
  });

  it('marks parallel receipt capsules partial and emits one exact final graph snapshot', async () => {
    const prepareExternalWait = vi.fn<WorkflowExternalWaitSnapshotPreparer>((preparation) =>
      Promise.resolve({
        snapshot: {} as WorkflowContinuationSnapshot,
        completeness: preparation.completeness,
      }),
    );
    const callMcpTool = vi.fn(async (input: Parameters<WorkflowRuntimePorts['callMcpTool']>[0]) => {
      const outcome = externalWait('execution.prepared-parallel', input.workflowNodeId);
      if (outcome.kind !== 'waiting_external') throw new Error('TEST_WAIT_REQUIRED');
      await input.prepareExternalWait(outcome.wait);
      return outcome;
    });
    const result = await compileWorkflow(
      definition(
        [
          {
            nodeId: 'parallel',
            name: 'Parallel',
            type: 'parallel',
            branchEntryNodeIds: ['remote-a', 'remote-b'],
          },
          {
            nodeId: 'remote-a',
            name: 'Remote A',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'long_running' },
            arguments: {},
          },
          {
            nodeId: 'remote-b',
            name: 'Remote B',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'long_running' },
            arguments: {},
          },
          {
            nodeId: 'join',
            name: 'Join',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        [
          { sourceNodeId: 'remote-a', targetNodeId: 'join' },
          { sourceNodeId: 'remote-b', targetNodeId: 'join' },
        ],
        'parallel',
        ['join'],
      ),
      'confirmed',
      ports({ callMcpTool }),
    ).invoke(
      {},
      budget,
      costs,
      undefined,
      'execution.prepared-parallel',
      undefined,
      prepareExternalWait,
    );

    expect(result.status).toBe('waiting_external');
    expect(prepareExternalWait.mock.calls.map(([input]) => input.completeness)).toEqual([
      'requires_graph_merge',
      'requires_graph_merge',
      'exact_final',
    ]);
    expect(prepareExternalWait.mock.calls.at(-1)?.[0].continuation.waitingNodeRuns).toHaveLength(2);
  });

  it('keeps a nested parallel remote wait partial until the final graph snapshot', async () => {
    const prepareExternalWait = vi.fn<WorkflowExternalWaitSnapshotPreparer>((preparation) =>
      Promise.resolve({
        snapshot: {} as WorkflowContinuationSnapshot,
        completeness: preparation.completeness,
      }),
    );
    const callMcpTool = vi.fn(async (input: Parameters<WorkflowRuntimePorts['callMcpTool']>[0]) => {
      const outcome = externalWait('execution.prepared-nested-parallel', 'remote');
      if (outcome.kind !== 'waiting_external') throw new Error('TEST_WAIT_REQUIRED');
      await input.prepareExternalWait(outcome.wait);
      return outcome;
    });
    const result = await compileWorkflow(
      definition(
        [
          {
            nodeId: 'parallel',
            name: 'Parallel',
            type: 'parallel',
            branchEntryNodeIds: ['remote', 'local'],
          },
          {
            nodeId: 'remote',
            name: 'Remote',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'long_running' },
            arguments: {},
          },
          {
            nodeId: 'transform',
            name: 'Transform',
            type: 'skill_call',
            skillId: 'transform',
            input: {},
          },
          {
            nodeId: 'local',
            name: 'Local',
            type: 'skill_call',
            skillId: 'local',
            input: {},
          },
          {
            nodeId: 'join',
            name: 'Join',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        [
          { sourceNodeId: 'remote', targetNodeId: 'transform' },
          { sourceNodeId: 'transform', targetNodeId: 'join' },
          { sourceNodeId: 'local', targetNodeId: 'join' },
        ],
        'parallel',
        ['join'],
      ),
      'confirmed',
      ports({ callMcpTool }),
    ).invoke(
      {},
      budget,
      costs,
      undefined,
      'execution.prepared-nested-parallel',
      undefined,
      prepareExternalWait,
    );

    expect(result.status).toBe('waiting_external');
    expect(prepareExternalWait.mock.calls.map(([input]) => input.completeness)).toEqual([
      'requires_graph_merge',
      'exact_final',
    ]);
    expect(prepareExternalWait.mock.calls[0]?.[0].continuation.waitingNodeRuns).toEqual([
      expect.objectContaining({ nodeId: 'remote' }),
    ]);
    expect(prepareExternalWait.mock.calls.at(-1)?.[0].continuation.waitingNodeRuns).toEqual([
      expect.objectContaining({ nodeId: 'remote' }),
    ]);
  });

  it('returns a typed external wait without succeeding the node or running its successor', async () => {
    const executeLlm = vi.fn().mockResolvedValue({ shouldNotRun: true });
    const callMcpTool = vi.fn().mockResolvedValue(externalWait('execution.external', 'remote'));
    const result = await compileWorkflow(
      definition(
        [
          {
            nodeId: 'remote',
            name: 'Remote',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'long_running' },
            arguments: {},
          },
          {
            nodeId: 'after',
            name: 'After',
            type: 'llm',
            instruction: 'after',
            responseSchema: true,
          },
        ],
        [{ sourceNodeId: 'remote', targetNodeId: 'after' }],
        'remote',
        ['after'],
      ),
      'confirmed',
      ports({ executeLlm, callMcpTool }),
    ).invoke({}, budget, costs, undefined, 'execution.external');

    expect(result).toMatchObject({
      status: 'waiting_external',
      continuation: {
        waitingNodeRuns: [
          {
            sourceId: 'binding-remote',
            nodeId: 'remote',
            nodeRunId: 'execution.external~remote~1',
          },
        ],
        runnableFrontier: [],
        nodeRunCounts: { remote: 1 },
      },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'node_started',
      'node_waiting_external',
    ]);
    expect(executeLlm).not.toHaveBeenCalled();
  });

  it('continues five sequential task-required Tool nodes only after each remote terminal result', async () => {
    const executionId = 'execution.five-segments';
    const segmentIds = Array.from({ length: 5 }, (_, index) => `segment-${String(index + 1)}`);
    const workflow = definition(
      [
        ...segmentIds.map((nodeId) => ({
          nodeId,
          name: `Move segment ${nodeId}`,
          type: 'mcp_tool' as const,
          tool: { serverId: 'provider', toolName: 'vehicle_navigate' },
          arguments: {
            resourceId: 'vehicle:ugv1',
            mission: { type: 'distance', direction: 'forward', distanceM: 2 },
          },
          taskExecution: {
            protocolMode: 'frozen_v1' as const,
            availabilityCheck: 'required' as const,
          },
        })),
        {
          nodeId: 'result',
          name: 'All segments completed',
          type: 'result' as const,
          value: { op: 'literal' as const, value: true },
        },
      ],
      [
        ...segmentIds.slice(0, -1).map((nodeId, index) => ({
          sourceNodeId: nodeId,
          targetNodeId: required(segmentIds[index + 1]),
        })),
        { sourceNodeId: required(segmentIds.at(-1)), targetNodeId: 'result' },
      ],
      required(segmentIds[0]),
      ['result'],
    );
    const callMcpTool = vi.fn((input: Parameters<WorkflowRuntimePorts['callMcpTool']>[0]) =>
      Promise.resolve(externalWait(executionId, input.workflowNodeId)),
    );
    let execution = await compileWorkflow(workflow, 'confirmed', ports({ callMcpTool })).invoke(
      {},
      { ...budget, maxMcpCalls: 5 },
      costs,
      undefined,
      executionId,
    );

    for (const [index, nodeId] of segmentIds.entries()) {
      expect(execution.status).toBe('waiting_external');
      const continuation = execution.continuation;
      const waiting = continuation?.waitingNodeRuns[0];
      if (continuation === undefined || waiting === undefined)
        throw new Error('TEST_CONTINUATION_MISSING');
      expect(waiting).toMatchObject({
        nodeId,
        nodeRunId: `${executionId}~${nodeId}~1`,
      });

      execution = await compileWorkflow(
        workflow,
        'confirmed',
        ports({ callMcpTool }),
      ).continueExternal(
        executionId,
        continuation,
        {
          kind: 'completed',
          waitId: waiting.waitId,
          nodeRunId: waiting.nodeRunId,
          result: {
            content: [],
            structuredContent: { segment: index + 1, terminal: true },
            isError: false,
          },
        },
        costs,
        undefined,
        `continuation-attempt-${String(index + 1)}`,
      );
    }

    expect(execution).toMatchObject({
      status: 'succeeded',
      result: true,
      budgetUsage: { mcpCalls: 5 },
    });
    expect(callMcpTool.mock.calls.map(([input]) => input.workflowNodeId)).toEqual(segmentIds);
  });

  it('waits for a child Workflow and continues its Skill call from a fresh runtime', async () => {
    const executionId = 'execution.child-wait';
    const nodeRunId = `${executionId}~child~1`;
    const executeSkill = vi.fn((input: Parameters<WorkflowRuntimePorts['executeSkill']>[0]) => {
      expect(input.parentNodeRunId).toBe(nodeRunId);
      return Promise.resolve({
        status: 'waiting_external' as const,
        wait: {
          waitId: 'wait-child-instance-1',
          kind: 'child_workflow' as const,
          sourceId: 'child-instance-1',
          nodeId: 'child',
          nodeRunId,
          state: 'waiting' as const,
        },
      });
    });
    const workflow = definition(
      [
        {
          nodeId: 'child',
          name: 'Child Skill',
          type: 'skill_call',
          skillId: 'skill.child',
          input: { request: 'run' },
          outputMappings: [{ sourcePath: 'value', targetPath: 'evidence.child-value' }],
        },
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'ref', path: ['evidence', 'child-value'] },
        },
      ],
      [{ sourceNodeId: 'child', targetNodeId: 'result' }],
      'child',
      ['result'],
    );
    const initial = await compileWorkflow(workflow, 'confirmed', ports({ executeSkill })).invoke(
      {},
      budget,
      costs,
      undefined,
      executionId,
    );

    expect(initial).toMatchObject({
      status: 'waiting_external',
      continuation: {
        waitingNodeRuns: [
          {
            waitId: 'wait-child-instance-1',
            kind: 'child_workflow',
            sourceId: 'child-instance-1',
            nodeId: 'child',
            nodeRunId,
          },
        ],
      },
    });
    expect(initial.events.map((event) => event.type)).toEqual([
      'node_started',
      'node_waiting_external',
    ]);
    expect(executeSkill).toHaveBeenCalledTimes(1);

    const continuation = initial.continuation;
    if (continuation === undefined) throw new Error('TEST_CONTINUATION_MISSING');
    const freshExecuteSkill = vi.fn().mockRejectedValue(new Error('must not replay child Skill'));
    const resumed = await compileWorkflow(
      workflow,
      'confirmed',
      ports({ executeSkill: freshExecuteSkill }),
    ).continueExternal(
      executionId,
      continuation,
      {
        kind: 'completed',
        waitId: 'wait-child-instance-1',
        nodeRunId,
        result: { value: 'done' },
      },
      costs,
      undefined,
      'attempt-child-1',
    );

    expect(resumed).toMatchObject({ status: 'succeeded', result: 'done' });
    expect(freshExecuteSkill).not.toHaveBeenCalled();
    expect(
      resumed.events.filter((event) => event.nodeId === 'child' && event.type === 'node_succeeded'),
    ).toHaveLength(1);
  });

  it('projects declared child output mappings before evidence gates', async () => {
    const executeSkill = vi.fn().mockResolvedValue({
      status: 'completed',
      output: { finalPosition: { x: 12, y: 8 } },
    });
    const result = await compileWorkflow(
      definition(
        [
          {
            nodeId: 'child',
            name: 'Move child',
            type: 'skill_call',
            skillId: 'skill.move',
            input: { op: 'ref', path: ['input', 'skillInput'] },
            outputMappings: [{ sourcePath: 'finalPosition', targetPath: 'evidence.trajectory' }],
          },
          {
            nodeId: 'gate',
            name: 'Require trajectory',
            type: 'condition',
            expression: { op: 'exists', path: ['evidence', 'trajectory'] },
          },
          {
            nodeId: 'success',
            name: 'Success',
            type: 'result',
            value: { op: 'ref', path: ['evidence', 'trajectory', 'x'] },
          },
          {
            nodeId: 'failure',
            name: 'Failure',
            type: 'result',
            value: { op: 'literal', value: false },
          },
        ],
        [
          { sourceNodeId: 'child', targetNodeId: 'gate' },
          { sourceNodeId: 'gate', targetNodeId: 'success', outcome: 'true' },
          { sourceNodeId: 'gate', targetNodeId: 'failure', outcome: 'false' },
        ],
        'child',
        ['success', 'failure'],
      ),
      'confirmed',
      ports({ executeSkill }),
    ).invoke({ skillInput: { resourceId: 'robot-17' } }, budget, costs);

    expect(result).toMatchObject({ status: 'succeeded', result: 12 });
    expect(executeSkill).toHaveBeenCalledWith(
      expect.objectContaining({ input: { resourceId: 'robot-17' } }),
    );
  });

  it('continues ready parallel work, then uses a fresh frontier invocation to join once', async () => {
    const initialCalls = vi.fn((input: Parameters<WorkflowRuntimePorts['callMcpTool']>[0]) =>
      Promise.resolve(externalWait('execution.parallel-wait', input.workflowNodeId)),
    );
    const initial = await compileWorkflow(
      definition(
        [
          {
            nodeId: 'parallel',
            name: 'Parallel',
            type: 'parallel',
            branchEntryNodeIds: ['remote', 'local'],
          },
          {
            nodeId: 'remote',
            name: 'Remote',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'long_running' },
            arguments: {},
          },
          {
            nodeId: 'local',
            name: 'Local',
            type: 'llm',
            instruction: 'local',
            responseSchema: true,
          },
          {
            nodeId: 'join',
            name: 'Join',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'join' },
            arguments: {},
          },
        ],
        [
          { sourceNodeId: 'remote', targetNodeId: 'join' },
          { sourceNodeId: 'local', targetNodeId: 'join' },
        ],
        'parallel',
        ['join'],
      ),
      'confirmed',
      ports({ callMcpTool: initialCalls }),
    ).invoke({}, budget, costs, undefined, 'execution.parallel-wait');

    expect(initial.status).toBe('waiting_external');
    expect(initialCalls).toHaveBeenCalledTimes(1);
    expect(
      initial.events.some((event) => event.nodeId === 'local' && event.type === 'node_succeeded'),
    ).toBe(true);
    expect(initial.continuation?.parallelJoinState).toEqual([
      expect.objectContaining({
        joinNodeId: 'join',
        arrivals: [expect.objectContaining({ predecessorNodeId: 'local' })],
      }),
    ]);

    const continuationCalls = vi.fn().mockResolvedValue(immediate({ joined: true }));
    const fresh = compileWorkflow(
      definition(
        [
          {
            nodeId: 'parallel',
            name: 'Parallel',
            type: 'parallel',
            branchEntryNodeIds: ['remote', 'local'],
          },
          {
            nodeId: 'remote',
            name: 'Remote',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'long_running' },
            arguments: {},
          },
          {
            nodeId: 'local',
            name: 'Local',
            type: 'llm',
            instruction: 'local',
            responseSchema: true,
          },
          {
            nodeId: 'join',
            name: 'Join',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'join' },
            arguments: {},
          },
        ],
        [
          { sourceNodeId: 'remote', targetNodeId: 'join' },
          { sourceNodeId: 'local', targetNodeId: 'join' },
        ],
        'parallel',
        ['join'],
      ),
      'confirmed',
      ports({ callMcpTool: continuationCalls }),
    );
    const continuation = initial.continuation;
    if (continuation === undefined) throw new Error('TEST_CONTINUATION_MISSING');
    const resumed = await fresh.continueExternal(
      'execution.parallel-wait',
      continuation,
      {
        kind: 'completed',
        waitId: 'wait-binding-remote',
        nodeRunId: 'execution.parallel-wait~remote~1',
        result: { content: [], structuredContent: { remote: 'done' }, isError: false },
      },
      costs,
      undefined,
      'attempt-parallel-1',
    );

    expect(resumed.status).toBe('succeeded');
    expect(continuationCalls).toHaveBeenCalledTimes(1);
    expect(continuationCalls).toHaveBeenCalledWith(
      expect.objectContaining({ workflowNodeId: 'join' }),
    );
    expect(resumed.events.some((event) => event.nodeId === 'parallel')).toBe(false);
    expect(resumed.events.some((event) => event.nodeId === 'local')).toBe(false);
    expect(
      resumed.events.some((event) => event.nodeId === 'remote' && event.type === 'node_succeeded'),
    ).toBe(true);
    expect(resumed.events.filter((event) => event.nodeId === 'join')).toHaveLength(2);
  });

  it('routes an external completed error Tool result through the existing error handler', async () => {
    const workflow = definition(
      [
        {
          nodeId: 'remote',
          name: 'Remote',
          type: 'mcp_tool',
          tool: { serverId: 'provider', toolName: 'long_running' },
          arguments: {},
        },
        {
          nodeId: 'handler',
          name: 'Handler',
          type: 'error_handler',
          handledNodeId: 'remote',
          strategy: 'continue',
        },
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'literal', value: 'recovered' },
        },
      ],
      [
        { sourceNodeId: 'remote', targetNodeId: 'result' },
        { sourceNodeId: 'handler', targetNodeId: 'result' },
      ],
      'remote',
      ['result'],
    );
    const initial = await compileWorkflow(
      workflow,
      'confirmed',
      ports({
        callMcpTool: vi.fn().mockResolvedValue(externalWait('execution.external-error', 'remote')),
      }),
    ).invoke({}, budget, costs, undefined, 'execution.external-error');
    const continuation = initial.continuation;
    if (continuation === undefined) throw new Error('TEST_CONTINUATION_MISSING');

    const callMcpTool = vi.fn();
    const decideExecutionError = vi.fn().mockResolvedValue({
      strategy: 'continue',
      summary: 'Continue through the existing error path.',
    });
    const resumed = await compileWorkflow(
      workflow,
      'confirmed',
      ports({ callMcpTool, decideExecutionError }),
    ).continueExternal(
      'execution.external-error',
      continuation,
      {
        kind: 'completed',
        waitId: 'wait-binding-remote',
        nodeRunId: 'execution.external-error~remote~1',
        result: {
          content: [{ type: 'text', text: 'business rejected' }],
          structuredContent: {
            outcome: 'deadline_reached',
            reasonCode: 'MAX_ELAPSED_TIME_REACHED',
            retryable: true,
          },
          isError: true,
        },
      },
      costs,
      undefined,
      'attempt-external-error-1',
    );

    expect(resumed).toMatchObject({
      status: 'succeeded',
      result: 'recovered',
      errors: {
        remote: {
          code: 'MCP_TASK_DEADLINE_REACHED',
          message: 'The Provider ended the remote Task at its maximum elapsed deadline.',
          details: {
            category: 'provider_business',
            outcome: 'deadline_reached',
            reasonCode: 'MAX_ELAPSED_TIME_REACHED',
            retryable: true,
            classification: 'declared',
            structuredEvidence: {
              outcome: 'deadline_reached',
              reasonCode: 'MAX_ELAPSED_TIME_REACHED',
              retryable: true,
            },
          },
        },
      },
    });
    expect(decideExecutionError).toHaveBeenCalledWith(
      expect.objectContaining({
        handledNodeId: 'remote',
        error: expect.objectContaining({ code: 'MCP_TASK_DEADLINE_REACHED' }),
      }),
    );
    expect(callMcpTool).not.toHaveBeenCalled();
    expect(
      resumed.events.filter((event) => event.nodeId === 'remote' && event.type === 'node_failed'),
    ).toHaveLength(1);
    expect(
      resumed.events.filter(
        (event) => event.nodeId === 'remote' && event.type === 'node_succeeded',
      ),
    ).toHaveLength(0);
  });

  it('rejects a remote continuation result that is not an internal Tool result', async () => {
    const workflow = definition(
      [
        {
          nodeId: 'remote',
          name: 'Remote',
          type: 'mcp_tool',
          tool: { serverId: 'provider', toolName: 'long_running' },
          arguments: {},
        },
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'literal', value: 'must not run' },
        },
      ],
      [{ sourceNodeId: 'remote', targetNodeId: 'result' }],
      'remote',
      ['result'],
    );
    const initial = await compileWorkflow(
      workflow,
      'confirmed',
      ports({
        callMcpTool: vi.fn().mockResolvedValue(externalWait('execution.remote-invalid', 'remote')),
      }),
    ).invoke({}, budget, costs, undefined, 'execution.remote-invalid');
    const continuation = initial.continuation;
    if (continuation === undefined) throw new Error('TEST_CONTINUATION_MISSING');

    await expect(
      compileWorkflow(workflow, 'confirmed', ports()).continueExternal(
        'execution.remote-invalid',
        continuation,
        {
          kind: 'completed',
          waitId: 'wait-binding-remote',
          nodeRunId: 'execution.remote-invalid~remote~1',
          result: { not: 'a Tool result' },
        },
        costs,
      ),
    ).rejects.toMatchObject({ code: 'WORKFLOW_EXTERNAL_CONTINUATION_INVALID' });
  });

  it('pauses after the active node and resumes before starting the next node', async () => {
    let completeLlm: ((value: unknown) => void) | undefined;
    const executeLlm = vi.fn(
      () =>
        new Promise<unknown>((resolvePromise) => {
          completeLlm = resolvePromise;
        }),
    );
    const callMcpTool = vi.fn().mockResolvedValue(immediate({ done: true }));
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

  it('does not route a child Skill confirmation interrupt through its failure handler', async () => {
    let confirmed = false;
    const executeSkill = vi.fn(() =>
      Promise.resolve(
        confirmed
          ? ({ status: 'completed', output: { child: 'done' } } as const)
          : ({
              status: 'awaiting_confirmation',
              callId: 'call-1',
              parentPlanId: 'plan-parent',
              parentInstanceId: 'execution.child-confirm',
              parentNodeId: 'child',
              childPlanId: 'plan-child',
              childSkillId: 'skill.child',
              childSkillVersion: 2,
            } as const),
      ),
    );
    const compiled = compileWorkflow(
      definition(
        [
          {
            nodeId: 'child',
            name: 'Child',
            type: 'skill_call',
            skillId: 'skill.child',
            input: { request: 'run' },
          },
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'ref', path: ['outputs', 'child', 'child'] },
          },
          {
            nodeId: 'child_handler',
            name: 'Recover child failure',
            type: 'error_handler',
            handledNodeId: 'child',
            strategy: 'goto',
            gotoNodeId: 'result',
            skillFailurePolicy: 'recoverable',
          },
        ],
        [
          { sourceNodeId: 'child', targetNodeId: 'result' },
          { sourceNodeId: 'child_handler', targetNodeId: 'result' },
        ],
        'child',
        ['result'],
      ),
      'confirmed',
      ports({ executeSkill }),
    );

    await expect(
      compiled.invoke({}, budget, costs, undefined, 'execution.child-confirm'),
    ).resolves.toMatchObject({
      status: 'paused',
      pendingConfirmation: {
        nodeId: 'child',
        kind: 'skill_confirmation',
        parentPlanId: 'plan-parent',
        childPlanId: 'plan-child',
        childSkillId: 'skill.child',
        childSkillVersion: 2,
      },
      budgetUsage: { llmCalls: 1 },
    });
    confirmed = true;
    await expect(compiled.resume('execution.child-confirm', true)).resolves.toMatchObject({
      status: 'succeeded',
      result: 'done',
      budgetUsage: { llmCalls: 1 },
    });
    expect(executeSkill).toHaveBeenCalledTimes(2);
  });

  it('cancels after the active node without starting any subsequent node', async () => {
    let completeLlm: ((value: unknown) => void) | undefined;
    const executeLlm = vi.fn(
      () =>
        new Promise<unknown>((resolvePromise) => {
          completeLlm = resolvePromise;
        }),
    );
    const callMcpTool = vi.fn().mockResolvedValue(immediate({ done: true }));
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
        data: expect.objectContaining({ temperature: 21 }),
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
        workflowNodeRunId: 'workflow.compiler~mcp~1',
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

  it.each(['skill_call', 'subworkflow'] as const)(
    'transfers external child confirmation to a %s checkpoint without charging or creating another call',
    async (type) => {
      let phase: 'waiting' | 'paused' | 'completed' = 'waiting';
      const requests: string[] = [];
      const child = vi.fn((request: { parentNodeRunId: string; resumeChild?: boolean }) => {
        requests.push(request.parentNodeRunId);
        if (request.resumeChild === true) phase = 'completed';
        if (phase === 'waiting')
          return Promise.resolve({
            status: 'waiting_external' as const,
            wait: {
              waitId: 'child-wait',
              kind: 'child_workflow' as const,
              sourceId: 'child-instance',
              nodeId: 'child',
              nodeRunId: request.parentNodeRunId,
              state: 'waiting' as const,
            },
          });
        return Promise.resolve(
          phase === 'completed'
            ? { status: 'completed' as const, output: { verified: true } }
            : {
                status: 'paused' as const,
                childInstanceId: 'child-instance',
                prompt: 'Review child after remote result',
              },
        );
      });
      const runtime = ports({
        executeSkill: child,
        executeSubworkflow: child,
        nowMilliseconds: () => 0,
      });
      const graph: WorkflowDefinition = {
        ...definition(
          [
            type === 'skill_call'
              ? { nodeId: 'child', name: 'Child', type, skillId: 'skill.child', input: {} }
              : {
                  nodeId: 'child',
                  name: 'Child',
                  type,
                  workflowDefinitionId: 'child-workflow',
                  workflowVersion: 1,
                  input: {},
                },
            {
              nodeId: 'result',
              name: 'Result',
              type: 'result',
              value: { op: 'ref', path: ['outputs', 'child', 'verified'] },
            },
          ],
          [{ sourceNodeId: 'child', targetNodeId: 'result' }],
          'child',
          ['result'],
        ),
        executionSemanticsVersion: '2.0',
      };
      const executor = new LangGraphWorkflowExecutor(runtime, costs);
      const waiting = await executor.execute(graph, {}, budget, undefined, 'parent');
      if (waiting.continuation === undefined) throw new Error('Expected persisted child wait');
      phase = 'paused';
      const paused = await executor.continueExternal(
        graph,
        'parent',
        waiting.continuation,
        { kind: 'child_paused', waitId: 'child-wait', nodeRunId: 'parent~child~1' },
        'child-confirmation',
      );
      expect(paused).toMatchObject({ status: 'paused', budgetUsage: { cost: 1 } });
      const done = await executor.resumeHumanConfirmation('parent', true);
      expect(done).toMatchObject({ status: 'succeeded', result: true, budgetUsage: { cost: 1 } });
      expect(new Set(requests)).toEqual(new Set(['parent~child~1']));
      expect(
        done.events.filter((event) => event.nodeId === 'child' && event.type === 'node_succeeded'),
      ).toHaveLength(1);
    },
  );

  it.each(['skill_call', 'subworkflow'] as const)(
    'resumes a paused %s with the same node-run and one call cost',
    async (type) => {
      let completed = false;
      const child = vi.fn((request: { resumeChild?: boolean }) => {
        if (request.resumeChild === true) completed = true;
        return Promise.resolve(
          completed
            ? { status: 'completed' as const, output: { verified: true } }
            : {
                status: 'paused' as const,
                childInstanceId: 'child-instance',
                prompt: 'Review child',
              },
        );
      });
      const runtime = ports({
        executeSkill: child,
        executeSubworkflow: child,
        nowMilliseconds: () => 0,
      });
      const graph = definition(
        [
          type === 'skill_call'
            ? { nodeId: 'child', name: 'Child', type, skillId: 'skill.child', input: {} }
            : {
                nodeId: 'child',
                name: 'Child',
                type,
                workflowDefinitionId: 'child-workflow',
                workflowVersion: 1,
                input: {},
              },
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'ref', path: ['outputs', 'child', 'verified'] },
          },
        ],
        [{ sourceNodeId: 'child', targetNodeId: 'result' }],
        'child',
        ['result'],
      );
      const executor = new LangGraphWorkflowExecutor(runtime, costs);
      const paused = await executor.execute(graph, {}, budget, undefined, 'parent');
      expect(paused.status).toBe('paused');
      const done = await executor.resumeHumanConfirmation('parent', true);
      expect(done).toMatchObject({ status: 'succeeded', result: true, budgetUsage: { cost: 1 } });
      expect(child.mock.calls.map(([request]) => request)).toEqual([
        expect.objectContaining({ parentNodeRunId: 'parent~child~1' }),
        expect.objectContaining({ parentNodeRunId: 'parent~child~1' }),
        expect.objectContaining({ parentNodeRunId: 'parent~child~1', resumeChild: true }),
      ]);
    },
  );

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
      return Promise.resolve(immediate({ commandId: 'command-1' }));
    });
    const executeSkill = vi.fn().mockResolvedValue({
      status: 'completed',
      output: { commandId: 'command-1', accepted: true },
    });
    const executeSubworkflow = vi
      .fn()
      .mockResolvedValue({ status: 'completed', output: { verified: true } });
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
    const callMcpTool = vi.fn().mockResolvedValue(immediate({ joined: true }));
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
    const nodeRunIds: string[] = [];
    const callMcpTool = vi.fn((input: Parameters<WorkflowRuntimePorts['callMcpTool']>[0]) => {
      iterations.push((input.arguments as { iteration: number }).iteration);
      nodeRunIds.push(input.workflowNodeRunId);
      return Promise.resolve(immediate({ ok: true }));
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
    expect(nodeRunIds).toEqual([
      'workflow.compiler~body~1',
      'workflow.compiler~body~2',
      'workflow.compiler~body~3',
    ]);
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
        .mockResolvedValue(immediate({ recovered: true }));
      const executeSkill = vi.fn().mockResolvedValue({
        status: 'completed',
        output: { recovered: true },
      });
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
    const callMcpTool = vi.fn().mockResolvedValue(immediate({ status: 'online' }));
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
  it('resolves and freezes dynamic scheduledAt immediately before the existing MCP call', async () => {
    const callMcpTool = vi.fn().mockResolvedValue(immediate({ accepted: true }));
    const compiled = compileWorkflow(
      definition(
        [
          {
            nodeId: 'patrol',
            name: 'Patrol',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'vehicle_patrol' },
            arguments: { route: { op: 'ref', path: ['input', 'route'] } },
            taskExecution: {
              protocolMode: 'frozen_v1',
              availabilityCheck: 'required',
              timing: {
                start: {
                  mode: 'scheduled',
                  scheduledAt: { op: 'ref', path: ['input', 'scheduledAt'] },
                  startToleranceMs: 0,
                },
                maxElapsedMs: null,
              },
            },
          },
        ],
        [],
        'patrol',
        ['patrol'],
      ),
      'confirmed',
      ports({ callMcpTool }),
    );

    await compiled.invoke(
      { route: 'A', scheduledAt: '2026-07-17T09:00:00+08:00' },
      budget,
      costs,
      undefined,
      'execution.tasks',
    );

    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowNodeId: 'patrol',
        arguments: { route: 'A' },
        taskExecution: {
          protocolMode: 'frozen_v1',
          availabilityCheck: 'required',
          timing: {
            start: {
              mode: 'scheduled',
              scheduledAt: '2026-07-17T01:00:00.000Z',
              startToleranceMs: 0,
            },
            maxElapsedMs: null,
          },
        },
      }),
    );
    const supplied = callMcpTool.mock.calls[0]?.[0] as
      Parameters<WorkflowRuntimePorts['callMcpTool']>[0] | undefined;
    expect(Object.isFrozen(supplied?.arguments)).toBe(true);
    expect(Object.isFrozen(supplied?.taskExecution?.timing)).toBe(true);
  });

  it('rejects a dynamic non-string scheduledAt before an MCP call', async () => {
    const callMcpTool = vi.fn();
    const compiled = compileWorkflow(
      definition(
        [
          {
            nodeId: 'patrol',
            name: 'Patrol',
            type: 'mcp_tool',
            tool: { serverId: 'provider', toolName: 'vehicle_patrol' },
            arguments: {},
            taskExecution: {
              protocolMode: 'frozen_v1',
              timing: {
                start: {
                  mode: 'scheduled',
                  scheduledAt: { op: 'ref', path: ['input', 'scheduledAt'] },
                  startToleranceMs: 1,
                },
              },
            },
          },
        ],
        [],
        'patrol',
        ['patrol'],
      ),
      'confirmed',
      ports({ callMcpTool }),
    );

    await expect(
      compiled.invoke({ scheduledAt: 42 }, budget, costs, undefined, 'execution.bad-time'),
    ).rejects.toMatchObject({ code: 'MCP_TASK_SCHEDULED_AT_UNRESOLVED' });
    expect(callMcpTool).not.toHaveBeenCalled();
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture value.');
  return value;
}

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
