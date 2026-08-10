import { z } from 'zod';

import type { NodeControlRuntimeEvidenceOperationsClient } from '../../node-control-application/src/index.js';
import type {
  EvidenceConfigurationMetadata,
  EvidenceDeadLetterMetadata,
  EvidenceManifestMetadata,
  EvidenceMetadataPage,
  EvidenceOperationsPageQuery,
  EvidenceOperationsStatusMetadata,
  EvidenceOutboxRecordMetadata,
  EvidenceProjectionCheckpointMetadata,
  EvidenceProjectionIssueMetadata,
  EvidenceQualityIssueMetadata,
  EvidenceRecoveryRequest,
  EvidenceRecoveryRunMetadata,
} from '../../runtime-control-application/src/index.js';

const RecordFamilySchema = z.enum([
  'runtime',
  'skill',
  'mcp_task',
  'capability',
  'experience',
  'replay',
  'artifact',
  'node_control',
  'evidence',
]);
const SourceSystemSchema = z.enum(['runtime', 'node_control']);
const EvaluationRoleSchema = z.enum(['required', 'supporting', 'diagnostic']);
const IssueCodeSchema = z.enum([
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
]);
const IssueSeveritySchema = z.enum(['diagnostic', 'degraded', 'blocking']);
const TimestampSchema = z.iso.datetime({ offset: true });
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const DecimalSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);

const ConfigurationSchema = z
  .object({
    exportId: z.string().min(1),
    revision: z.number().int().positive(),
    checksum: z.string().min(1),
    appliedAt: TimestampSchema,
    isActive: z.boolean(),
    isLastKnownGood: z.boolean(),
    includedFamilies: z.array(RecordFamilySchema),
    excludedDiagnosticTypes: z.array(z.string()),
    maxPendingRecords: z.number().int().positive(),
    retentionDays: z.number().int().positive(),
  })
  .strict();
const PartitionStatusSchema = z
  .object({
    exportId: z.string().min(1),
    sourcePartition: z.string().min(1),
    status: z.enum(['idle', 'exporting', 'degraded', 'high_watermark', 'disabled']),
    lastSentSequence: DecimalSchema.optional(),
    lastAcknowledgedSequence: DecimalSchema.optional(),
    lastAcknowledgedAt: TimestampSchema.optional(),
    leaseExpiresAt: TimestampSchema.optional(),
    fencingToken: DecimalSchema,
    lastErrorCode: z.string().min(1).optional(),
    lastErrorAt: TimestampSchema.optional(),
    observedAt: TimestampSchema,
  })
  .strict();
const StatusSchema = z
  .object({
    exportId: z.string().min(1).optional(),
    activeRevision: z.number().int().positive().optional(),
    pendingRecords: z.number().int().nonnegative(),
    deadLetterRecords: z.number().int().nonnegative(),
    openProjectionIssues: z.number().int().nonnegative(),
    openQualityIssues: z.number().int().nonnegative(),
    globalAcknowledgedFrontier: DecimalSchema.optional(),
    highWatermarkActive: z.boolean(),
    partitions: z.array(PartitionStatusSchema),
    observedAt: TimestampSchema,
  })
  .strict();
const OutboxRecordSchema = z
  .object({
    sequence: DecimalSchema,
    recordId: z.string().min(1),
    recordFamily: RecordFamilySchema,
    recordType: z.string().min(1),
    schemaName: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    sourceSystem: SourceSystemSchema,
    sourceTable: z.string().min(1),
    sourceRecordId: z.string().min(1),
    sourceRevision: z.string().min(1),
    sourcePartition: z.string().min(1),
    evaluationRole: EvaluationRoleSchema,
    taskId: z.string().min(1).optional(),
    episodeId: z.string().min(1).optional(),
    payloadHash: z.string().min(1),
    capturedAt: TimestampSchema,
    deliveryAttempts: z.number().int().nonnegative(),
    nextAttemptAt: TimestampSchema,
    sentAt: TimestampSchema.optional(),
    acknowledgedAt: TimestampSchema.optional(),
    lastErrorCode: z.string().min(1).optional(),
  })
  .strict();
const CheckpointSchema = z
  .object({
    sourceFamily: z.string().min(1),
    sourcePartition: z.string().min(1),
    lastOccurredAt: TimestampSchema.optional(),
    lastSourceRecordId: z.string().min(1).optional(),
    lastSourceRevision: z.string().min(1).optional(),
    lastPayloadHash: z.string().min(1).optional(),
    lastProjectedAt: TimestampSchema.optional(),
    projectorVersion: z.string().min(1),
  })
  .strict();
