import { createHash } from 'node:crypto';

import {
  createManagementOperation,
  createSmppRegistrySnapshot,
  createSmppRegistrySource,
  effectiveSmppRevalidatedValidUntil,
  effectiveSmppSnapshotValidUntil,
  hashConfigurationRequest,
  type JsonObject,
  type ManagementOperation,
  type SmppProviderCandidateDirectoryEntry,
  type SmppRegistrySource,
} from '../../node-control-domain/src/index.js';
import type {
  ConfigurationMutationContext,
  NodeControlClock,
  NodeControlIdGenerator,
  NodeControlSmppRegistryRepository,
  SmppRegistryClient,
  SmppRegistryResponseLineage,
  SmppRegistrySyncObservation,
  SmppSnapshotHead,
} from './ports.js';

export type NodeControlSmppRegistryErrorCode =
  'SMPP_SOURCE_NOT_FOUND' | 'SMPP_SOURCE_CONFLICT' | 'IDEMPOTENCY_KEY_REUSED';

export class NodeControlSmppRegistryError extends Error {
  readonly code: NodeControlSmppRegistryErrorCode;

  constructor(code: NodeControlSmppRegistryErrorCode, message: string) {
    super(message);
    this.name = 'NodeControlSmppRegistryError';
    this.code = code;
  }
}

export class NodeControlSmppRegistryService {
  readonly #repository: NodeControlSmppRegistryRepository;
  readonly #client: SmppRegistryClient;
  readonly #clock: NodeControlClock;
  readonly #ids: NodeControlIdGenerator;

  constructor(
    dependencies: Readonly<{
      repository: NodeControlSmppRegistryRepository;
      client: SmppRegistryClient;
      clock: NodeControlClock;
      ids: NodeControlIdGenerator;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#client = dependencies.client;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  createSource(source: SmppRegistrySource, idempotencyKey: string) {
    const normalized = createSmppRegistrySource(source);
    return this.#repository.createSource(
      normalized,
      this.context(
        'deployment-operator',
        'Create SMPP Registry Source draft.',
        idempotencyKey,
        sourceRequest(normalized),
      ),
    );
  }

  async getSource(sourceId: string): Promise<SmppRegistrySource> {
    const source = await this.#repository.findSource(sourceId);
    if (source === undefined)
      throw new NodeControlSmppRegistryError(
        'SMPP_SOURCE_NOT_FOUND',
        'SMPP Registry Source was not found.',
      );
    return source;
  }

  listSources(limit = 100) {
    return this.#repository.listSources(boundedLimit(limit));
  }

