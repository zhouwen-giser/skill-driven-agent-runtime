import { requireIdentifier } from './identity.js';

export type SkillDraftIntent = 'create' | 'update';

export interface SkillDraft {
  readonly draftId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly requestedBy: string;
  readonly intent: SkillDraftIntent;
  readonly requestText: string;
  readonly status: 'draft';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createSkillDraft(input: Omit<SkillDraft, 'status'>): SkillDraft {
  return {
    ...input,
    draftId: requireIdentifier(input.draftId, 'SKILL_DRAFT_ID_REQUIRED'),
    taskId: requireIdentifier(input.taskId, 'TASK_ID_REQUIRED'),
    contextId: requireIdentifier(input.contextId, 'CONTEXT_ID_REQUIRED'),
    status: 'draft',
  };
}
