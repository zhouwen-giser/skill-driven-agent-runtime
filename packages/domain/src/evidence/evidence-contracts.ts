import type {
  CanonicalEvidenceEnvelope,
  EvidenceJsonValue,
  EvidenceRecordFamily,
} from './canonical-evidence.js';
import { EVIDENCE_RECORD_CATALOG } from './catalog.js';

export type EvidenceExportConfigurationStatus = 'draft' | 'active' | 'suspended' | 'retired';
export type EvidenceExportApplyMode = 'hot_reload' | 'reconnect_required' | 'restart_required';

export interface EvidenceBatchRequest {
  readonly contractVersion: 'sdar.evidence/v1';
  readonly exportId: string;
  readonly sourceId: string;
  readonly nodeId: string;
  readonly revision: number;
  readonly firstSequence: string;
  readonly lastSequence: string;
  readonly batchHash: `sha256:${string}`;
  readonly records: readonly CanonicalEvidenceEnvelope[];
}

export interface EvidenceBatchAcknowledgement {
  readonly lastAcknowledgedSequence: string;
}

export interface EvidenceExportConfiguration {
  readonly exportId: string;
  readonly revision: number;
  readonly endpointRef: string;
  readonly sourceId: string;
  readonly nodeId?: string;
  readonly credentialRef: string;
  readonly includedFamilies: readonly EvidenceRecordFamily[];
  readonly excludedDiagnosticTypes?: readonly string[];
  readonly batchPolicy: Readonly<{
    maxRecords: number;
    maxBytes: number;
    flushIntervalMs: number;
  }>;
  readonly retryPolicy: Readonly<{
    baseDelayMs: number;
    maxDelayMs: number;
    maxAttempts?: number;
  }>;
  readonly outboxPolicy: Readonly<{
    maxPendingRecords: number;
    retentionDays: number;
  }>;
  readonly redactionProfile: string;
  readonly artifactMode: 'inline' | 'reference';
}

export interface ManagedEvidenceExportConfiguration extends EvidenceExportConfiguration {
  readonly status: EvidenceExportConfigurationStatus;
  readonly applyMode?: EvidenceExportApplyMode;
}

export interface EvidenceExportStatus {
  readonly exportId: string;
  readonly status: 'healthy' | 'degraded' | 'blocked' | 'disabled' | 'unavailable';
  readonly activeRevision?: number;
  readonly lastAcknowledgedSequence?: string;
  readonly pendingRecords: number;
  readonly oldestPendingAt?: string;
  readonly lastAcknowledgedAt?: string;
  readonly lastErrorCode?: string;
  readonly lastErrorAt?: string;
  readonly observedAt: string;
}

const diagnosticRecordTypes = new Set(
  EVIDENCE_RECORD_CATALOG.filter((entry) => entry.evaluationRole === 'diagnostic').map(
    (entry) => entry.recordType,
  ),
);
const requiredFamilies = new Set(
  EVIDENCE_RECORD_CATALOG.filter((entry) => entry.evaluationRole === 'required').map(
    (entry) => entry.recordFamily,
  ),
);

