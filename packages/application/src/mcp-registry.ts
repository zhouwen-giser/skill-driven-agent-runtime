import {
  createMcpServer,
  createMcpTool,
  createMcpToolEnhancement,
  type McpInvocation,
  type McpManagementOperation,
  type McpManagementOperationType,
  type McpServer,
  type McpTool,
  type McpToolEnhancement,
} from '../../domain/src/index.js';

import type {
  Clock,
  JsonSchemaValidator,
  McpRegistryRepository,
  McpTransportAdapter,
  SecretCipher,
} from './ports.js';

export interface RegisterMcpServerInput {
  readonly serverId: string;
  readonly name: string;
  readonly endpoint: string;
  readonly credentialHeaders: Readonly<Record<string, string>>;
}

export interface McpRefreshResult {
  readonly server: McpServer;
  readonly tools: readonly McpTool[];
  readonly dependencyWarnings: readonly Readonly<{
    toolName: string;
    reason: 'removed' | 'schema_changed';
  }>[];
}

export interface McpCallContext {
  readonly taskId?: string;
  readonly contextId?: string;
}

export interface McpHealthResult {
  readonly serverId: string;
  readonly status: 'enabled' | 'unreachable';
  readonly checkedAt: string;
  readonly durationMs: number;
  readonly errorCode?: 'MCP_HEALTH_CHECK_FAILED';
}

export class McpRegistryService {
  readonly #repository: McpRegistryRepository;
  readonly #transport: McpTransportAdapter;
  readonly #cipher: SecretCipher;
  readonly #schemas: JsonSchemaValidator;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: McpRegistryRepository;
      transport: McpTransportAdapter;
      cipher: SecretCipher;
      schemas: JsonSchemaValidator;
      clock: Clock;
      ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#transport = dependencies.transport;
    this.#cipher = dependencies.cipher;
    this.#schemas = dependencies.schemas;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async register(input: RegisterMcpServerInput): Promise<McpRefreshResult> {
    if ((await this.#repository.findServer(input.serverId)) !== undefined) {
      throw new McpRegistryError('MCP_SERVER_ALREADY_EXISTS', 'MCP Server already exists.');
    }
    const timestamp = this.#clock.now();
    const server = createMcpServer({
      serverId: input.serverId,
      name: input.name,
      endpoint: input.endpoint,
      transport: 'streamable_http',
      status: 'enabled',
      toolRevision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const encryptedCredential = this.#cipher.encrypt(input.credentialHeaders);
    const tools = await this.#discover(server, input.credentialHeaders, timestamp);
    await this.#repository.saveServerAndReplaceTools({ server, encryptedCredential }, tools);
    await this.#auditManagementOperation(server.serverId, 'register', {
      toolRevision: server.toolRevision,
      discoveredToolCount: tools.length,
    });
    return { server, tools, dependencyWarnings: [] };
  }

