import { createHash } from 'node:crypto';

export const EVIDENCE_CONTRACT_VERSION = 'sdar.evidence/v1' as const;
export const EVIDENCE_SCHEMA_VERSION = 1 as const;
export const EVIDENCE_MAX_JSON_DEPTH = 32;
export const EVIDENCE_MAX_CANONICAL_BYTES = 262_144;
export const EVIDENCE_MAX_REFERENCES = 256;

export const EVIDENCE_RECORD_FAMILIES = [
  'runtime',
  'skill',
  'mcp_task',
  'capability',
  'experience',
  'replay',
  'artifact',
  'node_control',
  'evidence',
] as const;
export const EVIDENCE_DELIVERY_GUARANTEES = [
  'transactional',
  'durable_projection',
  'buffered',
] as const;
export const EVIDENCE_EVALUATION_ROLES = ['required', 'supporting', 'diagnostic'] as const;

export type EvidenceRecordFamily = (typeof EVIDENCE_RECORD_FAMILIES)[number];
export type EvidenceSourceSystem = 'runtime' | 'node_control';
export type EvidenceDeliveryGuarantee = 'transactional' | 'durable_projection' | 'buffered';
export type EvidenceEvaluationRole = 'required' | 'supporting' | 'diagnostic';
export type EvidenceRequirementLevel = 'required' | 'conditional' | 'optional';
export type EvidenceSchemaCompatibility = 'backward_compatible_additive' | 'breaking';

export type EvidenceJsonScalar = string | number | boolean | null;
export type EvidenceJsonValue =
  | EvidenceJsonScalar
  | readonly EvidenceJsonValue[]
  | Readonly<{ [key: string]: EvidenceJsonValue }>;

export interface ArtifactRef {
  readonly artifactId: string;
  readonly version: number;
  readonly uri: string;
  readonly sha256: `sha256:${string}`;
  readonly mediaType: string;
  readonly byteSize: number;
}

export interface CanonicalEvidenceEnvelope<TPayload extends EvidenceJsonValue = EvidenceJsonValue> {
  readonly contractVersion: typeof EVIDENCE_CONTRACT_VERSION;
  readonly schemaName: string;
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly recordFamily: EvidenceRecordFamily;
  readonly recordType: string;
  readonly recordId: string;
  readonly sourceSystem: EvidenceSourceSystem;
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly sourceRevision: string;
  readonly tenantId?: string;
  readonly userScopeId?: string;
  readonly projectId?: string;
  readonly environment: string;
  readonly taskId?: string;
  readonly contextId?: string;
  readonly episodeId?: string;
  readonly runId?: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly skillExecutionId?: string;
  readonly capabilityBindingId?: string;
  readonly remoteTaskBindingId?: string;
  readonly nodeId?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly deliveryGuarantee: EvidenceDeliveryGuarantee;
  readonly evaluationRole: EvidenceEvaluationRole;
  readonly evidenceSequence?: string;
  readonly evidenceRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly payloadHash: `sha256:${string}`;
  readonly payload: TPayload;
}

export interface EvidenceRecordIdentityInput {
  readonly sourceSystem: EvidenceSourceSystem;
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly sourceRevision: string;
  readonly schemaName: string;
  readonly schemaVersion: number;
}

export interface CreateCanonicalEvidenceEnvelopeInput<
  TPayload extends EvidenceJsonValue = EvidenceJsonValue,
> extends EvidenceRecordIdentityInput {
  readonly recordFamily: EvidenceRecordFamily;
  readonly recordType: string;
  readonly environment: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly deliveryGuarantee: EvidenceDeliveryGuarantee;
  readonly evaluationRole: EvidenceEvaluationRole;
  readonly evidenceRefs?: readonly string[];
  readonly artifactRefs?: readonly string[];
  readonly tenantId?: string;
  readonly userScopeId?: string;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly contextId?: string;
  readonly episodeId?: string;
  readonly runId?: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly skillExecutionId?: string;
  readonly capabilityBindingId?: string;
  readonly remoteTaskBindingId?: string;
  readonly nodeId?: string;
  readonly causationId?: string;
  readonly evidenceSequence?: string;
  readonly payload: TPayload;
}

export type EvidenceContractErrorCode =
  | 'EVIDENCE_JSON_CYCLE'
  | 'EVIDENCE_JSON_DEPTH_EXCEEDED'
  | 'EVIDENCE_JSON_SIZE_EXCEEDED'
  | 'EVIDENCE_JSON_VALUE_INVALID'
  | 'EVIDENCE_FORBIDDEN_FIELD'
  | 'EVIDENCE_IDENTITY_INVALID'
  | 'EVIDENCE_REFERENCE_INVALID'
  | 'EVIDENCE_TIMESTAMP_INVALID'
  | 'EVIDENCE_PAYLOAD_CONFLICT';

