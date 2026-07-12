export type GoalInferenceSourceKind = 'conversation_history' | 'global_memory' | 'existing_data';

export interface GoalInferenceSource {
  readonly sourceId: string;
  readonly kind: GoalInferenceSourceKind;
  readonly summary: string;
  readonly content: unknown;
}

export interface GoalInputInferenceRecord {
  readonly inferenceId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly outcome: 'inferred' | 'input_required';
  readonly decisionSummary: string;
  readonly usedSources: readonly GoalInferenceSource[];
  readonly inferredGoal?: Readonly<{
    title: string;
    description: string;
    constraints: readonly string[];
    successCriteria: readonly string[];
  }>;
  readonly clarificationQuestion?: string;
  readonly createdAt: string;
}
