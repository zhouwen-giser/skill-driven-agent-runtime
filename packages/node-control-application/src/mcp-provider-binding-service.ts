import { createHash } from 'node:crypto';

import {
  createManagementOperation,
  createMcpProviderBindingRecord,
  hashConfigurationRequest,
  type JsonObject,
  type ManagementOperation,
  type McpProviderBinding,
  type McpProviderBindingRecord,
} from '../../node-control-domain/src/index.js';
import type {
  ConfigurationMutationContext,
  McpCatalogDiscoveryResult,
  McpBindingImportRequest,
  McpBindingRebindRequest,
  NodeControlClock,
  NodeControlIdGenerator,
  NodeControlMcpCatalogClient,
  NodeControlMcpProviderBindingRepository,
} from './ports.js';

export interface McpProviderBindingDetail extends McpProviderBinding {
  readonly availabilityValidUntil: string;
  readonly catalogObservedAt: string;
  readonly operationCount: number;
}

export type NodeControlMcpBindingErrorCode =
  | 'MCP_PROVIDER_BINDING_AUTHORITY_AMBIGUOUS'
  | 'MCP_PROVIDER_BINDING_NOT_FOUND'
  | 'MCP_PROVIDER_BINDING_CONFLICT'
  | 'MCP_PROVIDER_BINDING_STALE'
  | 'IDEMPOTENCY_KEY_REUSED';

export class NodeControlMcpBindingError extends Error {
  readonly code: NodeControlMcpBindingErrorCode;
  constructor(code: NodeControlMcpBindingErrorCode, message: string) {
    super(message);
    this.name = 'NodeControlMcpBindingError';
    this.code = code;
  }
}

export class NodeControlMcpProviderBindingService {
  readonly #repository: NodeControlMcpProviderBindingRepository;
  readonly #catalog: NodeControlMcpCatalogClient;
  readonly #clock: NodeControlClock;
  readonly #ids: NodeControlIdGenerator;

