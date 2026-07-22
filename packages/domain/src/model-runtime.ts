export type ModelStage =
  | 'intent'
  | 'goal'
  | 'goal_planning'
  | 'tool_enhancement'
  | 'skill_authoring'
  | 'skill_selection'
  | 'skill_input_resolution'
  | 'workflow_planning'
  | 'execution_decision'
  | 'goal_evaluation'
  | 'evaluation'
  | 'result_processing'
  | 'task_understanding';

export interface ModelProviderConfiguration {
  readonly providerId: string;
  readonly name: string;
  readonly kind: 'openai_compatible' | 'local' | 'other_vendor';
  readonly apiStyle: 'openai_chat_completions' | 'anthropic_messages';
  readonly baseUrl: string;
  readonly model: string;
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StageModelRoute {
  readonly stage: ModelStage;
  readonly providerId: string;
  readonly updatedAt: string;
}

export interface ModelInvocationRecord {
  readonly invocationId: string;
  readonly taskId?: string;
  readonly stage: ModelStage;
  readonly providerId: string;
  readonly model: string;
  readonly operation: 'structured_generation' | 'embedding';
  readonly promptId?: string;
  readonly promptVersion?: number;
  readonly request: unknown;
  readonly context: unknown;
  readonly rawResponse?: unknown;
  readonly structuredResult?: unknown;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs: number;
  readonly status: 'succeeded' | 'failed';
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly createdAt: string;
}
