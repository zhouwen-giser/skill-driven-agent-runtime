import type { WorkflowExternalWaitRef } from './workflow-continuation.js';
/** Durable parent/child identity. This relation does not own another Task state machine. */
export interface WorkflowChildCall {
  readonly callId: string;
  readonly kind: 'skill_call' | 'subworkflow';
  readonly parentInstanceId: string;
  readonly parentNodeRunId: string;
  readonly parentNodeId: string;
  readonly childPlanId: string;
  readonly childInstanceId?: string;
  readonly createdAt: string;
}

export type WorkflowChildExecutionResult =
  | Readonly<{ status: 'completed'; output: unknown }>
  | Readonly<{ status: 'paused'; childInstanceId: string; prompt: string }>
  | Readonly<{ status: 'waiting_external'; wait: WorkflowExternalWaitRef }>
  | Readonly<{ status: 'failed'; code: string; message: string }>
  | Readonly<{ status: 'canceled'; code: string; message: string }>;

export class WorkflowChildCallError extends Error {
  constructor(
    readonly code:
      | 'WORKFLOW_CHILD_CALL_INPUT_CONFLICT'
      | 'WORKFLOW_CHILD_CALL_IDENTITY_CONFLICT'
      | 'WORKFLOW_CHILD_PARENT_NOT_ACTIVE'
      | 'WORKFLOW_CHILD_STATE_UNAVAILABLE'
      | 'WORKFLOW_SUBWORKFLOW_NOT_CONFIRMED',
    message = code,
  ) {
    super(message);
    this.name = 'WorkflowChildCallError';
  }
}
