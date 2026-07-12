import { describe, expect, it } from 'vitest';

import type { StructuredModelProvider } from '../src/index.js';
import {
  StructuredExecutionExceptionDecider,
  StructuredSkillSelectionDecider,
  StructuredTaskDecisionService,
} from '../src/index.js';

describe('structured LLM final decisions', () => {
  it('routes intent and Goal formulation through their fixed model stages', async () => {
    const model = new SequenceModel([
      { intent: 'execute', summary: 'The user requested task execution.' },
      {
        title: 'Inspect device',
        description: 'Inspect the requested device safely.',
        constraints: ['read-only'],
        successCriteria: ['status returned'],
        requiresInput: false,
      },
      {
        relationship: 'related_successor',
        decisionSummary: 'This is the next phase of the completed inspection.',
      },
    ]);
    const decisions = new StructuredTaskDecisionService(model);

    await expect(decisions.decideIntent({ requestText: 'Inspect device 17.' })).resolves.toEqual({
      intent: 'execute',
      summary: 'The user requested task execution.',
    });
    await expect(
      decisions.formulateGoal({ requestText: 'Inspect device 17.' }),
    ).resolves.toMatchObject({
      title: 'Inspect device',
      constraints: ['read-only'],
      requiresInput: false,
    });
    await expect(
      decisions.decideGoalContinuity({
        requestText: 'Now summarize it.',
        previousGoal: {
          goalId: 'goal-1',
          title: 'Inspect',
          description: 'Inspect the device.',
          constraints: [],
          successCriteria: ['complete'],
          status: 'achieved',
        },
      }),
    ).resolves.toMatchObject({ relationship: 'related_successor' });
    expect(model.calls.map((call) => call.stage)).toEqual(['intent', 'goal', 'goal']);
  });

  it('rejects inconsistent Goal clarification instead of applying a rule fallback', async () => {
    const decisions = new StructuredTaskDecisionService(
      new SequenceModel([
        {
          title: 'Ambiguous inspection',
          description: 'A target is missing.',
          constraints: [],
          successCriteria: [],
          requiresInput: true,
        },
      ]),
    );
    await expect(decisions.formulateGoal({ requestText: 'Inspect it.' })).rejects.toMatchObject({
      code: 'GOAL_CLARIFICATION_SHAPE_INVALID',
    });
  });

  it('makes Skill selection through the fixed LLM stage using retrieval candidates as data', async () => {
    const model = new SequenceModel([
      { selectedSkillId: 'skill-safe', decisionSummary: 'Best fit under the Goal constraints.' },
    ]);
    const decider = new StructuredSkillSelectionDecider(model);
    await expect(
      decider.decide({
        goalDescription: 'Inspect safely.',
        mode: 'initial',
        candidates: [
          {
            skillId: 'skill-safe',
            skillVersion: 2,
            name: 'Safe inspection',
            summary: 'Read-only device inspection.',
            capabilities: ['device-inspection'],
            createdAt: '2026-07-12T00:00:00.000Z',
            semanticScore: 0.8,
            metrics: {
              sampleCount: 4,
              successRate: 1,
              averageDurationMs: 10,
              averageCost: 1,
              failureCount: 0,
              stabilityScore: 1,
            },
          },
        ],
      }),
    ).resolves.toMatchObject({ selectedSkillId: 'skill-safe' });
    expect(model.calls[0]).toMatchObject({ stage: 'skill_selection' });
    expect(model.calls[0]?.instruction).toContain('semanticScore');
  });

  it('constrains exception decisions to strategies permitted by the immutable graph', async () => {
    const model = new SequenceModel([{ strategy: 'continue', summary: 'Continue safely.' }]);
    await expect(
      new StructuredExecutionExceptionDecider(model).decide({
        handledNodeId: 'tool',
        error: { code: 'MCP_OFFLINE', message: 'Tool is offline.' },
        allowedStrategies: ['terminate', 'continue'],
      }),
    ).resolves.toMatchObject({ strategy: 'continue' });
    expect(model.calls[0]?.stage).toBe('execution_decision');
  });
});

class SequenceModel implements StructuredModelProvider {
  readonly calls: Parameters<StructuredModelProvider['generateStructured']>[0][] = [];
  readonly #outputs: readonly unknown[];
  constructor(outputs: readonly unknown[]) {
    this.#outputs = outputs;
  }
  generateStructured(input: Parameters<StructuredModelProvider['generateStructured']>[0]) {
    this.calls.push(input);
    return Promise.resolve(this.#outputs[this.calls.length - 1]);
  }
}
