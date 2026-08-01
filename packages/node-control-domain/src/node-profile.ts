import { NodeControlDomainError } from './errors.js';

export type NodeProfileStatus = 'draft' | 'active' | 'maintenance' | 'retired';

export interface NodeProfile {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly displayName: string;
  readonly description: string;
  readonly environment: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly authorityScopes: readonly string[];
  readonly runtimeEndpointRef: string;
  readonly telemetrySourceId?: string;
  readonly status: NodeProfileStatus;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface NodeProfileInput {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly displayName: string;
  readonly description?: string;
  readonly environment: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly authorityScopes?: readonly string[];
  readonly runtimeEndpointRef: string;
  readonly telemetrySourceId?: string;
  readonly status?: NodeProfileStatus;
}

const PROFILE_STATUSES = new Set<NodeProfileStatus>(['draft', 'active', 'maintenance', 'retired']);

export function createNodeProfile(input: NodeProfileInput, updatedAt: string): NodeProfile {
  const nodeId = required(input.nodeId, 'nodeId', 128);
  const nodeType = required(input.nodeType, 'nodeType', 128);
  const displayName = required(input.displayName, 'displayName', 256);
  const environment = required(input.environment, 'environment', 128);
  const runtimeEndpointRef = required(input.runtimeEndpointRef, 'runtimeEndpointRef', 2048);
  const status = input.status ?? 'draft';
  if (!PROFILE_STATUSES.has(status)) invalid('status is not supported.');
  assertTimestamp(updatedAt);
  const labels = normalizeLabels(input.labels ?? {});
  const authorityScopes = normalizeStringSet(input.authorityScopes ?? [], 'authorityScopes', 64);
  const description = (input.description ?? '').trim();
  if (description.length > 4096) invalid('description must not exceed 4096 characters.');
  const telemetrySourceId = optional(input.telemetrySourceId, 'telemetrySourceId', 256);
  return Object.freeze({
    nodeId,
    nodeType,
    displayName,
    description,
    environment,
    labels,
    authorityScopes,
    runtimeEndpointRef,
    ...(telemetrySourceId === undefined ? {} : { telemetrySourceId }),
    status,
    revision: 1,
    updatedAt,
  });
}

export function rehydrateNodeProfile(profile: NodeProfile): NodeProfile {
  if (!Number.isSafeInteger(profile.revision) || profile.revision < 1)
    invalid('revision must be a positive safe integer.');
  const base = createNodeProfile(profile, profile.updatedAt);
  return Object.freeze({ ...base, revision: profile.revision });
}

function normalizeLabels(
  value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const entries = Object.entries(value);
  if (entries.length > 64) invalid('labels must not contain more than 64 entries.');
  const normalized: Record<string, string> = {};
  for (const [keyValue, labelValue] of entries) {
    const key = required(keyValue, 'label key', 128);
    const valueText = required(labelValue, `label ${key}`, 512);
    normalized[key] = valueText;
  }
  return Object.freeze(normalized);
}

function normalizeStringSet(
  values: readonly string[],
  field: string,
  maximumItems: number,
): readonly string[] {
  if (values.length > maximumItems) invalid(`${field} exceeds ${String(maximumItems)} items.`);
  const normalized = values.map((value) => required(value, field, 256));
  if (new Set(normalized).size !== normalized.length) invalid(`${field} must be unique.`);
  return Object.freeze(normalized);
}

function required(value: string, field: string, maximumLength: number): string {
  const normalized = value.trim();
  if (normalized === '') invalid(`${field} is required.`);
  if (normalized.length > maximumLength)
    invalid(`${field} must not exceed ${String(maximumLength)} characters.`);
  return normalized;
}

function optional(value: string | undefined, field: string, maximumLength: number) {
  if (value === undefined) return undefined;
  return required(value, field, maximumLength);
}

function assertTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) invalid('updatedAt must be an ISO 8601 timestamp.');
}

function invalid(message: string): never {
  throw new NodeControlDomainError('NODE_PROFILE_INVALID', message);
}