export class EvidenceContractError extends Error {
  readonly code: EvidenceContractErrorCode;
  readonly field?: string;

  constructor(code: EvidenceContractErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'EvidenceContractError';
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}

const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const recordIdPattern = /^evidence_[0-9a-f]{64}$/u;

export function canonicalizeEvidenceJson(value: unknown): string {
  const active = new Set<object>();
  const canonical = canonicalize(value, 0, active, '$');
  const bytes = Buffer.byteLength(canonical, 'utf8');
  if (bytes > EVIDENCE_MAX_CANONICAL_BYTES) {
    throw new EvidenceContractError(
      'EVIDENCE_JSON_SIZE_EXCEEDED',
      `Canonical JSON is ${String(bytes)} bytes; maximum is ${String(EVIDENCE_MAX_CANONICAL_BYTES)}.`,
    );
  }
  return canonical;
}

export function hashCanonicalEvidenceJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalizeEvidenceJson(value)).digest('hex')}`;
}

export function createEvidenceRecordId(input: EvidenceRecordIdentityInput): string {
  for (const [field, value] of Object.entries(input)) {
    if ((typeof value === 'string' && value.trim() === '') || value === undefined) {
      throw new EvidenceContractError(
        'EVIDENCE_IDENTITY_INVALID',
        `${field} must be present and non-empty.`,
        field,
      );
    }
  }
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new EvidenceContractError(
      'EVIDENCE_IDENTITY_INVALID',
      'schemaVersion must be a positive safe integer.',
      'schemaVersion',
    );
  }
  const hash = createHash('sha256')
    .update(
      canonicalizeEvidenceJson([
        input.sourceSystem,
        input.sourceTable.trim(),
        input.sourceRecordId.trim(),
        input.sourceRevision.trim(),
        input.schemaName.trim(),
        input.schemaVersion,
      ]),
    )
    .digest('hex');
  return `evidence_${hash}`;
}

export function createCanonicalEvidenceEnvelope<TPayload extends EvidenceJsonValue>(
  input: CreateCanonicalEvidenceEnvelopeInput<TPayload>,
): CanonicalEvidenceEnvelope<TPayload> {
  if (input.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new EvidenceContractError(
      'EVIDENCE_IDENTITY_INVALID',
      `schemaVersion must equal ${String(EVIDENCE_SCHEMA_VERSION)}.`,
      'schemaVersion',
    );
  }
  if (!EVIDENCE_RECORD_FAMILIES.includes(input.recordFamily)) {
    throw new EvidenceContractError(
      'EVIDENCE_IDENTITY_INVALID',
      `Unknown evidence record family ${input.recordFamily}.`,
      'recordFamily',
    );
  }
  if (!['runtime', 'node_control'].includes(input.sourceSystem)) {
    throw new EvidenceContractError(
      'EVIDENCE_IDENTITY_INVALID',
      `Unknown evidence source system ${input.sourceSystem}.`,
      'sourceSystem',
    );
  }
  if (!EVIDENCE_DELIVERY_GUARANTEES.includes(input.deliveryGuarantee)) {
    throw new EvidenceContractError(
      'EVIDENCE_IDENTITY_INVALID',
      `Unknown delivery guarantee ${input.deliveryGuarantee}.`,
      'deliveryGuarantee',
    );
  }
  if (!EVIDENCE_EVALUATION_ROLES.includes(input.evaluationRole)) {
    throw new EvidenceContractError(
      'EVIDENCE_IDENTITY_INVALID',
      `Unknown evaluation role ${input.evaluationRole}.`,
      'evaluationRole',
    );
  }
  const evidenceRefs = normalizeReferences(input.evidenceRefs ?? [], 'evidenceRefs');
  const artifactRefs = normalizeReferences(input.artifactRefs ?? [], 'artifactRefs');
  assertIsoTimestamp(input.occurredAt, 'occurredAt');
  assertIsoTimestamp(input.recordedAt, 'recordedAt');
  const payloadHash = hashCanonicalEvidenceJson(input.payload);
  const recordId = createEvidenceRecordId(input);
  const optional = copyDefined(input, [
    'tenantId',
    'userScopeId',
    'projectId',
    'taskId',
    'contextId',
    'episodeId',
    'runId',
    'goalId',
    'goalVersion',
    'planId',
    'planVersion',
    'skillExecutionId',
    'capabilityBindingId',
    'remoteTaskBindingId',
    'nodeId',
    'causationId',
    'evidenceSequence',
  ] as const);
  return Object.freeze({
    contractVersion: EVIDENCE_CONTRACT_VERSION,
    schemaName: input.schemaName.trim(),
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    recordFamily: input.recordFamily,
    recordType: input.recordType.trim(),
    recordId,
    sourceSystem: input.sourceSystem,
    sourceTable: input.sourceTable.trim(),
    sourceRecordId: input.sourceRecordId.trim(),
    sourceRevision: input.sourceRevision.trim(),
    environment: requireText(input.environment, 'environment'),
    correlationId: requireText(input.correlationId, 'correlationId'),
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    deliveryGuarantee: input.deliveryGuarantee,
    evaluationRole: input.evaluationRole,
    evidenceRefs,
    artifactRefs,
    payloadHash,
    payload: input.payload,
    ...optional,
  });
}

export function assertEvidencePayloadIdentity(
  existing: Pick<CanonicalEvidenceEnvelope, 'recordId' | 'payloadHash'>,
  incoming: Pick<CanonicalEvidenceEnvelope, 'recordId' | 'payloadHash'>,
): void {
  if (existing.recordId === incoming.recordId && existing.payloadHash !== incoming.payloadHash) {
    throw new EvidenceContractError(
      'EVIDENCE_PAYLOAD_CONFLICT',
      `Evidence record ${existing.recordId} has conflicting payload hashes.`,
      'payloadHash',
    );
  }
}

export function isEvidenceRecordId(value: string): boolean {
  return recordIdPattern.test(value);
}

export function isEvidenceSha256(value: string): value is `sha256:${string}` {
  return sha256Pattern.test(value);
}

function canonicalize(value: unknown, depth: number, active: Set<object>, path: string): string {
  if (depth > EVIDENCE_MAX_JSON_DEPTH) {
    throw new EvidenceContractError(
      'EVIDENCE_JSON_DEPTH_EXCEEDED',
      `JSON depth exceeds ${String(EVIDENCE_MAX_JSON_DEPTH)}.`,
      path,
    );
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new EvidenceContractError(
        'EVIDENCE_JSON_VALUE_INVALID',
        'Non-finite numbers are forbidden.',
        path,
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') {
    throw new EvidenceContractError(
      'EVIDENCE_JSON_VALUE_INVALID',
      `Unsupported JSON value at ${path}.`,
      path,
    );
  }
  if (active.has(value)) {
    throw new EvidenceContractError('EVIDENCE_JSON_CYCLE', `Cyclic JSON at ${path}.`, path);
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value as readonly unknown[];
      if (items.length > 4096) {
        throw new EvidenceContractError(
          'EVIDENCE_JSON_SIZE_EXCEEDED',
          'JSON arrays are limited to 4096 items.',
          path,
        );
      }
      return `[${items
        .map((item, index) => canonicalize(item, depth + 1, active, `${path}[${String(index)}]`))
        .join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new EvidenceContractError(
        'EVIDENCE_JSON_VALUE_INVALID',
        `Only plain JSON objects are accepted at ${path}.`,
        path,
      );
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length > 1024) {
      throw new EvidenceContractError(
        'EVIDENCE_JSON_SIZE_EXCEEDED',
        'JSON objects are limited to 1024 fields.',
        path,
      );
    }
    return `{${entries
      .map(([key, item]) => {
        if (isForbiddenEvidenceField(key)) {
          throw new EvidenceContractError(
            'EVIDENCE_FORBIDDEN_FIELD',
            `Forbidden evidence field ${key}.`,
            `${path}.${key}`,
          );
        }
        return `${JSON.stringify(key)}:${canonicalize(item, depth + 1, active, `${path}.${key}`)}`;
      })
      .join(',')}}`;
  } finally {
    active.delete(value);
  }
}