const ProjectionIssueSchema = z
  .object({
    issueId: z.string().min(1),
    ruleId: z.string().min(1).optional(),
    issueCode: IssueCodeSchema,
    severity: IssueSeveritySchema,
    evaluationRole: EvaluationRoleSchema,
    recordType: z.string().min(1).optional(),
    recordId: z.string().min(1).optional(),
    episodeId: z.string().min(1).optional(),
    sourceSystem: SourceSystemSchema,
    sourceTable: z.string().min(1),
    sourceRecordId: z.string().min(1),
    sourcePartition: z.string().min(1),
    projectorVersion: z.string().min(1),
    retryable: z.boolean(),
    firstObservedAt: TimestampSchema,
    lastObservedAt: TimestampSchema,
    resolvedAt: TimestampSchema.optional(),
    revision: z.number().int().positive(),
  })
  .strict();
const QualityIssueSchema = z
  .object({
    issueId: z.string().min(1),
    ruleId: z.string().min(1).optional(),
    issueCode: IssueCodeSchema,
    severity: IssueSeveritySchema,
    recordType: z.string().min(1).optional(),
    recordId: z.string().min(1).optional(),
    episodeId: z.string().min(1).optional(),
    sourceSystem: SourceSystemSchema,
    sourceTable: z.string().min(1),
    sourceRecordId: z.string().min(1),
    firstObservedAt: TimestampSchema,
    lastObservedAt: TimestampSchema,
    resolvedAt: TimestampSchema.optional(),
    revision: z.number().int().positive(),
  })
  .strict();
const ManifestSchema = z
  .object({
    manifestId: z.string().min(1),
    revision: z.number().int().positive(),
    policyVersion: z.string().min(1),
    episodeId: z.string().min(1),
    taskId: z.string().min(1),
    terminalOutcomeId: z.string().min(1),
    expectedRequiredRecords: z.number().int().nonnegative(),
    projectedRequiredRecords: z.number().int().nonnegative(),
    pendingRequiredRecords: z.number().int().nonnegative(),
    failedRequiredRecords: z.number().int().nonnegative(),
    expectedFamilies: z.array(RecordFamilySchema),
    completedFamilies: z.array(RecordFamilySchema),
    missingFamilies: z.array(RecordFamilySchema),
    sourceCoverage: z.record(z.string(), z.json()),
    lastEvidenceSequence: DecimalSchema,
    status: z.enum(['projecting', 'complete', 'degraded', 'incomplete']),
    qualityIssueIds: z.array(z.string().min(1)),
    sourceSnapshotHash: z.string().min(1),
    createdAt: TimestampSchema,
    recomputedAt: TimestampSchema,
    sealedAt: TimestampSchema.optional(),
  })
  .strict();
const DeadLetterSchema = z
  .object({
    deadLetterId: z.string().min(1),
    sequence: DecimalSchema,
    recordId: z.string().min(1),
    issueCode: IssueCodeSchema,
    attempts: z.number().int().nonnegative(),
    failedAt: TimestampSchema,
    requeuedAt: TimestampSchema.optional(),
    requeueCount: z.number().int().nonnegative(),
    requeuedBy: z.string().min(1).optional(),
    requeueReason: z.string().min(1).optional(),
  })
  .strict();
const RecoveryRunSchema = z
  .object({
    recoveryRunId: z.string().min(1),
    operationId: z.string().min(1),
    idempotencyKeyHash: Sha256Schema,
    requestHash: Sha256Schema,
    operation: z.enum([
      'replay_record',
      'replay_source_partition',
      'replay_episode',
      'retry_dead_letter',
      'reconcile_coverage',
    ]),
    target: z.record(z.string(), z.string()),
    actorId: z.string().min(1),
    reason: z.string().min(1),
    status: z.enum(['requested', 'running', 'succeeded', 'failed']),
    affectedRecords: z.number().int().nonnegative(),
    resultSummary: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    errorCode: z.string().min(1).optional(),
    requestedAt: TimestampSchema,
    startedAt: TimestampSchema.optional(),
    completedAt: TimestampSchema.optional(),
    revision: z.number().int().positive(),
  })
  .strict();

export class HttpRuntimeEvidenceOperationsClient implements NodeControlRuntimeEvidenceOperationsClient {
  readonly #baseUrl: string;
  readonly #serviceToken: string;

