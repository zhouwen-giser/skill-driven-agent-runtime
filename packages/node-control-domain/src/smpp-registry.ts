import { hashConfigurationRequest } from './configuration-revision.js';
import { NodeControlDomainError } from './errors.js';

export type SmppSourceSyncMode = 'manual' | 'poll' | 'watch';
export type SmppSourceLkgPolicy = 'allow_unexpired' | 'deny_when_unavailable';
export type SmppSourceStatus = 'draft' | 'active' | 'suspended' | 'retired';

/**
 * The only supported explicit no-credential authority for an SMPP Registry Source. This is not a
 * fallback: operators must choose it deliberately instead of supplying a SecretRef.
 */
export const SMPP_UNAUTHENTICATED_CREDENTIAL_REF = 'unauthenticated://none' as const;

export interface SmppRegistrySource {
  readonly smppSourceId: string;
  readonly name?: string;
  readonly registryEndpoint: string;
  readonly credentialRef: string;
  readonly tenantId?: string;
  readonly projectId?: string;
  readonly environment: string;
  readonly syncMode: SmppSourceSyncMode;
  readonly snapshotTtlSeconds: number;
  readonly lkgPolicy: SmppSourceLkgPolicy;
  readonly status: SmppSourceStatus;
  readonly activeSnapshotRevision?: number;
  readonly activeSnapshotChecksum?: string;
  readonly activeSnapshotValidUntil?: string;
  readonly lastSyncAt?: string;
  readonly lastErrorCode?: string;
  readonly revision: number;
}

