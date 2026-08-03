import type { JsonObject } from './configuration-revision.js';
import { NodeControlDomainError } from './errors.js';

export type TelemetryExportConfigurationStatus = 'draft' | 'active' | 'suspended' | 'retired';
export type TelemetryExportApplyMode = 'hot_reload' | 'reconnect_required' | 'restart_required';

export interface TelemetryExportConfiguration {
  readonly exportId: string;
  readonly endpointRef: string;
  readonly sourceId: string;
  readonly nodeId?: string;
  readonly credentialRef: string;
  readonly recordFamilies: readonly string[];
  readonly batchPolicy?: JsonObject;
  readonly retryPolicy?: JsonObject;
  readonly outboxPolicy?: JsonObject;
  readonly tlsPolicyRef?: string;
  readonly status: TelemetryExportConfigurationStatus;
  readonly revision: number;
  readonly applyMode?: TelemetryExportApplyMode;
}

export interface TelemetryExportStatus {
  readonly exportId: string;
  readonly status: 'healthy' | 'degraded' | 'blocked' | 'disabled' | 'unavailable';
  readonly activeRevision?: number;
  readonly lastAcknowledgedSequence?: number;
  readonly pendingRecords: number;
  readonly oldestPendingAt?: string;
  readonly lastAcknowledgedAt?: string;
  readonly lastErrorCode?: string;
  readonly lastErrorAt?: string;
  readonly observedAt: string;
}

const SECRET_KEY = /(?:password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)$/iu;
const REFERENCE_KEY = /(?:ref|reference)$/iu;

export function normalizeTelemetryExportConfiguration(
  input: TelemetryExportConfiguration,
): TelemetryExportConfiguration {
  const endpointRef = required(input.endpointRef, 'endpointRef');
  const endpoint = parseEndpoint(endpointRef);
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
    invalid('endpointRef must use HTTP or HTTPS.');
  if (endpoint.username !== '' || endpoint.password !== '')
    invalid('endpointRef must not contain credentials.');
  const recordFamilies = Object.freeze(
    [...new Set(input.recordFamilies.map((value) => required(value, 'recordFamilies')))].sort(),
  );
  if (recordFamilies.length === 0) invalid('recordFamilies must not be empty.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1)
    invalid('revision must be a positive safe integer.');
  assertNoInlineSecrets(input.batchPolicy, 'batchPolicy');
  assertNoInlineSecrets(input.retryPolicy, 'retryPolicy');
  assertNoInlineSecrets(input.outboxPolicy, 'outboxPolicy');
  assertBoundedInteger(input.batchPolicy?.['maxRecords'], 'batchPolicy.maxRecords', 1, 1_000);
  assertBoundedInteger(
    input.retryPolicy?.['baseDelaySeconds'],
    'retryPolicy.baseDelaySeconds',
    1,
    300,
  );
  assertBoundedInteger(
    input.retryPolicy?.['maxDelaySeconds'],
    'retryPolicy.maxDelaySeconds',
    1,
    86_400,
  );
  assertBoundedInteger(
    input.outboxPolicy?.['maxPendingRecords'],
    'outboxPolicy.maxPendingRecords',
    1,
    1_000_000,
  );
  const baseDelay = input.retryPolicy?.['baseDelaySeconds'];
  const maxDelay = input.retryPolicy?.['maxDelaySeconds'];
  if (typeof baseDelay === 'number' && typeof maxDelay === 'number' && baseDelay > maxDelay)
    invalid('retryPolicy.baseDelaySeconds must not exceed maxDelaySeconds.');
  return Object.freeze({
    exportId: required(input.exportId, 'exportId'),
    endpointRef: endpoint.toString(),
    sourceId: required(input.sourceId, 'sourceId'),
    ...(input.nodeId === undefined ? {} : { nodeId: required(input.nodeId, 'nodeId') }),
    credentialRef: required(input.credentialRef, 'credentialRef'),
    recordFamilies,
    ...(input.batchPolicy === undefined ? {} : { batchPolicy: freezeObject(input.batchPolicy) }),
    ...(input.retryPolicy === undefined ? {} : { retryPolicy: freezeObject(input.retryPolicy) }),
    ...(input.outboxPolicy === undefined ? {} : { outboxPolicy: freezeObject(input.outboxPolicy) }),
    ...(input.tlsPolicyRef === undefined
      ? {}
      : { tlsPolicyRef: required(input.tlsPolicyRef, 'tlsPolicyRef') }),
    status: input.status,
    revision: input.revision,
    ...(input.applyMode === undefined ? {} : { applyMode: input.applyMode }),
  });
}

export function activeTelemetryExportConfiguration(
  input: TelemetryExportConfiguration,
): TelemetryExportConfiguration {
  return Object.freeze({ ...normalizeTelemetryExportConfiguration(input), status: 'active' });
}

function assertNoInlineSecrets(value: JsonObject | undefined, field: string): void {
  if (value === undefined) return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && !REFERENCE_KEY.test(key))
      invalid(`${field} contains an inline secret field.`);
    if (typeof nested === 'object' && nested !== null && !Array.isArray(nested))
      assertNoInlineSecrets(nested as JsonObject, `${field}.${key}`);
  }
}

function freezeObject(value: JsonObject): JsonObject {
  return Object.freeze(structuredClone(value));
}

function assertBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
    invalid(`${field} is outside its supported range.`);
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > 2_048) invalid(`${field} is invalid.`);
  return normalized;
}

function parseEndpoint(value: string): URL {
  try {
    return new URL(value);
  } catch {
    return invalid('endpointRef must be an absolute HTTP or HTTPS URL.');
  }
}

function invalid(message: string): never {
  throw new NodeControlDomainError('TELEMETRY_EXPORT_INVALID', message);
}