  constructor(configuration: Readonly<{ baseUrl: string; serviceToken: string }>) {
    this.#baseUrl = configuration.baseUrl.replace(/\/+$/u, '');
    this.#serviceToken = configuration.serviceToken;
  }

  async configuration(): Promise<EvidenceConfigurationMetadata | undefined> {
    const body = await this.#get('/internal/v1/evidence-export/operations/configuration');
    const configuration = ConfigurationSchema.nullable().parse(body);
    return configuration === null ? undefined : Object.freeze(configuration);
  }

  async status(): Promise<EvidenceOperationsStatusMetadata> {
    return projectStatus(
      StatusSchema.parse(await this.#get('/internal/v1/evidence-export/operations/status')),
    );
  }

  async outbox(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceOutboxRecordMetadata>> {
    return this.#metadataPage(
      '/internal/v1/evidence-export/operations/outbox',
      query,
      OutboxRecordSchema,
      projectOutboxRecord,
    );
  }

  async checkpoints(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceProjectionCheckpointMetadata>> {
    return this.#metadataPage(
      '/internal/v1/evidence-export/operations/source-checkpoints',
      query,
      CheckpointSchema,
      projectCheckpoint,
    );
  }

  async projectionIssues(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceProjectionIssueMetadata>> {
    return this.#metadataPage(
      '/internal/v1/evidence-export/operations/projection-issues',
      query,
      ProjectionIssueSchema,
      projectProjectionIssue,
    );
  }

  async qualityIssues(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceQualityIssueMetadata>> {
    return this.#metadataPage(
      '/internal/v1/evidence-export/operations/quality-issues',
      query,
      QualityIssueSchema,
      projectQualityIssue,
    );
  }

  async manifest(episodeId: string): Promise<EvidenceManifestMetadata | undefined> {
    const body = await this.#get(
      `/internal/v1/evidence-export/operations/episode-manifests/${encodeURIComponent(episodeId)}`,
    );
    const manifest = ManifestSchema.nullable().parse(body);
    return manifest === null ? undefined : (Object.freeze(manifest) as EvidenceManifestMetadata);
  }

  async deadLetters(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceDeadLetterMetadata>> {
    return this.#metadataPage(
      '/internal/v1/evidence-export/operations/dead-letters',
      query,
      DeadLetterSchema,
      projectDeadLetter,
    );
  }

  async recover(request: EvidenceRecoveryRequest): Promise<EvidenceRecoveryRunMetadata> {
    switch (request.operation) {
      case 'replay_record':
      case 'replay_source_partition':
      case 'replay_episode':
        return this.#recovery('/internal/v1/evidence-export/operations/replays', request);
      case 'retry_dead_letter': {
        return this.#recovery(
          `/internal/v1/evidence-export/operations/dead-letters/${encodeURIComponent(request.deadLetterId)}/retry`,
          recoveryRequestBase(request),
        );
      }
      case 'reconcile_coverage': {
        return this.#recovery('/internal/v1/evidence-export/operations/reconcile', {
          ...recoveryRequestBase(request),
          ...(request.episodeId === undefined ? {} : { episodeId: request.episodeId }),
        });
      }
    }
    return assertNever(request);
  }

  async #metadataPage<TInput, TOutput>(
    path: string,
    query: EvidenceOperationsPageQuery,
    itemSchema: z.ZodType<TInput>,
    project: (input: TInput) => TOutput,
  ): Promise<EvidenceMetadataPage<TOutput>> {
    const schema = z
      .object({ items: z.array(itemSchema), nextCursor: z.string().min(1).optional() })
      .strict();
    const page = schema.parse(await this.#get(this.#queryUrl(path, query)));
    return Object.freeze({
      items: Object.freeze(page.items.map(project)),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    });
  }

  async #recovery(path: string, body: unknown): Promise<EvidenceRecoveryRunMetadata> {
    const response = await globalThis.fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: this.#headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    return Object.freeze(
      RecoveryRunSchema.parse(await responseJson(response)),
    ) as EvidenceRecoveryRunMetadata;
  }

  async #get(path: string | URL): Promise<unknown> {
    const response = await globalThis.fetch(
      typeof path === 'string' ? `${this.#baseUrl}${path}` : path,
      { headers: this.#headers() },
    );
    return responseJson(response);
  }

  #queryUrl(path: string, query: EvidenceOperationsPageQuery): URL {
    const url = new URL(`${this.#baseUrl}${path}`);
    url.searchParams.set('limit', String(query.limit));
    if (query.cursor !== undefined) url.searchParams.set('cursor', query.cursor);
    if (query.episodeId !== undefined) url.searchParams.set('episodeId', query.episodeId);
    if (query.sourcePartition !== undefined)
      url.searchParams.set('sourcePartition', query.sourcePartition);
    if (query.openOnly !== undefined) url.searchParams.set('openOnly', String(query.openOnly));
    return url;
  }

  #headers(extra: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
    return Object.freeze({ authorization: `Bearer ${this.#serviceToken}`, ...extra });
  }
}

