import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import type {
  ToolReference,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '../../domain/src/index.js';
import { evaluateWorkflowExpression } from './expression-interpreter.js';

export interface WorkflowExecutionEvent {
  readonly nodeId: string;
  readonly type: 'node_started' | 'node_succeeded' | 'node_failed';
  readonly timestamp: string;
  readonly summary: string;
}

export interface WorkflowRuntimePorts {
  readonly executeLlm: (
    input: Readonly<{
      instruction: string;
      responseSchema: unknown;
      signal?: AbortSignal;
    }>,
  ) => Promise<unknown>;
  readonly callMcpTool: (
    input: Readonly<{
      tool: ToolReference;
      arguments: unknown;
      signal?: AbortSignal;
    }>,
  ) => Promise<unknown>;
  readonly executeSkill: (
    input: Readonly<{
      skillId: string;
      input: unknown;
      signal?: AbortSignal;
    }>,
  ) => Promise<unknown>;
  readonly executeSubworkflow: (
    input: Readonly<{
      workflowDefinitionId: string;
      workflowVersion: number;
      parentInput: unknown;
      signal?: AbortSignal;
    }>,
  ) => Promise<unknown>;
  readonly requestHumanConfirmation: (
    input: Readonly<{
      prompt: string;
      signal?: AbortSignal;
    }>,
  ) => Promise<boolean>;
  readonly now: () => string;
}

export interface WorkflowExecutionResult {
  readonly status: 'succeeded' | 'failed';
  readonly result?: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly errors: Readonly<Record<string, Readonly<{ code: string; message: string }>>>;
  readonly loopCounts: Readonly<Record<string, number>>;
  readonly events: readonly WorkflowExecutionEvent[];
}

interface WorkflowExecutionState {
  readonly input: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly errors: Readonly<Record<string, Readonly<{ code: string; message: string }>>>;
  readonly routes: Readonly<Record<string, string>>;
  readonly loopCounts: Readonly<Record<string, number>>;
  readonly events: readonly WorkflowExecutionEvent[];
  readonly result?: unknown;
  readonly failed: boolean;
  readonly signal: AbortSignal | undefined;
}

const ExecutionState = Annotation.Root({
  input: Annotation<unknown>,
  outputs: Annotation<Readonly<Record<string, unknown>>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  errors: Annotation<Readonly<Record<string, Readonly<{ code: string; message: string }>>>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  routes: Annotation<Readonly<Record<string, string>>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  loopCounts: Annotation<Readonly<Record<string, number>>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  events: Annotation<readonly WorkflowExecutionEvent[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  result: Annotation<unknown>,
  failed: Annotation<boolean>,
  signal: Annotation<AbortSignal | undefined>,
});

type StateUpdate = Partial<WorkflowExecutionState>;
type NodeAction = (state: WorkflowExecutionState) => Promise<StateUpdate>;

export interface CompiledWorkflow {
  readonly definition: WorkflowDefinition;
  invoke(input: unknown, signal?: AbortSignal): Promise<WorkflowExecutionResult>;
}

export function compileWorkflow(
  definition: WorkflowDefinition,
  confirmationStatus: 'awaiting_confirmation' | 'confirmed',
  ports: WorkflowRuntimePorts,
): CompiledWorkflow {
  if (confirmationStatus !== 'confirmed')
    throw new WorkflowCompilerError(
      'WORKFLOW_PLAN_NOT_CONFIRMED',
      'Only a confirmed Workflow plan may be compiled.',
    );
  assertCompilable(definition);
  const immutableDefinition = deepFreeze(structuredClone(definition));
  const handlers = new Map(
    immutableDefinition.nodes
      .filter((node) => node.type === 'error_handler')
      .map((node) => [node.handledNodeId, node]),
  );
  const actions: Record<string, NodeAction> = {};
  for (const node of immutableDefinition.nodes)
    actions[graphNodeKey(node.nodeId)] = createNodeAction(
      node,
      immutableDefinition,
      handlers,
      ports,
    );

  const graph = new StateGraph(ExecutionState).addNode(actions);
  const parallelJoins = detectParallelJoins(immutableDefinition);
  const joinedEdges = new Set(
    parallelJoins.flatMap((join) =>
      join.predecessorNodeIds.map(
        (predecessorNodeId) => `${predecessorNodeId}->${join.joinNodeId}`,
      ),
    ),
  );
  graph.addEdge(START, graphNodeKey(immutableDefinition.entryNodeId));
  for (const node of immutableDefinition.nodes) {
    const sourceKey = graphNodeKey(node.nodeId);
    const outgoing = immutableDefinition.edges.filter((edge) => edge.sourceNodeId === node.nodeId);
    const effectiveOutgoing = outgoing.filter(
      (edge) => !joinedEdges.has(`${edge.sourceNodeId}->${edge.targetNodeId}`),
    );
    if (immutableDefinition.exitNodeIds.includes(node.nodeId) || node.type === 'result') {
      const handler = handlers.get(node.nodeId);
      if (handler === undefined) graph.addEdge(sourceKey, END);
      else
        graph.addConditionalEdges(sourceKey, (state) => routeKey(state.routes[node.nodeId]), [
          graphNodeKey(handler.nodeId),
          END,
        ]);
      continue;
    }
    if (node.type === 'parallel') {
      for (const target of node.branchEntryNodeIds) graph.addEdge(sourceKey, graphNodeKey(target));
      continue;
    }
    if (outgoing.length > 0 && effectiveOutgoing.length === 0) continue;
    const routeTargets = routeTargetIds(node, effectiveOutgoing, handlers.get(node.nodeId));
    if (routeTargets.length === 0) graph.addEdge(sourceKey, END);
    else if (routeTargets.length === 1 && !requiresConditionalRouting(node, handlers)) {
      const target = routeTargets[0];
      if (target === undefined)
        throw new WorkflowCompilerError('WORKFLOW_ROUTE_MISSING', 'Static route is missing.');
      graph.addEdge(sourceKey, graphNodeKey(target));
    } else
      graph.addConditionalEdges(sourceKey, (state) => routeKey(state.routes[node.nodeId]), [
        ...routeTargets.map(graphNodeKey),
        END,
      ]);
  }
  for (const join of parallelJoins)
    graph.addEdge(join.predecessorNodeIds.map(graphNodeKey), graphNodeKey(join.joinNodeId));
  const executable = graph.compile({ name: immutableDefinition.workflowDefinitionId });
  return {
    definition: immutableDefinition,
    async invoke(input: unknown, signal?: AbortSignal) {
      const state = await executable.invoke(
        {
          input,
          outputs: {},
          errors: {},
          routes: {},
          loopCounts: {},
          events: [],
          failed: false,
          signal,
        },
        signal === undefined ? undefined : { signal },
      );
      return {
        status: state.failed ? 'failed' : 'succeeded',
        ...(state.result === undefined ? {} : { result: state.result }),
        outputs: state.outputs,
        errors: state.errors,
        loopCounts: state.loopCounts,
        events: state.events,
      };
    },
  };
}

function detectParallelJoins(
  definition: WorkflowDefinition,
): readonly Readonly<{ predecessorNodeIds: readonly string[]; joinNodeId: string }>[] {
  const joins: { predecessorNodeIds: readonly string[]; joinNodeId: string }[] = [];
  for (const node of definition.nodes) {
    if (node.type !== 'parallel') continue;
    const distances = node.branchEntryNodeIds.map((branchNodeId) =>
      graphDistances(branchNodeId, definition.edges),
    );
    const common = [...(distances[0]?.keys() ?? [])].filter((candidate) =>
      distances.every((items) => items.has(candidate)),
    );
    const joinNodeId = common.sort((left, right) => {
      const leftDistances = distances.map((items) => requiredDistance(items, left));
      const rightDistances = distances.map((items) => requiredDistance(items, right));
      return (
        Math.max(...leftDistances) - Math.max(...rightDistances) ||
        leftDistances.reduce((sum, value) => sum + value, 0) -
          rightDistances.reduce((sum, value) => sum + value, 0)
      );
    })[0];
    if (joinNodeId === undefined) continue;
    const predecessorNodeIds = [
      ...new Set(
        definition.edges
          .filter(
            (edge) =>
              edge.targetNodeId === joinNodeId &&
              distances.some((items) => items.has(edge.sourceNodeId)),
          )
          .map((edge) => edge.sourceNodeId),
      ),
    ];
    if (predecessorNodeIds.length >= node.branchEntryNodeIds.length)
      joins.push({ predecessorNodeIds, joinNodeId });
  }
  return joins;
}

function graphDistances(
  entryNodeId: string,
  edges: readonly WorkflowEdge[],
): ReadonlyMap<string, number> {
  const distances = new Map<string, number>([[entryNodeId, 0]]);
  const queue = [entryNodeId];
  while (queue.length > 0) {
    const source = queue.shift();
    if (source === undefined) break;
    const distance = requiredDistance(distances, source);
    for (const edge of edges.filter((candidate) => candidate.sourceNodeId === source)) {
      if (distances.has(edge.targetNodeId)) continue;
      distances.set(edge.targetNodeId, distance + 1);
      queue.push(edge.targetNodeId);
    }
  }
  return distances;
}

function requiredDistance(distances: ReadonlyMap<string, number>, nodeId: string): number {
  const distance = distances.get(nodeId);
  if (distance === undefined)
    throw new WorkflowCompilerError(
      'WORKFLOW_DEFINITION_INVALID',
      `Node ${nodeId} has no graph distance.`,
    );
  return distance;
}

function graphNodeKey(nodeId: string): string {
  return `dsl__${nodeId}`;
}

function routeKey(nodeId: string | undefined): string {
  return nodeId === undefined || nodeId === END ? END : graphNodeKey(nodeId);
}

function createNodeAction(
  node: WorkflowNode,
  definition: WorkflowDefinition,
  handlers: ReadonlyMap<string, Extract<WorkflowNode, { type: 'error_handler' }>>,
  ports: WorkflowRuntimePorts,
): NodeAction {
  return async (state) => {
    const started: WorkflowExecutionEvent = {
      nodeId: node.nodeId,
      type: 'node_started',
      timestamp: ports.now(),
      summary: `${node.type} node started.`,
    };
    try {
      const update = await executeNode(node, state, definition, ports);
      const handler = handlers.get(node.nodeId);
      const successRoute =
        handler === undefined || update.routes?.[node.nodeId] !== undefined
          ? {}
          : { routes: { [node.nodeId]: defaultTarget(definition, node.nodeId) ?? END } };
      return {
        ...update,
        ...successRoute,
        events: [
          started,
          {
            nodeId: node.nodeId,
            type: 'node_succeeded',
            timestamp: ports.now(),
            summary: `${node.type} node succeeded.`,
          },
        ],
      };
    } catch (error: unknown) {
      const handler = handlers.get(node.nodeId);
      if (handler === undefined) throw error;
      return {
        errors: { [node.nodeId]: normalizedError(error) },
        routes: { [node.nodeId]: handler.nodeId },
        events: [
          started,
          {
            nodeId: node.nodeId,
            type: 'node_failed',
            timestamp: ports.now(),
            summary: `${node.type} node failed with ${errorCode(error)}.`,
          },
        ],
      };
    }
  };
}

async function executeNode(
  node: WorkflowNode,
  state: WorkflowExecutionState,
  definition: WorkflowDefinition,
  ports: WorkflowRuntimePorts,
): Promise<StateUpdate> {
  const signal = state.signal;
  switch (node.type) {
    case 'llm':
      return output(
        node.nodeId,
        await ports.executeLlm({
          instruction: node.instruction,
          responseSchema: node.responseSchema,
          ...(signal === undefined ? {} : { signal }),
        }),
      );
    case 'mcp_tool':
      return output(
        node.nodeId,
        await ports.callMcpTool({
          tool: node.tool,
          arguments: node.arguments,
          ...(signal === undefined ? {} : { signal }),
        }),
      );
    case 'skill_call':
      return output(
        node.nodeId,
        await ports.executeSkill({
          skillId: node.skillId,
          input: node.input,
          ...(signal === undefined ? {} : { signal }),
        }),
      );
    case 'subworkflow':
      return output(
        node.nodeId,
        await ports.executeSubworkflow({
          workflowDefinitionId: node.workflowDefinitionId,
          workflowVersion: node.workflowVersion,
          parentInput: state.input,
          ...(signal === undefined ? {} : { signal }),
        }),
      );
    case 'human_confirmation': {
      const confirmed = await ports.requestHumanConfirmation({
        prompt: node.prompt,
        ...(signal === undefined ? {} : { signal }),
      });
      return {
        outputs: { [node.nodeId]: confirmed },
        routes: {
          [node.nodeId]: targetForOutcome(
            definition,
            node.nodeId,
            confirmed ? 'success' : 'failure',
          ),
        },
      };
    }
    case 'result': {
      const result = evaluateWorkflowExpression(node.value, state);
      return { result, outputs: { [node.nodeId]: result } };
    }
    case 'condition': {
      const value = evaluateWorkflowExpression(node.expression, state);
      if (typeof value !== 'boolean')
        throw new WorkflowCompilerError(
          'WORKFLOW_CONDITION_NOT_BOOLEAN',
          'Condition must evaluate to a boolean.',
        );
      return {
        outputs: { [node.nodeId]: value },
        routes: {
          [node.nodeId]: targetForOutcome(definition, node.nodeId, value ? 'true' : 'false'),
        },
      };
    }
    case 'loop': {
      const value = evaluateWorkflowExpression(node.condition, state);
      if (typeof value !== 'boolean')
        throw new WorkflowCompilerError(
          'WORKFLOW_CONDITION_NOT_BOOLEAN',
          'Loop condition must evaluate to a boolean.',
        );
      const count = state.loopCounts[node.nodeId] ?? 0;
      const iterate = value && count < node.maxIterations;
      return {
        loopCounts: { [node.nodeId]: iterate ? count + 1 : count },
        routes: {
          [node.nodeId]: iterate
            ? node.bodyEntryNodeId
            : targetForOutcome(definition, node.nodeId, 'done'),
        },
      };
    }
    case 'parallel':
      return output(node.nodeId, node.branchEntryNodeIds);
    case 'error_handler': {
      const handledError = state.errors[node.handledNodeId];
      if (handledError === undefined)
        throw new WorkflowCompilerError(
          'WORKFLOW_HANDLER_WITHOUT_ERROR',
          'Error handler ran without its handled error.',
        );
      if (node.strategy === 'terminate') return { failed: true, routes: { [node.nodeId]: END } };
      if (node.strategy === 'goto') {
        if (node.gotoNodeId === undefined)
          throw new WorkflowCompilerError(
            'WORKFLOW_DEFINITION_INVALID',
            'Goto error handler requires a target.',
          );
        return { routes: { [node.nodeId]: node.gotoNodeId } };
      }
      const next = defaultTarget(definition, node.nodeId);
      return { routes: { [node.nodeId]: next ?? END } };
    }
  }
}

function output(nodeId: string, value: unknown): StateUpdate {
  return { outputs: { [nodeId]: value } };
}

function targetForOutcome(
  definition: WorkflowDefinition,
  nodeId: string,
  outcome: NonNullable<WorkflowEdge['outcome']>,
): string {
  const edge = definition.edges.find(
    (candidate) => candidate.sourceNodeId === nodeId && candidate.outcome === outcome,
  );
  if (edge === undefined)
    throw new WorkflowCompilerError(
      'WORKFLOW_ROUTE_MISSING',
      `Node ${nodeId} has no ${outcome} route.`,
    );
  return edge.targetNodeId;
}

function defaultTarget(definition: WorkflowDefinition, nodeId: string): string | undefined {
  return definition.edges.find(
    (edge) =>
      edge.sourceNodeId === nodeId && (edge.outcome === undefined || edge.outcome === 'default'),
  )?.targetNodeId;
}

function routeTargetIds(
  node: WorkflowNode,
  outgoing: readonly WorkflowEdge[],
  handler: Extract<WorkflowNode, { type: 'error_handler' }> | undefined,
): readonly string[] {
  const targets = new Set(outgoing.map((edge) => edge.targetNodeId));
  if (node.type === 'loop') targets.add(node.bodyEntryNodeId);
  if (node.type === 'error_handler' && node.gotoNodeId !== undefined) targets.add(node.gotoNodeId);
  if (handler !== undefined) targets.add(handler.nodeId);
  return [...targets];
}

function requiresConditionalRouting(
  node: WorkflowNode,
  handlers: ReadonlyMap<string, Extract<WorkflowNode, { type: 'error_handler' }>>,
): boolean {
  return (
    ['condition', 'loop', 'human_confirmation', 'error_handler'].includes(node.type) ||
    handlers.has(node.nodeId)
  );
}

function assertCompilable(definition: WorkflowDefinition): void {
  const ids = new Set(definition.nodes.map((node) => node.nodeId));
  if (!ids.has(definition.entryNodeId))
    throw new WorkflowCompilerError('WORKFLOW_DEFINITION_INVALID', 'Entry node is missing.');
  const handlers = definition.nodes.filter((node) => node.type === 'error_handler');
  if (new Set(handlers.map((node) => node.handledNodeId)).size !== handlers.length)
    throw new WorkflowCompilerError(
      'WORKFLOW_DEFINITION_INVALID',
      'A node may have only one error handler.',
    );
  for (const node of definition.nodes) {
    const outgoing = definition.edges.filter((edge) => edge.sourceNodeId === node.nodeId);
    if (
      node.type !== 'parallel' &&
      node.type !== 'condition' &&
      node.type !== 'loop' &&
      node.type !== 'human_confirmation' &&
      outgoing.length > 1
    )
      throw new WorkflowCompilerError(
        'WORKFLOW_ROUTE_AMBIGUOUS',
        `Node ${node.nodeId} has ambiguous outgoing routes.`,
      );
  }
}

function normalizedError(error: unknown): Readonly<{ code: string; message: string }> {
  return {
    code: errorCode(error),
    message: error instanceof Error ? error.message : 'Unknown node failure.',
  };
}

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'WORKFLOW_NODE_FAILED';
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export type WorkflowCompilerErrorCode =
  | 'WORKFLOW_CONDITION_NOT_BOOLEAN'
  | 'WORKFLOW_DEFINITION_INVALID'
  | 'WORKFLOW_HANDLER_WITHOUT_ERROR'
  | 'WORKFLOW_PLAN_NOT_CONFIRMED'
  | 'WORKFLOW_ROUTE_AMBIGUOUS'
  | 'WORKFLOW_ROUTE_MISSING'
  | 'WORKFLOW_SUBWORKFLOW_RECURSION_INVALID';

export class WorkflowCompilerError extends Error {
  readonly code: WorkflowCompilerErrorCode;
  constructor(code: WorkflowCompilerErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowCompilerError';
    this.code = code;
  }
}
