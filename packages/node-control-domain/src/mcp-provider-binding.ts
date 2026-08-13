import { NodeControlDomainError } from './errors.js';

export type McpBindingOriginType = 'direct' | 'smpp_registry';
export type McpBindingStatus =
  'candidate' | 'imported' | 'active' | 'degraded' | 'suspended' | 'removed';
export type McpBindingAvailabilityStatus = 'unknown' | 'available' | 'degraded' | 'unavailable';

/** Explicit authority for a credential-free MCP Runtime. Missing SecretRefs never fall back here. */
export const MCP_UNAUTHENTICATED_CREDENTIAL_REF = 'unauthenticated://none' as const;

export interface McpProviderBinding {
  readonly bindingId: string;
  readonly localServerId: string;
  readonly originType: McpBindingOriginType;
  readonly smppSourceId?: string;
  readonly externalProviderId?: string;
  readonly externalServerId?: string;
  readonly registryRevision?: number;
  readonly registryChecksum?: string;
  readonly catalogRevision: string;
  readonly catalogChecksum: string;
  readonly endpointRef: string;
  readonly status: McpBindingStatus;
  readonly availabilityStatus: McpBindingAvailabilityStatus;
  readonly revision: number;
}

export interface McpProviderBindingRecord {
  readonly binding: McpProviderBinding;
  readonly credentialRef: string;
  readonly availabilityValidUntil: string;
  readonly catalogObservedAt: string;
  readonly operationCount: number;
}

export function createMcpProviderBinding(input: McpProviderBinding): McpProviderBinding {
  const bindingId = required(input.bindingId, 'bindingId');
  const localServerId = required(input.localServerId, 'localServerId');
  if (!['direct', 'smpp_registry'].includes(input.originType))
    invalid('originType is unsupported.');
  if (
    !['candidate', 'imported', 'active', 'degraded', 'suspended', 'removed'].includes(input.status)
  )
    invalid('status is unsupported.');
  if (!['unknown', 'available', 'degraded', 'unavailable'].includes(input.availabilityStatus))
    invalid('availabilityStatus is unsupported.');
  positive(input.revision, 'revision');
  const smppFields = [
    input.smppSourceId,
    input.externalProviderId,
    input.externalServerId,
    input.registryRevision,
    input.registryChecksum,
  ];
  if (input.originType === 'direct' && smppFields.some((value) => value !== undefined))
    invalid('direct bindings cannot carry SMPP origin lineage.');
  if (input.originType === 'smpp_registry' && smppFields.some((value) => value === undefined))
    invalid('SMPP bindings require complete Source, Provider, Server and Snapshot lineage.');
  if (input.registryRevision !== undefined) positive(input.registryRevision, 'registryRevision');
  if (input.registryChecksum !== undefined) checksum(input.registryChecksum, 'registryChecksum');
  const catalogRevision = required(input.catalogRevision, 'catalogRevision');
  checksum(input.catalogChecksum, 'catalogChecksum');
  return Object.freeze({
    bindingId,
    localServerId,
    originType: input.originType,
    ...(input.smppSourceId === undefined
      ? {}
      : { smppSourceId: required(input.smppSourceId, 'smppSourceId') }),
    ...(input.externalProviderId === undefined
      ? {}
      : { externalProviderId: required(input.externalProviderId, 'externalProviderId') }),
    ...(input.externalServerId === undefined
      ? {}
      : { externalServerId: required(input.externalServerId, 'externalServerId') }),
    ...(input.registryRevision === undefined ? {} : { registryRevision: input.registryRevision }),
    ...(input.registryChecksum === undefined ? {} : { registryChecksum: input.registryChecksum }),
    catalogRevision,
    catalogChecksum: input.catalogChecksum,
    endpointRef: safeEndpoint(input.endpointRef),
    status: input.status,
    availabilityStatus: input.availabilityStatus,
    revision: input.revision,
  });
}

export function createMcpProviderBindingRecord(
  input: McpProviderBindingRecord,
): McpProviderBindingRecord {
  const binding = createMcpProviderBinding(input.binding);
  const credentialRef = validateMcpCredentialRef(input.credentialRef);
  timestamp(input.availabilityValidUntil, 'availabilityValidUntil');
  timestamp(input.catalogObservedAt, 'catalogObservedAt');
  if (Date.parse(input.availabilityValidUntil) <= Date.parse(input.catalogObservedAt))
    invalid('availabilityValidUntil must be later than catalogObservedAt.');
  if (
    !Number.isSafeInteger(input.operationCount) ||
    input.operationCount < 0 ||
    input.operationCount > 1024
  )
    invalid('operationCount must be a safe integer between 0 and 1024.');
  return Object.freeze({
    binding,
    credentialRef,
    availabilityValidUntil: input.availabilityValidUntil,
    catalogObservedAt: input.catalogObservedAt,
    operationCount: input.operationCount,
  });
}

export function validateMcpCredentialRef(value: string): string {
  const normalized = required(value, 'credentialRef');
  if (
    normalized !== MCP_UNAUTHENTICATED_CREDENTIAL_REF &&
    !/^secret:\/\/[A-Za-z0-9._~:/-]+$/u.test(normalized)
  )
    invalid(`credentialRef must be an opaque SecretRef or ${MCP_UNAUTHENTICATED_CREDENTIAL_REF}.`);
  return normalized;
}

export function mcpBindingSelectable(
  record: McpProviderBindingRecord,
  observedAt: string,
): boolean {
  timestamp(observedAt, 'observedAt');
  return (
    record.binding.status === 'active' &&
    record.binding.availabilityStatus === 'available' &&
    Date.parse(record.availabilityValidUntil) > Date.parse(observedAt)
  );
}

function safeEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return invalid('endpointRef must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    invalid('endpointRef must be HTTP(S) and cannot contain credentials.');
  endpoint.hash = '';
  return endpoint.toString();
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > 512)
    invalid(`${field} must contain between 1 and 512 characters.`);
  return normalized;
}

function positive(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    invalid(`${field} must be a positive safe integer.`);
}

function checksum(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) invalid(`${field} must be a lowercase SHA-256 digest.`);
}

function timestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) invalid(`${field} must be an ISO 8601 timestamp.`);
}

function invalid(message: string): never {
  throw new NodeControlDomainError('MCP_PROVIDER_BINDING_INVALID', message);
}
