import { describe, expect, it } from 'vitest';

import type { StructuredModelProvider } from '../src/ports.js';
import { StructuredGoalEvaluator } from '../src/goal-evaluator.js';

describe('structured Goal evaluator', () => {
  it('accepts a displayable structured replan decision', async () => {
    const model = new FixedModel({
      decision: 'replan',
      summary: 'The current result does not satisfy the success criterion.',
      replanInstruction: 'Collect the missing observation.',
    });
    await expect(new StructuredGoalEvaluator(model).evaluate(evaluationInput())).resolves.toEqual({
      decision: 'replan',
      summary: 'The current result does not satisfy the success criterion.',
      replanInstruction: 'Collect the missing observation.',
    });
    expect(model.input?.stage).toBe('goal_evaluation');
  });

  it('rejects missing replan instructions and unexpected/private fields', async () => {
    await expect(
      new StructuredGoalEvaluator(
        new FixedModel({ decision: 'replan', summary: 'Incomplete.' }),
      ).evaluate(evaluationInput()),
    ).rejects.toMatchObject({ code: 'GOAL_EVALUATION_REPLAN_INSTRUCTION_REQUIRED' });
    await expect(
      new StructuredGoalEvaluator(
        new FixedModel({ decision: 'achieved', summary: 'Done.', reasoning: 'private' }),
      ).evaluate(evaluationInput()),
    ).rejects.toThrow('Unrecognized key');
  });
});

function evaluationInput() {
  return {
    goal: {
      goalId: 'goal-1',
      contextId: 'context-1',
      version: 1,
      title: 'Goal',
      description: 'Complete the task.',
      constraints: [],
      successCriteria: ['Done'],
      status: 'active' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    },
    instance: {
      instanceId: 'instance-1',
      planId: 'plan-1',
      workflowDefinitionId: 'workflow-1',
      workflowVersion: 1,
      goalId: 'goal-1',
      goalVersion: 1,
      skillVersions: [],
      budgetLimits: {
        maxReplans: 2,
        maxDurationSeconds: 60,
        maxLlmCalls: 10,
        maxMcpCalls: 10,
        maxCost: 100,
      },
      budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
      status: 'succeeded' as const,
      input: {},
      result: true,
      errors: {},
      startedAt: '2026-07-12T00:00:00.000Z',
      completedAt: '2026-07-12T00:00:01.000Z',
    },
  };
}

class FixedModel implements StructuredModelProvider {
  input?: Parameters<StructuredModelProvider['generateStructured']>[0];
  readonly #output: unknown;
  constructor(output: unknown) {
    this.#output = output;
  }
  generateStructured(input: Parameters<StructuredModelProvider['generateStructured']>[0]) {
    this.input = input;
    return Promise.resolve(this.#output);
  }
}
