import { DomainError } from './errors.js';
import type { InternalToolResult } from './mcp-task.js';

export const MAX_PROVIDER_BUSINESS_OUTCOME_JSON_BYTES = 65_536;
export const MAX_PROVIDER_BUSINESS_OUTCOME_JSON_DEPTH = 32;
export const MAX_PROVIDER_BUSINESS_OUTCOME_ALTERNATIVES = 32;

export type ProviderBusinessOutcomeKind =
  'start_window_missed' | 'deadline_reached' | 'partial_completion' | 'business_failure';

export interface ProviderBusinessOutcome {
  readonly outcome: ProviderBusinessOutcomeKind;
  readonly reasonCode: string;
  readonly retryable: boolean;
  readonly classification: 'declared' | 'fallback';
  readonly declaredOutcome?: string;
  readonly partialResult?: unknown;
  readonly alternatives?: readonly unknown[];
  readonly structuredEvidence: Readonly<Record<string, unknown>>;
}

export interface ProviderBusinessNodeError {
  readonly code:
    | 'MCP_TASK_START_WINDOW_MISSED'
    | 'MCP_TASK_DEADLINE_REACHED'
    | 'MCP_TASK_PARTIAL_COMPLETION'
    | 'MCP_TASK_BUSINESS_FAILURE';
  readonly message: string;
  readonly details: Readonly<{
    category: 'provider_business';
    outcome: ProviderBusinessOutcomeKind;
    reasonCode: string;
    retryable: boolean;
    classification: ProviderBusinessOutcome['classification'];
    declaredOutcome?: string;
    partialResult?: unknown;
    alternatives?: readonly unknown[];
    structuredEvidence: Readonly<Record<string, unknown>>;
  }>;
}

const declaredOutcomes = new Set<ProviderBusinessOutcomeKind>([
  'start_window_missed',
  'deadline_reached',
  'partial_completion',
  'business_failure',
]);

export function classifyProviderBusinessOutcome(
  result: InternalToolResult,
): ProviderBusinessOutcome {
  if (!result.isError)
    throw new DomainError(
      'PROVIDER_BUSINESS_OUTCOME_EXPECTED',
      'Only an error Tool result can be classified as a Provider business outcome.',
    );
  const evidence = snapshotStructuredEvidence(result.structuredContent);
  const declared = evidence['outcome'];
  if (declared !== undefined && (typeof declared !== 'string' || !isBoundedOutcomeName(declared)))
    throw invalidOutcome('Provider business outcome must be a bounded identifier.');
  const isDeclared = typeof declared === 'string' && isProviderBusinessOutcomeKind(declared);
  if (!isDeclared) return fallbackOutcome(evidence, declared);

  const reasonCode = requiredReasonCode(evidence['reasonCode']);
  const retryable = requiredRetryable(evidence['retryable']);
  const partialResult = optionalJson(evidence, 'partialResult');
  if (declared === 'partial_completion' && partialResult === undefined)
    throw invalidOutcome('partial_completion requires bounded partialResult evidence.');
  const alternatives = optionalAlternatives(evidence['alternatives']);
  return Object.freeze({
    outcome: declared,
    reasonCode,
    retryable,
    classification: 'declared',
    ...(partialResult === undefined ? {} : { partialResult }),
    ...(alternatives === undefined ? {} : { alternatives }),
    structuredEvidence: evidence,
  });
}

export function createProviderBusinessNodeError(
  outcome: ProviderBusinessOutcome,
): ProviderBusinessNodeError {
  const codes = {
    start_window_missed: 'MCP_TASK_START_WINDOW_MISSED',
    deadline_reached: 'MCP_TASK_DEADLINE_REACHED',
    partial_completion: 'MCP_TASK_PARTIAL_COMPLETION',
    business_failure: 'MCP_TASK_BUSINESS_FAILURE',
  } as const;
  const messages = {
    start_window_missed: 'The Provider could not start the remote Task within its start window.',
    deadline_reached: 'The Provider ended the remote Task at its maximum elapsed deadline.',
    partial_completion: 'The Provider completed only part of the requested operation.',
    business_failure: 'The remote Task completed with a Provider business failure.',
  } as const;
  return Object.freeze({
    code: codes[outcome.outcome],
    message: messages[outcome.outcome],
    details: Object.freeze({
      category: 'provider_business',
      outcome: outcome.outcome,
      reasonCode: outcome.reasonCode,
      retryable: outcome.retryable,
      classification: outcome.classification,
      ...(outcome.declaredOutcome === undefined
        ? {}
        : { declaredOutcome: outcome.declaredOutcome }),
      ...(outcome.partialResult === undefined ? {} : { partialResult: outcome.partialResult }),
      ...(outcome.alternatives === undefined ? {} : { alternatives: outcome.alternatives }),
      structuredEvidence: outcome.structuredEvidence,
    }),
  });
}

