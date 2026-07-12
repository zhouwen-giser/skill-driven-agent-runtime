export interface GoalTransitionRecord {
  readonly transitionId: string;
  readonly contextId: string;
  readonly fromGoalId: string;
  readonly toGoalId: string;
  readonly relationship: 'related_successor' | 'unrelated_new';
  readonly decisionSummary: string;
  readonly requestText: string;
  readonly createdAt: string;
}
