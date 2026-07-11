import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

const SpikeState = Annotation.Root({
  count: Annotation<number>,
  route: Annotation<'continue' | 'done'>,
  events: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
});

export interface DynamicGraphResult {
  readonly count: number;
  readonly route: 'continue' | 'done';
  readonly events: readonly string[];
}

export async function runBoundedDynamicGraph(maxIterations: number): Promise<DynamicGraphResult> {
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 100) {
    throw new Error('WORKFLOW_LOOP_BOUND_INVALID');
  }

  const graph = new StateGraph(SpikeState)
    .addNode('step', (state) => {
      const count = state.count + 1;
      return {
        count,
        route: count < maxIterations ? ('continue' as const) : ('done' as const),
        events: [`iteration:${String(count)}`],
      };
    })
    .addEdge(START, 'step')
    .addConditionalEdges('step', (state) => state.route, {
      continue: 'step',
      done: END,
    })
    .compile();

  const result = await graph.invoke({ count: 0, route: 'continue', events: [] });
  return result;
}

const CompositionState = Annotation.Root({
  branches: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  childValue: Annotation<number>,
});

export interface CompositionGraphResult {
  readonly branches: readonly string[];
  readonly childValue: number;
}

export async function runParallelSubgraph(): Promise<CompositionGraphResult> {
  const childGraph = new StateGraph(CompositionState)
    .addNode('child_step', (state) => ({
      childValue: state.childValue + 1,
      branches: ['child'],
    }))
    .addEdge(START, 'child_step')
    .addEdge('child_step', END)
    .compile();

  const parentGraph = new StateGraph(CompositionState)
    .addNode('left', () => ({ branches: ['left'] }))
    .addNode('right', () => ({ branches: ['right'] }))
    .addNode('child', childGraph)
    .addEdge(START, 'left')
    .addEdge(START, 'right')
    .addEdge(['left', 'right'], 'child')
    .addEdge('child', END)
    .compile();

  return parentGraph.invoke({ branches: [], childValue: 0 });
}
