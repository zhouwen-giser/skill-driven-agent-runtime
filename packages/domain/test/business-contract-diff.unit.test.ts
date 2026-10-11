import { describe, expect, it } from 'vitest';

import { diffBusinessContract } from '../src/business-contract-diff.js';

describe('pinned business contract differences', () => {
  it('AC-002 reports exact required/type/enum/extension changes without rewriting inputs', () => {
    const before = Object.freeze({
      required: ['taskId'],
      properties: { mode: { type: 'string', enum: ['live'] } },
      extensions: { 'io.sdar/taskBusiness': { profileVersion: '1.0-rc2' } },
    });
    const after = {
      required: ['taskId', 'executionId'],
      properties: { mode: { type: 'number', enum: ['simulation'] } },
      extensions: { 'io.sdar/taskBusiness': { profileVersion: '2.0' } },
    };
    expect(diffBusinessContract(before, after)).toEqual([
      {
        pointer: '/extensions/io.sdar~1taskBusiness/profileVersion',
        before: '1.0-rc2',
        after: '2.0',
        impact: 'requires_successor',
      },
      {
        pointer: '/properties/mode/enum',
        before: ['live'],
        after: ['simulation'],
        impact: 'requires_successor',
      },
      {
        pointer: '/properties/mode/type',
        before: 'string',
        after: 'number',
        impact: 'requires_successor',
      },
      {
        pointer: '/required',
        before: ['taskId'],
        after: ['taskId', 'executionId'],
        impact: 'requires_successor',
      },
    ]);
    expect(before.required).toEqual(['taskId']);
    expect(diffBusinessContract(before, { ...before })).toEqual([]);
  });
});