  constructor(
    dependencies: Readonly<{
      repository: NodeControlMcpProviderBindingRepository;
      catalog: NodeControlMcpCatalogClient;
      clock: NodeControlClock;
      ids: NodeControlIdGenerator;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  listBindings(limit = 100) {
    return this.#repository.list(boundedLimit(limit));
  }

  async getBinding(bindingId: string, revision?: number): Promise<McpProviderBindingDetail> {
    const record = await this.#repository.find(bindingId, revision);
    if (record === undefined)
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_NOT_FOUND',
        'MCP Provider Binding was not found.',
      );
    return Object.freeze({
      ...record.binding,
      availabilityValidUntil: record.availabilityValidUntil,
      catalogObservedAt: record.catalogObservedAt,
      operationCount: record.operationCount,
    });
  }

  async getCurrentAuthority(input: Readonly<{ bindingId?: string; localServerId: string }>) {
    const authority = await this.#repository.findCurrentAuthority({
      ...(input.bindingId === undefined ? {} : { bindingId: input.bindingId }),
      localServerId: input.localServerId,
      observedAt: this.#clock.now(),
    });
    if (authority === undefined)
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_NOT_FOUND',
        'No current MCP Provider Binding authority matches the requested identity.',
      );
    return authority;
  }

  async importBinding(
    request: McpBindingImportRequest,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const context = this.context(
      'mcp-binding:import',
      idempotencyKey,
      reason,
      requestJson(request),
    );
    const replay = await this.#repository.findCommandReplay('mcp-binding:import', context);
    if (replay !== undefined) return replay;
    const operation = this.operation('mcp_provider_binding.import', request.bindingId, 1, context);
    try {
      const resolved = await this.resolveImport(request, context.occurredAt);
      const discovery = await this.#catalog.discover({
        localServerId: request.localServerId,
        endpointRef: resolved.endpointRef,
        credentialRef: request.credentialRef,
        bindingRevision: 1,
        observedAt: context.occurredAt,
        snapshotId: this.#ids.next(),
      });
      const record = createMcpProviderBindingRecord({
        binding: {
          bindingId: request.bindingId,
          localServerId: request.localServerId,
          originType: request.originType,
          ...resolved.lineage,
          catalogRevision: discovery.catalogRevision,
          catalogChecksum: discovery.catalogChecksum,
          endpointRef: resolved.endpointRef,
          status: 'active',
          availabilityStatus: discovery.availabilityStatus,
          revision: 1,
        },
        credentialRef: request.credentialRef,
        availabilityValidUntil: discovery.availabilityValidUntil,
        catalogObservedAt: discovery.observedAt,
        operationCount: discovery.operationCount,
      });
      return await this.#repository.completeImport(record, operation, context);
    } catch (error: unknown) {
      return this.#repository.recordImportFailure(
        request.bindingId,
        operation,
        context,
        safeCatalogError(error),
      );
    }
  }

  async refresh(
    bindingId: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const prior = await this.requireRecord(bindingId);
    return this.rediscover(prior, idempotencyKey, reason);
  }

  async rebind(
    bindingId: string,
    request: McpBindingRebindRequest,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const commandRequest = Object.freeze({ bindingId, ...request });
    const context = this.context(
      'mcp-binding:rebind',
      idempotencyKey,
      reason,
      requestJson(commandRequest),
    );
    const replay = await this.#repository.findCommandReplay('mcp-binding:rebind', context);
    if (replay !== undefined) return replay;
    const prior = await this.requireRecord(bindingId);
    if (prior.binding.revision !== request.expectedRevision)
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_CONFLICT',
        'MCP Provider Binding revision does not match expectedRevision.',
      );
    if (
      prior.binding.originType !== 'smpp_registry' ||
      prior.binding.status === 'suspended' ||
      prior.binding.status === 'removed'
    )
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_CONFLICT',
        'Only selectable SMPP Registry Bindings can be rebound.',
      );
    const candidate = await this.#repository.findSmppCandidate({
      smppSourceId: request.smppSourceId,
      externalProviderId: request.externalProviderId,
      externalServerId: request.externalServerId,
      registryRevision: request.registryRevision,
      registryChecksum: request.registryChecksum,
      observedAt: context.occurredAt,
    });
    if (candidate?.serverEndpoint !== request.endpointRef)
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_STALE',
        'Rebind Candidate is absent, stale, expired or its endpoint has changed.',
      );
    if (
      prior.binding.smppSourceId === request.smppSourceId &&
      prior.binding.externalProviderId === request.externalProviderId &&
      prior.binding.externalServerId === request.externalServerId &&
      prior.binding.registryRevision === request.registryRevision &&
      prior.binding.registryChecksum === request.registryChecksum &&
      prior.binding.endpointRef === request.endpointRef
    )
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_CONFLICT',
        'Candidate lineage is unchanged; use refresh instead of rebind.',
      );
    const nextRevision = prior.binding.revision + 1;
    const operation = this.operation(
      'mcp_provider_binding.rebind',
      bindingId,
      nextRevision,
      context,
    );
    let discovery: McpCatalogDiscoveryResult;
    try {
      discovery = await this.#catalog.discover({
        localServerId: prior.binding.localServerId,
        endpointRef: candidate.serverEndpoint,
        credentialRef: prior.credentialRef,
        bindingRevision: nextRevision,
        observedAt: context.occurredAt,
        snapshotId: this.#ids.next(),
      });
    } catch {
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_STALE',
        'Candidate discovery failed; the selected Binding revision was not changed.',
      );
    }
    const record = createMcpProviderBindingRecord({
      binding: {
        ...prior.binding,
        smppSourceId: request.smppSourceId,
        externalProviderId: request.externalProviderId,
        externalServerId: request.externalServerId,
        registryRevision: request.registryRevision,
        registryChecksum: request.registryChecksum,
        endpointRef: candidate.serverEndpoint,
        catalogRevision: discovery.catalogRevision,
        catalogChecksum: discovery.catalogChecksum,
        status: 'active',
        availabilityStatus: discovery.availabilityStatus,
        revision: nextRevision,
      },
      credentialRef: prior.credentialRef,
      availabilityValidUntil: discovery.availabilityValidUntil,
      catalogObservedAt: discovery.observedAt,
      operationCount: discovery.operationCount,
    });
    return this.#repository.completeRevision(prior, record, operation, context, 'rebound');
  }

  suspend(bindingId: string, idempotencyKey: string, reason: string) {
    return this.transition(bindingId, 'suspended', idempotencyKey, reason);
  }

  remove(bindingId: string, idempotencyKey: string, reason: string) {
    return this.transition(bindingId, 'removed', idempotencyKey, reason);
  }

  private async rediscover(
    prior: McpProviderBindingRecord,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const nextRevision = prior.binding.revision + 1;
    const request = Object.freeze({ bindingId: prior.binding.bindingId });
    const context = this.context('mcp-binding:refresh', idempotencyKey, reason, request);
    const replay = await this.#repository.findCommandReplay('mcp-binding:refresh', context);
    if (replay !== undefined) return replay;
    if (prior.binding.status === 'suspended' || prior.binding.status === 'removed')
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_CONFLICT',
        'Suspended or removed MCP Provider Bindings cannot be refreshed.',
      );
    const operation = this.operation(
      'mcp_provider_binding.refresh',
      prior.binding.bindingId,
      nextRevision,
      context,
    );
    try {
      const approved = await this.#repository.findLatestActive(prior.binding.bindingId);
      const discovery = await this.#catalog.discover({
        localServerId: prior.binding.localServerId,
        endpointRef: prior.binding.endpointRef,
        credentialRef: prior.credentialRef,
        bindingRevision: nextRevision,
        observedAt: context.occurredAt,
        snapshotId: this.#ids.next(),
      });
      const drift = discovery.catalogChecksum !== approved?.binding.catalogChecksum;
      const record = createMcpProviderBindingRecord({
        binding: {
          ...prior.binding,
          catalogRevision: discovery.catalogRevision,
          catalogChecksum: discovery.catalogChecksum,
          status: drift ? 'degraded' : 'active',
          availabilityStatus: drift ? 'degraded' : 'available',
          revision: nextRevision,
        },
        credentialRef: prior.credentialRef,
        availabilityValidUntil: discovery.availabilityValidUntil,
        catalogObservedAt: discovery.observedAt,
        operationCount: discovery.operationCount,
      });
      return await this.#repository.completeRevision(
        prior,
        record,
        operation,
        context,
        drift ? 'MCP_CATALOG_DRIFT_DETECTED' : 'refreshed',
      );
    } catch (error: unknown) {
      const record = createMcpProviderBindingRecord({
        ...prior,
        binding: {
          ...prior.binding,
          status: 'degraded',
          availabilityStatus: 'unavailable',
          revision: nextRevision,
        },
        availabilityValidUntil: new Date(Date.parse(context.occurredAt) + 1).toISOString(),
        catalogObservedAt: context.occurredAt,
      });
      return this.#repository.completeRevision(
        prior,
        record,
        operation,
        context,
        safeCatalogError(error),
      );
    }
  }

  private async transition(
    bindingId: string,
    status: 'suspended' | 'removed',
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const prior = await this.requireRecord(bindingId);
    const nextRevision = prior.binding.revision + 1;
    const context = this.context(
      `mcp-binding:${status}`,
      idempotencyKey,
      reason,
      Object.freeze({ bindingId, status }),
    );
    const replay = await this.#repository.findCommandReplay(`mcp-binding:${status}`, context);
    if (replay !== undefined) return replay;
    if (prior.binding.status === 'removed' || prior.binding.status === status)
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_CONFLICT',
        `MCP Provider Binding cannot transition from ${prior.binding.status} to ${status}.`,
      );
    const operation = this.operation(
      `mcp_provider_binding.${status}`,
      bindingId,
      nextRevision,
      context,
    );
    const record = createMcpProviderBindingRecord({
      ...prior,
      binding: { ...prior.binding, status, revision: nextRevision },
    });
    return this.#repository.completeRevision(prior, record, operation, context, status);
  }

  private async resolveImport(request: McpBindingImportRequest, observedAt: string) {
    if (request.originType === 'direct') {
      if (request.endpointRef === undefined)
        throw new NodeControlMcpBindingError(
          'MCP_PROVIDER_BINDING_CONFLICT',
          'Direct binding import requires endpointRef.',
        );
      return Object.freeze({ endpointRef: request.endpointRef, lineage: Object.freeze({}) });
    }
    if (
      request.smppSourceId === undefined ||
      request.externalProviderId === undefined ||
      request.externalServerId === undefined ||
      request.registryRevision === undefined ||
      request.registryChecksum === undefined
    )
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_STALE',
        'SMPP import requires exact candidate lineage.',
      );
    const candidate = await this.#repository.findSmppCandidate({
      smppSourceId: request.smppSourceId,
      externalProviderId: request.externalProviderId,
      externalServerId: request.externalServerId,
      registryRevision: request.registryRevision,
      registryChecksum: request.registryChecksum,
      observedAt,
    });
    if (candidate === undefined)
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_STALE',
        'SMPP candidate is absent, stale or no longer selectable.',
      );
    return Object.freeze({
      endpointRef: candidate.serverEndpoint,
      lineage: Object.freeze({
        smppSourceId: request.smppSourceId,
        externalProviderId: request.externalProviderId,
        externalServerId: request.externalServerId,
        registryRevision: request.registryRevision,
        registryChecksum: request.registryChecksum,
      }),
    });
  }

  private async requireRecord(bindingId: string): Promise<McpProviderBindingRecord> {
    const record = await this.#repository.find(bindingId);
    if (record === undefined)
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_NOT_FOUND',
        'MCP Provider Binding was not found.',
      );
    return record;
  }

  private operation(
    operationType: string,
    bindingId: string,
    revision: number,
    context: ConfigurationMutationContext,
  ) {
    return createManagementOperation(
      {
        operationId: this.#ids.next(),
        operationType,
        target: { type: 'mcp_provider_binding', id: bindingId, revision },
        actorId: context.actorId,
        reason: context.reason,
        idempotencyKeyHash: context.idempotencyKeyHash,
        inputHash: context.requestHash,
      },
      context.occurredAt,
    );
  }

  private context(scope: string, key: string, reason: string, request: JsonObject) {
    const cleanKey = key.trim();
    const cleanReason = reason.trim();
    if (
      cleanKey.length < 8 ||
      cleanKey.length > 256 ||
      cleanReason === '' ||
      cleanReason.length > 1024
    )
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_CONFLICT',
        'A bounded Idempotency-Key and non-empty reason are required.',
      );
    return Object.freeze({
      actorId: 'deployment-operator',
      reason: cleanReason,
      idempotencyKeyHash: createHash('sha256').update(cleanKey).digest('hex'),
      requestHash: hashConfigurationRequest(Object.freeze({ scope, request })),
      occurredAt: this.#clock.now(),
    });
  }
}

function requestJson(
  request: McpBindingImportRequest | (McpBindingRebindRequest & { bindingId: string }),
): JsonObject {
  return JSON.parse(JSON.stringify(request)) as JsonObject;
}

function safeCatalogError(error: unknown): string {
  if (error instanceof NodeControlMcpBindingError) return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code);
    if (['MCP_ENDPOINT_NOT_ALLOWED', 'SECRET_REFERENCE_UNAVAILABLE'].includes(code)) return code;
  }
  return 'MCP_PROVIDER_DISCOVERY_FAILED';
}

function boundedLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000 ? value : 100;
}
