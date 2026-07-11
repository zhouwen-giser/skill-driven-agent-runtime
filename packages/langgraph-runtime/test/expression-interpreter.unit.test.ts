import { describe, expect, it } from 'vitest';

import { evaluateWorkflowExpression } from '../src/expression-interpreter.js';

const context = {
  input: { approved: true, score: 3 },
  outputs: { model: { label: 'ok' } },
  errors: {},
  loopCounts: { retry: 2 },
};

describe('restricted Workflow expression interpreter', () => {
  it('evaluates nested references, boolean operators and ordered scalar comparisons', () => {
    expect(
      evaluateWorkflowExpression(
        {
          op: 'and',
          left: { op: 'ref', path: ['input', 'approved'] },
          right: {
            op: 'gte',
            left: { op: 'ref', path: ['input', 'score'] },
            right: { op: 'literal', value: 3 },
          },
        },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateWorkflowExpression(
        {
          op: 'eq',
          left: { op: 'ref', path: ['outputs', 'model', 'label'] },
          right: { op: 'literal', value: 'ok' },
        },
        context,
      ),
    ).toBe(true);
  });

  it('rejects missing references and implicit truthiness/coercion', () => {
    expect(() =>
      evaluateWorkflowExpression({ op: 'ref', path: ['input', 'missing'] }, context),
    ).toThrow('does not exist');
    expect(() =>
      evaluateWorkflowExpression({ op: 'not', operand: { op: 'literal', value: 1 } }, context),
    ).toThrow('must evaluate to a boolean');
    expect(() =>
      evaluateWorkflowExpression(
        {
          op: 'lt',
          left: { op: 'literal', value: 1 },
          right: { op: 'literal', value: '2' },
        },
        context,
      ),
    ).toThrow('same type');
  });
});