  async refresh(serverId: string): Promise<McpRefreshResult> {
    const record = await this.#requireServer(serverId);
    const previous = await this.#repository.listTools(serverId);
    const timestamp = this.#clock.now();
    const server = createMcpServer({
      ...record.server,
      toolRevision: record.server.toolRevision + 1,
      status: 'enabled',
      updatedAt: timestamp,
    });
    const headers = this.#cipher.decrypt(record.encryptedCredential);
    const discoveredTools = await this.#discover(server, headers, timestamp);
    const previousByName = new Map(previous.map((tool) => [tool.toolName, tool]));
    const tools = discoveredTools.map((tool) => {
      const enhancement = previousByName.get(tool.toolName)?.enhancement;
      return enhancement === undefined ? tool : { ...tool, enhancement };
    });
    const dependencyWarnings = compareTools(previous, tools);
    await this.#repository.saveServerAndReplaceTools(
      { server, encryptedCredential: record.encryptedCredential },
      tools,
      dependencyWarnings,
    );
    await this.#auditManagementOperation(serverId, 'refresh', {
      toolRevision: server.toolRevision,
      discoveredToolCount: tools.length,
      dependencyWarningCount: dependencyWarnings.length,
    });
    return { server, tools, dependencyWarnings };
  }

  async call(
    serverId: string,
    toolName: string,
    arguments_: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
    context: McpCallContext = {},
  ): Promise<unknown> {
    const record = await this.#requireServer(serverId);
    const tool = (await this.#repository.listTools(serverId)).find(
      (item) => item.toolName === toolName,
    );
    if (tool === undefined)
      throw new McpRegistryError('MCP_TOOL_NOT_FOUND', 'MCP Tool was not found.');
    const validation = this.#schemas.validate(tool.inputSchema, arguments_);
    if (!validation.valid) {
      throw new McpRegistryError(
        'MCP_ARGUMENT_SCHEMA_MISMATCH',
        'Arguments violate the original MCP Tool schema.',
        validation.errors,
      );
    }
    const invocationId = this.#ids.nextInvocationId();
    const startedAt = this.#clock.now();
    let result: unknown;
    try {
      result = await this.#transport.call({
        endpoint: record.server.endpoint,
        headers: this.#cipher.decrypt(record.encryptedCredential),
        toolName,
        arguments: arguments_,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      const completedAt = this.#clock.now();
      const canceled = signal?.aborted === true;
      await this.#repository.saveInvocation(
        invocationRecord({
          invocationId,
          context,
          serverId,
          toolName,
          arguments: arguments_,
          status: canceled ? 'canceled' : 'failed',
          errorCode: canceled ? 'MCP_CALL_CANCELED' : 'MCP_CALL_FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown MCP call failure.',
          startedAt,
          completedAt,
        }),
      );
      throw error;
    }
    const completedAt = this.#clock.now();
    await this.#repository.saveInvocation(
      invocationRecord({
        invocationId,
        context,
        serverId,
        toolName,
        arguments: arguments_,
        result,
        status: 'succeeded',
        startedAt,
        completedAt,
      }),
    );
    return result;
  }

  async delete(serverId: string): Promise<void> {
    const record = await this.#requireServer(serverId);
    await this.#transport.disconnect({
      endpoint: record.server.endpoint,
      headers: this.#cipher.decrypt(record.encryptedCredential),
    });
    await this.#repository.deleteServer(serverId);
    await this.#auditManagementOperation(serverId, 'delete', { disconnected: true });
  }

  async updateCredentials(
    serverId: string,
    credentialHeaders: Readonly<Record<string, string>>,
  ): Promise<void> {
    const record = await this.#requireServer(serverId);
    const previousHeaders = this.#cipher.decrypt(record.encryptedCredential);
    await this.#transport.ping({ endpoint: record.server.endpoint, headers: credentialHeaders });
    const tools = await this.#repository.listTools(serverId);
    await this.#transport.disconnect({
      endpoint: record.server.endpoint,
      headers: previousHeaders,
    });
    await this.#repository.saveServerAndReplaceTools(
      { ...record, encryptedCredential: this.#cipher.encrypt(credentialHeaders) },
      tools,
    );
    await this.#auditManagementOperation(serverId, 'credentials_update', {
      headerNames: Object.keys(credentialHeaders).sort(),
    });
  }

  async checkHealth(serverId: string): Promise<McpHealthResult> {
    const record = await this.#requireServer(serverId);
    const headers = this.#cipher.decrypt(record.encryptedCredential);
    const startedAt = this.#clock.now();
    let status: McpHealthResult['status'] = 'enabled';
    let errorCode: McpHealthResult['errorCode'];
    try {
      await this.#transport.ping({ endpoint: record.server.endpoint, headers });
    } catch {
      status = 'unreachable';
      errorCode = 'MCP_HEALTH_CHECK_FAILED';
    }
    const checkedAt = this.#clock.now();
    const server = createMcpServer({ ...record.server, status, updatedAt: checkedAt });
    await this.#repository.saveServerAndReplaceTools(
      { server, encryptedCredential: record.encryptedCredential },
      await this.#repository.listTools(serverId),
    );
    await this.#auditManagementOperation(serverId, 'health_check', {
      status,
      durationMs: elapsedMilliseconds(startedAt, checkedAt),
    });
    return {
      serverId,
      status,
      checkedAt,
      durationMs: elapsedMilliseconds(startedAt, checkedAt),
      ...(errorCode === undefined ? {} : { errorCode }),
    };
  }

  listInvocations(serverId: string) {
    return this.#repository.listInvocations(serverId);
  }

  listInvocationsByTask(taskId: string) {
    return this.#repository.listInvocationsByTask(taskId);
  }

  listManagementOperations(serverId: string) {
    return this.#repository.listManagementOperations(serverId);
  }

  listServers() {
    return this.#repository.listServers();
  }

  listTools(serverId: string) {
    return this.#repository.listTools(serverId);
  }

  listDependencyWarnings(serverId: string) {
    return this.#repository.listDependencyWarnings(serverId);
  }

  async updateToolEnhancement(
    serverId: string,
    toolName: string,
    enhancement: McpToolEnhancement,
  ): Promise<void> {
    await this.#requireServer(serverId);
    if (!(await this.#repository.listTools(serverId)).some((tool) => tool.toolName === toolName)) {
      throw new McpRegistryError('MCP_TOOL_NOT_FOUND', 'MCP Tool was not found.');
    }
    await this.#repository.updateToolEnhancement(
      serverId,
      toolName,
      createMcpToolEnhancement(enhancement),
    );
    await this.#auditManagementOperation(
      serverId,
      'tool_metadata_update',
      { tags: enhancement.tags, scenarioCount: enhancement.scenarios.length },
      toolName,
    );
  }

  async #auditManagementOperation(
    serverId: string,
    operationType: McpManagementOperationType,
    summary: Readonly<Record<string, unknown>>,
    target?: string,
  ): Promise<void> {
    const operation: McpManagementOperation = {
      operationId: this.#ids.nextManagementOperationId(),
      serverId,
      operationType,
      actor: 'anonymous-management',
      ...(target === undefined ? {} : { target }),
      summary,
      occurredAt: this.#clock.now(),
    };
    await this.#repository.saveManagementOperation(operation);
  }

  async #discover(
    server: McpServer,
    headers: Readonly<Record<string, string>>,
    timestamp: string,
  ): Promise<readonly McpTool[]> {
    const discovered = await this.#transport.discover({ endpoint: server.endpoint, headers });
    return discovered.map((tool) => {
      const schema = this.#schemas.checkSchema(tool.inputSchema);
      if (!schema.valid) {
        throw new McpRegistryError(
          'MCP_TOOL_SCHEMA_INVALID',
          `Tool ${tool.name} has an invalid input schema.`,
          schema.errors,
        );
      }
      return createMcpTool({
        serverId: server.serverId,
        toolName: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema,
        discoveredAt: timestamp,
      });
    });
  }

  async #requireServer(serverId: string) {
    const record = await this.#repository.findServer(serverId);
    if (record === undefined)
      throw new McpRegistryError('MCP_SERVER_NOT_FOUND', 'MCP Server was not found.');
    return record;
  }
}

