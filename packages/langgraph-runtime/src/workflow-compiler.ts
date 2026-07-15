import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from '@langchain/langgraph';

import type {
  ToolReference,
  WorkflowBudgetLimits,
  WorkflowBudgetTerminationReason,
  WorkflowBudgetUsage,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRecoveryOption,
} from '../../domain/src/index.js';
import { normalizeResultEnvelope } from '../../domain/src/index.js';
import { resolveWorkflowBoundValue } from './bound-value-resolver.js';
import { evaluateWorkflowExpression } from './expression-interpreter.js';

export interface WorkflowExecutionEvent {
  readonly nodeId: string;
  readonly type: 'node_started' | 'node_succeeded' | 'node_failed';
  readonly timestamp: string;
  readonly durationMs?: number;
  readonly summary: string;
}

export interface WorkflowRuntimePorts {
  readonly executeLlm: (
    input: Readonly<{
      executionId: string;
      instruction: string;
      context?: unknown;
      responseSchema: unknown;
      signal?: AbortSignal;
    }>,
  ) => Promise<unknown>;
  readonly callMcpTool: (
    input: Readonly<{
      executionId: string;
      tool: ToolReference;
      arguments: unknown;
      signal?: AbortSignal;
    }>,
  ) => Promise<unknown>;
  readonly executeSkill: (
    input: Readonly<{
      skillId: string;
      input: unknown;
      parentExecutionId: string;
      parentNodeId: string;
      signal?: AbortSignal;
    }>,
  ) => Promise<unknown>;
  readonly executeSubworkflow: (
    input: Readonly<{
      workflowDefinitionId: string;
      workflowVersion: number;
      input: unknown;
      signal?: AbortSignal;
    }>,
  ) => Promise<unknown>;
  readonly requestHumanConfirmation: (
    input: Readonly<{
      prompt: string;
      signal?: AbortSignal;
    }>,
  ) => Promise<boolean>;
  readonly decideExecutionError: (
    input: Readonly<{
      handledNodeId: string;
      error: Readonly<{ code: string; message: string }>;
      allowedStrategies: readonly ('terminate' | 'continue' | 'goto')[];
      gotoNodeId?: string;
      allowedRecoveryOptions?: readonly WorkflowRecoveryOption[];
    }>,
  ) => Promise<
    Readonly<{
      strategy: 'terminate' | 'continue' | 'goto';
      summary: string;
      recoveryAction?: WorkflowRecoveryOption['action'] | undefined;
      targetNodeId?: string | undefined;
    }>
  >;
  readonly now: () => string;
  readonly nowMilliseconds: () => number;
}

export interface WorkflowCallCosts {
  readonly llm: number;
  readonly mcp: number;
  readonly skill: number;
  readonly subworkflow: number;
}

export interface WorkflowExecutionResult {
  readonly status: 'paused' | 'succeeded' | 'failed' | 'canceled';
  readonly result?: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly errors: Readonly<Record<string, Readonly<{ code: string; message: string }>>>;
  readonly loopCounts: Readonly<Record<string, number>>;
  readonly recoveryCounts: Readonly<Record<string, number>>;
  readonly events: readonly WorkflowExecutionEvent[];
  readonly budgetUsage: WorkflowBudgetUsage;
  readonly terminationReason?: WorkflowBudgetTerminationReason;
  readonly pendingConfirmation?: Readonly<{
    nodeId: string;
    prompt: string;
    kind?: 'human_confirmation' | 'task_pause';
    pausedAt?: string;
  }>;
}

interface WorkflowExecutionState {
  readonly executionId: string;
  readonly input: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly errors: Readonly<Record<string, Readonly<{ code: string; message: string }>>>;
  readonly routes: Readonly<Record<string, string>>;
  readonly loopCounts: Readonly<Record<string, number>>;
  readonly recoveryCounts: Readonly<Record<string, number>>;
  readonly events: readonly WorkflowExecutionEvent[];
  readonly result?: unknown;
  readonly failed: boolean;
}