  listCandidates(
    sourceId?: string,
    limit = 100,
  ): Promise<readonly SmppProviderCandidateDirectoryEntry[]> {
    return this.#repository.listCandidates({
      ...(sourceId === undefined ? {} : { sourceId }),
      observedAt: this.#clock.now(),
      limit: boundedLimit(limit),
    });
  }

  async synchronize(
    sourceId: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const source = await this.getSource(sourceId);
    const context = this.context(
      'deployment-operator',
      reason,
      idempotencyKey,
      Object.freeze({ sourceId, sourceRevision: source.revision }),
    );
    const replay = await this.#repository.findSyncReplay(context);
    if (replay !== undefined) return replay;
    const operation = createManagementOperation(
      {
        operationId: this.#ids.next(),
        operationType: 'smpp_source.sync',
        target: { type: 'smpp_source', id: sourceId, revision: source.revision },
        actorId: context.actorId,
        reason: context.reason,
        idempotencyKeyHash: context.idempotencyKeyHash,
        inputHash: context.requestHash,
      },
      context.occurredAt,
    );
    let observation: SmppRegistrySyncObservation | undefined;
    try {
      const active = await this.#repository.findActiveSnapshot(sourceId);
      const fetched = await this.#client.fetchLatest(
        source,
        isConditionallyReusable(active, context.occurredAt) ? active.etag : undefined,
      );
      if (fetched.status === 'not_modified') {
        if (active === undefined)
          return await this.#repository.recordSyncFailure(
            source,
            'SMPP_SOURCE_UNAVAILABLE',
            operation,
            context,
          );
        const validUntil = effectiveSmppRevalidatedValidUntil(
          source,
          active.externalExpiresAt,
          context.occurredAt,
        );
        observation = observationFromHead(
          { ...active, etag: fetched.etag },
          fetched.nativeLineage,
          validUntil,
        );
        if (
          !isFresh(active.validUntil, context.occurredAt) ||
          !isFresh(active.externalExpiresAt, context.occurredAt)
        )
          return await this.#repository.recordSyncFailure(
            source,
            'SMPP_SNAPSHOT_EXPIRED',
            operation,
            context,
            observation,
          );
        if (
          fetched.etag !== active.etag ||
          active.nativeLineage === undefined ||
          !sameLineage(active.nativeLineage, fetched.nativeLineage)
        )
          return await this.#repository.recordSyncFailure(
            source,
            'SMPP_SNAPSHOT_LINEAGE_MISMATCH',
            operation,
            context,
            observation,
          );
        return await this.#repository.recordNotModified(
          source,
          active,
          fetched.nativeLineage,
          validUntil,
          operation,
          context,
        );
      }
      observation = Object.freeze({
        revision: fetched.snapshot.revision,
        checksum: fetched.snapshot.checksum,
        etag: fetched.snapshot.etag,
        nativeLineage: fetched.nativeLineage,
      });
      const snapshot = createSmppRegistrySnapshot(fetched.snapshot);
      if (snapshot.smppSourceId !== sourceId)
        return await this.#repository.recordSyncFailure(
          source,
          'SMPP_SNAPSHOT_SOURCE_MISMATCH',
          operation,
          context,
          observation,
        );
      const validUntil = effectiveSmppSnapshotValidUntil(source, snapshot, context.occurredAt);
      observation = Object.freeze({ ...observation, validUntil });
      if (Date.parse(snapshot.expiresAt) <= Date.parse(context.occurredAt))
        return await this.#repository.recordSyncFailure(
          source,
          'SMPP_SNAPSHOT_EXPIRED',
          operation,
          context,
          observation,
        );
      return await this.#repository.applySnapshot(
        source,
        snapshot,
        validUntil,
        fetched.nativeLineage,
        operation,
        context,
      );
    } catch (error: unknown) {
      return this.#repository.recordSyncFailure(
        source,
        safeSyncErrorCode(error),
        operation,
        context,
        observation,
      );
    }
  }

  async synchronizeScheduled(
    limit = 100,
  ): Promise<Readonly<{ attempted: number; failed: number }>> {
    const sources = await this.#repository.listScheduledSources(boundedLimit(limit));
    let failed = 0;
    for (const source of sources) {
      const observedAt = this.#clock.now();
      const operation = await this.synchronize(
        source.smppSourceId,
        `worker-${source.smppSourceId}-${observedAt}`,
        'Scheduled SMPP Registry refresh.',
      );
      if (operation.status === 'failed') failed += 1;
    }
    return Object.freeze({ attempted: sources.length, failed });
  }

  private context(
    actorId: string,
    reason: string,
    idempotencyKey: string,
    request: JsonObject,
  ): ConfigurationMutationContext {
    const cleanReason = reason.trim();
    if (cleanReason === '' || cleanReason.length > 1024)
      throw new NodeControlSmppRegistryError(
        'SMPP_SOURCE_CONFLICT',
        'A bounded non-empty command reason is required.',
      );
    const cleanKey = idempotencyKey.trim();
    if (cleanKey.length < 8 || cleanKey.length > 256)
      throw new NodeControlSmppRegistryError(
        'SMPP_SOURCE_CONFLICT',
        'Idempotency-Key must contain between 8 and 256 characters.',
      );
    return Object.freeze({
      actorId,
      reason: cleanReason,
      idempotencyKeyHash: createHash('sha256').update(cleanKey).digest('hex'),
      requestHash: hashConfigurationRequest(request),
      occurredAt: this.#clock.now(),
    });
  }
}

function isConditionallyReusable(
  active: SmppSnapshotHead | undefined,
  observedAt: string,
): active is SmppSnapshotHead & { readonly nativeLineage: SmppRegistryResponseLineage } {
  return (
    active?.nativeLineage !== undefined &&
    isFresh(active.validUntil, observedAt) &&
    isFresh(active.externalExpiresAt, observedAt)
  );
}

function isFresh(expiresAt: string, observedAt: string): boolean {
  return Date.parse(expiresAt) > Date.parse(observedAt);
}

function sameLineage(
  left: SmppRegistryResponseLineage,
  right: SmppRegistryResponseLineage,
): boolean {
  return (
    left.nativeRevision === right.nativeRevision && left.nativeChecksum === right.nativeChecksum
  );
}

function observationFromHead(
  active: SmppSnapshotHead,
  nativeLineage: SmppRegistryResponseLineage,
  validUntil: string,
): SmppRegistrySyncObservation {
  return Object.freeze({
    revision: active.revision,
    checksum: active.checksum,
    etag: active.etag,
    validUntil,
    nativeLineage,
  });
}

function sourceRequest(value: SmppRegistrySource): JsonObject {
  return Object.freeze({
    smppSourceId: value.smppSourceId,
    ...(value.name === undefined ? {} : { name: value.name }),
    registryEndpoint: value.registryEndpoint,
    credentialRef: value.credentialRef,
    ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
    ...(value.projectId === undefined ? {} : { projectId: value.projectId }),
    environment: value.environment,
    syncMode: value.syncMode,
    snapshotTtlSeconds: value.snapshotTtlSeconds,
    lkgPolicy: value.lkgPolicy,
    status: value.status,
    revision: value.revision,
  });
}

function safeSyncErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'SMPP_SNAPSHOT_INVALID' || error.code === 'SMPP_SNAPSHOT_CHECKSUM_MISMATCH')
  )
    return error.code;
  return 'SMPP_SOURCE_UNAVAILABLE';
}

function boundedLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000 ? value : 100;
}