export interface SmppProviderCandidate {
  readonly smppSourceId: string;
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly compositeIdentity: string;
  readonly serverEndpoint: string;
  readonly displayName?: string;
  readonly catalogRevision?: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface SmppProviderCandidateDirectoryEntry extends SmppProviderCandidate {
  readonly registryRevision: number;
  readonly registryChecksum: string;
  readonly registryEtag: string;
  readonly registryValidUntil: string;
  readonly nativeRegistryRevision?: number;
  readonly nativeRegistryChecksum?: string;
  readonly registryProjectionContract?: 'sdar-registry-v1';
}

export interface SmppRegistrySnapshot {
  readonly smppSourceId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly etag: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly candidates: readonly SmppProviderCandidate[];
}

export function createSmppRegistrySource(input: SmppRegistrySource): SmppRegistrySource {
  const sourceId = required(input.smppSourceId, 'smppSourceId');
  const name = optional(input.name, 'name');
  const tenantId = optional(input.tenantId, 'tenantId');
  const projectId = optional(input.projectId, 'projectId');
  const environment = required(input.environment, 'environment');
  if (!['manual', 'poll', 'watch'].includes(input.syncMode))
    sourceInvalid('syncMode is not supported.');
  if (!['allow_unexpired', 'deny_when_unavailable'].includes(input.lkgPolicy))
    sourceInvalid('lkgPolicy is not supported.');
  if (input.status !== 'draft') sourceInvalid('new SMPP Source must be draft.');
  positiveInteger(input.snapshotTtlSeconds, 'snapshotTtlSeconds', 2_592_000, sourceInvalid);
  positiveInteger(input.revision, 'revision', Number.MAX_SAFE_INTEGER, sourceInvalid);
  return Object.freeze({
    smppSourceId: sourceId,
    ...(name === undefined ? {} : { name }),
    registryEndpoint: safeHttpUrl(input.registryEndpoint, 'registryEndpoint', sourceInvalid),
    credentialRef: secretReference(input.credentialRef),
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(projectId === undefined ? {} : { projectId }),
    environment,
    syncMode: input.syncMode,
    snapshotTtlSeconds: input.snapshotTtlSeconds,
    lkgPolicy: input.lkgPolicy,
    status: 'draft',
    revision: input.revision,
  });
}

export function rehydrateSmppRegistrySource(input: SmppRegistrySource): SmppRegistrySource {
  const base = createSmppRegistrySource({ ...input, status: 'draft' });
  if (!['draft', 'active', 'suspended', 'retired'].includes(input.status))
    sourceInvalid('status is not supported.');
  if (input.activeSnapshotRevision !== undefined)
    positiveInteger(
      input.activeSnapshotRevision,
      'activeSnapshotRevision',
      Number.MAX_SAFE_INTEGER,
      sourceInvalid,
    );
  if (input.activeSnapshotChecksum !== undefined) checksum(input.activeSnapshotChecksum);
  if (input.activeSnapshotValidUntil !== undefined)
    timestamp(input.activeSnapshotValidUntil, 'activeSnapshotValidUntil', sourceInvalid);
  const activePointerFields = [
    input.activeSnapshotRevision,
    input.activeSnapshotChecksum,
    input.activeSnapshotValidUntil,
  ];
  if (
    activePointerFields.some((field) => field === undefined) &&
    activePointerFields.some((field) => field !== undefined)
  )
    sourceInvalid('active Snapshot revision, checksum, and validUntil must be present together.');
  if (input.lastSyncAt !== undefined) timestamp(input.lastSyncAt, 'lastSyncAt', sourceInvalid);
  const lastErrorCode = optional(input.lastErrorCode, 'lastErrorCode');
  return Object.freeze({
    ...base,
    status: input.status,
    ...(input.activeSnapshotRevision === undefined
      ? {}
      : {
          activeSnapshotRevision: input.activeSnapshotRevision,
          activeSnapshotChecksum: input.activeSnapshotChecksum,
          activeSnapshotValidUntil: input.activeSnapshotValidUntil,
        }),
    ...(input.lastSyncAt === undefined ? {} : { lastSyncAt: input.lastSyncAt }),
    ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
  });
}

export function createSmppRegistrySnapshot(input: SmppRegistrySnapshot): SmppRegistrySnapshot {
  const sourceId = required(input.smppSourceId, 'smppSourceId');
  positiveInteger(input.revision, 'snapshot revision', Number.MAX_SAFE_INTEGER, snapshotInvalid);
  checksum(input.checksum);
  const etag = required(input.etag, 'etag', 512, snapshotInvalid);
  timestamp(input.generatedAt, 'generatedAt', snapshotInvalid);
  timestamp(input.expiresAt, 'expiresAt', snapshotInvalid);
  if (Date.parse(input.expiresAt) <= Date.parse(input.generatedAt))
    snapshotInvalid('expiresAt must be later than generatedAt.');
  if (input.candidates.length > 100_000)
    snapshotInvalid('a Snapshot cannot contain more than 100000 candidates.');
  const candidates = input.candidates
    .map((candidate) => normalizeCandidate(sourceId, candidate))
    .sort((left, right) => left.compositeIdentity.localeCompare(right.compositeIdentity));
  if (
    new Set(candidates.map((candidate) => candidate.compositeIdentity)).size !== candidates.length
  )
    snapshotInvalid('candidate composite identities must be unique within a Snapshot.');
  const normalized = Object.freeze({
    smppSourceId: sourceId,
    revision: input.revision,
    checksum: input.checksum,
    etag,
    generatedAt: input.generatedAt,
    expiresAt: input.expiresAt,
    candidates: Object.freeze(candidates),
  });
  if (computeSmppSnapshotChecksum(normalized) !== input.checksum)
    throw new NodeControlDomainError(
      'SMPP_SNAPSHOT_CHECKSUM_MISMATCH',
      'SMPP Snapshot checksum does not match canonical candidate content.',
    );
  return normalized;
}

export function computeSmppSnapshotChecksum(
  input: Omit<SmppRegistrySnapshot, 'checksum' | 'etag'>,
): string {
  const candidates = [...input.candidates]
    .map((candidate) => normalizeCandidate(input.smppSourceId, candidate))
    .sort((left, right) => left.compositeIdentity.localeCompare(right.compositeIdentity));
  return hashConfigurationRequest(
    Object.freeze({
      smppSourceId: input.smppSourceId,
      revision: input.revision,
      generatedAt: input.generatedAt,
      expiresAt: input.expiresAt,
      candidates: Object.freeze(
        candidates.map((candidate) =>
          Object.freeze({
            externalProviderId: candidate.externalProviderId,
            externalServerId: candidate.externalServerId,
            serverEndpoint: candidate.serverEndpoint,
            ...(candidate.displayName === undefined ? {} : { displayName: candidate.displayName }),
            ...(candidate.catalogRevision === undefined
              ? {}
              : { catalogRevision: candidate.catalogRevision }),
            labels: candidate.labels,
          }),
        ),
      ),
    }),
  );
}

export function smppCandidateIdentity(
  smppSourceId: string,
  externalProviderId: string,
  externalServerId: string,
): string {
  return `${required(smppSourceId, 'smppSourceId')}::${required(
    externalProviderId,
    'externalProviderId',
    256,
    snapshotInvalid,
  )}::${required(externalServerId, 'externalServerId', 256, snapshotInvalid)}`;
}

export function effectiveSmppSnapshotValidUntil(
  source: SmppRegistrySource,
  snapshot: SmppRegistrySnapshot,
  receivedAt: string,
): string {
  timestamp(receivedAt, 'receivedAt', snapshotInvalid);
  const localExpiry = Date.parse(receivedAt) + source.snapshotTtlSeconds * 1_000;
  return new Date(Math.min(localExpiry, Date.parse(snapshot.expiresAt))).toISOString();
}

export function effectiveSmppRevalidatedValidUntil(
  source: SmppRegistrySource,
  externalExpiresAt: string,
  receivedAt: string,
): string {
  timestamp(externalExpiresAt, 'externalExpiresAt', snapshotInvalid);
  timestamp(receivedAt, 'receivedAt', snapshotInvalid);
  const localExpiry = Date.parse(receivedAt) + source.snapshotTtlSeconds * 1_000;
  return new Date(Math.min(localExpiry, Date.parse(externalExpiresAt))).toISOString();
}

export function smppSourceEtag(source: SmppRegistrySource): string {
  return `"smpp-source:${hashConfigurationRequest(
    Object.freeze({
      smppSourceId: source.smppSourceId,
      revision: source.revision,
      status: source.status,
      activeSnapshotChecksum: source.activeSnapshotChecksum ?? null,
      activeSnapshotValidUntil: source.activeSnapshotValidUntil ?? null,
      lastSyncAt: source.lastSyncAt ?? null,
      lastErrorCode: source.lastErrorCode ?? null,
    }),
  )}"`;
}

function normalizeCandidate(sourceId: string, input: SmppProviderCandidate): SmppProviderCandidate {
  if (input.smppSourceId !== sourceId)
    snapshotInvalid('candidate smppSourceId must match its Snapshot source.');
  const externalProviderId = required(
    input.externalProviderId,
    'externalProviderId',
    256,
    snapshotInvalid,
  );
  const externalServerId = required(
    input.externalServerId,
    'externalServerId',
    256,
    snapshotInvalid,
  );
  const identity = smppCandidateIdentity(sourceId, externalProviderId, externalServerId);
  if (input.compositeIdentity !== identity)
    snapshotInvalid('candidate compositeIdentity is not the stable SMPP composite identity.');
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.labels)) {
    labels[required(key, 'label key', 128, snapshotInvalid)] = required(
      value,
      'label value',
      512,
      snapshotInvalid,
    );
  }
  return Object.freeze({
    smppSourceId: sourceId,
    externalProviderId,
    externalServerId,
    compositeIdentity: identity,
    serverEndpoint: safeHttpUrl(input.serverEndpoint, 'serverEndpoint', snapshotInvalid),
    ...(input.displayName === undefined
      ? {}
      : { displayName: required(input.displayName, 'displayName', 256, snapshotInvalid) }),
    ...(input.catalogRevision === undefined
      ? {}
      : {
          catalogRevision: required(input.catalogRevision, 'catalogRevision', 256, snapshotInvalid),
        }),
    labels: Object.freeze(labels),
  });
}