const ExecutionState = Annotation.Root({
  executionId: Annotation<string>,
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
  recoveryCounts: Annotation<Readonly<Record<string, number>>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  events: Annotation<readonly WorkflowExecutionEvent[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  result: Annotation<unknown>,
  failed: Annotation<boolean>,
});

type StateUpdate = Partial<WorkflowExecutionState>;
type NodeAction = (state: WorkflowExecutionState) => Promise<StateUpdate>;

export interface CompiledWorkflow {
  readonly definition: WorkflowDefinition;
  invoke(
    input: unknown,
    budgetLimits: WorkflowBudgetLimits,
    callCosts: WorkflowCallCosts,
    signal?: AbortSignal,
    executionId?: string,
  ): Promise<WorkflowExecutionResult>;
  resume(
    executionId: string,
    confirmed: boolean,
    signal?: AbortSignal,
  ): Promise<WorkflowExecutionResult>;
  requestPause(executionId: string): boolean;
  requestCancel(executionId: string, interruptCurrent: boolean): boolean;
}

interface ExecutionControl {
  pauseRequested: boolean;
  cancelRequested: boolean;
  readonly activeCallAbort: AbortController;
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
  const runtimeContexts = new Map<
    string,
    Readonly<{
      budgetMeter: WorkflowBudgetMeter;
      control: ExecutionControl;
      signal?: AbortSignal;
    }>
  >();
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
      (executionId) => requiredRuntimeContext(runtimeContexts, executionId),
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
  const executable = graph.compile({
    name: immutableDefinition.workflowDefinitionId,
    checkpointer: new MemorySaver(),
  });
  const resultFromState = (
    state: WorkflowExecutionState & Readonly<Record<string, unknown>>,
    previousEventCount = 0,
  ): WorkflowExecutionResult => {
    const pending = pendingConfirmation(state);
    return {
      status: pending === undefined ? (state.failed ? 'failed' : 'succeeded') : 'paused',
      ...(state.result === undefined ? {} : { result: state.result }),
      outputs: state.outputs,
      errors: state.errors,
      loopCounts: state.loopCounts,
      recoveryCounts: state.recoveryCounts,
      events: state.events.slice(previousEventCount),
      budgetUsage: requiredRuntimeContext(
        runtimeContexts,
        state.executionId,
      ).budgetMeter.snapshot(),
      ...(pending === undefined ? {} : { pendingConfirmation: pending }),
    };
  };
  return {
    definition: immutableDefinition,
    async invoke(input, budgetLimits, callCosts, signal, executionId) {
      const budgetMeter = new WorkflowBudgetMeter(budgetLimits, callCosts, ports.nowMilliseconds);
      const runId = executionId ?? immutableDefinition.workflowDefinitionId;
      runtimeContexts.set(runId, {
        budgetMeter,
        control: {
          pauseRequested: false,
          cancelRequested: false,
          activeCallAbort: new AbortController(),
        },
        ...(signal === undefined ? {} : { signal }),
      });
      try {
        const state = await executable.invoke(
          {
            executionId: runId,
            input,
            outputs: {},
            errors: {},
            routes: {},
            loopCounts: {},
            recoveryCounts: {},
            events: [],
            failed: false,
          },
          {
            configurable: { thread_id: runId },
            ...(signal === undefined ? {} : { signal }),
          },
        );
        return resultFromState(state);
      } catch (error: unknown) {
        if (
          error instanceof WorkflowCanceledError ||
          runtimeContexts.get(runId)?.control.cancelRequested === true
        ) {
          const state = await executable.getState({ configurable: { thread_id: runId } });
          const result = resultFromState(
            state.values as WorkflowExecutionState & Readonly<Record<string, unknown>>,
          );
          runtimeContexts.delete(runId);
          return {
            ...result,
            status: 'canceled',
            errors: {
              ...result.errors,
              cancellation: {
                code: 'WORKFLOW_CANCELED',
                message:
                  'Workflow canceled; no subsequent node was started and no automatic compensation ran.',
              },
            },
          };
        }
        if (!(error instanceof WorkflowBudgetExceededError)) throw error;
        return {
          status: 'failed',
          outputs: {},
          errors: { budget: { code: error.code, message: error.message } },
          loopCounts: {},
          recoveryCounts: {},
          events: [],
          budgetUsage: budgetMeter.snapshot(),
          terminationReason: error.reason,
        };
      }
    },
    async resume(executionId, confirmed, signal) {
      const existingContext = runtimeContexts.get(executionId);
      if (existingContext === undefined)
        throw new WorkflowCompilerError(
          'WORKFLOW_CHECKPOINT_NOT_AVAILABLE',
          'Workflow checkpoint is unavailable and cannot be recovered or retried.',
        );
      const config = {
        configurable: { thread_id: executionId },
        ...(signal === undefined ? {} : { signal }),
      };
      runtimeContexts.set(executionId, {
        budgetMeter: existingContext.budgetMeter,
        control: existingContext.control,
        ...(signal === undefined ? {} : { signal }),
      });
      existingContext.budgetMeter.resume();
      const before = await executable.getState(config);
      const previousEventCount = workflowEventCount(before.values);
      const state = await executable.invoke(new Command({ resume: confirmed }), config);
      const result = resultFromState(state, previousEventCount);
      if (result.status !== 'paused') runtimeContexts.delete(executionId);
      return result;
    },
    requestPause(executionId) {
      const context = runtimeContexts.get(executionId);
      if (context === undefined) return false;
      context.control.pauseRequested = true;
      return true;
    },
    requestCancel(executionId, interruptCurrent) {
      const context = runtimeContexts.get(executionId);
      if (context === undefined) return false;
      context.control.cancelRequested = true;
      if (interruptCurrent) context.control.activeCallAbort.abort(new Error('WORKFLOW_CANCELED'));
      return true;
    },
  };
}

function pendingConfirmation(
  state: Readonly<Record<string, unknown>>,
): WorkflowExecutionResult['pendingConfirmation'] {
  const interruptions = state['__interrupt__'];
  if (!Array.isArray(interruptions)) return undefined;
  const first: unknown = interruptions[0];
  if (typeof first !== 'object' || first === null || !('value' in first)) return undefined;
  const value: unknown = first.value;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('nodeId' in value) ||
    typeof value.nodeId !== 'string' ||
    !('prompt' in value) ||
    typeof value.prompt !== 'string'
  )
    return undefined;
  const kind =
    'kind' in value && (value.kind === 'human_confirmation' || value.kind === 'task_pause')
      ? value.kind
      : undefined;
  const pausedAt =
    'pausedAt' in value && typeof value.pausedAt === 'string' ? value.pausedAt : undefined;
  return {
    nodeId: value.nodeId,
    prompt: value.prompt,
    ...(kind === undefined ? {} : { kind }),
    ...(pausedAt === undefined ? {} : { pausedAt }),
  };
}