export function normalizeEvidenceExportConfiguration(
  input: ManagedEvidenceExportConfiguration,
): ManagedEvidenceExportConfiguration {
  const endpoint = absoluteEndpoint(requiredText(input.endpointRef, 'endpointRef'));
  if (!['http:', 'https:'].includes(endpoint.protocol))
    invalidConfiguration('endpointRef must use HTTP or HTTPS.');
  if (endpoint.username !== '' || endpoint.password !== '')
    invalidConfiguration('endpointRef must not contain credentials.');
  const includedFamilies = Object.freeze(
    [...new Set(input.includedFamilies.map(assertRecordFamily))].sort(),
  );
  const missingRequired = [...requiredFamilies].filter(
    (family) => !includedFamilies.includes(family),
  );
  if (missingRequired.length > 0) {
    invalidConfiguration(
      `includedFamilies cannot exclude required Evidence families: ${missingRequired.join(', ')}.`,
    );
  }
  const excludedDiagnosticTypes = Object.freeze(
    [...new Set(input.excludedDiagnosticTypes ?? [])]
      .map((value) => requiredText(value, 'excludedDiagnosticTypes'))
      .sort(),
  );
  const invalidExcluded = excludedDiagnosticTypes.find((type) => !diagnosticRecordTypes.has(type));
  if (invalidExcluded !== undefined) {
    invalidConfiguration(
      `excludedDiagnosticTypes may contain only catalog Diagnostic record types: ${invalidExcluded}.`,
    );
  }
  positiveInteger(input.revision, 'revision', 1, Number.MAX_SAFE_INTEGER);
  positiveInteger(input.batchPolicy.maxRecords, 'batchPolicy.maxRecords', 1, 1_000);
  positiveInteger(input.batchPolicy.maxBytes, 'batchPolicy.maxBytes', 1_024, 262_144);
  positiveInteger(input.batchPolicy.flushIntervalMs, 'batchPolicy.flushIntervalMs', 10, 3_600_000);
  positiveInteger(input.retryPolicy.baseDelayMs, 'retryPolicy.baseDelayMs', 10, 300_000);
  positiveInteger(input.retryPolicy.maxDelayMs, 'retryPolicy.maxDelayMs', 10, 86_400_000);
  if (input.retryPolicy.baseDelayMs > input.retryPolicy.maxDelayMs)
    invalidConfiguration('retryPolicy.baseDelayMs must not exceed maxDelayMs.');
  if (input.retryPolicy.maxAttempts !== undefined)
    positiveInteger(input.retryPolicy.maxAttempts, 'retryPolicy.maxAttempts', 1, 1_000);
  positiveInteger(
    input.outboxPolicy.maxPendingRecords,
    'outboxPolicy.maxPendingRecords',
    1,
    1_000_000,
  );
  positiveInteger(input.outboxPolicy.retentionDays, 'outboxPolicy.retentionDays', 1, 3_650);
  if (!['inline', 'reference'].includes(input.artifactMode))
    invalidConfiguration('artifactMode is invalid.');
  if (!['draft', 'active', 'suspended', 'retired'].includes(input.status))
    invalidConfiguration('status is invalid.');
  if (
    input.applyMode !== undefined &&
    !['hot_reload', 'reconnect_required', 'restart_required'].includes(input.applyMode)
  )
    invalidConfiguration('applyMode is invalid.');
  return Object.freeze({
    exportId: requiredText(input.exportId, 'exportId'),
    revision: input.revision,
    endpointRef: endpoint.toString(),
    sourceId: requiredText(input.sourceId, 'sourceId'),
    ...(input.nodeId === undefined ? {} : { nodeId: requiredText(input.nodeId, 'nodeId') }),
    credentialRef: credentialReference(input.credentialRef),
    includedFamilies,
    ...(excludedDiagnosticTypes.length === 0 ? {} : { excludedDiagnosticTypes }),
    batchPolicy: Object.freeze({ ...input.batchPolicy }),
    retryPolicy: Object.freeze({ ...input.retryPolicy }),
    outboxPolicy: Object.freeze({ ...input.outboxPolicy }),
    redactionProfile: requiredText(input.redactionProfile, 'redactionProfile'),
    artifactMode: input.artifactMode,
    status: input.status,
    ...(input.applyMode === undefined ? {} : { applyMode: input.applyMode }),
  });
}

export function activeEvidenceExportConfiguration(
  input: ManagedEvidenceExportConfiguration,
): ManagedEvidenceExportConfiguration {
  return Object.freeze({ ...normalizeEvidenceExportConfiguration(input), status: 'active' });
}

function assertRecordFamily(value: EvidenceRecordFamily): EvidenceRecordFamily {
  const allowed: readonly string[] = [
    'runtime',
    'skill',
    'mcp_task',
    'capability',
    'experience',
    'replay',
    'artifact',
    'node_control',
    'evidence',
  ];
  if (!allowed.includes(value)) invalidConfiguration(`Unknown Evidence record family: ${value}.`);
  return value;
}

