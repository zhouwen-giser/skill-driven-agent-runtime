import type { WorkflowExternalWaitRef } from './workflow-continuation.js';

export type SkillCallWorkflowStatus =
  | 'awaiting_confirmation'
  | 'running'
  | 'waiting_external'
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
  /** Absent only for legacy calls whose iteration cannot be proven. */
  readonly parentNodeRunId?: string;
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
  | Readonly<{ status: 'paused'; childInstanceId: string; prompt: string }>
  | Readonly<{ status: 'waiting_external'; wait: WorkflowExternalWaitRef }>
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
