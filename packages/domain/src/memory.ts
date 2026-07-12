import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

export type MemoryType =
  | 'fact'
  | 'success_experience'
  | 'failure_experience'
  | 'workflow_pattern'
  | 'skill_learning'
  | 'prompt_learning';
export type MemoryStatus = 'active' | 'superseded' | 'invalid';
export type MemoryRetrievalStage =
  'intent' | 'skill_selection' | 'workflow_generation' | 'exception_handling' | 'goal_evaluation';

export interface MemoryItem {
  readonly memoryId: string;
  readonly type: MemoryType;
  readonly content: Readonly<Record<string, unknown>>;
  readonly summary: string;
  readonly status: MemoryStatus;
  readonly sourceRefs: readonly string[];
  readonly supersedes: readonly string[];
  readonly confidence: number;
  readonly createdAt: string;
}

export interface MemorySearchHit {
  readonly item: MemoryItem;
  readonly score: number;
}

export interface MemoryStatusTransition {
  readonly transitionId: string;
  readonly memoryId: string;
  readonly fromStatus: MemoryStatus;
  readonly toStatus: Exclude<MemoryStatus, 'active'>;
  readonly replacementMemoryId?: string;
  readonly actor: string;
  readonly reason: string;
  readonly createdAt: string;
}

export function createMemoryItem(input: MemoryItem): MemoryItem {
  const memoryId = requireIdentifier(input.memoryId, 'MEMORY_ID_REQUIRED');
  const summary = input.summary.trim();
  const sourceRefs = [...new Set(input.sourceRefs.map((value) => value.trim()).filter(Boolean))];
  if (summary === '')
    throw new DomainError('MEMORY_SUMMARY_REQUIRED', 'Memory summary is required.');
  if (sourceRefs.length === 0)
    throw new DomainError(
      'MEMORY_SOURCE_REQUIRED',
      'Memory requires at least one source reference.',
    );
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
    throw new DomainError(
      'MEMORY_CONFIDENCE_INVALID',
      'Memory confidence must be between zero and one.',
    );
  return {
    ...input,
    memoryId,
    summary,
    sourceRefs,
    supersedes: [...new Set(input.supersedes)],
  };
}