function projectStatus(input: z.infer<typeof StatusSchema>): EvidenceOperationsStatusMetadata {
  return Object.freeze({
    ...(input.exportId === undefined ? {} : { exportId: input.exportId }),
    ...(input.activeRevision === undefined ? {} : { activeRevision: input.activeRevision }),
    pendingRecords: input.pendingRecords,
    deadLetterRecords: input.deadLetterRecords,
    openProjectionIssues: input.openProjectionIssues,
    openQualityIssues: input.openQualityIssues,
    ...(input.globalAcknowledgedFrontier === undefined
      ? {}
      : { globalAcknowledgedFrontier: input.globalAcknowledgedFrontier }),
    highWatermarkActive: input.highWatermarkActive,
    partitions: Object.freeze(input.partitions.map(projectPartitionStatus)),
    observedAt: input.observedAt,
  });
}

function projectPartitionStatus(
  input: z.infer<typeof PartitionStatusSchema>,
): EvidenceOperationsStatusMetadata['partitions'][number] {
  return Object.freeze({
    exportId: input.exportId,
    sourcePartition: input.sourcePartition,
    status: input.status,
    ...(input.lastSentSequence === undefined ? {} : { lastSentSequence: input.lastSentSequence }),
    ...(input.lastAcknowledgedSequence === undefined
      ? {}
      : { lastAcknowledgedSequence: input.lastAcknowledgedSequence }),
    ...(input.lastAcknowledgedAt === undefined
      ? {}
      : { lastAcknowledgedAt: input.lastAcknowledgedAt }),
    ...(input.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: input.leaseExpiresAt }),
    fencingToken: input.fencingToken,
    ...(input.lastErrorCode === undefined ? {} : { lastErrorCode: input.lastErrorCode }),
    ...(input.lastErrorAt === undefined ? {} : { lastErrorAt: input.lastErrorAt }),
    observedAt: input.observedAt,
  });
}

function projectOutboxRecord(
  input: z.infer<typeof OutboxRecordSchema>,
): EvidenceOutboxRecordMetadata {
  return Object.freeze({
    sequence: input.sequence,
    recordId: input.recordId,
    recordFamily: input.recordFamily,
    recordType: input.recordType,
    schemaName: input.schemaName,
    schemaVersion: input.schemaVersion,
    sourceSystem: input.sourceSystem,
    sourceTable: input.sourceTable,
    sourceRecordId: input.sourceRecordId,
    sourceRevision: input.sourceRevision,
    sourcePartition: input.sourcePartition,
    evaluationRole: input.evaluationRole,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input.episodeId === undefined ? {} : { episodeId: input.episodeId }),
    payloadHash: input.payloadHash,
    capturedAt: input.capturedAt,
    deliveryAttempts: input.deliveryAttempts,
    nextAttemptAt: input.nextAttemptAt,
    ...(input.sentAt === undefined ? {} : { sentAt: input.sentAt }),
    ...(input.acknowledgedAt === undefined ? {} : { acknowledgedAt: input.acknowledgedAt }),
    ...(input.lastErrorCode === undefined ? {} : { lastErrorCode: input.lastErrorCode }),
  });
}

function projectCheckpoint(
  input: z.infer<typeof CheckpointSchema>,
): EvidenceProjectionCheckpointMetadata {
  return Object.freeze({
    sourceFamily: input.sourceFamily,
    sourcePartition: input.sourcePartition,
    ...(input.lastOccurredAt === undefined ? {} : { lastOccurredAt: input.lastOccurredAt }),
    ...(input.lastSourceRecordId === undefined
      ? {}
      : { lastSourceRecordId: input.lastSourceRecordId }),
    ...(input.lastSourceRevision === undefined
      ? {}
      : { lastSourceRevision: input.lastSourceRevision }),
    ...(input.lastPayloadHash === undefined ? {} : { lastPayloadHash: input.lastPayloadHash }),
    ...(input.lastProjectedAt === undefined ? {} : { lastProjectedAt: input.lastProjectedAt }),
    projectorVersion: input.projectorVersion,
  });
}

