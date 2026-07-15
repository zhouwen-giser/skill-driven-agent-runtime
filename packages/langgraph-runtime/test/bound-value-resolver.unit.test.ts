import { describe, expect, it } from 'vitest';

import type { WorkflowBindingError } from '../src/bound-value-resolver.js';
import { resolveWorkflowBoundValue } from '../src/bound-value-resolver.js';

describe('Workflow bound-value resolver', () => {
  it('recursively resolves every whitelisted state root through objects and arrays', () => {
    const snapshot = resolveWorkflowBoundValue(
      {
        initial: { op: 'ref', path: ['input', 'device', 'id'] },
        nodeAlias: { op: 'ref', path: ['nodes', 'query', 'data', 'status'] },
        directOutput: { op: 'ref', path: ['outputs', 'query', 'data', 'samples', '1'] },
        error: { op: 'ref', path: ['errors', 'control'] },
        loop: { op: 'ref', path: ['loopCounts', 'retry'] },
        result: { op: 'ref', path: ['result', 'summary'] },
        nested: [null, [], { value: { op: 'ref', path: ['input', 'target'] } }],
      },
      {
        input: { device: { id: 'device-1' }, target: 21 },
        outputs: {
          query: { data: { status: 'online', samples: [3, 8] } },
        },
        errors: { control: { code: 'MCP_OFFLINE', message: 'offline' } },
        loopCounts: { retry: 2 },
        result: { summary: 'done' },
      },
    );

    expect(snapshot).toEqual({
      initial: 'device-1',
      nodeAlias: 'online',
      directOutput: 8,
      error: { code: 'MCP_OFFLINE', message: 'offline' },
      loop: 2,
      result: 'done',
      nested: [null, [], { value: 21 }],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen((snapshot as { nested: unknown[] }).nested)).toBe(true);
  });

  it('creates an immutable detached snapshot of referenced upstream data', () => {
    const upstream = { data: { values: [{ target: 21 }] } };
    const snapshot = resolveWorkflowBoundValue(
      { payload: { op: 'ref', path: ['outputs', 'query'] } },
      { input: {}, outputs: { query: upstream }, errors: {}, loopCounts: {} },
    ) as { payload: { data: { values: { target: number }[] } } };

    const upstreamValue = upstream.data.values[0];
    const snapshotValue = snapshot.payload.data.values[0];
    if (upstreamValue === undefined || snapshotValue === undefined)
      throw new Error('BOUND_VALUE_FIXTURE_MISSING');
    upstreamValue.target = 99;
    expect(snapshotValue.target).toBe(21);
    expect(Object.isFrozen(snapshotValue)).toBe(true);
    expect(() => {
      snapshotValue.target = 42;
    }).toThrow();
  });

  it('reports a readable stable error for a missing object or array segment', () => {
    expect(() =>
      resolveWorkflowBoundValue(
        { op: 'ref', path: ['outputs', 'query', 'missing'] },
        { input: {}, outputs: { query: {} }, errors: {}, loopCounts: {} },
      ),
    ).toThrow(
      expect.objectContaining<Partial<WorkflowBindingError>>({
        code: 'WORKFLOW_BINDING_REFERENCE_MISSING',
        message: expect.stringContaining('outputs.query.missing'),
      }),
    );
    expect(() =>
      resolveWorkflowBoundValue(
        { op: 'ref', path: ['outputs', 'items', '4'] },
        { input: {}, outputs: { items: [1] }, errors: {}, loopCounts: {} },
      ),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_BINDING_REFERENCE_MISSING' }));
  });

  it('rejects non-JSON and non-finite referenced values', () => {
    for (const invalid of [undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date()])
      expect(() =>
        resolveWorkflowBoundValue(
          { op: 'ref', path: ['outputs', 'invalid'] },
          { input: {}, outputs: { invalid }, errors: {}, loopCounts: {} },
        ),
      ).toThrow(expect.objectContaining({ code: 'WORKFLOW_BINDING_VALUE_INVALID' }));
  });
});
