import {
  createMcpServer,
  deriveFrozenMcpCatalogAuthority,
  withMcpToolAdminExecutionSemanticsOverride,
  type McpDependencyWarningReason,
  type McpProtocolDiscoverySnapshot,
  type McpServer,
  type McpTool,
  type McpToolDependencyChange,
} from '../../domain/src/index.js';

import type {
  Clock,
  CurrentMcpProviderBindingAuthorityPort,
  McpServerRecord,
  SecretCipher,
} from './ports.js';

export interface FrozenMcpDiscoveryPort {
  discover(
    input: Readonly<{
      server: McpServer;
      headers: Readonly<Record<string, string>>;
      snapshotId: string;
      baselineSha256: string;
      discoveredAt: string;
    }>,
  ): Promise<
    Readonly<{
      snapshot: McpProtocolDiscoverySnapshot;
      tools: readonly McpTool[];
    }>
  >;
}

export interface FrozenMcpRegistryRepository {
  findServer(serverId: string): Promise<McpServerRecord | undefined>;
  listTools(serverId: string): Promise<readonly McpTool[]>;
  findCurrentProtocolSnapshot?(serverId: string): Promise<McpProtocolDiscoverySnapshot | undefined>;
  replaceEncryptedCredential(
    serverId: string,
    encryptedCredential: string,
    updatedAt: string,
  ): Promise<boolean>;
  saveFrozenServerAndReplaceTools(
    record: McpServerRecord,
    tools: readonly McpTool[],
    snapshot: McpProtocolDiscoverySnapshot,
    changes?: readonly McpToolDependencyChange[],
  ): Promise<void>;
}

export interface FrozenMcpRegistrationInput {
  readonly serverId: string;
  readonly name: string;
  readonly endpoint: string;
  readonly credentialHeaders: Readonly<Record<string, string>>;
}

export interface FrozenMcpRefreshResult {
  readonly server: McpServer;
  readonly snapshot: McpProtocolDiscoverySnapshot;
  readonly tools: readonly McpTool[];
  readonly dependencyWarnings: readonly McpToolDependencyChange[];
}

export class FrozenMcpRegistryService {
  readonly #repository: FrozenMcpRegistryRepository;
  readonly #discovery: FrozenMcpDiscoveryPort;
  readonly #cipher: SecretCipher;
  readonly #clock: Clock;
  readonly #nextSnapshotId: () => string;
  readonly #baselineSha256: string;
  #refreshTail: Promise<void> = Promise.resolve();

  constructor(
    input: Readonly<{
      repository: FrozenMcpRegistryRepository;
      discovery: FrozenMcpDiscoveryPort;
      cipher: SecretCipher;
      clock: Clock;
      nextSnapshotId: () => string;
      baselineSha256: string;
    }>,
  ) {
    this.#repository = input.repository;
    this.#discovery = input.discovery;
    this.#cipher = input.cipher;
    this.#clock = input.clock;
    this.#nextSnapshotId = input.nextSnapshotId;
    this.#baselineSha256 = input.baselineSha256;
  }