function projectProjectionIssue(
  input: z.infer<typeof ProjectionIssueSchema>,
): EvidenceProjectionIssueMetadata {
  return Object.freeze({
    issueId: input.issueId,
    ...(input.ruleId === undefined ? {} : { ruleId: input.ruleId }),
    issueCode: input.issueCode,
    severity: input.severity,
    evaluationRole: input.evaluationRole,
    ...(input.recordType === undefined ? {} : { recordType: input.recordType }),
    ...(input.recordId === undefined ? {} : { recordId: input.recordId }),
    ...(input.episodeId === undefined ? {} : { episodeId: input.episodeId }),
    sourceSystem: input.sourceSystem,
    sourceTable: input.sourceTable,
    sourceRecordId: input.sourceRecordId,
    sourcePartition: input.sourcePartition,
    projectorVersion: input.projectorVersion,
    retryable: input.retryable,
    firstObservedAt: input.firstObservedAt,
    lastObservedAt: input.lastObservedAt,
    ...(input.resolvedAt === undefined ? {} : { resolvedAt: input.resolvedAt }),
    revision: input.revision,
  });
}

function projectQualityIssue(
  input: z.infer<typeof QualityIssueSchema>,
): EvidenceQualityIssueMetadata {
  return Object.freeze({
    issueId: input.issueId,
    ...(input.ruleId === undefined ? {} : { ruleId: input.ruleId }),
    issueCode: input.issueCode,
    severity: input.severity,
    ...(input.recordType === undefined ? {} : { recordType: input.recordType }),
    ...(input.recordId === undefined ? {} : { recordId: input.recordId }),
    ...(input.episodeId === undefined ? {} : { episodeId: input.episodeId }),
    sourceSystem: input.sourceSystem,
    sourceTable: input.sourceTable,
    sourceRecordId: input.sourceRecordId,
    firstObservedAt: input.firstObservedAt,
    lastObservedAt: input.lastObservedAt,
    ...(input.resolvedAt === undefined ? {} : { resolvedAt: input.resolvedAt }),
    revision: input.revision,
  });
}

function projectDeadLetter(input: z.infer<typeof DeadLetterSchema>): EvidenceDeadLetterMetadata {
  return Object.freeze({
    deadLetterId: input.deadLetterId,
    sequence: input.sequence,
    recordId: input.recordId,
    issueCode: input.issueCode,
    attempts: input.attempts,
    failedAt: input.failedAt,
    ...(input.requeuedAt === undefined ? {} : { requeuedAt: input.requeuedAt }),
    requeueCount: input.requeueCount,
    ...(input.requeuedBy === undefined ? {} : { requeuedBy: input.requeuedBy }),
    ...(input.requeueReason === undefined ? {} : { requeueReason: input.requeueReason }),
  });
}

function assertNever(value: never): never {
  throw new RuntimeEvidenceOperationsHttpError(
    `RUNTIME_EVIDENCE_OPERATIONS_UNSUPPORTED_${String(value)}`,
    400,
  );
}

function recoveryRequestBase(request: EvidenceRecoveryRequest): Readonly<{
  operationId: string;
  idempotencyKeyHash: `sha256:${string}`;
  actorId: string;
  reason: string;
  requestedAt: string;
}> {
  return Object.freeze({
    operationId: request.operationId,
    idempotencyKeyHash: request.idempotencyKeyHash,
    actorId: request.actorId,
    reason: request.reason,
    requestedAt: request.requestedAt,
  });
}

async function responseJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code =
      runtimeErrorCode(body) ?? `RUNTIME_EVIDENCE_OPERATIONS_HTTP_${String(response.status)}`;
    throw new RuntimeEvidenceOperationsHttpError(code, response.status);
  }
  return body;
}

function runtimeErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  if ('code' in body && typeof body.code === 'string') return body.code;
  if (
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'code' in body.error &&
    typeof body.error.code === 'string'
  )
    return body.error.code;
  return undefined;
}

export class RuntimeEvidenceOperationsHttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(`Runtime Evidence Operations request failed with ${code}.`);
    this.name = 'RuntimeEvidenceOperationsHttpError';
    this.code = code;
    this.status = status;
  }
}
