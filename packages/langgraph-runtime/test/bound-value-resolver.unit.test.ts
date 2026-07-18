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

  it('resolves bounded Skill context and Provider evidence through reserved roots', () => {
    const resolved = resolveWorkflowBoundValue(
      {
        permission: { op: 'ref', path: ['context', 'permission'] },
        position: { op: 'ref', path: ['evidence', 'final-position'] },
      },
      {
        input: { skillInput: {}, context: { permission: true }, evidence: {} },
        outputs: {
          move: {
            data: { structuredContent: { evidence: { 'final-position': true } } },
          },
        },
        errors: {},
        loopCounts: {},
      },
    );

    expect(resolved).toEqual({ permission: true, position: true });
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
    expect(() =>
      resolveWorkflowBoundValue(
        { op: 'ref', path: ['result'] },
        { input: {}, outputs: {}, errors: {}, loopCounts: {} },
      ),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_BINDING_REFERENCE_MISSING' }));
    expect(() =>
      resolveWorkflowBoundValue(
        { op: 'ref', path: ['outputs', 'node.with.dot', 'missing'] },
        { input: {}, outputs: { 'node.with.dot': {} }, errors: {}, loopCounts: {} },
      ),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('["outputs","node.with.dot","missing"]'),
      }),
    );
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

  it('supports deep bounded JSON while rejecting unbounded template and referenced recursion', () => {
    let allowedTemplate: Parameters<typeof resolveWorkflowBoundValue>[0] = null;
    for (let index = 0; index < 64; index += 1) allowedTemplate = { nested: allowedTemplate };
    expect(() =>
      resolveWorkflowBoundValue(allowedTemplate, {
        input: {},
        outputs: {},
        errors: {},
        loopCounts: {},
      }),
    ).not.toThrow();

    const tooDeepTemplate = { nested: allowedTemplate };
    expect(() =>
      resolveWorkflowBoundValue(tooDeepTemplate, {
        input: {},
        outputs: {},
        errors: {},
        loopCounts: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_BINDING_DEPTH_EXCEEDED' }));

    let tooDeepOutput: unknown = null;
    for (let index = 0; index < 65; index += 1) tooDeepOutput = { nested: tooDeepOutput };
    expect(() =>
      resolveWorkflowBoundValue(
        { op: 'ref', path: ['outputs', 'deep'] },
        { input: {}, outputs: { deep: tooDeepOutput }, errors: {}, loopCounts: {} },
      ),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_BINDING_DEPTH_EXCEEDED' }));

    const cyclicOutput: { self?: unknown } = {};
    cyclicOutput.self = cyclicOutput;
    expect(() =>
      resolveWorkflowBoundValue(
        { op: 'ref', path: ['outputs', 'cyclic'] },
        { input: {}, outputs: { cyclic: cyclicOutput }, errors: {}, loopCounts: {} },
      ),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_BINDING_DEPTH_EXCEEDED' }));
  });
});
