import { createHash } from 'node:crypto';

import { NodeControlDomainError } from './errors.js';

export type ConfigurationTargetType =
  | 'node'
  | 'llm_provider'
  | 'model_route'
  | 'smpp_source'
  | 'mcp_provider_binding'
  | 'telemetry_link'
  | 'runtime_policy';

export type ConfigurationApplyMode =
  'hot_reload' | 'new_task_only' | 'reconnect_required' | 'restart_required' | 'immutable';

export type ConfigurationRevisionStatus =
  | 'draft'
  | 'validated'
  | 'published'
  | 'applying'
  | 'applied'
  | 'partially_applied'
  | 'rejected'
  | 'rolled_back';

export type RuntimeRevisionAckStatus =
  'applied' | 'partially_applied' | 'rejected' | 'restart_required' | 'stale' | 'unavailable';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface DesiredObservedState {
  readonly desired: Readonly<{
    revision?: number;
    status: string;
    checksum?: string;
  }>;
  readonly observed: Readonly<{
    revision?: number;
    status: string;
    checksum?: string;
    runtimeVersion?: string;
    observedAt?: string;
  }>;
  readonly convergence: Readonly<{
    status: 'converged' | 'pending' | 'degraded' | 'rejected' | 'restart_required' | 'unavailable';
    reasonCode?: string;
    detail?: string;
  }>;
}

export interface ConfigurationRevision {
  readonly configurationId: string;
  readonly targetType: ConfigurationTargetType;
  readonly targetId: string;
  readonly revision: number;
  readonly status: ConfigurationRevisionStatus;
  readonly applyMode: ConfigurationApplyMode;
  readonly content: JsonValue;
  readonly checksum: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly publishedAt?: string;
  readonly state?: DesiredObservedState;
}

export interface RuntimeRevisionAck {
  readonly runtimeInstanceId: string;
  readonly targetType: ConfigurationTargetType;
  readonly targetId: string;
  readonly revision: number;
  readonly status: RuntimeRevisionAckStatus;
  readonly observedRuntimeVersion: string;
  readonly activeChecksum?: string;
  readonly reasonCode?: string;
  readonly detail?: JsonObject;
  readonly acknowledgedAt: string;
}

const TARGET_TYPES = new Set<ConfigurationTargetType>([
  'node',
  'llm_provider',
  'model_route',
  'smpp_source',
  'mcp_provider_binding',
  'telemetry_link',
  'runtime_policy',
]);
const APPLY_MODES = new Set<ConfigurationApplyMode>([
  'hot_reload',
  'new_task_only',
  'reconnect_required',
  'restart_required',
  'immutable',
]);
const ACK_STATUSES = new Set<RuntimeRevisionAckStatus>([
  'applied',
  'partially_applied',
  'rejected',
  'restart_required',
  'stale',
  'unavailable',
]);
const FORBIDDEN_SECRET_KEYS =
  /(?:password|secret|token|credential|api[_-]?key|access[_-]?key|private[_-]?key)$/iu;
const SECRET_REFERENCE_KEYS = /(?:ref|reference)$/iu;
const MAX_CONTENT_BYTES = 262_144;
const MAX_CONTENT_DEPTH = 32;

