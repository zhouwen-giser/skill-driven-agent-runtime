import type { TaskQualityReport } from './task-quality.js';
import type { ToolReference } from './skill.js';
import type { WorkflowInstance } from './workflow.js';

export interface EvaluationAnalyticsFilter {
  readonly skillId?: string;
  readonly skillVersion?: number;
  readonly providerId?: string;
  readonly model?: string;
  readonly serverId?: string;
  readonly toolName?: string;
}

export interface EvaluationAnalyticsSample {
  readonly experienceId: string;
  readonly taskId?: string;
  readonly instanceId: string;
  readonly skillVersions: WorkflowInstance['skillVersions'];
  readonly tools: readonly ToolReference[];
  readonly successful: boolean;
  readonly durationMs: number;
  readonly cost: number;
  readonly failureCodes: readonly string[];
  readonly qualityReport?: Pick<
    TaskQualityReport,
    'reportId' | 'taskId' | 'overallScore' | 'status' | 'createdAt'
  >;
}

export interface EvaluationAnalyticsSnapshot {
  readonly filters: EvaluationAnalyticsFilter;
  readonly sampleCount: number;
  readonly successCount: number;
  readonly successRate: number;
  readonly averageDurationMs: number;
  readonly totalCost: number;
  readonly averageCost: number;
  readonly failureTypes: readonly Readonly<{ code: string; count: number }>[];
  readonly versionStability: readonly Readonly<{
    skillId: string;
    skillVersion: number;
    sampleCount: number;
    successRate: number;
    averageQuality: number;
    qualityDeviation: number;
    stabilityScore: number;
  }>[];
  readonly qualityTrend: readonly Readonly<{
    reportId: string;
    taskId: string;
    instanceId: string;
    skillVersions: WorkflowInstance['skillVersions'];
    score: number;
    status: TaskQualityReport['status'];
    createdAt: string;
  }>[];
}
