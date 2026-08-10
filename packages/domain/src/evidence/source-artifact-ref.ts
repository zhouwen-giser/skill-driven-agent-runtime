import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { ArtifactRef, EvidenceJsonValue } from './canonical-evidence.js';

export const RUNTIME_SOURCE_ARTIFACT_AUTHORITY = 'runtime' as const;
export const RUNTIME_SOURCE_ARTIFACT_MEDIA_TYPE = 'application/json' as const;
export const RUNTIME_SOURCE_ARTIFACT_MAX_BYTES = 1_073_741_824;
export const RUNTIME_SOURCE_ARTIFACT_MAX_URI_LENGTH = 4096;
export const RUNTIME_SOURCE_ARTIFACT_MAX_RECORD_ID_LENGTH = 512;
export const RUNTIME_SOURCE_ARTIFACT_MAX_VERSION = 2_147_483_647;

export const RUNTIME_SOURCE_ARTIFACT_TABLES = [
  'compiled_artifact',
  'replay_dataset_manifest',
  'artifact_replay_case',
  'pattern_candidate',
] as const;

export type RuntimeSourceArtifactTable = (typeof RUNTIME_SOURCE_ARTIFACT_TABLES)[number];
export type RuntimeSourceArtifactFieldPath =
  'definition.artifact.definition' | 'definition' | 'content';

export interface RuntimeSourceArtifactAddress {
  readonly authority: typeof RUNTIME_SOURCE_ARTIFACT_AUTHORITY;
  readonly sourceTable: RuntimeSourceArtifactTable;
  readonly sourceRecordId: string;
  readonly sourceVersion: number;
  readonly fieldPath: RuntimeSourceArtifactFieldPath;
}

export interface BuildRuntimeSourceArtifactInput {
  readonly sourceTable: RuntimeSourceArtifactTable;
  readonly sourceRecordId: string;
  readonly sourceVersion: number;
  readonly value: EvidenceJsonValue;
}

export interface CanonicalRuntimeSourceArtifact {
  readonly address: RuntimeSourceArtifactAddress;
  readonly artifactRef: ArtifactRef;
  readonly canonicalJson: string;
  readonly canonicalBytes: Uint8Array;
}

export type SourceArtifactRefErrorCode =
  | 'SOURCE_ARTIFACT_ADDRESS_INVALID'
  | 'SOURCE_ARTIFACT_CONTENT_INVALID'
  | 'SOURCE_ARTIFACT_INTEGRITY_MISMATCH'
  | 'SOURCE_ARTIFACT_SIZE_EXCEEDED'
  | 'SOURCE_ARTIFACT_URI_INVALID';

export class SourceArtifactRefError extends Error {
  readonly code: SourceArtifactRefErrorCode;
  readonly field?: string;