function workflowEventCount(value: unknown): number {
  if (typeof value !== 'object' || value === null || !('events' in value)) return 0;
  return Array.isArray(value.events) ? value.events.length : 0;
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
  runtimeContext: (executionId: string) => Readonly<{
    budgetMeter: WorkflowBudgetMeter;
    control: ExecutionControl;
    signal?: AbortSignal;
  }>,
): NodeAction {
  return async (state) => {
    const context = runtimeContext(state.executionId);
    if (context.control.cancelRequested) throw new WorkflowCanceledError();
    if (context.control.pauseRequested) {
      context.budgetMeter.pause();
      interrupt<
        Readonly<{
          nodeId: string;
          prompt: string;
          kind: 'task_pause';
          pausedAt: string;
        }>,
        boolean
      >({
        nodeId: node.nodeId,
        prompt: 'Task paused before the next Workflow node.',
        kind: 'task_pause',
        pausedAt: ports.now(),
      });
      context.control.pauseRequested = false;
      context.budgetMeter.resume();
    }
    context.budgetMeter.assertDuration();
    const startedAtMilliseconds = ports.nowMilliseconds();
    const started: WorkflowExecutionEvent = {
      nodeId: node.nodeId,
      type: 'node_started',
      timestamp: ports.now(),
      summary: `${node.type} node started.`,
    };
    try {
      const update = await executeNode(node, state, definition, ports, context);
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
            durationMs: Math.max(0, ports.nowMilliseconds() - startedAtMilliseconds),
            summary: `${node.type} node succeeded.`,
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof WorkflowBudgetExceededError) throw error;
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
            durationMs: Math.max(0, ports.nowMilliseconds() - startedAtMilliseconds),
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
  runtimeContext: Readonly<{
    budgetMeter: WorkflowBudgetMeter;
    control: ExecutionControl;
    signal?: AbortSignal;
  }>,
): Promise<StateUpdate> {
  const signal =
    runtimeContext.signal === undefined
      ? runtimeContext.control.activeCallAbort.signal
      : AbortSignal.any([runtimeContext.signal, runtimeContext.control.activeCallAbort.signal]);
  const budgetMeter = runtimeContext.budgetMeter;
  switch (node.type) {
    case 'llm': {
      budgetMeter.reserve('llm');
      const callSignal = budgetMeter.signal(signal);
      const dynamicContext =
        node.context === undefined ? undefined : resolveWorkflowBoundValue(node.context, state);
      const value = await ports.executeLlm({
        executionId: state.executionId,
        instruction: node.instruction,
        ...(dynamicContext === undefined ? {} : { context: dynamicContext }),
        responseSchema: node.responseSchema,
        signal: callSignal,
      });
      budgetMeter.assertDuration();
      return output(node.nodeId, value);
    }
    case 'mcp_tool': {
      budgetMeter.reserve('mcp');
      const callSignal = budgetMeter.signal(signal);
      const argumentsSnapshot = resolveWorkflowBoundValue(node.arguments, state);
      const value = await ports.callMcpTool({
        executionId: state.executionId,
        tool: node.tool,
        arguments: argumentsSnapshot,
        signal: callSignal,
      });
      budgetMeter.assertDuration();
      return output(node.nodeId, normalizeResultEnvelope(value));
    }
    case 'skill_call': {
      budgetMeter.reserve('skill');
      const callSignal = budgetMeter.signal(signal);
      const inputSnapshot = resolveWorkflowBoundValue(node.input, state);
      const value = await ports.executeSkill({
        skillId: node.skillId,
        input: inputSnapshot,
        parentExecutionId: state.executionId,
        parentNodeId: node.nodeId,
        signal: callSignal,
      });
      budgetMeter.assertDuration();
      return output(node.nodeId, value);
    }
    case 'subworkflow': {
      budgetMeter.reserve('subworkflow');
      const callSignal = budgetMeter.signal(signal);
      const inputSnapshot = resolveWorkflowBoundValue(node.input, state);
      const value = await ports.executeSubworkflow({
        workflowDefinitionId: node.workflowDefinitionId,
        workflowVersion: node.workflowVersion,
        input: inputSnapshot,
        signal: callSignal,
      });
      budgetMeter.assertDuration();
      return output(node.nodeId, value);
    }
    case 'human_confirmation': {
      budgetMeter.assertDuration();
      budgetMeter.pause();
      const confirmed = interrupt<
        Readonly<{
          nodeId: string;
          prompt: string;
          kind: 'human_confirmation';
          pausedAt: string;
        }>,
        boolean
      >({
        nodeId: node.nodeId,
        prompt: node.prompt,
        kind: 'human_confirmation',
        pausedAt: ports.now(),
      });
      budgetMeter.resume();
      budgetMeter.assertDuration();
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
      const configuredRecoveryOptions = node.recoveryOptions ?? [];
      const availableRecoveryOptions = configuredRecoveryOptions.filter(
        (option) =>
          (state.recoveryCounts[recoveryKey(node.nodeId, option)] ?? 0) < option.maxAttempts,
      );
      const allowedStrategies: readonly ('terminate' | 'continue' | 'goto')[] =
        configuredRecoveryOptions.length > 0
          ? availableRecoveryOptions.length > 0
            ? ['terminate', 'goto']
            : ['terminate']
          : node.gotoNodeId === undefined
            ? ['terminate', 'continue']
            : ['terminate', 'continue', 'goto'];
      const decision = await ports.decideExecutionError({
        handledNodeId: node.handledNodeId,
        error: handledError,
        allowedStrategies,
        ...(node.gotoNodeId === undefined ? {} : { gotoNodeId: node.gotoNodeId }),
        ...(configuredRecoveryOptions.length === 0
          ? {}
          : { allowedRecoveryOptions: availableRecoveryOptions }),
      });
      if (!allowedStrategies.includes(decision.strategy))
        throw new WorkflowCompilerError(
          'WORKFLOW_ERROR_DECISION_INVALID',
          'Execution error decision selected a strategy outside the constrained choices.',
        );
      if (decision.strategy === 'terminate')
        return {
          failed: true,
          outputs: { [node.nodeId]: decision },
          routes: { [node.nodeId]: END },
        };
      if (decision.strategy === 'goto') {
        if (configuredRecoveryOptions.length > 0) {
          const recovery = availableRecoveryOptions.find(
            (option) =>
              option.action === decision.recoveryAction &&
              option.targetNodeId === decision.targetNodeId,
          );
          if (recovery === undefined)
            throw new WorkflowCompilerError(
              'WORKFLOW_ERROR_DECISION_INVALID',
              'Execution error decision selected an unavailable recovery action.',
            );
          const key = recoveryKey(node.nodeId, recovery);
          return {
            outputs: { [node.nodeId]: decision },
            recoveryCounts: { [key]: (state.recoveryCounts[key] ?? 0) + 1 },
            routes: { [node.nodeId]: recovery.targetNodeId },
          };
        }
        if (node.gotoNodeId === undefined)
          throw new WorkflowCompilerError(
            'WORKFLOW_DEFINITION_INVALID',
            'Goto error handler requires a target.',
          );
        return {
          outputs: { [node.nodeId]: decision },
          routes: { [node.nodeId]: node.gotoNodeId },
        };
      }
      const next = defaultTarget(definition, node.nodeId);
      return { outputs: { [node.nodeId]: decision }, routes: { [node.nodeId]: next ?? END } };
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
  if (node.type === 'error_handler')
    for (const option of node.recoveryOptions ?? []) targets.add(option.targetNodeId);
  if (handler !== undefined) targets.add(handler.nodeId);
  return [...targets];
}

function recoveryKey(nodeId: string, option: WorkflowRecoveryOption): string {
  return `${nodeId}:${option.action}:${option.targetNodeId}`;
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
    if (node.type === 'error_handler' && node.recoveryOptions !== undefined) {
      const recoveryKeys = node.recoveryOptions.map(
        (option) => `${option.action}:${option.targetNodeId}`,
      );
      if (
        node.strategy !== 'goto' ||
        node.gotoNodeId !== undefined ||
        recoveryKeys.length === 0 ||
        new Set(recoveryKeys).size !== recoveryKeys.length ||
        node.recoveryOptions.some(
          (option) =>
            !ids.has(option.targetNodeId) || option.maxAttempts < 1 || option.maxAttempts > 10,
        )
      )
        throw new WorkflowCompilerError(
          'WORKFLOW_DEFINITION_INVALID',
          `Error handler ${node.nodeId} has invalid bounded recovery options.`,
        );
    }
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

function requiredRuntimeContext<T>(contexts: ReadonlyMap<string, T>, executionId: string): T {
  const context = contexts.get(executionId);
  if (context === undefined)
    throw new WorkflowCompilerError(
      'WORKFLOW_CHECKPOINT_NOT_AVAILABLE',
      'Workflow runtime context is unavailable and cannot be recovered or retried.',
    );
  return context;
}

export type WorkflowCompilerErrorCode =
  | 'WORKFLOW_CONDITION_NOT_BOOLEAN'
  | 'WORKFLOW_DEFINITION_INVALID'
  | 'WORKFLOW_ERROR_DECISION_INVALID'
  | 'WORKFLOW_HANDLER_WITHOUT_ERROR'
  | 'WORKFLOW_PLAN_NOT_CONFIRMED'
  | 'WORKFLOW_ROUTE_AMBIGUOUS'
  | 'WORKFLOW_ROUTE_MISSING'
  | 'WORKFLOW_SUBWORKFLOW_RECURSION_INVALID'
  | 'WORKFLOW_BUDGET_CONFIGURATION_INVALID'
  | 'WORKFLOW_CHECKPOINT_NOT_AVAILABLE';

class WorkflowCanceledError extends Error {
  readonly code = 'WORKFLOW_CANCELED';
  constructor() {
    super('Workflow canceled; no subsequent node was started and no automatic compensation ran.');
    this.name = 'WorkflowCanceledError';
  }
}

export class WorkflowCompilerError extends Error {
  readonly code: WorkflowCompilerErrorCode;
  constructor(code: WorkflowCompilerErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowCompilerError';
    this.code = code;
  }
}

type MeteredCallKind = keyof WorkflowCallCosts;

class WorkflowBudgetMeter {
  readonly #limits: WorkflowBudgetLimits;
  readonly #costs: WorkflowCallCosts;
  readonly #now: () => number;
  #activeStartedAt: number | undefined;
  #elapsedMs = 0;
  #llmCalls = 0;
  #mcpCalls = 0;
  #cost = 0;

  constructor(limits: WorkflowBudgetLimits, costs: WorkflowCallCosts, now: () => number) {
    validateMeterInputs(limits, costs);
    this.#limits = limits;
    this.#costs = costs;
    this.#now = now;
    this.#activeStartedAt = now();
  }

  assertDuration(): void {
    if (this.#durationMs() >= this.#limits.maxDurationSeconds * 1000)
      throw new WorkflowBudgetExceededError(
        'WORKFLOW_DURATION_BUDGET_EXHAUSTED',
        'duration_exhausted',
      );
  }

  reserve(kind: MeteredCallKind): void {
    this.assertDuration();
    const llmIncrement = kind === 'llm' || kind === 'skill' ? 1 : 0;
    const mcpIncrement = kind === 'mcp' ? 1 : 0;
    if (this.#llmCalls + llmIncrement > this.#limits.maxLlmCalls)
      throw new WorkflowBudgetExceededError(
        'WORKFLOW_LLM_CALL_BUDGET_EXHAUSTED',
        'llm_calls_exhausted',
      );
    if (this.#mcpCalls + mcpIncrement > this.#limits.maxMcpCalls)
      throw new WorkflowBudgetExceededError(
        'WORKFLOW_MCP_CALL_BUDGET_EXHAUSTED',
        'mcp_calls_exhausted',
      );
    const nextCost = this.#cost + this.#costs[kind];
    if (nextCost > this.#limits.maxCost)
      throw new WorkflowBudgetExceededError('WORKFLOW_COST_BUDGET_EXHAUSTED', 'cost_exhausted');
    this.#llmCalls += llmIncrement;
    this.#mcpCalls += mcpIncrement;
    this.#cost = nextCost;
  }

  signal(parent: AbortSignal | undefined): AbortSignal {
    this.assertDuration();
    const remaining = Math.max(1, this.#limits.maxDurationSeconds * 1000 - this.#durationMs());
    const deadline = AbortSignal.timeout(remaining);
    return parent === undefined ? deadline : AbortSignal.any([parent, deadline]);
  }

  snapshot(): WorkflowBudgetUsage {
    return {
      replanCount: 0,
      durationMs: this.#durationMs(),
      llmCalls: this.#llmCalls,
      mcpCalls: this.#mcpCalls,
      cost: this.#cost,
    };
  }

  pause(): void {
    if (this.#activeStartedAt === undefined) return;
    this.#elapsedMs += Math.max(0, this.#now() - this.#activeStartedAt);
    this.#activeStartedAt = undefined;
  }

  resume(): void {
    if (this.#activeStartedAt !== undefined) return;
    this.#activeStartedAt = this.#now();
  }

  #durationMs(): number {
    return (
      this.#elapsedMs +
      (this.#activeStartedAt === undefined ? 0 : Math.max(0, this.#now() - this.#activeStartedAt))
    );
  }
}

function validateMeterInputs(limits: WorkflowBudgetLimits, costs: WorkflowCallCosts): void {
  if (
    !Number.isInteger(limits.maxReplans) ||
    limits.maxReplans < 0 ||
    !Number.isInteger(limits.maxDurationSeconds) ||
    limits.maxDurationSeconds < 1 ||
    !Number.isInteger(limits.maxLlmCalls) ||
    limits.maxLlmCalls < 0 ||
    !Number.isInteger(limits.maxMcpCalls) ||
    limits.maxMcpCalls < 0 ||
    !Number.isFinite(limits.maxCost) ||
    limits.maxCost < 0 ||
    Object.values(costs).some((cost) => !Number.isFinite(cost) || cost < 0)
  )
    throw new WorkflowCompilerError(
      'WORKFLOW_BUDGET_CONFIGURATION_INVALID',
      'Workflow budget limits and call costs must be finite and nonnegative.',
    );
}

export type WorkflowBudgetErrorCode =
  | 'WORKFLOW_COST_BUDGET_EXHAUSTED'
  | 'WORKFLOW_DURATION_BUDGET_EXHAUSTED'
  | 'WORKFLOW_LLM_CALL_BUDGET_EXHAUSTED'
  | 'WORKFLOW_MCP_CALL_BUDGET_EXHAUSTED';

export class WorkflowBudgetExceededError extends Error {
  readonly code: WorkflowBudgetErrorCode;
  readonly reason: Exclude<WorkflowBudgetTerminationReason, 'replans_exhausted'>;
  constructor(
    code: WorkflowBudgetErrorCode,
    reason: Exclude<WorkflowBudgetTerminationReason, 'replans_exhausted'>,
  ) {
    super(`Workflow terminated because ${reason.replaceAll('_', ' ')}.`);
    this.name = 'WorkflowBudgetExceededError';
    this.code = code;
    this.reason = reason;
  }
}
