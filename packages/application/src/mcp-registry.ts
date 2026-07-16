import {
  createMcpServer,
  createRuntimeExecutionContext,
  LIVE_RUNTIME_EXECUTION_CONTEXT,
  createMcpTool,
  createMcpToolEnhancement,
  type McpInvocation,
  type McpInvocationOutcome,
  type McpManagementOperation,
  type McpManagementOperationType,
  type McpServer,
  type McpTool,
  type McpToolEnhancement,
  type RuntimeExecutionContext,
} from '../../domain/src/index.js';

import type {
  Clock,
  JsonSchemaValidator,
  McpRegistryRepository,
  McpTransportAdapter,
  RemoteTaskReadResult,
  SecretCipher,
} from './ports.js';
import type { McpToolEnhancer } from './mcp-tool-enhancer.js';

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
  readonly executionContext?: RuntimeExecutionContext;
}

export const SDAR_EXECUTION_MODE_HEADER = 'X-SDAR-Execution-Mode';
export const SDAR_SIMULATION_ID_HEADER = 'X-SDAR-Simulation-Id';
const RESERVED_RUNTIME_HEADERS = new Set(
  [SDAR_EXECUTION_MODE_HEADER, SDAR_SIMULATION_ID_HEADER].map((header) => header.toLowerCase()),
);

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
  readonly #enhancer: McpToolEnhancer;
  readonly #ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: McpRegistryRepository;
      transport: McpTransportAdapter;
      cipher: SecretCipher;
      schemas: JsonSchemaValidator;
      enhancer: McpToolEnhancer;
      clock: Clock;
      ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#transport = dependencies.transport;
    this.#cipher = dependencies.cipher;
    this.#schemas = dependencies.schemas;
    this.#enhancer = dependencies.enhancer;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async register(input: RegisterMcpServerInput): Promise<McpRefreshResult> {
    if ((await this.#repository.findServer(input.serverId)) !== undefined) {
      throw new McpRegistryError('MCP_SERVER_ALREADY_EXISTS', 'MCP Server already exists.');
    }
    assertNoReservedCredentialHeaders(input.credentialHeaders);
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
    const headers = sanitizedCredentialHeaders(this.#cipher.decrypt(record.encryptedCredential));
    const discoveredTools = await this.#discover(server, headers, timestamp, previous);
    const tools = discoveredTools;
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
  ): Promise<McpInvocationOutcome> {
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
    const executionContext = createRuntimeExecutionContext(
      context.executionContext ?? LIVE_RUNTIME_EXECUTION_CONTEXT,
    );
    let outcome: McpInvocationOutcome;
    try {
      outcome = await this.#transport.call({
        endpoint: record.server.endpoint,
        headers: executionHeaders(
          this.#cipher.decrypt(record.encryptedCredential),
          executionContext,
        ),
        executionContext,
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
    const invocationResult =
      outcome.kind === 'immediate' ? outcome.result : { remoteTask: outcome.task };
    const businessRejected = outcome.kind === 'immediate' && outcome.result.isError;
    await this.#repository.saveInvocation(
      invocationRecord({
        invocationId,
        context,
        serverId,
        toolName,
        arguments: arguments_,
        result: invocationResult,
        status: businessRejected ? 'failed' : 'succeeded',
        ...(businessRejected
          ? {
              errorCode: 'MCP_TOOL_BUSINESS_REJECTION',
              errorMessage: 'MCP Tool returned an immediate isError result.',
            }
          : {}),
        startedAt,
        completedAt,
      }),
    );
    return outcome;
  }

  async delete(serverId: string): Promise<void> {
    const record = await this.#requireServer(serverId);
    await this.#transport.disconnect({
      endpoint: record.server.endpoint,
      headers: sanitizedCredentialHeaders(this.#cipher.decrypt(record.encryptedCredential)),
    });
    await this.#repository.deleteServer(serverId);
    await this.#auditManagementOperation(serverId, 'delete', { disconnected: true });
  }

  async updateCredentials(
    serverId: string,
    credentialHeaders: Readonly<Record<string, string>>,
  ): Promise<void> {
    assertNoReservedCredentialHeaders(credentialHeaders);
    const record = await this.#requireServer(serverId);
    const previousHeaders = sanitizedCredentialHeaders(
      this.#cipher.decrypt(record.encryptedCredential),
    );
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
    const headers = sanitizedCredentialHeaders(this.#cipher.decrypt(record.encryptedCredential));
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

  async readRemoteTask(
    input: Readonly<{
      serverId: string;
      remoteTaskId: string;
      executionContext: RuntimeExecutionContext;
    }>,
  ): Promise<RemoteTaskReadResult> {
    try {
      const record = await this.#requireServer(input.serverId);
      const executionContext = createRuntimeExecutionContext(input.executionContext);
      const snapshot = await this.#transport.getTask({
        endpoint: record.server.endpoint,
        headers: executionHeaders(
          this.#cipher.decrypt(record.encryptedCredential),
          executionContext,
        ),
        remoteTaskId: input.remoteTaskId,
      });
      return { kind: 'snapshot', snapshot };
    } catch (error: unknown) {
      const code = stableErrorCode(error);
      if (
        code === 'MCP_TASK_RESPONSE_INVALID' ||
        code === 'MCP_TASK_RESPONSE_TOO_LARGE' ||
        code === 'MCP_TOOL_RESULT_TOO_LARGE'
      ) {
        return { kind: 'contract_invalid', errorCode: code };
      }
      if (
        code === 'MCP_TASK_CAPABILITY_REQUIRED' ||
        code === 'MCP_TASK_PROTOCOL_REVISION_UNSUPPORTED' ||
        code === 'MCP_SERVER_NOT_FOUND'
      ) {
        return { kind: 'provider_protocol', errorCode: code };
      }
      return { kind: 'provider_unreachable', errorCode: 'MCP_TASK_PROVIDER_UNREACHABLE' };
    }
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
    previous: readonly McpTool[] = [],
  ): Promise<readonly McpTool[]> {
    const discovered = await this.#transport.discover({ endpoint: server.endpoint, headers });
    const registered = discovered.map((tool) => {
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
    const previousByName = new Map(previous.map((tool) => [tool.toolName, tool]));
    return Promise.all(
      registered.map(async (tool) => {
        const existing = previousByName.get(tool.toolName)?.enhancement;
        return {
          ...tool,
          enhancement: existing ?? (await this.#enhancer.enhance(tool)),
        };
      }),
    );
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
  const executionContext = createRuntimeExecutionContext(
    input.context.executionContext ?? LIVE_RUNTIME_EXECUTION_CONTEXT,
  );
  return {
    invocationId: input.invocationId,
    ...(input.context.taskId === undefined ? {} : { taskId: input.context.taskId }),
    ...(input.context.contextId === undefined ? {} : { contextId: input.context.contextId }),
    executionMode: executionContext.mode,
    ...(executionContext.simulationId === undefined
      ? {}
      : { simulationId: executionContext.simulationId }),
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

function assertNoReservedCredentialHeaders(headers: Readonly<Record<string, string>>): void {
  const conflict = Object.keys(headers).find((header) =>
    RESERVED_RUNTIME_HEADERS.has(header.toLowerCase()),
  );
  if (conflict !== undefined)
    throw new McpRegistryError(
      'MCP_RESERVED_HEADER_CONFLICT',
      `Credential Header ${conflict} is reserved for runtime execution isolation.`,
    );
}

function sanitizedCredentialHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([header]) => !RESERVED_RUNTIME_HEADERS.has(header.toLowerCase()),
    ),
  );
}

function executionHeaders(
  credentials: Readonly<Record<string, string>>,
  context: RuntimeExecutionContext,
): Readonly<Record<string, string>> {
  const headers = { ...sanitizedCredentialHeaders(credentials) };
  if (context.mode === 'live') return headers;
  return {
    ...headers,
    [SDAR_EXECUTION_MODE_HEADER]: context.mode,
    [SDAR_SIMULATION_ID_HEADER]: context.simulationId ?? '',
  };
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

function stableErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export type McpRegistryErrorCode =
  | 'MCP_ARGUMENT_SCHEMA_MISMATCH'
  | 'MCP_SERVER_ALREADY_EXISTS'
  | 'MCP_SERVER_NOT_FOUND'
  | 'MCP_RESERVED_HEADER_CONFLICT'
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