  async register(input: FrozenMcpRegistrationInput): Promise<FrozenMcpRefreshResult> {
    if ((await this.#repository.findServer(input.serverId)) !== undefined)
      throw registryError('MCP_SERVER_ALREADY_EXISTS', 'MCP Server already exists.');
    assertCredentialHeaders(input.credentialHeaders);
    const timestamp = this.#clock.now();
    const server = createMcpServer({
      serverId: input.serverId,
      name: input.name,
      endpoint: input.endpoint,
      transport: 'streamable_http',
      status: 'enabled',
      toolRevision: 1,
      protocolMode: 'frozen_v1',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const discovered = await this.#discover(server, input.credentialHeaders, timestamp);
    const persistedServer = createMcpServer({
      ...server,
      currentProtocolSnapshotId: discovered.snapshot.snapshotId,
    });
    await this.#repository.saveFrozenServerAndReplaceTools(
      {
        server: persistedServer,
        encryptedCredential: this.#cipher.encrypt(input.credentialHeaders),
      },
      discovered.tools,
      discovered.snapshot,
    );
    return Object.freeze({
      server: persistedServer,
      snapshot: discovered.snapshot,
      tools: discovered.tools,
      dependencyWarnings: Object.freeze([]),
    });
  }

  refresh(serverId: string): Promise<FrozenMcpRefreshResult> {
    return this.#serializeRefresh(() => this.#refresh(serverId));
  }

  /** Materialize a new registered semantic revision; health never mutates Runtime anchors. */
  reconcileProviderBinding(
    authority: Awaited<
      ReturnType<CurrentMcpProviderBindingAuthorityPort['loadCurrentMcpProviderBinding']>
    >,
  ): Promise<FrozenMcpRefreshResult> {
    return this.#serializeRefresh(() => this.#refresh(authority.binding.localServerId, authority));
  }

  #serializeRefresh(work: () => Promise<FrozenMcpRefreshResult>): Promise<FrozenMcpRefreshResult> {
    const result = this.#refreshTail.then(work);
    this.#refreshTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #refresh(
    serverId: string,
    authority?: Awaited<
      ReturnType<CurrentMcpProviderBindingAuthorityPort['loadCurrentMcpProviderBinding']>
    >,
  ): Promise<FrozenMcpRefreshResult> {
    const record = await this.#repository.findServer(serverId);
    if (record === undefined)
      throw registryError('MCP_SERVER_NOT_FOUND', 'MCP Server was not found.');
    if (record.server.protocolMode !== 'frozen_v1')
      throw registryError(
        'MCP_PROTOCOL_MODE_MISMATCH',
        'Provider identity does not use the Frozen MCP Tasks V1 contract.',
      );
    const [previous, previousSnapshot] = await Promise.all([
      this.#repository.listTools(serverId),
      this.#repository.findCurrentProtocolSnapshot?.(serverId),
    ]);
    const previousCatalog =
      previousSnapshot === undefined
        ? undefined
        : deriveFrozenMcpCatalogAuthority(previousSnapshot, previous, record.server.toolRevision);
    if (
      authority !== undefined &&
      (authority.binding.localServerId !== serverId ||
        authority.binding.endpointRef !== record.server.endpoint ||
        authority.binding.revision < record.server.toolRevision)
    )
      throw registryError(
        'MCP_PROVIDER_BINDING_CONFLICT',
        'Registered Provider authority conflicts with the Runtime target.',
      );
    if (
      authority !== undefined &&
      previousSnapshot !== undefined &&
      previousCatalog?.catalogChecksum === authority.binding.catalogChecksum &&
      previousCatalog.catalogRevision === authority.binding.catalogRevision &&
      previousCatalog.operationCount === authority.binding.operationCount &&
      record.server.toolRevision === authority.binding.revision
    )
      return Object.freeze({
        server: record.server,
        snapshot: previousSnapshot,
        tools: previous,
        dependencyWarnings: Object.freeze([]),
      });
    const timestamp = this.#clock.now();
    const server = createMcpServer({
      ...record.server,
      toolRevision: authority?.binding.revision ?? record.server.toolRevision,
      updatedAt: timestamp,
    });
    const headers = this.#cipher.decrypt(record.encryptedCredential);
    const discovered = await this.#discover(server, headers, timestamp);
    const tools = retainAdminExecutionSemanticsOverrides(previous, discovered.tools);
    const discoveredCatalog = deriveFrozenMcpCatalogAuthority(
      discovered.snapshot,
      tools,
      server.toolRevision,
    );
    if (
      authority !== undefined &&
      (discoveredCatalog.catalogChecksum !== authority.binding.catalogChecksum ||
        discoveredCatalog.catalogRevision !== authority.binding.catalogRevision ||
        discoveredCatalog.operationCount !== authority.binding.operationCount)
    )
      throw registryError(
        'MCP_PROVIDER_BINDING_CONFLICT',
        'Discovery differs from the registered semantic Catalog.',
      );
    if (
      authority === undefined &&
      previousSnapshot !== undefined &&
      previousCatalog?.catalogChecksum === discoveredCatalog.catalogChecksum
    )
      return Object.freeze({
        server: record.server,
        // A health refresh must not rotate the persisted Frozen Task anchor when
        // the Catalog is unchanged. Its response still carries the just-observed
        // discovery so callers can prove current liveness without mistaking the
        // historical persisted snapshot for a fresh observation.
        snapshot: discovered.snapshot,
        tools,
        dependencyWarnings: Object.freeze([]),
      });
    const toolRevision = authority?.binding.revision ?? record.server.toolRevision + 1;
    const snapshot = Object.freeze({ ...discovered.snapshot, toolRevision });
    const persistedServer = createMcpServer({
      ...server,
      toolRevision,
      currentProtocolSnapshotId: snapshot.snapshotId,
    });
    const changes = compareTools(previous, tools);
    await this.#repository.saveFrozenServerAndReplaceTools(
      { ...record, server: persistedServer },
      tools,
      snapshot,
      changes,
    );
    return Object.freeze({
      server: persistedServer,
      snapshot,
      tools,
      dependencyWarnings: changes,
    });
  }

  async replaceCredentials(
    serverId: string,
    credentialHeaders: Readonly<Record<string, string>>,
  ): Promise<void> {
    assertCredentialHeaders(credentialHeaders);
    const updated = await this.#repository.replaceEncryptedCredential(
      serverId,
      this.#cipher.encrypt(credentialHeaders),
      this.#clock.now(),
    );
    if (!updated) throw registryError('MCP_SERVER_NOT_FOUND', 'MCP Server was not found.');
  }