function credentialReference(value: string): string {
  const normalized = requiredText(value, 'credentialRef');
  if (!/^(?:env|secret):[A-Za-z0-9_.:/-]{1,256}$/u.test(normalized))
    invalidConfiguration('credentialRef must be an opaque env: or secret: reference.');
  return normalized;
}

function requiredText(value: string, field: string): string {
  if (typeof value !== 'string') invalidConfiguration(`${field} must be a string.`);
  const normalized = value.trim();
  if (normalized === '' || normalized.length > 2_048) invalidConfiguration(`${field} is invalid.`);
  return normalized;
}

function positiveInteger(value: number, field: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    invalidConfiguration(`${field} is outside its supported range.`);
}

function absoluteEndpoint(value: string): URL {
  try {
    return new URL(value);
  } catch {
    return invalidConfiguration('endpointRef must be an absolute HTTP or HTTPS URL.');
  }
}

function invalidConfiguration(message: string): never {
  throw Object.assign(new Error(message), { code: 'EVIDENCE_EXPORT_INVALID', status: 422 });
}

export type EvidenceManifestStatus = 'projecting' | 'complete' | 'degraded' | 'incomplete';

export interface EvidenceSourceCoverage {
  readonly expected: number;
  readonly projected: number;
  readonly pending: number;
  readonly failed: number;
  readonly lastSourceRevision?: string;
}

export interface EpisodeEvidenceManifest {
  readonly manifestId: string;
  readonly episodeId: string;
  readonly taskId: string;
  readonly terminalOutcomeId: string;
  readonly expectedRequiredRecords: number;
  readonly projectedRequiredRecords: number;
  readonly pendingRequiredRecords: number;
  readonly failedRequiredRecords: number;
  readonly expectedFamilies: readonly EvidenceRecordFamily[];
  readonly completedFamilies: readonly EvidenceRecordFamily[];
  readonly missingFamilies: readonly EvidenceRecordFamily[];
  readonly sourceCoverage: Readonly<Record<string, EvidenceSourceCoverage>>;
  readonly lastEvidenceSequence: string;
  readonly status: EvidenceManifestStatus;
  readonly qualityIssueIds: readonly string[];
  readonly createdAt: string;
  readonly sealedAt?: string;
}

export const EVIDENCE_ISSUE_CODES = [
  'schema_invalid',
  'source_identity_missing',
  'source_revision_missing',
  'payload_hash_conflict',
  'reference_unresolved',
  'redaction_rejected',
  'artifact_write_failed',
  'export_rejected',
  'ack_invalid',
  'source_unavailable',
  'projection_bug',
] as const;

export type EvidenceIssueCode = (typeof EVIDENCE_ISSUE_CODES)[number];
export type EvidenceIssueSeverity = 'diagnostic' | 'degraded' | 'blocking';

export interface EvidenceQualityIssue {
  readonly issueId: string;
  readonly issueCode: EvidenceIssueCode;
  readonly severity: EvidenceIssueSeverity;
  readonly recordType?: string;
  readonly recordId?: string;
  readonly episodeId?: string;
  readonly sourceSystem: 'runtime' | 'node_control';
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly detail: Readonly<Record<string, EvidenceJsonValue>>;
  readonly createdAt: string;
}

export interface EvidenceProjectionIssue extends EvidenceQualityIssue {
  readonly projectorVersion: string;
  readonly sourcePartition: string;
  readonly retryable: boolean;
}

export interface EvidenceSourceCheckpoint {
  readonly sourceFamily: string;
  readonly sourcePartition: string;
  readonly lastOccurredAt?: string;
  readonly lastSourceRecordId?: string;
  readonly lastSourceRevision?: string;
  readonly lastPayloadHash?: `sha256:${string}`;
  readonly lastProjectedAt?: string;
  readonly projectorVersion: string;
}
