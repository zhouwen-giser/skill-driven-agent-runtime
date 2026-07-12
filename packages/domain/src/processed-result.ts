import type { TaskOutput } from './task.js';

export interface ResultFact {
  readonly name: string;
  readonly value: unknown;
  readonly confidence: number;
}

export interface ResultMemoryCandidate {
  readonly kind: 'fact' | 'preference' | 'procedure' | 'outcome';
  readonly content: string;
  readonly confidence: number;
}

export interface NormalizedResultEnvelope {
  readonly data: unknown;
  readonly errors: readonly Readonly<{ code: string; message: string }>[];
  readonly originalSize: number;
  readonly contextValue: unknown;
  readonly contextTruncated: boolean;
  readonly summary: string;
}

export interface ProcessedResultRecord {
  readonly resultId: string;
  readonly taskId: string;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly normalized: NormalizedResultEnvelope;
  readonly output: TaskOutput;
  readonly facts: readonly ResultFact[];
  readonly valuable: boolean;
  readonly valueSummary: string;
  readonly memoryCandidates: readonly ResultMemoryCandidate[];
  readonly createdAt: string;
}

export function normalizeResultEnvelope(
  data: unknown,
  errors: readonly Readonly<{ code: string; message: string }>[] = [],
  maxContextCharacters = 16_000,
): NormalizedResultEnvelope {
  let serialized: string;
  try {
    serialized = JSON.stringify(data === undefined ? null : data);
  } catch {
    throw new Error('RESULT_NOT_JSON_SERIALIZABLE');
  }
  const contextTruncated = serialized.length > maxContextCharacters;
  return {
    data,
    errors: errors.map((error) => ({ code: error.code, message: error.message })),
    originalSize: serialized.length,
    contextValue: contextTruncated
      ? { truncatedJson: serialized.slice(0, maxContextCharacters) }
      : data,
    contextTruncated,
    summary: `${errors.length === 0 ? 'Successful' : 'Error-bearing'} result with ${String(serialized.length)} JSON characters${contextTruncated ? '; context value truncated' : ''}.`,
  };
}