function isForbiddenEvidenceField(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
  if (normalized.endsWith('credentialref') || normalized.endsWith('secretref')) return false;
  return /(?:credential|password|passwd|accesstoken|refreshtoken|secret|authorization|apikey|privatekey|chainofthought|privatereasoning|reasoningcontent|hiddenreasoning)/u.test(
    normalized,
  );
}

function normalizeReferences(values: readonly string[], field: string): readonly string[] {
  if (values.length > EVIDENCE_MAX_REFERENCES) {
    throw new EvidenceContractError(
      'EVIDENCE_REFERENCE_INVALID',
      `${field} exceeds ${String(EVIDENCE_MAX_REFERENCES)} entries.`,
      field,
    );
  }
  const normalized = values.map((value) => requireText(value, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new EvidenceContractError(
      'EVIDENCE_REFERENCE_INVALID',
      `${field} must contain unique references.`,
      field,
    );
  }
  return Object.freeze(normalized);
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > 4096) {
    throw new EvidenceContractError(
      'EVIDENCE_IDENTITY_INVALID',
      `${field} must contain 1..4096 characters.`,
      field,
    );
  }
  return normalized;
}

function assertIsoTimestamp(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)) {
    throw new EvidenceContractError(
      'EVIDENCE_TIMESTAMP_INVALID',
      `${field} must be an RFC 3339 UTC timestamp.`,
      field,
    );
  }
}

function copyDefined<T extends object, K extends readonly (keyof T)[]>(
  input: T,
  keys: K,
): Pick<T, K[number]> {
  const output: Partial<T> = {};
  for (const key of keys) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output as Pick<T, K[number]>;
}
