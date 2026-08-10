import type {
  EvidenceEvaluationRole,
  EvidenceIssueCode,
  EvidenceIssueSeverity,
  EvidenceJsonValue,
  EvidenceManifestStatus,
  EvidenceRecordFamily,
  EvidenceSourceSystem,
} from '../../domain/src/index.js';
import { hashCanonicalEvidenceJson } from '../../domain/src/index.js';

export interface EvidenceOperationsPageQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly episodeId?: string;
  readonly sourcePartition?: string;
  readonly openOnly?: boolean;
}

export interface EvidenceMetadataPage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface EvidenceConfigurationMetadata {
  readonly exportId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly appliedAt: string;
  readonly isActive: boolean;
  readonly isLastKnownGood: boolean;
  readonly includedFamilies: readonly EvidenceRecordFamily[];
  readonly excludedDiagnosticTypes: readonly string[];
  readonly maxPendingRecords: number;
  readonly retentionDays: number;
}

export interface EvidencePartitionStatusMetadata {
  readonly exportId: string;
  readonly sourcePartition: string;
  readonly status: 'idle' | 'exporting' | 'degraded' | 'high_watermark' | 'disabled';
  readonly lastSentSequence?: string;
  readonly lastAcknowledgedSequence?: string;
  readonly lastAcknowledgedAt?: string;
  readonly leaseExpiresAt?: string;
  readonly fencingToken: string;
  readonly lastErrorCode?: string;
  readonly lastErrorAt?: string;
  readonly observedAt: string;
}

export interface EvidenceOperationsStatusMetadata {
  readonly exportId?: string;
  readonly activeRevision?: number;
  readonly pendingRecords: number;
  readonly deadLetterRecords: number;
  readonly openProjectionIssues: number;
  readonly openQualityIssues: number;
  readonly globalAcknowledgedFrontier?: string;
  readonly highWatermarkActive: boolean;
  readonly partitions: readonly EvidencePartitionStatusMetadata[];
  readonly observedAt: string;
}

export interface EvidenceOutboxRecordMetadata {
  readonly sequence: string;
  readonly recordId: string;
  readonly recordFamily: EvidenceRecordFamily;
  readonly recordType: string;
  readonly schemaName: string;
  readonly schemaVersion: number;
  readonly sourceSystem: EvidenceSourceSystem;
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly sourceRevision: string;
  readonly sourcePartition: string;
  readonly evaluationRole: EvidenceEvaluationRole;
  readonly taskId?: string;
  readonly episodeId?: string;
  readonly payloadHash: string;
  readonly capturedAt: string;
  readonly deliveryAttempts: number;
  readonly nextAttemptAt: string;
  readonly sentAt?: string;
  readonly acknowledgedAt?: string;
  readonly lastErrorCode?: string;
}

export interface EvidenceProjectionCheckpointMetadata {
  readonly sourceFamily: string;
  readonly sourcePartition: string;
  readonly lastOccurredAt?: string;
  readonly lastSourceRecordId?: string;
  readonly lastSourceRevision?: string;
  readonly lastPayloadHash?: string;
  readonly lastProjectedAt?: string;
  readonly projectorVersion: string;
}

export interface EvidenceProjectionIssueMetadata {
  readonly issueId: string;
  readonly ruleId?: string;
  readonly issueCode: EvidenceIssueCode;
  readonly severity: EvidenceIssueSeverity;
  readonly evaluationRole: EvidenceEvaluationRole;
  readonly recordType?: string;
  readonly recordId?: string;
  readonly episodeId?: string;
  readonly sourceSystem: EvidenceSourceSystem;
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly sourcePartition: string;
  readonly projectorVersion: string;
  readonly retryable: boolean;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly resolvedAt?: string;
  readonly revision: number;
}

export interface EvidenceQualityIssueMetadata {
  readonly issueId: string;
  readonly ruleId?: string;
  readonly issueCode: EvidenceIssueCode;
  readonly severity: EvidenceIssueSeverity;
  readonly recordType?: string;
  readonly recordId?: string;
  readonly episodeId?: string;
  readonly sourceSystem: EvidenceSourceSystem;
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly resolvedAt?: string;
  readonly revision: number;
}

