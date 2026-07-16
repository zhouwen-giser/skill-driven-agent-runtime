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
export const MAX_MEMORY_CONTENT_JSON_DEPTH = 64;
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
  return Object.freeze({
    ...input,
    ...refinement,
    memoryId,
    sourceRefs: Object.freeze(sourceRefs),
    supersedes: Object.freeze([...new Set(input.supersedes)]),
  });
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
  return Object.freeze({
    ...input,
    content: snapshotMemoryContent(input.content),
    summary,
    durabilityReason,
  });
}

function snapshotMemoryContent(
  content: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (Array.isArray(content) || !isPlainObject(content))
    throw invalidMemoryContent('Memory content must be a plain JSON object.');
  return snapshotMemoryJsonObject(content, new WeakSet(), 0);
}

function snapshotMemoryJsonValue(value: unknown, active: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_MEMORY_CONTENT_JSON_DEPTH)
    throw invalidMemoryContent(
      `Memory content exceeds JSON depth ${String(MAX_MEMORY_CONTENT_JSON_DEPTH)}.`,
    );
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (typeof value !== 'object')
    throw invalidMemoryContent('Memory content must contain only finite JSON data.');
  if (active.has(value))
    throw invalidMemoryContent('Memory content must not contain cyclic JSON data.');
  active.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => snapshotMemoryJsonValue(item, active, depth + 1)));
    if (!isPlainObject(value))
      throw invalidMemoryContent('Memory content must contain only plain JSON objects.');
    return snapshotMemoryJsonObject(value, active, depth);
  } finally {
    active.delete(value);
  }
}

function snapshotMemoryJsonObject(
  value: Readonly<Record<string, unknown>>,
  active: WeakSet<object>,
  depth: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        snapshotMemoryJsonValue(item, active, depth + 1),
      ]),
    ),
  );
}

function isPlainObject(value: object): value is Readonly<Record<string, unknown>> {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidMemoryContent(message: string): DomainError {
  return new DomainError('MEMORY_CONTENT_INVALID', message);
}
