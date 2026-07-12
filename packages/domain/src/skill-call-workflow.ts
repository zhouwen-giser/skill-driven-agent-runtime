export type SkillCallWorkflowStatus = 'succeeded' | 'failed' | 'canceled';

export interface SkillCallWorkflowRecord {
  readonly parentInstanceId: string;
  readonly parentNodeId: string;
  readonly childInstanceId: string;
  readonly childPlanId: string;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly status: SkillCallWorkflowStatus;
  readonly evaluationSummary: string;
  readonly createdAt: string;
  readonly completedAt: string;
}