export interface EvidenceManifestMetadata {
  readonly manifestId: string;
  readonly revision: number;
  readonly policyVersion: string;
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
  readonly sourceCoverage: Readonly<Record<string, EvidenceJsonValue>>;
  readonly lastEvidenceSequence: string;
  readonly status: EvidenceManifestStatus;
  readonly qualityIssueIds: readonly string[];
  readonly sourceSnapshotHash: string;
  readonly createdAt: string;
  readonly recomputedAt: string;
  readonly sealedAt?: string;
}

export interface EvidenceDeadLetterMetadata {
  readonly deadLetterId: string;
  readonly sequence: string;
  readonly recordId: string;
  readonly issueCode: EvidenceIssueCode;
  readonly attempts: number;
  readonly failedAt: string;
  readonly requeuedAt?: string;
  readonly requeueCount: number;
  readonly requeuedBy?: string;
  readonly requeueReason?: string;
}

export type EvidenceRecoveryOperation =
  | 'replay_record'
  | 'replay_source_partition'
  | 'replay_episode'
  | 'retry_dead_letter'
  | 'reconcile_coverage'
  | 'apply_retention';

interface EvidenceRecoveryCommandBase {
  readonly operationId: string;
  readonly idempotencyKeyHash: `sha256:${string}`;
  readonly requestHash: `sha256:${string}`;
  readonly exportId: string;
  readonly configurationRevision: number;
  readonly actorId: string;
  readonly reason: string;
  readonly requestedAt: string;
}

export type EvidenceRecoveryCommand =
  | (EvidenceRecoveryCommandBase & Readonly<{ operation: 'replay_record'; recordId: string }>)
  | (EvidenceRecoveryCommandBase &
      Readonly<{
        operation: 'replay_source_partition';
        sourceFamily: string;
        sourcePartition: string;
      }>)
  | (EvidenceRecoveryCommandBase & Readonly<{ operation: 'replay_episode'; episodeId: string }>)
  | (EvidenceRecoveryCommandBase &
      Readonly<{ operation: 'retry_dead_letter'; deadLetterId: string }>)
  | (EvidenceRecoveryCommandBase &
      Readonly<{ operation: 'reconcile_coverage'; episodeId?: string }>)
  | (EvidenceRecoveryCommandBase & Readonly<{ operation: 'apply_retention' }>);

export interface EvidenceCoverageRecoveryTarget {
  readonly recoveryRunId: string;
  readonly episodeId: string;
  readonly taskId: string;
  readonly terminalOutcomeId: string;
  readonly sealRequested: boolean;
  readonly claimToken: string;
}

export interface EvidenceRecoveryRunMetadata {
  readonly recoveryRunId: string;
  readonly operationId: string;
  readonly idempotencyKeyHash: `sha256:${string}`;
  readonly requestHash: `sha256:${string}`;
  readonly operation: EvidenceRecoveryOperation;
  readonly target: Readonly<Record<string, string>>;
  readonly actorId: string;
  readonly reason: string;
  readonly status: 'requested' | 'running' | 'succeeded' | 'failed';
  readonly affectedRecords: number;
  readonly resultSummary?: Readonly<Record<string, string | number>>;
  readonly errorCode?: string;
  readonly requestedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly revision: number;
}