  constructor(code: SourceArtifactRefErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'SourceArtifactRefError';
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}

const URI_PREFIX = 'artifact://runtime/v1/';
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const MAX_JSON_DEPTH = 32;

/**
 * Builds the externally carried ArtifactRef and its canonical source bytes together.
 * The digest and byte size are always calculated over the returned canonicalBytes.
 */
export function buildRuntimeSourceArtifact(
  input: BuildRuntimeSourceArtifactInput,
): CanonicalRuntimeSourceArtifact {
  const address = createAddress(input);
  const canonicalJson = canonicalizeSourceArtifactJson(input.value);
  const canonicalBytes = Buffer.from(canonicalJson, 'utf8');
  if (canonicalBytes.byteLength > RUNTIME_SOURCE_ARTIFACT_MAX_BYTES) {
    throw new SourceArtifactRefError(
      'SOURCE_ARTIFACT_SIZE_EXCEEDED',
      `Source Artifact is ${String(canonicalBytes.byteLength)} bytes; maximum is ${String(RUNTIME_SOURCE_ARTIFACT_MAX_BYTES)}.`,
      'value',
    );
  }
  const uri = formatRuntimeSourceArtifactUri(address);
  const artifactRef: ArtifactRef = Object.freeze({
    artifactId: address.sourceRecordId,
    version: address.sourceVersion,
    uri,
    sha256: `sha256:${createHash('sha256').update(canonicalBytes).digest('hex')}`,
    mediaType: RUNTIME_SOURCE_ARTIFACT_MEDIA_TYPE,
    byteSize: canonicalBytes.byteLength,
  });
  return Object.freeze({
    address,
    artifactRef,
    canonicalJson,
    canonicalBytes,
  });
}

export function parseRuntimeSourceArtifactUri(uri: string): RuntimeSourceArtifactAddress {
  if (
    typeof uri !== 'string' ||
    uri.length < URI_PREFIX.length + 1 ||
    uri.length > RUNTIME_SOURCE_ARTIFACT_MAX_URI_LENGTH ||
    !uri.startsWith(URI_PREFIX)
  ) {
    throw uriError('URI must use the canonical runtime Artifact authority.');
  }
  const segments = uri.slice(URI_PREFIX.length).split('/');
  const table = segments[0];
  if (!isRuntimeSourceArtifactTable(table)) {
    throw uriError('URI contains an unknown Runtime source table.');
  }
  const expectedLength = table === 'compiled_artifact' ? 6 : 4;
  if (segments.length !== expectedLength) {
    throw uriError('URI contains an invalid or traversing source path.');
  }
  const encodedRecordId = segments[1];
  const versionText = segments[2];
  if (encodedRecordId === undefined || versionText === undefined) {
    throw uriError('URI source identity is incomplete.');
  }
  const sourceRecordId = decodeRecordId(encodedRecordId);
  const sourceVersion = parseVersion(versionText);
  if ((table === 'artifact_replay_case' || table === 'pattern_candidate') && sourceVersion !== 1) {
    throw uriError(`${table} uses immutable source version 1.`);
  }
  const fieldPath = parseFieldPath(table, segments.slice(3));
  const address = createAddress({
    sourceTable: table,
    sourceRecordId,
    sourceVersion,
  });
  if (address.fieldPath !== fieldPath || formatRuntimeSourceArtifactUri(address) !== uri) {
    throw uriError('URI is not in canonical form.');
  }
  return address;
}

export function formatRuntimeSourceArtifactUri(address: RuntimeSourceArtifactAddress): string {
  if (!isRuntimeAuthority(address.authority)) {
    throw new SourceArtifactRefError(
      'SOURCE_ARTIFACT_ADDRESS_INVALID',
      'Only the Runtime source Artifact authority is allowed.',
      'authority',
    );
  }
  const canonical = createAddress({
    sourceTable: address.sourceTable,
    sourceRecordId: address.sourceRecordId,
    sourceVersion: address.sourceVersion,
  });
  if (address.fieldPath !== canonical.fieldPath) {
    throw new SourceArtifactRefError(
      'SOURCE_ARTIFACT_ADDRESS_INVALID',
      'Runtime source Artifact address authority or field path is invalid.',
      'address',
    );
  }
  const field = canonical.fieldPath.replaceAll('.', '/');
  const uri = `${URI_PREFIX}${canonical.sourceTable}/${encodeURIComponent(canonical.sourceRecordId)}/${String(canonical.sourceVersion)}/${field}`;
  if (uri.length > RUNTIME_SOURCE_ARTIFACT_MAX_URI_LENGTH) {
    throw new SourceArtifactRefError(
      'SOURCE_ARTIFACT_ADDRESS_INVALID',
      `Runtime source Artifact URI exceeds ${String(RUNTIME_SOURCE_ARTIFACT_MAX_URI_LENGTH)} characters.`,
      'uri',
    );
  }
  return uri;
}

export function assertRuntimeSourceArtifactRef(
  expected: ArtifactRef,
  actual: CanonicalRuntimeSourceArtifact,
): void {
  if (
    expected.artifactId !== actual.artifactRef.artifactId ||
    expected.version !== actual.artifactRef.version ||
    expected.uri !== actual.artifactRef.uri ||
    expected.sha256 !== actual.artifactRef.sha256 ||
    expected.mediaType !== actual.artifactRef.mediaType ||
    expected.byteSize !== actual.artifactRef.byteSize
  ) {
    throw new SourceArtifactRefError(
      'SOURCE_ARTIFACT_INTEGRITY_MISMATCH',
      `Runtime source Artifact ${expected.uri} failed canonical byte integrity verification.`,
      'artifactRef',
    );
  }
}

export function validateRuntimeSourceArtifactRef(ref: ArtifactRef): RuntimeSourceArtifactAddress {
  const address = parseRuntimeSourceArtifactUri(ref.uri);
  if (
    ref.artifactId !== address.sourceRecordId ||
    ref.version !== address.sourceVersion ||
    ref.mediaType !== RUNTIME_SOURCE_ARTIFACT_MEDIA_TYPE ||
    !HASH_PATTERN.test(ref.sha256) ||
    !Number.isSafeInteger(ref.byteSize) ||
    ref.byteSize < 0 ||
    ref.byteSize > RUNTIME_SOURCE_ARTIFACT_MAX_BYTES
  ) {
    throw new SourceArtifactRefError(
      'SOURCE_ARTIFACT_ADDRESS_INVALID',
      'ArtifactRef metadata does not match its canonical Runtime source URI.',
      'artifactRef',
    );
  }
  return address;
}

export function canonicalizeSourceArtifactJson(value: EvidenceJsonValue): string {
  return canonicalize(value, 0, new Set<object>(), '$');
}

/** Hashes the exact canonical source-Artifact byte domain without Evidence envelope array bounds. */
export function hashSourceArtifactJson(value: EvidenceJsonValue): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(Buffer.from(canonicalizeSourceArtifactJson(value), 'utf8'))
    .digest('hex')}`;
}

function createAddress(
  input: Pick<BuildRuntimeSourceArtifactInput, 'sourceTable' | 'sourceRecordId' | 'sourceVersion'>,
): RuntimeSourceArtifactAddress {
  if (!isRuntimeSourceArtifactTable(input.sourceTable)) {
    throw new SourceArtifactRefError(
      'SOURCE_ARTIFACT_ADDRESS_INVALID',
      'Unknown Runtime source Artifact table.',
      'sourceTable',
    );
  }
  const sourceRecordId = validateRecordId(input.sourceRecordId);
  const sourceVersion = validateVersion(input.sourceVersion);
  if (
    (input.sourceTable === 'artifact_replay_case' || input.sourceTable === 'pattern_candidate') &&
    sourceVersion !== 1
  ) {
    throw new SourceArtifactRefError(
      'SOURCE_ARTIFACT_ADDRESS_INVALID',
      `${input.sourceTable} uses immutable source version 1.`,
      'sourceVersion',
    );
  }
  return Object.freeze({
    authority: RUNTIME_SOURCE_ARTIFACT_AUTHORITY,
    sourceTable: input.sourceTable,
    sourceRecordId,
    sourceVersion,
    fieldPath:
      input.sourceTable === 'compiled_artifact'
        ? 'definition.artifact.definition'
        : input.sourceTable === 'pattern_candidate'
          ? 'definition'
          : 'content',
  });
}

function parseFieldPath(
  table: RuntimeSourceArtifactTable,
  segments: readonly string[],
): RuntimeSourceArtifactFieldPath {
  if (
    table === 'compiled_artifact' &&
    segments.length === 3 &&
    segments[0] === 'definition' &&
    segments[1] === 'artifact' &&
    segments[2] === 'definition'
  ) {
    return 'definition.artifact.definition';
  }
  if (table !== 'compiled_artifact' && segments.length === 1 && segments[0] === 'content') {
    return 'content';
  }
  if (table === 'pattern_candidate' && segments.length === 1 && segments[0] === 'definition') {
    return 'definition';
  }
  throw uriError('URI source field path is not allowed.');
}

function decodeRecordId(encoded: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw uriError('URI source record ID encoding is invalid.');
  }
  return validateRecordId(decoded, 'SOURCE_ARTIFACT_URI_INVALID');
}

function validateRecordId(
  value: string,
  code: Extract<
    SourceArtifactRefErrorCode,
    'SOURCE_ARTIFACT_ADDRESS_INVALID' | 'SOURCE_ARTIFACT_URI_INVALID'
  > = 'SOURCE_ARTIFACT_ADDRESS_INVALID',
): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > RUNTIME_SOURCE_ARTIFACT_MAX_RECORD_ID_LENGTH ||
    value === '.' ||
    value === '..' ||
    hasPathControlCharacter(value)
  ) {
    throw new SourceArtifactRefError(
      code,
      'Runtime source record ID is empty, oversized, or contains a path traversal character.',
      'sourceRecordId',
    );
  }
  return value;
}

function parseVersion(value: string): number {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) throw uriError('URI source version is invalid.');
  return validateVersion(Number(value), 'SOURCE_ARTIFACT_URI_INVALID');
}

function validateVersion(
  value: number,
  code: Extract<
    SourceArtifactRefErrorCode,
    'SOURCE_ARTIFACT_ADDRESS_INVALID' | 'SOURCE_ARTIFACT_URI_INVALID'
  > = 'SOURCE_ARTIFACT_ADDRESS_INVALID',
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > RUNTIME_SOURCE_ARTIFACT_MAX_VERSION) {
    throw new SourceArtifactRefError(
      code,
      `Runtime source version must be between 1 and ${String(RUNTIME_SOURCE_ARTIFACT_MAX_VERSION)}.`,
      'sourceVersion',
    );
  }
  return value;
}

function isRuntimeSourceArtifactTable(
  value: string | undefined,
): value is RuntimeSourceArtifactTable {
  return RUNTIME_SOURCE_ARTIFACT_TABLES.some((table) => table === value);
}

function isRuntimeAuthority(value: unknown): value is typeof RUNTIME_SOURCE_ARTIFACT_AUTHORITY {
  return value === RUNTIME_SOURCE_ARTIFACT_AUTHORITY;
}

function uriError(message: string): SourceArtifactRefError {
  return new SourceArtifactRefError('SOURCE_ARTIFACT_URI_INVALID', message, 'uri');
}

function canonicalize(value: unknown, depth: number, active: Set<object>, path: string): string {
  if (depth > MAX_JSON_DEPTH) {
    throw contentError(`Source Artifact JSON depth exceeds ${String(MAX_JSON_DEPTH)}.`, path);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw contentError('Non-finite JSON numbers are forbidden.', path);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') {
    throw contentError('Unsupported Source Artifact JSON value.', path);
  }
  if (active.has(value)) throw contentError('Cyclic Source Artifact JSON is forbidden.', path);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index)) ||
        Reflect.ownKeys(value).some(
          (key) => typeof key !== 'string' || (key !== 'length' && !keys.includes(key)),
        )
      ) {
        throw contentError('Sparse or extended JSON arrays are forbidden.', path);
      }
      return `[${value
        .map((item, index) => canonicalize(item, depth + 1, active, `${path}[${String(index)}]`))
        .join(',')}]`;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw contentError('Only plain Source Artifact JSON objects are accepted.', path);
    }
    const keys = Object.keys(value);
    if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key))) {
      throw contentError('Hidden or symbolic Source Artifact JSON fields are forbidden.', path);
    }
    keys.sort(compareCodeUnits);
    const record = value as Readonly<Record<string, unknown>>;
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(record[key], depth + 1, active, `${path}.${key}`)}`,
      )
      .join(',')}}`;
  } finally {
    active.delete(value);
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasPathControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 32 || codeUnit === 127 || codeUnit === 47 || codeUnit === 92) return true;
  }
  return false;
}

function contentError(message: string, path: string): SourceArtifactRefError {
  return new SourceArtifactRefError(
    'SOURCE_ARTIFACT_CONTENT_INVALID',
    `${message} Path: ${path}.`,
    path,
  );
}
