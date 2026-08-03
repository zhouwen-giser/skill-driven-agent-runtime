import type {
  CanonicalEvidenceEnvelope,
  EvidenceJsonValue,
  EvidenceRecordFamily,
} from './canonical-evidence.js';

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