export interface EvidenceOperationsRepository {
  getConfiguration(): Promise<EvidenceConfigurationMetadata | undefined>;
  getStatus(): Promise<EvidenceOperationsStatusMetadata>;
  listOutbox(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceOutboxRecordMetadata>>;
  listCheckpoints(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceProjectionCheckpointMetadata>>;
  listProjectionIssues(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceProjectionIssueMetadata>>;
  listQualityIssues(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceQualityIssueMetadata>>;
  getManifest(episodeId: string): Promise<EvidenceManifestMetadata | undefined>;
  listDeadLetters(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceDeadLetterMetadata>>;
  /** Persist only the idempotent requested run. No recovery side effect occurs in this call. */
  startRecoveryRun(command: EvidenceRecoveryCommand): Promise<EvidenceRecoveryRunMetadata>;
  /** Claim in one transaction, then execute and terminally persist in a later transaction. */
  resumeRecoveryRun(recoveryRunId: string): Promise<EvidenceRecoveryRunMetadata>;
  getRecoveryRun(recoveryRunId: string): Promise<EvidenceRecoveryRunMetadata | undefined>;
  listRecoverableRuns(limit: number): Promise<readonly EvidenceRecoveryRunMetadata[]>;
  claimCoverageRecoveryTarget(
    recoveryRunId: string,
    claimedAt: string,
  ): Promise<EvidenceCoverageRecoveryTarget | undefined>;
  completeCoverageRecoveryTarget(
    target: EvidenceCoverageRecoveryTarget,
    completedAt: string,
  ): Promise<EvidenceRecoveryRunMetadata>;
  failRecoveryRun(
    recoveryRunId: string,
    errorCode: string,
    completedAt: string,
  ): Promise<EvidenceRecoveryRunMetadata>;
}

interface EvidenceRecoveryRequestBase {
  readonly operationId: string;
  readonly idempotencyKeyHash: `sha256:${string}`;
  readonly actorId: string;
  readonly reason: string;
  readonly requestedAt: string;
}

export type EvidenceRecoveryRequest =
  | (EvidenceRecoveryRequestBase & Readonly<{ operation: 'replay_record'; recordId: string }>)
  | (EvidenceRecoveryRequestBase &
      Readonly<{
        operation: 'replay_source_partition';
        sourceFamily: string;
        sourcePartition: string;
      }>)
  | (EvidenceRecoveryRequestBase & Readonly<{ operation: 'replay_episode'; episodeId: string }>)
  | (EvidenceRecoveryRequestBase &
      Readonly<{ operation: 'retry_dead_letter'; deadLetterId: string }>)
  | (EvidenceRecoveryRequestBase &
      Readonly<{ operation: 'reconcile_coverage'; episodeId?: string }>);

export interface EvidenceRetentionRequest {
  readonly operationId: string;
  readonly idempotencyKeyHash: `sha256:${string}`;
  readonly actorId: string;
  readonly reason: string;
  readonly requestedAt: string;
}

export interface EvidenceCoverageRecoveryHandler {
  reconcileEpisode(target: EvidenceCoverageRecoveryTarget): Promise<void>;
}

export class EvidenceOperationsServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'EvidenceOperationsServiceError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Bounded metadata and recovery application boundary. It never accepts SQL, mapper names,
 * Evidence payloads, credentials, or arbitrary repository predicates.
 */
export class EvidenceOperationsService {
  readonly #repository: EvidenceOperationsRepository;
  readonly #coverageRecovery?: EvidenceCoverageRecoveryHandler;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    input:
      | EvidenceOperationsRepository
      | Readonly<{
          repository: EvidenceOperationsRepository;
          coverageRecovery?: EvidenceCoverageRecoveryHandler;
          clock?: Readonly<{ now(): string }>;
        }>,
  ) {
    if ('repository' in input) {
      this.#repository = input.repository;
      if (input.coverageRecovery !== undefined) this.#coverageRecovery = input.coverageRecovery;
      this.#clock = input.clock ?? { now: () => new Date().toISOString() };
    } else {
      this.#repository = input;
      this.#clock = { now: () => new Date().toISOString() };
    }
  }

  configuration(): Promise<EvidenceConfigurationMetadata | undefined> {
    return this.#repository.getConfiguration();
  }

  status(): Promise<EvidenceOperationsStatusMetadata> {
    return this.#repository.getStatus();
  }

  outbox(query: EvidenceOperationsPageQuery) {
    return this.#repository.listOutbox(normalizeQuery(query));
  }

  checkpoints(query: EvidenceOperationsPageQuery) {
    return this.#repository.listCheckpoints(normalizeQuery(query));
  }

  projectionIssues(query: EvidenceOperationsPageQuery) {
    return this.#repository.listProjectionIssues(normalizeQuery(query));
  }

  qualityIssues(query: EvidenceOperationsPageQuery) {
    return this.#repository.listQualityIssues(normalizeQuery(query));
  }

  manifest(episodeId: string): Promise<EvidenceManifestMetadata | undefined> {
    return this.#repository.getManifest(boundedText(episodeId, 'episodeId'));
  }

  deadLetters(query: EvidenceOperationsPageQuery) {
    return this.#repository.listDeadLetters(normalizeQuery(query));
  }

  async recover(request: EvidenceRecoveryRequest): Promise<EvidenceRecoveryRunMetadata> {
    const active = await this.#repository.getConfiguration();
    if (!active?.isActive) {
      throw new EvidenceOperationsServiceError(
        'EVIDENCE_EXPORT_ACTIVE_CONFIGURATION_REQUIRED',
        'Evidence recovery requires an active export configuration.',
        409,
      );
    }
    const normalized = normalizeRecoveryRequest(request);
    const target = recoveryTarget(normalized);
    const requestHash = hashCanonicalEvidenceJson({
      operation: normalized.operation,
      target,
      actorId: normalized.actorId,
      reason: normalized.reason,
      exportId: active.exportId,
      configurationRevision: active.revision,
    });
    const staged = await this.#repository.startRecoveryRun({
      ...normalized,
      exportId: active.exportId,
      configurationRevision: active.revision,
      requestHash,
    });
    return this.#driveRecovery(staged);
  }

  /**
   * Executes one bounded PostgreSQL retention batch. A full batch deliberately leaves the
   * same durable run running; resumeRecoveryRuns() drains its next batch on a later tick.
   */
  async applyRetention(request: EvidenceRetentionRequest): Promise<EvidenceRecoveryRunMetadata> {
    const active = await this.#repository.getConfiguration();
    if (!active?.isActive) {
      throw new EvidenceOperationsServiceError(
        'EVIDENCE_EXPORT_ACTIVE_CONFIGURATION_REQUIRED',
        'Evidence retention requires an active export configuration.',
        409,
      );
    }
    const normalized = normalizeMaintenanceRequest(request);
    const requestHash = hashCanonicalEvidenceJson({
      operation: 'apply_retention',
      target: {},
      actorId: normalized.actorId,
      reason: normalized.reason,
      exportId: active.exportId,
      configurationRevision: active.revision,
    });
    const staged = await this.#repository.startRecoveryRun({
      ...normalized,
      operation: 'apply_retention',
      exportId: active.exportId,
      configurationRevision: active.revision,
      requestHash,
    });
    return this.#driveRecovery(staged);
  }

