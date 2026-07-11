import { describe, expect, it } from 'vitest';

import { resolveWorkflowBudgetLimits } from '../src/workflow-budget.js';

const defaults = {
  maxReplans: 3,
  maxDurationSeconds: 300,
  maxLlmCalls: 20,
  maxMcpCalls: 10,
  maxCost: 100,
};

describe('Workflow budget policy resolution', () => {
  it('uses system defaults when no Skill overrides a field', () => {
    expect(resolveWorkflowBudgetLimits(defaults, [])).toEqual(defaults);
    expect(
      resolveWorkflowBudgetLimits(defaults, [{ autoConfirmPlan: false, maxMcpCalls: 2 }]),
    ).toEqual({ ...defaults, maxMcpCalls: 2 });
  });

  it('uses the most restrictive effective limit across composed Skills', () => {
    expect(
      resolveWorkflowBudgetLimits(defaults, [
        { autoConfirmPlan: false, maxLlmCalls: 8, maxCost: 70 },
        { autoConfirmPlan: true, maxLlmCalls: 4, maxDurationSeconds: 30 },
      ]),
    ).toEqual({
      maxReplans: 3,
      maxDurationSeconds: 30,
      maxLlmCalls: 4,
      maxMcpCalls: 10,
      maxCost: 70,
    });
  });

  it('rejects invalid system and Skill budget values', () => {
    expect(() => resolveWorkflowBudgetLimits({ ...defaults, maxCost: Number.NaN }, [])).toThrow(
      'must be finite',
    );
    expect(() =>
      resolveWorkflowBudgetLimits(defaults, [{ autoConfirmPlan: false, maxMcpCalls: -1 }]),
    ).toThrow('must be finite');
  });
});
