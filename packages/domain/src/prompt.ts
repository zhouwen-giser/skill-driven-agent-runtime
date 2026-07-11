import type { ModelStage } from './model-runtime.js';

export interface PromptVersion {
  readonly promptId: string;
  readonly stage: ModelStage;
  readonly version: number;
  readonly previousVersion?: number;
  readonly content: string;
  readonly status: 'candidate' | 'enabled' | 'disabled';
  readonly source: 'admin' | 'auto_candidate' | 'manual_correction' | 'rollback';
  readonly createdAt: string;
}

export interface PromptEffectSummary {
  readonly promptId: string;
  readonly version: number;
  readonly invocationCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly averageDurationMs: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
}