function fallbackOutcome(
  evidence: Readonly<Record<string, unknown>>,
  declared: string | undefined,
): ProviderBusinessOutcome {
  const reason = evidence['reasonCode'];
  if (reason !== undefined && !isReasonCode(reason))
    throw invalidOutcome('Provider business reasonCode is malformed.');
  const retryable = evidence['retryable'];
  if (retryable !== undefined && typeof retryable !== 'boolean')
    throw invalidOutcome('Provider business retryable evidence must be boolean.');
  const partialResult = optionalJson(evidence, 'partialResult');
  const alternatives = optionalAlternatives(evidence['alternatives']);
  return Object.freeze({
    outcome: 'business_failure',
    reasonCode: typeof reason === 'string' ? reason : 'UNCLASSIFIED_PROVIDER_BUSINESS_FAILURE',
    retryable: typeof retryable === 'boolean' ? retryable : false,
    classification: 'fallback',
    ...(declared === undefined ? {} : { declaredOutcome: declared }),
    ...(partialResult === undefined ? {} : { partialResult }),
    ...(alternatives === undefined ? {} : { alternatives }),
    structuredEvidence: evidence,
  });
}

function snapshotStructuredEvidence(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined) return Object.freeze({});
  const snapshot = snapshotJson(value, new Set<object>(), 0);
  if (!isPlainRecord(snapshot))
    throw invalidOutcome('Provider business structuredContent must be a JSON object.');
  const encoded = JSON.stringify(snapshot);
  if (new TextEncoder().encode(encoded).byteLength > MAX_PROVIDER_BUSINESS_OUTCOME_JSON_BYTES)
    throw new DomainError(
      'PROVIDER_BUSINESS_OUTCOME_JSON_TOO_LARGE',
      'Provider business outcome exceeds its bounded JSON size.',
    );
  return snapshot;
}

function snapshotJson(value: unknown, active: Set<object>, depth: number): unknown {
  if (depth > MAX_PROVIDER_BUSINESS_OUTCOME_JSON_DEPTH)
    throw new DomainError(
      'PROVIDER_BUSINESS_OUTCOME_JSON_TOO_LARGE',
      'Provider business outcome exceeds its bounded JSON depth.',
    );
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw invalidOutcome('Provider business JSON numbers must be finite.');
    return value;
  }
  if (typeof value !== 'object')
    throw invalidOutcome('Provider business evidence must contain only JSON values.');
  if (active.has(value)) throw invalidOutcome('Provider business evidence cannot contain cycles.');
  active.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => snapshotJson(item, active, depth + 1)));
    if (!isPlainRecord(value))
      throw invalidOutcome('Provider business evidence must contain only plain JSON objects.');
    const snapshot: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === '') throw invalidOutcome('Provider business evidence keys must be non-empty.');
      snapshot[key] = snapshotJson(value[key], active, depth + 1);
    }
    return Object.freeze(snapshot);
  } finally {
    active.delete(value);
  }
}

function optionalJson(evidence: Readonly<Record<string, unknown>>, key: string): unknown {
  return evidence[key];
}

function optionalAlternatives(value: unknown): readonly unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!isUnknownArray(value) || value.length > MAX_PROVIDER_BUSINESS_OUTCOME_ALTERNATIVES)
    throw invalidOutcome('Provider business alternatives must be a bounded JSON array.');
  return value;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function requiredReasonCode(value: unknown): string {
  if (!isReasonCode(value)) throw invalidOutcome('Provider business reasonCode is required.');
  return value;
}

function requiredRetryable(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw invalidOutcome('Provider business retryable evidence is required.');
  return value;
}

function isReasonCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value);
}

function isBoundedOutcomeName(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,127}$/u.test(value);
}

function isProviderBusinessOutcomeKind(value: string): value is ProviderBusinessOutcomeKind {
  return declaredOutcomes.has(value as ProviderBusinessOutcomeKind);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function invalidOutcome(message: string): DomainError {
  return new DomainError('PROVIDER_BUSINESS_OUTCOME_INVALID', message);
}
