export type SkillCallWorkflowStatus =
  | 'awaiting_confirmation'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'rejected'
  | 'invalidated';

export type SkillCallConfirmationStatus =
  'awaiting_confirmation' | 'confirmed' | 'rejected' | 'invalidated';

export interface SkillCallWorkflowRecord {
  readonly callId: string;
  readonly parentPlanId: string;
  readonly parentInstanceId: string;
  readonly parentNodeId: string;
  readonly childInstanceId?: string;
  readonly childPlanId: string;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly confirmationStatus: SkillCallConfirmationStatus;
  readonly status: SkillCallWorkflowStatus;
  readonly evaluationSummary: string;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export type SkillCallExecutionResult =
  | Readonly<{ status: 'completed'; output: unknown }>
  | Readonly<{
      status: 'awaiting_confirmation';
      callId: string;
      parentPlanId: string;
      parentInstanceId: string;
      parentNodeId: string;
      childPlanId: string;
      childSkillId: string;
      childSkillVersion: number;
    }>;