function invocationRecord(
  input: Readonly<{
    invocationId: string;
    context: McpCallContext;
    serverId: string;
    toolName: string;
    arguments: Readonly<Record<string, unknown>>;
    result?: unknown;
    status: McpInvocation['status'];
    errorCode?: string;
    errorMessage?: string;
    startedAt: string;
    completedAt: string;
  }>,
): McpInvocation {
  const duration = elapsedMilliseconds(input.startedAt, input.completedAt);
  return {
    invocationId: input.invocationId,
    ...input.context,
    serverId: input.serverId,
    toolName: input.toolName,
    arguments: input.arguments,
    ...(input.result === undefined ? {} : { result: input.result }),
    status: input.status,
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: duration,
  };
}

function elapsedMilliseconds(startedAt: string, completedAt: string): number {
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function compareTools(
  previous: readonly McpTool[],
  current: readonly McpTool[],
): McpRefreshResult['dependencyWarnings'] {
  const currentByName = new Map(current.map((tool) => [tool.toolName, tool]));
  const warnings: { toolName: string; reason: 'removed' | 'schema_changed' }[] = [];
  for (const tool of previous) {
    const next = currentByName.get(tool.toolName);
    if (next === undefined) warnings.push({ toolName: tool.toolName, reason: 'removed' });
    else if (JSON.stringify(tool.inputSchema) !== JSON.stringify(next.inputSchema)) {
      warnings.push({ toolName: tool.toolName, reason: 'schema_changed' });
    }
  }
  return warnings;
}

export type McpRegistryErrorCode =
  | 'MCP_ARGUMENT_SCHEMA_MISMATCH'
  | 'MCP_SERVER_ALREADY_EXISTS'
  | 'MCP_SERVER_NOT_FOUND'
  | 'MCP_TOOL_NOT_FOUND'
  | 'MCP_TOOL_SCHEMA_INVALID';

export class McpRegistryError extends Error {
  readonly code: McpRegistryErrorCode;
  readonly details: readonly string[];
  constructor(code: McpRegistryErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'McpRegistryError';
    this.code = code;
    this.details = details;
  }
}
