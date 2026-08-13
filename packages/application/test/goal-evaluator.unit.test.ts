import { describe, expect, it } from 'vitest';

import type { StructuredModelProvider } from '../src/ports.js';
import { StructuredGoalEvaluator } from '../src/goal-evaluator.js';

describe('structured Goal evaluator', () => {
  it('accepts a displayable structured plan-adjustment decision', async () => {
    const model = new FixedModel({
      decision: 'adjust_plan',
      summary: 'The current result does not satisfy the success criterion.',
      actionInstruction: 'Collect the missing observation.',
    });
    await expect(
      new StructuredGoalEvaluator(model, {
        searchForStage: () =>
          Promise.resolve([
            {
              item: {
                memoryId: 'memory-evaluation',
                type: 'success_experience',
                content: { result: 'complete' },
                summary: 'A comparable Goal succeeded.',
                status: 'active',
                sourceRefs: ['task:source'],
                supersedes: [],
                confidence: 0.9,
                durability: 'durable',
                authority: 'skill_experience',
                durabilityReason: 'The prior outcome is reusable.',
                createdAt: '2026-07-12T00:00:00.000Z',
              },
              score: 0.9,
            },
          ]),
      }).evaluate({ ...evaluationInput(), taskId: 'task-goal-evaluation' }),
    ).resolves.toEqual({
      decision: 'adjust_plan',
      summary: 'The current result does not satisfy the success criterion.',
      actionInstruction: 'Collect the missing observation.',
    });
    expect(model.input?.stage).toBe('goal_evaluation');
    expect(model.input?.taskId).toBe('task-goal-evaluation');
    expect(model.input?.instruction).toContain('memory-evaluation');
  });

  it('validates decision-specific evidence and rejects unexpected/private fields', async () => {
    await expect(
      new StructuredGoalEvaluator(
        new FixedModel({ decision: 'replace_skill', summary: 'Current Skill is unsuitable.' }),
      ).evaluate(evaluationInput()),
    ).rejects.toMatchObject({ code: 'GOAL_EVALUATION_ACTION_INSTRUCTION_REQUIRED' });
    await expect(
      new StructuredGoalEvaluator(
        new FixedModel({ decision: 'request_input', summary: 'A value is missing.' }),
      ).evaluate(evaluationInput()),
    ).rejects.toMatchObject({ code: 'GOAL_EVALUATION_QUESTION_REQUIRED' });
    await expect(
      new StructuredGoalEvaluator(
        new FixedModel({
          decision: 'capability_gap',
          summary: 'A tool is missing.',
          missingCapability: 'Read a pressure gauge.',
        }),
      ).evaluate(evaluationInput()),
    ).rejects.toMatchObject({ code: 'GOAL_EVALUATION_CAPABILITY_EVIDENCE_REQUIRED' });
    await expect(
      new StructuredGoalEvaluator(
        new FixedModel({ decision: 'achieved', summary: 'Done.', reasoning: 'private' }),
      ).evaluate(evaluationInput()),
    ).rejects.toThrow('Unrecognized key');
  });

  it('accepts explicit input and capability-gap evidence without starting a plan', async () => {
    await expect(
      new StructuredGoalEvaluator(
        new FixedModel({
          decision: 'request_input',
          summary: 'The device identity cannot be inferred.',
          question: 'Which device should be inspected?',
        }),
      ).evaluate(evaluationInput()),
    ).resolves.toMatchObject({ decision: 'request_input' });
    await expect(
      new StructuredGoalEvaluator(
        new FixedModel({
          decision: 'capability_gap',
          summary: 'No registered tool can read pressure.',
          missingCapability: 'Read pressure.',
          suggestedToolContract: {
            name: 'read_pressure',
            description: 'Read pressure for a device.',
            inputSchema: { type: 'object', required: ['deviceId'] },
          },
        }),
      ).evaluate(evaluationInput()),
    ).resolves.toMatchObject({ decision: 'capability_gap' });
  });

  it('uses one bounded correction for conflicting decision-specific fields', async () => {
    const model = new SequenceModel([
      {
        decision: 'replace_skill',
        summary: 'The provider rejected the current execution mode.',
        missingCapability: 'A compatible read-state capability.',
        suggestedToolContract: {
          name: 'read_state',
          description: 'Read the current state.',
          inputSchema: { type: 'object' },
        },
      },
      {
        decision: 'capability_gap',
        summary: 'The provider rejected the current execution mode.',
        missingCapability: 'A compatible read-state capability.',
        suggestedToolContract: {
          name: 'read_state',
          description: 'Read the current state.',
          inputSchema: { type: 'object' },
        },
      },
    ]);

    await expect(
      new StructuredGoalEvaluator(model).evaluate(evaluationInput()),
    ).resolves.toMatchObject({ decision: 'capability_gap' });
    expect(model.inputs).toHaveLength(2);
    expect(model.inputs[1]?.correctionErrors).toEqual([
      'GOAL_EVALUATION_ACTION_INSTRUCTION_REQUIRED',
      'GOAL_EVALUATION_CAPABILITY_EVIDENCE_FORBIDDEN',
    ]);
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

class SequenceModel implements StructuredModelProvider {
  readonly inputs: Parameters<StructuredModelProvider['generateStructured']>[0][] = [];
  readonly #outputs: unknown[];
  constructor(outputs: unknown[]) {
    this.#outputs = outputs;
  }
  generateStructured(input: Parameters<StructuredModelProvider['generateStructured']>[0]) {
    this.inputs.push(input);
    return Promise.resolve(this.#outputs.shift());
  }
}
