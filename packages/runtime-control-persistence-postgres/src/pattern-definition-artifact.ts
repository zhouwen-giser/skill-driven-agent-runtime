import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';

import {
  buildRuntimeSourceArtifact,
  canonicalizeSourceArtifactJson,
  createCohortDefinition,
  createDiscoveredProcessPattern,
  createProcessVariant,
  createWorkflowPattern,
  type CanonicalRuntimeSourceArtifact,
  type EvidenceJsonValue,
} from '../../domain/src/index.js';

const MAX_PATTERN_DEFINITION_BYTES = 64 * 1024 * 1024;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export type PatternDefinitionArtifactErrorCode =
  | 'PATTERN_DEFINITION_CONTENT_INVALID'
  | 'PATTERN_DEFINITION_ENVELOPE_INVALID'
  | 'PATTERN_DEFINITION_INTEGRITY_MISMATCH';

export class PatternDefinitionArtifactError extends Error {
  readonly code: PatternDefinitionArtifactErrorCode;

  constructor(code: PatternDefinitionArtifactErrorCode, message: string) {
    super(message);
    this.name = 'PatternDefinitionArtifactError';
    this.code = code;
  }
}

export interface DecodedPatternCandidateDefinition {
  readonly definition: Readonly<Record<string, EvidenceJsonValue>>;
  readonly contentHash: `sha256:${string}`;
  readonly uncompressedBytes: number;
  readonly sourceArtifact: CanonicalRuntimeSourceArtifact;
}

/**
 * Decodes the immutable P03 pattern envelope and proves that the persisted compressed bytes,
 * decompressed canonical definition, and externally resolvable ArtifactRef share one byte domain.
 */
export function decodePatternCandidateDefinition(input: {
  readonly patternId: string;
  readonly envelope: unknown;
}): DecodedPatternCandidateDefinition {
  const envelope = exactRecord(
    input.envelope,
    [
      'schemaVersion',
      'encoding',
      'contentHash',
      'uncompressedBytes',
      'workflowPatternId',
      'supportCount',
      'contradictionCount',
      'payload',
    ],
    'Pattern definition envelope',
  );
  if (envelope['schemaVersion'] !== '1.2' || envelope['encoding'] !== 'br+base64') {
    invalidEnvelope('Pattern definition envelope version or encoding is invalid.');
  }
  const contentHash = envelope['contentHash'];
  const uncompressedBytes = envelope['uncompressedBytes'];
  const workflowPatternId = envelope['workflowPatternId'];
  const supportCount = envelope['supportCount'];
  const contradictionCount = envelope['contradictionCount'];
  const payload = envelope['payload'];
  if (
    typeof contentHash !== 'string' ||
    !HASH_PATTERN.test(contentHash) ||
    typeof workflowPatternId !== 'string' ||
    workflowPatternId.trim() === '' ||
    !nonNegativeSafeInteger(uncompressedBytes) ||
    uncompressedBytes > MAX_PATTERN_DEFINITION_BYTES ||
    !nonNegativeSafeInteger(supportCount) ||
    !nonNegativeSafeInteger(contradictionCount) ||
    typeof payload !== 'string' ||
    payload.length === 0 ||
    !BASE64_PATTERN.test(payload)
  ) {
    invalidEnvelope('Pattern definition envelope identity metadata is invalid.');
  }
  const compressed = Buffer.from(payload, 'base64');
  if (compressed.toString('base64') !== payload) {
    invalidEnvelope('Pattern definition payload is not canonical Base64.');
  }
  let decompressed: Buffer;
  try {
    decompressed = brotliDecompressSync(compressed, {
      maxOutputLength: MAX_PATTERN_DEFINITION_BYTES,
    });
  } catch (error) {
    throw new PatternDefinitionArtifactError(
      'PATTERN_DEFINITION_INTEGRITY_MISMATCH',
      `Pattern definition Brotli payload could not be decoded: ${errorSummary(error)}`,
    );
  }
  if (decompressed.byteLength !== uncompressedBytes) {
    integrityError('Pattern definition decompressed byte size does not match its envelope.');
  }
  const actualHash = `sha256:${createHash('sha256').update(decompressed).digest('hex')}`;
  if (actualHash !== contentHash) {
    integrityError('Pattern definition decompressed bytes do not match their envelope hash.');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(decompressed.toString('utf8')) as unknown;
  } catch {
    contentError('Pattern definition decompressed bytes are not JSON.');
  }
  const definition = exactRecord(
    decoded,
    ['schemaVersion', 'cohort', 'variants', 'discoveredPattern', 'workflowPattern'],
    'Pattern definition',
  ) as Readonly<Record<string, EvidenceJsonValue>>;
  if (definition['schemaVersion'] !== '1.2') {
    contentError('Pattern definition contract version is invalid.');
  }
  if (!Array.isArray(definition['variants']) || definition['variants'].length === 0) {
    contentError('Pattern definition variants are invalid.');
  }
  try {
    createCohortDefinition(definition['cohort'] as never);
    for (const variant of definition['variants']) createProcessVariant(variant as never);
    const discovered = createDiscoveredProcessPattern(definition['discoveredPattern'] as never);
    const workflow = createWorkflowPattern(definition['workflowPattern'] as never);
    if (
      discovered.patternId !== input.patternId ||
      workflow.sourcePatternRef !== input.patternId ||
      workflow.workflowPatternId !== workflowPatternId ||
      workflow.sourceTraceRefs.length !== supportCount ||
      discovered.supportRefs.length !== supportCount ||
      discovered.contradictionRefs.length !== contradictionCount
    ) {
      contentError('Pattern definition identity or support metadata is inconsistent.');
    }
  } catch (error) {
    if (error instanceof PatternDefinitionArtifactError) throw error;
    throw new PatternDefinitionArtifactError(
      'PATTERN_DEFINITION_CONTENT_INVALID',
      `Pattern definition domain contract is invalid: ${errorSummary(error)}`,
    );
  }

  const canonicalJson = canonicalizeSourceArtifactJson(definition);
  if (!Buffer.from(canonicalJson, 'utf8').equals(decompressed)) {
    integrityError('Pattern definition decompressed bytes are not canonical JSON.');
  }
  const sourceArtifact = buildRuntimeSourceArtifact({
    sourceTable: 'pattern_candidate',
    sourceRecordId: input.patternId,
    sourceVersion: 1,
    value: definition,
  });
  if (
    sourceArtifact.artifactRef.sha256 !== contentHash ||
    sourceArtifact.artifactRef.byteSize !== uncompressedBytes ||
    !Buffer.from(sourceArtifact.canonicalBytes).equals(decompressed)
  ) {
    integrityError('Pattern definition ArtifactRef does not identify the decompressed bytes.');
  }
  return Object.freeze({
    definition: Object.freeze(definition),
    contentHash,
    uncompressedBytes,
    sourceArtifact,
  });
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    contentError(`${label} must be an object.`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    contentError(`${label} fields are incomplete or unknown.`);
  }
  return record;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function invalidEnvelope(message: string): never {
  throw new PatternDefinitionArtifactError('PATTERN_DEFINITION_ENVELOPE_INVALID', message);
}

function contentError(message: string): never {
  throw new PatternDefinitionArtifactError('PATTERN_DEFINITION_CONTENT_INVALID', message);
}

function integrityError(message: string): never {
  throw new PatternDefinitionArtifactError('PATTERN_DEFINITION_INTEGRITY_MISMATCH', message);
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown failure';
}