export function createConfigurationRevision(
  input: Readonly<{
    configurationId: string;
    targetType: ConfigurationTargetType;
    targetId: string;
    revision: number;
    applyMode: ConfigurationApplyMode;
    content: JsonValue;
    createdBy: string;
  }>,
  createdAt: string,
): ConfigurationRevision {
  const configurationId = required(input.configurationId, 'configurationId', 256);
  const targetId = required(input.targetId, 'targetId', 256);
  const createdBy = required(input.createdBy, 'createdBy', 256);
  if (!TARGET_TYPES.has(input.targetType)) invalid('targetType is not supported.');
  if (!APPLY_MODES.has(input.applyMode)) invalid('applyMode is not supported.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1)
    invalid('revision must be a positive safe integer.');
  assertTimestamp(createdAt, 'createdAt');
  const content = normalizeJson(input.content);
  const canonical = canonicalJson(content);
  if (Buffer.byteLength(canonical, 'utf8') > MAX_CONTENT_BYTES)
    invalid(`content exceeds ${String(MAX_CONTENT_BYTES)} UTF-8 bytes.`);
  return Object.freeze({
    configurationId,
    targetType: input.targetType,
    targetId,
    revision: input.revision,
    status: 'draft',
    applyMode: input.applyMode,
    content,
    checksum: createHash('sha256').update(canonical).digest('hex'),
    createdBy,
    createdAt,
  });
}

export function validateConfigurationRevision(
  revision: ConfigurationRevision,
): ConfigurationRevision {
  assertRevisionIntegrity(revision);
  if (revision.status !== 'draft') transitionInvalid(revision.status, 'validated');
  return Object.freeze({ ...revision, status: 'validated' });
}

export function rehydrateConfigurationRevision(
  revision: ConfigurationRevision,
): ConfigurationRevision {
  const base = createConfigurationRevision(
    {
      configurationId: revision.configurationId,
      targetType: revision.targetType,
      targetId: revision.targetId,
      revision: revision.revision,
      applyMode: revision.applyMode,
      content: revision.content,
      createdBy: revision.createdBy,
    },
    revision.createdAt,
  );
  if (base.checksum !== revision.checksum)
    throw new NodeControlDomainError(
      'CONFIGURATION_CHECKSUM_MISMATCH',
      'Configuration Revision checksum does not match canonical content.',
    );
  if (revision.publishedAt !== undefined) assertTimestamp(revision.publishedAt, 'publishedAt');
  if (
    revision.status !== 'draft' &&
    revision.status !== 'validated' &&
    revision.publishedAt === undefined
  ) {
    invalid('Published Configuration Revision status requires publishedAt.');
  }
  return Object.freeze({
    ...base,
    status: revision.status,
    ...(revision.publishedAt === undefined ? {} : { publishedAt: revision.publishedAt }),
    ...(revision.state === undefined ? {} : { state: freezeState(revision.state) }),
  });
}

export function publishConfigurationRevision(
  revision: ConfigurationRevision,
  publishedAt: string,
): ConfigurationRevision {
  assertRevisionIntegrity(revision);
  if (revision.status !== 'validated') transitionInvalid(revision.status, 'published');
  assertTimestamp(publishedAt, 'publishedAt');
  return Object.freeze({ ...revision, status: 'published', publishedAt });
}

export function observeConfigurationRevision(
  revision: ConfigurationRevision,
  acknowledgement: RuntimeRevisionAck,
): ConfigurationRevisionStatus {
  assertRevisionIntegrity(revision);
  assertRuntimeRevisionAck(acknowledgement);
  if (
    acknowledgement.targetType !== revision.targetType ||
    acknowledgement.targetId !== revision.targetId ||
    acknowledgement.revision !== revision.revision
  ) {
    invalid('Runtime acknowledgement does not identify this Configuration Revision.');
  }
  if (acknowledgement.status === 'applied') {
    if (acknowledgement.activeChecksum !== revision.checksum)
      invalid('Applied acknowledgement checksum does not match the Configuration Revision.');
    return 'applied';
  }
  if (acknowledgement.status === 'partially_applied') return 'partially_applied';
  if (acknowledgement.status === 'rejected') return 'rejected';
  return revision.status === 'published' ? 'applying' : revision.status;
}

export function assertRuntimeRevisionAck(value: RuntimeRevisionAck): void {
  required(value.runtimeInstanceId, 'runtimeInstanceId', 256);
  if (!TARGET_TYPES.has(value.targetType)) invalid('ack targetType is not supported.');
  required(value.targetId, 'targetId', 256);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    invalid('ack revision must be a positive safe integer.');
  if (!ACK_STATUSES.has(value.status)) invalid('ack status is not supported.');
  required(value.observedRuntimeVersion, 'observedRuntimeVersion', 128);
  if (value.activeChecksum !== undefined) assertChecksum(value.activeChecksum);
  if (
    (value.status === 'rejected' || value.status === 'partially_applied') &&
    (value.reasonCode ?? '').trim() === ''
  ) {
    invalid(`${value.status} acknowledgement requires reasonCode.`);
  }
  assertTimestamp(value.acknowledgedAt, 'acknowledgedAt');
  if (value.detail !== undefined) normalizeJson(value.detail);
}

export function assertRevisionIntegrity(revision: ConfigurationRevision): void {
  const normalized = createConfigurationRevision(
    {
      configurationId: revision.configurationId,
      targetType: revision.targetType,
      targetId: revision.targetId,
      revision: revision.revision,
      applyMode: revision.applyMode,
      content: revision.content,
      createdBy: revision.createdBy,
    },
    revision.createdAt,
  );
  if (normalized.checksum !== revision.checksum)
    throw new NodeControlDomainError(
      'CONFIGURATION_CHECKSUM_MISMATCH',
      'Configuration Revision checksum does not match canonical content.',
    );
  if (revision.publishedAt !== undefined) assertTimestamp(revision.publishedAt, 'publishedAt');
}

export function configurationEtag(revision: ConfigurationRevision): string {
  return `"configuration:${revision.configurationId}:${String(revision.revision)}:${revision.status}:${revision.checksum}"`;
}

export function hashConfigurationRequest(value: JsonValue): string {
  return createHash('sha256')
    .update(canonicalJson(normalizeJson(value)))
    .digest('hex');
}

function normalizeJson(value: JsonValue, depth = 0, path = '$'): JsonValue {
  if (depth > MAX_CONTENT_DEPTH) invalid(`content exceeds depth ${String(MAX_CONTENT_DEPTH)}.`);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value))
    return Object.freeze(
      (value as readonly JsonValue[]).map((item, index) =>
        normalizeJson(item, depth + 1, `${path}[${String(index)}]`),
      ),
    );
  if (typeof value !== 'object') invalid(`${path} is not JSON-compatible.`);
  const normalized: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const cleanKey = required(key, `${path} key`, 256);
    if (FORBIDDEN_SECRET_KEYS.test(cleanKey) && !SECRET_REFERENCE_KEYS.test(cleanKey))
      throw new NodeControlDomainError(
        'CONFIGURATION_PLAINTEXT_SECRET_FORBIDDEN',
        `${path}.${cleanKey} must be represented by a SecretRef, not plaintext.`,
      );
    normalized[cleanKey] = normalizeJson(item, depth + 1, `${path}.${cleanKey}`);
  }
  return Object.freeze(normalized);
}

function freezeState(state: DesiredObservedState): DesiredObservedState {
  return Object.freeze({
    desired: Object.freeze({ ...state.desired }),
    observed: Object.freeze({ ...state.observed }),
    convergence: Object.freeze({ ...state.convergence }),
  });
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function assertChecksum(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) invalid('checksum must be a lowercase SHA-256 digest.');
}

function required(value: string, field: string, maximumLength: number): string {
  const normalized = value.trim();
  if (normalized === '') invalid(`${field} is required.`);
  if (normalized.length > maximumLength)
    invalid(`${field} must not exceed ${String(maximumLength)} characters.`);
  return normalized;
}

function assertTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) invalid(`${field} must be an ISO 8601 timestamp.`);
}

function transitionInvalid(from: string, to: string): never {
  throw new NodeControlDomainError(
    'CONFIGURATION_TRANSITION_INVALID',
    `Cannot transition Configuration Revision from ${from} to ${to}.`,
  );
}

function invalid(message: string): never {
  throw new NodeControlDomainError('CONFIGURATION_REVISION_INVALID', message);
}