function safeHttpUrl(value: string, field: string, fail: (message: string) => never): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail(`${field} must be an absolute URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    fail(`${field} must be HTTP(S) and cannot contain credentials.`);
  parsed.hash = '';
  return parsed.toString().replace(/\/$/u, '');
}

function secretReference(value: string): string {
  const normalized = required(value, 'credentialRef');
  if (
    normalized !== SMPP_UNAUTHENTICATED_CREDENTIAL_REF &&
    !/^secret:\/\/[A-Za-z0-9._~:/-]+$/u.test(normalized)
  )
    sourceInvalid(
      `credentialRef must be an opaque SecretRef or ${SMPP_UNAUTHENTICATED_CREDENTIAL_REF}.`,
    );
  return normalized;
}

function checksum(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) snapshotInvalid('checksum must be lowercase SHA-256.');
}

function required(
  value: string,
  field: string,
  maximum = 256,
  fail: (message: string) => never = sourceInvalid,
): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > maximum)
    fail(`${field} must contain between 1 and ${String(maximum)} characters.`);
  return normalized;
}

function optional(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  return required(value, field);
}

function positiveInteger(
  value: number,
  field: string,
  maximum: number,
  fail: (message: string) => never,
): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    fail(`${field} must be a positive safe integer no greater than ${String(maximum)}.`);
}

function timestamp(value: string, field: string, fail: (message: string) => never): void {
  if (!Number.isFinite(Date.parse(value))) fail(`${field} must be an ISO 8601 timestamp.`);
}

function sourceInvalid(message: string): never {
  throw new NodeControlDomainError('SMPP_SOURCE_INVALID', message);
}

function snapshotInvalid(message: string): never {
  throw new NodeControlDomainError('SMPP_SNAPSHOT_INVALID', message);
}
