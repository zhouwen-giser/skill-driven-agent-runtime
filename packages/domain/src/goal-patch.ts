import type { Goal } from './goal.js';

export interface GoalPatchChanges {
  readonly title?: string;
  readonly description?: string;
  readonly constraints?: readonly string[];
  readonly successCriteria?: readonly string[];
}

export interface GoalPatchRecord {
  readonly patchId: string;
  readonly goalId: string;
  readonly triggeringTaskId?: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly instruction: string;
  readonly changes: GoalPatchChanges;
  readonly decisionSummary: string;
  readonly compensationWarnings: readonly string[];
  readonly invalidatedPlanIds: readonly string[];
  readonly invalidatedInstanceIds: readonly string[];
  readonly newPlanId: string;
  readonly beforeGoal: Goal;
  readonly afterGoal: Goal;
  readonly createdAt: string;
}
