import { describe, expect, it } from 'vitest';

import type { TaskQualityReport } from '../../domain/src/index.js';
import { TaskQualityEvaluationService } from '../src/index.js';

describe('TaskQualityEvaluationService', () => {
  it('cross-evaluates all five components and deterministically aggregates the report', async () => {
    const components: string[] = [];
    let saved: TaskQualityReport | undefined;
    const service = new TaskQualityEvaluationService({
      model: {
        generateStructured: (request) => {
          const parsed = JSON.parse(request.instruction) as { component: string };
          components.push(parsed.component);
          return Promise.resolve({
            score: parsed.component === 'tool_call' ? 0.5 : 1,
            summary: `${parsed.component} summary`,
            findings: [`${parsed.component} finding`],
            evidenceRefs: [`${parsed.component}:source`],
          });
        },
      },
      repository: {
        save: (report) => {
          saved = report;
          return Promise.resolve();
        },
        findByTask: () => Promise.resolve(saved),
      },
      clock: { now: () => '2026-07-13T00:00:00.000Z' },
      nextId: () => 'quality-report-1',
    });
    await expect(service.evaluate(qualityInput())).resolves.toMatchObject({
      overallScore: 0.9,
      status: 'passed',
      assessments: expect.arrayContaining([
        expect.objectContaining({ component: 'goal' }),
        expect.objectContaining({ component: 'tool_call', score: 0.5 }),
      ]),
    });
    expect(components).toEqual(['goal', 'workflow', 'skill', 'result_quality', 'tool_call']);
    await expect(service.getByTask('task-1')).resolves.toMatchObject({
      reportId: 'quality-report-1',
    });
  });
});

function qualityInput() {
  const limits = {
    maxReplans: 2,
    maxDurationSeconds: 60,
    maxLlmCalls: 10,
    maxMcpCalls: 10,
    maxCost: 100,
  };
  return {
    taskId: 'task-1',
    goal: {
      goalId: 'goal-1',
      contextId: 'context-1',
      version: 1,
      title: 'Inspect',
      description: 'Inspect device.',
      constraints: [],
      successCriteria: ['Online'],
      status: 'active' as const,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    goalEvaluation: { decision: 'achieved' as const, summary: 'Goal achieved.' },
    workflow: {
      workflowDefinitionId: 'workflow-1',
      version: 1,
      goalId: 'goal-1',
      goalVersion: 1,
      entryNodeId: 'result',
      exitNodeIds: ['result'],
      nodes: [
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result' as const,
          value: { op: 'literal' as const, value: true },
        },
      ],
      edges: [],
    },
    instance: {
      instanceId: 'instance-1',
      planId: 'plan-1',
      workflowDefinitionId: 'workflow-1',
      workflowVersion: 1,
      goalId: 'goal-1',
      goalVersion: 1,
      skillVersions: [{ skillId: 'skill-1', version: 1 }],
      budgetLimits: limits,
      budgetUsage: { replanCount: 0, durationMs: 10, llmCalls: 0, mcpCalls: 1, cost: 0 },
      status: 'succeeded' as const,
      input: {},
      result: { status: 'online' },
      errors: {},
      startedAt: '2026-07-13T00:00:00.000Z',
      completedAt: '2026-07-13T00:00:01.000Z',
    },
    skill: { skillId: 'skill-1', version: 1, inputSchema: {}, outputSchema: {} },
    processedResult: {
      resultId: 'result-1',
      taskId: 'task-1',
      skillId: 'skill-1',
      skillVersion: 1,
      normalized: {
        data: { status: 'online' },
        errors: [],
        originalSize: 19,
        contextValue: { status: 'online' },
        contextTruncated: false,
        summary: 'Successful.',
      },
      output: { text: 'Online.', structured: { status: 'online' } },
      facts: [],
      valuable: true,
      valueSummary: 'Useful.',
      memoryCandidates: [],
      createdAt: '2026-07-13T00:00:01.000Z',
    },
    isTemporarySkill: false,
  };
}
