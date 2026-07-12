import type { ModelStage } from './model-runtime.js';

export interface EvaluationInfluenceRecord {
  readonly influenceId: string;
  readonly reportId: string;
  readonly taskId: string;
  readonly experienceId: string;
  readonly skillObservationId?: string;
  readonly workflowDisposition: 'quality_occurrence_recorded' | 'rejected_low_quality';
  readonly workflowTemplateId?: string;
  readonly workflowTemplateVersion?: number;
  readonly promptDisposition: 'candidate_created' | 'not_required';
  readonly promptId?: string;
  readonly promptVersion?: number;
  readonly promptStage?: ModelStage;
  readonly createdAt: string;
}
