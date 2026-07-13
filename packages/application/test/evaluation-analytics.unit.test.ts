import { describe, expect, it } from 'vitest';

import type {
  EvaluationAnalyticsFilter,
  EvaluationAnalyticsSample,
} from '../../domain/src/index.js';
import { EvaluationAnalyticsService, type EvaluationAnalyticsRepository } from '../src/index.js';

describe('EvaluationAnalyticsService', () => {
  it('aggregates success, duration, cost, failure, stability, and ordered quality trend', async () => {
    const repository = new MemoryAnalyticsRepository(samples());
    const service = new EvaluationAnalyticsService({ repository });
    await expect(service.summarize({ skillId: 'skill-1' })).resolves.toEqual({
      filters: { skillId: 'skill-1' },
      sampleCount: 3,
      successCount: 2,
      successRate: 0.666667,
      averageDurationMs: 200,
      totalCost: 9,
      averageCost: 3,
      failureTypes: [{ code: 'MCP_TIMEOUT', count: 1 }],
      mcpUsage: [
        {
          serverId: 'mcp-1',
          toolName: 'read',
          invocationCount: 3,
          successRate: 0.666667,
          averageDurationMs: 20,
        },
      ],
      modelEffects: [
        {
          providerId: 'provider-1',
          model: 'model-a',
          invocationCount: 3,
          successRate: 0.666667,
          averageDurationMs: 10,
          averageTokens: 15,
        },
      ],
      versionStability: [
        {
          skillId: 'skill-1',
          skillVersion: 1,
          sampleCount: 2,
          successRate: 0.5,
          averageQuality: 0.6,
          qualityDeviation: 0.3,
          stabilityScore: 0.35,
        },
        {
          skillId: 'skill-1',
          skillVersion: 2,
          sampleCount: 1,
          successRate: 1,
          averageQuality: 0.8,
          qualityDeviation: 0,
          stabilityScore: 1,
        },
      ],
      qualityTrend: [
        expect.objectContaining({ reportId: 'report-1', score: 0.9 }),
        expect.objectContaining({ reportId: 'report-2', score: 0.3 }),
        expect.objectContaining({ reportId: 'report-3', score: 0.8 }),
      ],
      capabilityGrowth: [
        {
          skillId: 'skill-1',
          observedVersions: 2,
          firstVersion: 1,
          latestVersion: 2,
          sampleCount: 3,
          successfulSamples: 2,
        },
      ],
      optimizationSuggestions: [
        {
          code: 'review_failure',
          severity: 'warning',
          target: 'MCP_TIMEOUT',
          summary: 'Review repeated failure MCP_TIMEOUT.',
          evidenceCount: 1,
        },
        {
          code: 'review_tool',
          severity: 'warning',
          target: 'mcp-1.read',
          summary: 'Review Tool reliability or Skill Tool selection.',
          evidenceCount: 3,
        },
        {
          code: 'review_model',
          severity: 'warning',
          target: 'provider-1/model-a',
          summary: 'Review fixed-stage model configuration and Prompt evidence.',
          evidenceCount: 3,
        },
        {
          code: 'review_skill_version',
          severity: 'warning',
          target: 'skill-1@1',
          summary: 'Review or correct the unstable Skill version; do not disable automatically.',
          evidenceCount: 2,
        },
      ],
    });
    expect(repository.filters).toEqual({ skillId: 'skill-1' });
  });

  it('rejects version/tool filters that omit their parent identity', async () => {
    const service = new EvaluationAnalyticsService({
      repository: new MemoryAnalyticsRepository([]),
    });
    await expect(service.summarize({ skillVersion: 1 })).rejects.toThrow(
      'EVALUATION_ANALYTICS_SKILL_ID_REQUIRED',
    );
    await expect(service.summarize({ toolName: 'read' })).rejects.toThrow(
      'EVALUATION_ANALYTICS_SERVER_ID_REQUIRED',
    );
  });
});

class MemoryAnalyticsRepository implements EvaluationAnalyticsRepository {
  filters: EvaluationAnalyticsFilter | undefined;
  readonly #samples: readonly EvaluationAnalyticsSample[];
  constructor(samples: readonly EvaluationAnalyticsSample[]) {
    this.#samples = samples;
  }
  query(filters: EvaluationAnalyticsFilter): Promise<readonly EvaluationAnalyticsSample[]> {
    this.filters = filters;
    return Promise.resolve(this.#samples);
  }
}

function samples(): readonly EvaluationAnalyticsSample[] {
  return [
    sample('1', 1, true, 100, 2, [], 0.9, '2026-07-13T00:00:01.000Z'),
    sample('2', 1, false, 300, 4, ['MCP_TIMEOUT'], 0.3, '2026-07-13T00:00:02.000Z'),
    sample('3', 2, true, 200, 3, [], 0.8, '2026-07-13T00:00:03.000Z'),
  ];
}

function sample(
  id: string,
  version: number,
  successful: boolean,
  durationMs: number,
  cost: number,
  failureCodes: readonly string[],
  score: number,
  createdAt: string,
): EvaluationAnalyticsSample {
  return {
    experienceId: `experience-${id}`,
    taskId: `task-${id}`,
    instanceId: `instance-${id}`,
    skillVersions: [{ skillId: 'skill-1', version }],
    tools: [{ serverId: 'mcp-1', toolName: 'read' }],
    mcpInvocations: [
      {
        serverId: 'mcp-1',
        toolName: 'read',
        status: successful ? 'succeeded' : 'failed',
        durationMs: 20,
      },
    ],
    modelInvocations: [
      {
        providerId: 'provider-1',
        model: 'model-a',
        status: successful ? 'succeeded' : 'failed',
        durationMs: 10,
        inputTokens: 10,
        outputTokens: 5,
      },
    ],
    successful,
    durationMs,
    cost,
    failureCodes,
    qualityReport: {
      reportId: `report-${id}`,
      taskId: `task-${id}`,
      overallScore: score,
      status: score >= 0.8 ? 'passed' : score >= 0.5 ? 'warning' : 'failed',
      createdAt,
    },
  };
}
