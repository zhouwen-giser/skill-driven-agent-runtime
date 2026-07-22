import { createHash } from 'node:crypto';

import type { McpProtocolDiscoverySnapshot, McpServer, McpTool } from '../../domain/src/index.js';

export interface McpProtocolOperationsRepository {
  listServers(): Promise<readonly McpServer[]>;
  listTools(serverId: string): Promise<readonly McpTool[]>;
  findCurrentProtocolSnapshot(serverId: string): Promise<McpProtocolDiscoverySnapshot | undefined>;
}

export interface McpProviderProtocolEvidence {
  readonly server: McpServer;
  readonly currentDiscovery?: McpProtocolDiscoverySnapshot;
  readonly tools: readonly Readonly<{
    toolName: string;
    taskBehavior?: string;
    outputSchemaHash?: string;
  }>[];
  readonly notificationStatus: 'streaming_supported' | 'polling_fallback';
  readonly warnings: readonly string[];
  readonly operations: Readonly<{
    registerOrRefresh: 'frozen_registry';
    protocolDiagnosis: true;
    reconnect: 'component_required' | 'subscription_component';
    forceReconciliation: true;
    baselineAudit: true;
  }>;
}

export class McpProtocolOperationsService {
  readonly #repository: McpProtocolOperationsRepository;
  readonly #expectedBaselineSha256: string;
  readonly #notificationReconnectComposed: boolean;

  constructor(
    input: Readonly<{
      repository: McpProtocolOperationsRepository;
      expectedBaselineSha256: string;
      notificationReconnectComposed?: boolean;
    }>,
  ) {
    this.#repository = input.repository;
    this.#expectedBaselineSha256 = input.expectedBaselineSha256;
    this.#notificationReconnectComposed = input.notificationReconnectComposed ?? false;
  }

  async listProviders(): Promise<readonly McpProviderProtocolEvidence[]> {
    return Promise.all(
      (await this.#repository.listServers()).map((server) => this.inspect(server)),
    );
  }

  async diagnose(serverId: string): Promise<McpProviderProtocolEvidence> {
    const server = (await this.#repository.listServers()).find(
      (item) => item.serverId === serverId,
    );
    if (server === undefined)
      throw new McpProtocolOperationsError('MCP_SERVER_NOT_FOUND', 'MCP Server was not found.');
    return this.inspect(server);
  }

  async auditBaseline(serverId: string): Promise<
    Readonly<{
      serverId: string;
      expectedBaselineSha256: string;
      actualBaselineSha256?: string;
      passed: boolean;
    }>
  > {
    const evidence = await this.diagnose(serverId);
    const actual = evidence.currentDiscovery?.baselineSha256;
    return Object.freeze({
      serverId,
      expectedBaselineSha256: this.#expectedBaselineSha256,
      ...(actual === undefined ? {} : { actualBaselineSha256: actual }),
      passed: actual === this.#expectedBaselineSha256,
    });
  }

  private async inspect(server: McpServer): Promise<McpProviderProtocolEvidence> {
    const [currentDiscovery, tools] = await Promise.all([
      this.#repository.findCurrentProtocolSnapshot(server.serverId),
      this.#repository.listTools(server.serverId),
    ]);
    const taskNotifications = currentDiscovery?.taskNotifications === true;
    return Object.freeze({
      server,
      ...(currentDiscovery === undefined ? {} : { currentDiscovery }),
      tools: Object.freeze(
        tools.map((tool) =>
          Object.freeze({
            toolName: tool.toolName,
            ...(tool.taskExecutionProfile === undefined
              ? {}
              : { taskBehavior: tool.taskExecutionProfile.taskBehavior }),
            ...(tool.outputSchema === undefined
              ? {}
              : { outputSchemaHash: hashJson(tool.outputSchema) }),
          }),
        ),
      ),
      notificationStatus: taskNotifications ? 'streaming_supported' : 'polling_fallback',
      warnings: Object.freeze(
        taskNotifications
          ? []
          : ['Task Notifications are unavailable; polling fallback increases observation latency.'],
      ),
      operations: Object.freeze({
        registerOrRefresh: 'frozen_registry',
        protocolDiagnosis: true,
        reconnect: this.#notificationReconnectComposed
          ? 'subscription_component'
          : 'component_required',
        forceReconciliation: true,
        baselineAudit: true,
      }),
    });
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
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

export class McpProtocolOperationsError extends Error {
  readonly code: 'MCP_SERVER_NOT_FOUND';
  constructor(code: 'MCP_SERVER_NOT_FOUND', message: string) {
    super(message);
    this.name = 'McpProtocolOperationsError';
    this.code = code;
  }
}
