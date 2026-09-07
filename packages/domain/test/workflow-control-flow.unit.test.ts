import { describe, expect, it } from 'vitest';
import {
  analyzeWorkflowControlFlow,
  type WorkflowDefinition,
  type WorkflowNode,
} from '../src/index.js';

const action = (nodeId: string): WorkflowNode => ({
  nodeId,
  name: nodeId,
  type: 'llm',
  instruction: 'Run',
  responseSchema: { type: 'object' },
});
const result: WorkflowNode = {
  nodeId: 'result',
  name: 'Result',
  type: 'result',
  value: { op: 'literal', value: true },
};
function graph(
  nodes: readonly WorkflowNode[],
  edges: WorkflowDefinition['edges'],
): WorkflowDefinition {
  return {
    executionSemanticsVersion: '2.0',
    workflowDefinitionId: 'regions',
    version: 1,
    goalId: 'goal',
    goalVersion: 1,
    entryNodeId: nodes[0]?.nodeId ?? 'missing',
    exitNodeIds: ['result'],
    nodes: [...nodes, result],
    edges,
  };
}
const edge = (
  sourceNodeId: string,
  targetNodeId: string,
  outcome?: WorkflowDefinition['edges'][number]['outcome'],
) => ({ sourceNodeId, targetNodeId, ...(outcome === undefined ? {} : { outcome }) });
function conditionalFork() {
  return graph(
    [
      {
        nodeId: 'fork',
        name: 'Fork',
        type: 'parallel',
        branchEntryNodeIds: ['condition', 'right'],
        joinNodeId: 'result',
        mergeStrategy: 'reject_conflicts',
      },
      {
        nodeId: 'condition',
        name: 'Condition',
        type: 'condition',
        expression: { op: 'literal', value: true },
      },
      action('leftTrue'),
      action('leftFalse'),
      action('right'),
    ],
    [
      edge('condition', 'leftTrue', 'true'),
      edge('condition', 'leftFalse', 'false'),
      edge('leftTrue', 'result'),
      edge('leftFalse', 'result'),
      edge('right', 'result'),
    ],
  );
}

describe('shared Workflow control-flow regions', () => {
  it('rejects a conditional bypass into a parallel join before execution', () => {
    const fork = conditionalFork();
    const value: WorkflowDefinition = {
      ...fork,
      entryNodeId: 'choose',
      nodes: [
        {
          nodeId: 'choose',
          name: 'Choose',
          type: 'condition',
          expression: { op: 'literal', value: true },
        },
        ...fork.nodes,
      ],
      edges: [edge('choose', 'fork', 'true'), edge('choose', 'result', 'false'), ...fork.edges],
    };
    expect(analyzeWorkflowControlFlow(value).issues).toContainEqual(
      expect.objectContaining({ code: 'WORKFLOW_PARALLEL_REGION_INVALID' }),
    );
  });

  it('assigns alternative condition arrivals to one branch obligation', () => {
    const analysis = analyzeWorkflowControlFlow(conditionalFork());
    expect(analysis.issues).toEqual([]);
    expect(analysis.parallels[0]?.branches).toEqual([
      {
        branchId: 'condition',
        entryNodeId: 'condition',
        nodeIds: ['condition', 'leftFalse', 'leftTrue'],
        arrivalNodeIds: ['leftTrue', 'leftFalse'],
      },
      { branchId: 'right', entryNodeId: 'right', nodeIds: ['right'], arrivalNodeIds: ['right'] },
    ]);
  });
  it('discovers nested loop regions through implicit body references', () => {
    const analysis = analyzeWorkflowControlFlow(
      graph(
        [
          {
            nodeId: 'outer',
            name: 'Outer',
            type: 'loop',
            bodyEntryNodeId: 'inner',
            maxIterations: 3,
            condition: { op: 'literal', value: true },
          },
          {
            nodeId: 'inner',
            name: 'Inner',
            type: 'loop',
            bodyEntryNodeId: 'action',
            maxIterations: 2,
            condition: { op: 'literal', value: true },
          },
          action('action'),
        ],
        [edge('outer', 'result', 'done'), edge('inner', 'outer', 'done'), edge('action', 'inner')],
      ),
    );
    expect(analysis.issues).toEqual([]);
    expect(
      analysis.loops.map(({ loopNodeId, bodyNodeIds }) => ({ loopNodeId, bodyNodeIds })),
    ).toEqual([
      { loopNodeId: 'outer', bodyNodeIds: ['inner', 'action'] },
      { loopNodeId: 'inner', bodyNodeIds: ['action'] },
    ]);
  });
  it.each([
    [
      'missing join',
      (value: WorkflowDefinition) => ({
        ...value,
        nodes: value.nodes.map((node) =>
          node.type === 'parallel'
            ? {
                nodeId: node.nodeId,
                name: node.name,
                type: 'parallel' as const,
                branchEntryNodeIds: node.branchEntryNodeIds,
              }
            : node,
        ),
      }),
      'WORKFLOW_PARALLEL_REGION_INVALID',
    ],
    [
      'crossed branches',
      (value: WorkflowDefinition) => ({
        ...value,
        edges: value.edges.map((item) =>
          item.sourceNodeId === 'right' ? edge('right', 'leftTrue') : item,
        ),
      }),
      'WORKFLOW_PARALLEL_REGION_INVALID',
    ],
    [
      'unknown implicit branch',
      (value: WorkflowDefinition) => ({
        ...value,
        nodes: value.nodes.map((node) =>
          node.type === 'parallel' ? { ...node, branchEntryNodeIds: ['missing', 'right'] } : node,
        ),
      }),
      'WORKFLOW_REFERENCE_INVALID',
    ],
    [
      'dead end',
      (value: WorkflowDefinition) => ({
        ...value,
        edges: value.edges.filter((item) => item.sourceNodeId !== 'right'),
      }),
      'WORKFLOW_ROUTE_MISSING',
    ],
    [
      'unbounded cycle',
      (value: WorkflowDefinition) => ({
        ...value,
        edges: value.edges.map((item) =>
          item.sourceNodeId === 'right' ? edge('right', 'right') : item,
        ),
      }),
      'WORKFLOW_UNBOUNDED_CYCLE',
    ],
  ] as const)('rejects %s before compilation', (_name, change, code) => {
    expect(
      analyzeWorkflowControlFlow(change(conditionalFork())).issues.map((issue) => issue.code),
    ).toContain(code);
  });
  it('rejects duplicate handlers referenced only through implicit error routes', () => {
    const value = graph(
      [
        action('work'),
        ...['h1', 'h2'].map((nodeId): WorkflowNode => ({
          nodeId,
          name: nodeId,
          type: 'error_handler',
          handledNodeId: 'work',
          strategy: 'terminate',
        })),
      ],
      [edge('work', 'result')],
    );
    expect(analyzeWorkflowControlFlow(value).issues.map((issue) => issue.code)).toContain(
      'WORKFLOW_HANDLER_DUPLICATE',
    );
  });
  it('keeps legacy implicit joins recognizable without rewriting the definition', () => {
    const legacy = { ...conditionalFork() };
    delete legacy.executionSemanticsVersion;
    const before = structuredClone(legacy);
    expect(analyzeWorkflowControlFlow(legacy).parallels).toEqual([]);
    expect(legacy).toEqual(before);
  });
});