  async #discover(
    server: McpServer,
    headers: Readonly<Record<string, string>>,
    discoveredAt: string,
  ) {
    return this.#discovery.discover({
      server,
      headers,
      snapshotId: this.#nextSnapshotId(),
      baselineSha256: this.#baselineSha256,
      discoveredAt,
    });
  }
}

function retainAdminExecutionSemanticsOverrides(
  previous: readonly McpTool[],
  discovered: readonly McpTool[],
): readonly McpTool[] {
  const previousByName = new Map(previous.map((tool) => [tool.toolName, tool] as const));
  return Object.freeze(
    discovered.map((tool) => {
      const adminOverride = previousByName.get(tool.toolName)?.adminExecutionSemanticsOverride;
      return adminOverride === undefined
        ? tool
        : withMcpToolAdminExecutionSemanticsOverride(tool, adminOverride);
    }),
  );
}

function compareTools(
  previous: readonly McpTool[],
  current: readonly McpTool[],
): readonly McpToolDependencyChange[] {
  const currentByName = new Map(current.map((tool) => [tool.toolName, tool] as const));
  return Object.freeze(
    previous.flatMap((tool): readonly McpToolDependencyChange[] => {
      const next = currentByName.get(tool.toolName);
      const reason: McpDependencyWarningReason | undefined =
        next === undefined
          ? 'removed'
          : stableStringify([tool.inputSchema, tool.outputSchema, tool.taskExecutionProfile]) ===
              stableStringify([next.inputSchema, next.outputSchema, next.taskExecutionProfile])
            ? undefined
            : 'schema_changed';
      return reason === undefined ? [] : [{ toolName: tool.toolName, reason }];
    }),
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertCredentialHeaders(headers: Readonly<Record<string, string>>): void {
  for (const name of Object.keys(headers))
    if (['x-sdar-execution-mode', 'x-sdar-simulation-id'].includes(name.toLowerCase()))
      throw registryError(
        'MCP_RESERVED_HEADER_FORBIDDEN',
        'Execution-control headers cannot be stored as Provider credentials.',
      );
}

export type FrozenMcpRegistryErrorCode =
  | 'MCP_SERVER_ALREADY_EXISTS'
  | 'MCP_SERVER_NOT_FOUND'
  | 'MCP_PROTOCOL_MODE_MISMATCH'
  | 'MCP_PROVIDER_BINDING_CONFLICT'
  | 'MCP_RESERVED_HEADER_FORBIDDEN';

export class FrozenMcpRegistryError extends Error {
  readonly code: FrozenMcpRegistryErrorCode;
  constructor(code: FrozenMcpRegistryErrorCode, message: string) {
    super(message);
    this.name = 'FrozenMcpRegistryError';
    this.code = code;
  }
}

function registryError(code: FrozenMcpRegistryErrorCode, message: string) {
  return new FrozenMcpRegistryError(code, message);
}
