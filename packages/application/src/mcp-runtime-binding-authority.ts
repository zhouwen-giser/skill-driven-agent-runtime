import {
  deriveFrozenMcpCatalogAuthority,
  type FrozenMcpCatalogAuthority,
  type McpProtocolDiscoverySnapshot,
  type McpTool,
} from '../../domain/src/index.js';

import type {
  Clock,
  CurrentMcpProviderBindingAuthorityPort,
  McpRegistryRepository,
  McpServerRecord,
} from './ports.js';

export type CurrentMcpProviderBindingAuthority = Awaited<
  ReturnType<CurrentMcpProviderBindingAuthorityPort['loadCurrentMcpProviderBinding']>
>;

export interface RuntimeMcpCatalogAuthority {
  readonly record: McpServerRecord;
  readonly snapshot: McpProtocolDiscoverySnapshot;
  readonly tools: readonly McpTool[];
  readonly catalogAuthority: FrozenMcpCatalogAuthority;
}

export interface RuntimeMcpProviderBindingAdmissionVerifier {
  assertCurrent(
    input: Readonly<{
      authority: CurrentMcpProviderBindingAuthority;
      bindingId: string;
      localServerId: string;
      providerId?: string;
      runtimeAuthority?: RuntimeMcpCatalogAuthority;
    }>,
  ): Promise<void>;
}

/**
 * Rebuilds the Runtime side of a governed MCP Binding from persisted Frozen discovery.
 * It deliberately has no fallback or remote discovery path: admission and execution must
 * compare Node Control authority with the exact local Server/snapshot/Tool materialization.
 */
export class McpRuntimeBindingAuthorityVerifier implements RuntimeMcpProviderBindingAdmissionVerifier {
  readonly #repository: McpRegistryRepository;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      repository: McpRegistryRepository;
      clock: Clock;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  async loadRuntimeAuthority(localServerId: string): Promise<RuntimeMcpCatalogAuthority> {
    const record = await this.#repository.findServer(localServerId);
    if (record === undefined)
      throw new McpRuntimeBindingAuthorityError(
        'MCP_SERVER_NOT_FOUND',
        'MCP Server was not found.',
      );
    if (record.server.status !== 'enabled')
      throw new McpRuntimeBindingAuthorityError(
        'MCP_SERVER_NOT_ENABLED',
        'MCP Server must be enabled before Provider access.',
      );

    const [tools, snapshot] = await Promise.all([
      this.#repository.listTools(localServerId),
      this.#repository.findCurrentProtocolSnapshot?.(localServerId),
    ]);
    if (
      record.server.protocolMode !== 'frozen_v1' ||
      snapshot?.protocolMode !== 'frozen_v1' ||
      snapshot.serverId !== localServerId ||
      snapshot.snapshotId !== record.server.currentProtocolSnapshotId ||
      snapshot.toolRevision !== record.server.toolRevision ||
      tools.some((tool) => tool.serverId !== localServerId)
    )
      throw new McpRuntimeBindingAuthorityError(
        'MCP_FROZEN_PROTOCOL_SNAPSHOT_REQUIRED',
        'Frozen MCP access requires its current persisted discovery snapshot.',
      );

    return Object.freeze({
      record,
      snapshot,
      tools: Object.freeze([...tools]),
      catalogAuthority: deriveFrozenMcpCatalogAuthority(
        snapshot,
        tools,
        record.server.toolRevision,
      ),
    });
  }

  async assertCurrent(
    input: Readonly<{
      authority: CurrentMcpProviderBindingAuthority;
      bindingId: string;
      localServerId: string;
      providerId?: string;
      runtimeAuthority?: RuntimeMcpCatalogAuthority;
    }>,
  ): Promise<void> {
    const runtime =
      input.runtimeAuthority ?? (await this.loadRuntimeAuthority(input.localServerId));
    const { binding } = input.authority;
    if (
      runtime.record.server.serverId !== input.localServerId ||
      binding.bindingId !== input.bindingId ||
      binding.localServerId !== input.localServerId ||
      (input.providerId !== undefined && binding.providerId !== input.providerId) ||
      binding.endpointRef !== runtime.record.server.endpoint ||
      binding.catalogRevision !== runtime.catalogAuthority.catalogRevision ||
      binding.catalogChecksum !== runtime.catalogAuthority.catalogChecksum ||
      binding.operationCount !== runtime.catalogAuthority.operationCount ||
      Date.parse(binding.availabilityValidUntil) <= Date.parse(this.#clock.now())
    )
      throw new McpRuntimeBindingAuthorityError(
        'MCP_PROVIDER_BINDING_NOT_CURRENT',
        'Current MCP Provider Binding authority differs from the Runtime target.',
      );
  }
}

export type McpRuntimeBindingAuthorityErrorCode =
  | 'MCP_SERVER_NOT_FOUND'
  | 'MCP_SERVER_NOT_ENABLED'
  | 'MCP_FROZEN_PROTOCOL_SNAPSHOT_REQUIRED'
  | 'MCP_PROVIDER_BINDING_NOT_CURRENT';

export class McpRuntimeBindingAuthorityError extends Error {
  constructor(
    readonly code: McpRuntimeBindingAuthorityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpRuntimeBindingAuthorityError';
  }
}