  /** Re-drives committed requested/running runs after restart; Redis is not consulted. */
  async resumeRecoveryRuns(limit = 20): Promise<readonly EvidenceRecoveryRunMetadata[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new EvidenceOperationsServiceError(
        'EVIDENCE_RECOVERY_RESUME_LIMIT_INVALID',
        'Evidence recovery resume limit must be between 1 and 100.',
        400,
      );
    }
    const pending = await this.#repository.listRecoverableRuns(limit);
    const completed: EvidenceRecoveryRunMetadata[] = [];
    for (const run of pending) completed.push(await this.#driveRecovery(run));
    return Object.freeze(completed);
  }

  async #driveRecovery(staged: EvidenceRecoveryRunMetadata): Promise<EvidenceRecoveryRunMetadata> {
    if (staged.status === 'succeeded' || staged.status === 'failed') return staged;
    let run = await this.#repository.resumeRecoveryRun(staged.recoveryRunId);
    if (run.operation === 'apply_retention' && run.status === 'running') {
      return run;
    }
    if (run.operation !== 'reconcile_coverage' || run.status !== 'running') return run;
    if (this.#coverageRecovery === undefined) {
      return this.#repository.failRecoveryRun(
        run.recoveryRunId,
        'EVIDENCE_COVERAGE_RECOVERY_NOT_CONFIGURED',
        this.#clock.now(),
      );
    }
    for (;;) {
      const target = await this.#repository.claimCoverageRecoveryTarget(
        run.recoveryRunId,
        this.#clock.now(),
      );
      if (target === undefined) {
        return (await this.#repository.getRecoveryRun(run.recoveryRunId)) ?? run;
      }
      try {
        await this.#coverageRecovery.reconcileEpisode(target);
      } catch {
        return this.#repository.failRecoveryRun(
          run.recoveryRunId,
          'EVIDENCE_COVERAGE_RECOVERY_FAILED',
          this.#clock.now(),
        );
      }
      run = await this.#repository.completeCoverageRecoveryTarget(target, this.#clock.now());
      if (run.status === 'succeeded' || run.status === 'failed') return run;
    }
  }
}

