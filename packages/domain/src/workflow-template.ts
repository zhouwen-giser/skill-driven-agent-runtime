import type { WorkflowDefinition } from './workflow.js';

export interface WorkflowTemplateOccurrence {
  readonly experienceId: string;
  readonly goalKey: string;
  readonly structureKey: string;
  readonly workflow: WorkflowDefinition;
  readonly durationMs: number;
  readonly createdAt: string;
}

export interface WorkflowTemplate {
  readonly templateId: string;
  readonly version: number;
  readonly goalKey: string;
  readonly structureKey: string;
  readonly workflow: WorkflowDefinition;
  readonly sourceExperienceIds: readonly string[];
  readonly sourceSuccessCount: number;
  readonly useCount: number;
  readonly successfulUseCount: number;
  readonly averageUseDurationMs: number;
  readonly status: 'enabled';
  readonly createdAt: string;
}

export interface WorkflowTemplateUse {
  readonly useId: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly planId: string;
  readonly workflowDefinitionId: string;
  readonly workflowVersion: number;
  readonly status: 'planned' | 'succeeded' | 'failed';
  readonly durationMs?: number;
  readonly createdAt: string;
  readonly completedAt?: string;
}
