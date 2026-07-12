export type TaskQualityComponent = 'goal' | 'workflow' | 'skill' | 'result_quality' | 'tool_call';

export interface TaskQualityAssessment {
  readonly component: TaskQualityComponent;
  readonly score: number;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface TaskQualityReport {
  readonly reportId: string;
  readonly taskId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly workflowInstanceId: string;
  readonly processedResultId: string;
  readonly assessments: readonly TaskQualityAssessment[];
  readonly overallScore: number;
  readonly status: 'passed' | 'warning' | 'failed';
  readonly createdAt: string;
}