function normalizeQuery(query: EvidenceOperationsPageQuery): EvidenceOperationsPageQuery {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200) {
    throw new EvidenceOperationsServiceError(
      'EVIDENCE_OPERATIONS_LIMIT_INVALID',
      'Evidence operations query limit must be between 1 and 200.',
      400,
    );
  }
  return Object.freeze({
    limit: query.limit,
    ...(query.cursor === undefined ? {} : { cursor: boundedText(query.cursor, 'cursor', 2_048) }),
    ...(query.episodeId === undefined
      ? {}
      : { episodeId: boundedText(query.episodeId, 'episodeId') }),
    ...(query.sourcePartition === undefined
      ? {}
      : { sourcePartition: boundedText(query.sourcePartition, 'sourcePartition', 2_048) }),
    ...(query.openOnly === undefined ? {} : { openOnly: query.openOnly }),
  });
}

function normalizeRecoveryRequest(request: EvidenceRecoveryRequest): EvidenceRecoveryRequest {
  const common = Object.freeze({
    operationId: boundedText(request.operationId, 'operationId'),
    idempotencyKeyHash: sha256(request.idempotencyKeyHash, 'idempotencyKeyHash'),
    actorId: boundedText(request.actorId, 'actorId'),
    reason: boundedText(request.reason, 'reason', 2_048),
    requestedAt: timestamp(request.requestedAt, 'requestedAt'),
  });
  switch (request.operation) {
    case 'replay_record':
      return Object.freeze({
        ...common,
        operation: request.operation,
        recordId: boundedText(request.recordId, 'recordId'),
      });
    case 'replay_source_partition':
      return Object.freeze({
        ...common,
        operation: request.operation,
        sourceFamily: boundedText(request.sourceFamily, 'sourceFamily'),
        sourcePartition: boundedText(request.sourcePartition, 'sourcePartition', 2_048),
      });
    case 'replay_episode':
      return Object.freeze({
        ...common,
        operation: request.operation,
        episodeId: boundedText(request.episodeId, 'episodeId'),
      });
    case 'retry_dead_letter':
      return Object.freeze({
        ...common,
        operation: request.operation,
        deadLetterId: boundedText(request.deadLetterId, 'deadLetterId'),
      });
    case 'reconcile_coverage':
      return Object.freeze({
        ...common,
        operation: request.operation,
        ...(request.episodeId === undefined
          ? {}
          : { episodeId: boundedText(request.episodeId, 'episodeId') }),
      });
  }
}

function normalizeMaintenanceRequest(request: EvidenceRetentionRequest): EvidenceRetentionRequest {
  return Object.freeze({
    operationId: boundedText(request.operationId, 'operationId'),
    idempotencyKeyHash: sha256(request.idempotencyKeyHash, 'idempotencyKeyHash'),
    actorId: boundedText(request.actorId, 'actorId'),
    reason: boundedText(request.reason, 'reason', 2_048),
    requestedAt: timestamp(request.requestedAt, 'requestedAt'),
  });
}

function recoveryTarget(request: EvidenceRecoveryRequest): Readonly<Record<string, string>> {
  switch (request.operation) {
    case 'replay_record':
      return Object.freeze({ recordId: request.recordId });
    case 'replay_source_partition':
      return Object.freeze({
        sourceFamily: request.sourceFamily,
        sourcePartition: request.sourcePartition,
      });
    case 'replay_episode':
      return Object.freeze({ episodeId: request.episodeId });
    case 'retry_dead_letter':
      return Object.freeze({ deadLetterId: request.deadLetterId });
    case 'reconcile_coverage':
      return request.episodeId === undefined
        ? Object.freeze({})
        : Object.freeze({ episodeId: request.episodeId });
  }
}

function boundedText(value: string, field: string, maximum = 512): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new EvidenceOperationsServiceError(
      `EVIDENCE_OPERATIONS_${field.toUpperCase()}_INVALID`,
      `Evidence operations ${field} is invalid.`,
      400,
    );
  }
  return normalized;
}

function sha256(value: string, field: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new EvidenceOperationsServiceError(
      `EVIDENCE_OPERATIONS_${field.toUpperCase()}_INVALID`,
      `Evidence operations ${field} is invalid.`,
      400,
    );
  }
  return value as `sha256:${string}`;
}

function timestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new EvidenceOperationsServiceError(
      `EVIDENCE_OPERATIONS_${field.toUpperCase()}_INVALID`,
      `Evidence operations ${field} is invalid.`,
      400,
    );
  }
  return new Date(value).toISOString();
}
