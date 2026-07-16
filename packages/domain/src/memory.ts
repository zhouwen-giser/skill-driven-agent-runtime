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
export type MemoryDurability = 'durable' | 'volatile' | 'unknown';
export type MemoryAuthority = 'mcp' | 'skill_experience' | 'admin' | 'model_inferred';
export type MemoryRetrievalStage =
  | 'intent'
  | 'skill_selection'
  | 'skill_input_resolution'
  | 'workflow_generation'
  | 'exception_handling'
  | 'goal_evaluation';

export interface MemoryRefinement {
  readonly type: MemoryType;
  readonly content: Readonly<Record<string, unknown>>;
  readonly summary: string;
  readonly confidence: number;
  readonly durability: MemoryDurability;
  readonly authority: MemoryAuthority;
  readonly durabilityReason: string;
}

export interface MemoryItem extends MemoryRefinement {
  readonly memoryId: string;
  readonly status: MemoryStatus;
  readonly sourceRefs: readonly string[];
  readonly supersedes: readonly string[];
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
  const refinement = createMemoryRefinement(input);
  const sourceRefs = [...new Set(input.sourceRefs.map((value) => value.trim()).filter(Boolean))];
  if (sourceRefs.length === 0)
    throw new DomainError(
      'MEMORY_SOURCE_REQUIRED',
      'Memory requires at least one source reference.',
    );
  return {
    ...input,
    ...refinement,
    memoryId,
    sourceRefs,
    supersedes: [...new Set(input.supersedes)],
  };
}

export function createMemoryRefinement(input: MemoryRefinement): MemoryRefinement {
  const summary = input.summary.trim();
  const durabilityReason = input.durabilityReason.trim();
  if (summary === '')
    throw new DomainError('MEMORY_SUMMARY_REQUIRED', 'Memory summary is required.');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
    throw new DomainError(
      'MEMORY_CONFIDENCE_INVALID',
      'Memory confidence must be between zero and one.',
    );
  if (!(['durable', 'volatile', 'unknown'] as const).includes(input.durability))
    throw new DomainError('MEMORY_DURABILITY_INVALID', 'Memory durability is invalid.');
  if (!(['mcp', 'skill_experience', 'admin', 'model_inferred'] as const).includes(input.authority))
    throw new DomainError('MEMORY_AUTHORITY_INVALID', 'Memory authority is invalid.');
  if (durabilityReason === '')
    throw new DomainError(
      'MEMORY_DURABILITY_REASON_REQUIRED',
      'Memory durability requires a displayable reason.',
    );
  return { ...input, summary, durabilityReason };
}
