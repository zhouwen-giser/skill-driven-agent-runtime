import { describe, expect, it } from 'vitest';

import { runBoundedDynamicGraph, runParallelSubgraph } from '../src/dynamic-graph-spike.js';

describe('LangGraph dynamic compiler compatibility', () => {
  it('executes a conditionally routed, explicitly bounded loop', async () => {
    await expect(runBoundedDynamicGraph(3)).resolves.toEqual({
      count: 3,
      route: 'done',
      events: ['iteration:1', 'iteration:2', 'iteration:3'],
    });
  });

  it.each([0, -1, 101, 1.5])('rejects invalid loop bound %s', async (bound) => {
    await expect(runBoundedDynamicGraph(bound)).rejects.toThrow('WORKFLOW_LOOP_BOUND_INVALID');
  });

  it('joins parallel branches before executing a compiled subgraph', async () => {
    const result = await runParallelSubgraph();

    expect(new Set(result.branches)).toEqual(new Set(['left', 'right', 'child']));
    expect(result.childValue).toBe(1);
  });
});
