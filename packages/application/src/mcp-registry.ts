import {
  createMcpServer,
  createRuntimeExecutionContext,
  LIVE_RUNTIME_EXECUTION_CONTEXT,
  createMcpTool,
  createMcpToolExecutionSemantics,
  withMcpToolAdminExecutionSemanticsOverride,
  createMcpToolEnhancement,
  type McpInvocation,
  type McpInvocationOutcome,
  type McpProtocolContractSnapshot,
  type McpTaskBehavior,
  type RemoteTaskOperationAck,
  type RemoteTaskSnapshot,
  type McpManagementOperation,
  type McpManagementOperationType,
  type McpServer,
  type McpTool,
  type McpToolEnhancement,
  type McpToolExecutionSemanticsValues,
  type RuntimeExecutionContext,
  type ResolvedMcpTaskExecution,
  type TaskAvailabilityReadResult,
  type TaskAvailabilityCheckRequest,
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
  readonly taskExecution?: ResolvedMcpTaskExecution;
}

export interface RecordedMcpInvocationOutcome {
  readonly invocationId: string;
  readonly outcome: McpInvocationOutcome;
  readonly credentialRevision: string;
  readonly sessionRevision: string;
  readonly protocolContract?: McpProtocolContractSnapshot;
  readonly taskBehavior?: McpTaskBehavior;
}

export interface FrozenTaskAvailabilityRuntimePort {
  check(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      requests: readonly TaskAvailabilityCheckRequest[];
      signal?: AbortSignal;
    }>,
  ): Promise<TaskAvailabilityReadResult>;
}

export interface FrozenTaskLifecycleRuntimePort {
  disconnect?(
    input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>,
  ): void;
  call(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      toolName: string;
      arguments: Readonly<Record<string, unknown>>;
      outputSchema?: unknown;
      outputValidator: JsonSchemaValidator;
      signal?: AbortSignal;
    }>,
  ): Promise<McpInvocationOutcome>;
  get(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      remoteTaskId: string;
      outputSchema?: unknown;
      outputValidator: JsonSchemaValidator;
    }>,
  ): Promise<RemoteTaskSnapshot>;
  update(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      remoteTaskId: string;
      inputResponses: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<RemoteTaskOperationAck>;
  cancel(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      remoteTaskId: string;
    }>,
  ): Promise<RemoteTaskOperationAck>;
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
  readonly #frozenAvailability: FrozenTaskAvailabilityRuntimePort | undefined;
  readonly #frozenLifecycle: FrozenTaskLifecycleRuntimePort | undefined;
  readonly #ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: McpRegistryRepository;
      transport: McpTransportAdapter;
      cipher: SecretCipher;
      schemas: JsonSchemaValidator;
      enhancer: McpToolEnhancer;
      frozenAvailability?: FrozenTaskAvailabilityRuntimePort;
      frozenLifecycle?: FrozenTaskLifecycleRuntimePort;
      clock: Clock;
      ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#transport = dependencies.transport;
    this.#cipher = dependencies.cipher;
    this.#schemas = dependencies.schemas;
    this.#enhancer = dependencies.enhancer;
    this.#frozenAvailability = dependencies.frozenAvailability;
    this.#frozenLifecycle = dependencies.frozenLifecycle;
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
    return (await this.callDetailed(serverId, toolName, arguments_, signal, context)).outcome;
  }

  async callDetailed(
    serverId: string,
    toolName: string,
    arguments_: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
    context: McpCallContext = {},
  ): Promise<RecordedMcpInvocationOutcome> {
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
      if (record.server.protocolMode === 'frozen_v1') {
        if (this.#frozenLifecycle === undefined)
          throw new McpRegistryError(
            'MCP_FROZEN_RUNTIME_UNAVAILABLE',
            'Frozen MCP lifecycle runtime is not composed.',
          );
        outcome = await this.#frozenLifecycle.call({
          endpoint: record.server.endpoint,
          headers: this.#cipher.decrypt(record.encryptedCredential),
          toolName,
          arguments: arguments_,
          outputValidator: this.#schemas,
          ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
          ...(signal === undefined ? {} : { signal }),
        });
      } else
        outcome = await this.#transport.call({
          endpoint: record.server.endpoint,
          headers: executionHeaders(
            this.#cipher.decrypt(record.encryptedCredential),
            executionContext,
          ),
          executionContext,
          toolName,
          arguments: arguments_,
          ...(context.taskExecution === undefined ? {} : { taskExecution: context.taskExecution }),
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
          executionSemantics: tool.executionSemantics,
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
        executionSemantics: tool.executionSemantics,
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
    return {
      invocationId,
      outcome,
      credentialRevision: record.server.updatedAt,
      sessionRevision:
        outcome.kind === 'remote_task'
          ? `${outcome.task.protocolRevision}/${outcome.task.tasksSchemaRevision}`
          : String(record.server.toolRevision),
      ...(record.server.protocolMode !== 'frozen_v1'
        ? {}
        : await this.#frozenInvocationAuthority(serverId, tool)),
    };
  }

  async #frozenInvocationAuthority(
    serverId: string,
    tool: McpTool,
  ): Promise<
    Readonly<{ protocolContract: McpProtocolContractSnapshot; taskBehavior: McpTaskBehavior }>
  > {
    const snapshot = await this.#repository.findCurrentProtocolSnapshot?.(serverId);
    if (snapshot?.protocolMode !== 'frozen_v1')
      throw new McpRegistryError(
        'MCP_FROZEN_PROTOCOL_SNAPSHOT_REQUIRED',
        'Frozen MCP invocation requires its persisted discovery snapshot.',
      );
    if (tool.protocolMode !== 'frozen_v1' || tool.taskExecutionProfile === undefined)
      throw new McpRegistryError(
        'MCP_FROZEN_TOOL_PROFILE_REQUIRED',
        'Frozen MCP invocation requires its persisted Tool execution profile.',
      );
    return {
      protocolContract: Object.freeze({
        mode: 'frozen_v1',
        protocolVersion: snapshot.protocolVersion,
        baselineSha256: snapshot.baselineSha256,
        taskExecutionProfileVersion: tool.taskExecutionProfile.profileVersion,
        evidenceProfileVersion: '1.0',
        serverDiscoverySnapshotId: snapshot.snapshotId,
      }),
      taskBehavior: tool.taskExecutionProfile.taskBehavior,
    };
  }

  async delete(serverId: string): Promise<void> {
    const record = await this.#requireServer(serverId);
    const headers = sanitizedCredentialHeaders(this.#cipher.decrypt(record.encryptedCredential));
    if (record.server.protocolMode === 'frozen_v1')
      this.#frozenLifecycle?.disconnect?.({ endpoint: record.server.endpoint, headers });
    else await this.#transport.disconnect({ endpoint: record.server.endpoint, headers });
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
      operationName: string;
      remoteTaskId: string;
      executionContext: RuntimeExecutionContext;
    }>,
  ): Promise<RemoteTaskReadResult> {
    try {
      const record = await this.#requireServer(input.serverId);
      const executionContext = createRuntimeExecutionContext(input.executionContext);
      const tool = (await this.#repository.listTools(input.serverId)).find(
        (candidate) => candidate.toolName === input.operationName,
      );
      if (tool === undefined)
        throw new McpRegistryError('MCP_TOOL_NOT_FOUND', 'MCP Tool was not found.');
      const snapshot =
        record.server.protocolMode === 'frozen_v1'
          ? await this.#requireFrozenLifecycle().get({
              endpoint: record.server.endpoint,
              headers: this.#cipher.decrypt(record.encryptedCredential),
              remoteTaskId: input.remoteTaskId,
              outputValidator: this.#schemas,
              ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
            })
          : await this.#transport.getTask({
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

  async cancelRemoteTask(
    input: Readonly<{
      serverId: string;
      remoteTaskId: string;
      executionContext: RuntimeExecutionContext;
      signal?: AbortSignal;
    }>,
  ): Promise<RemoteTaskOperationAck> {
    const record = await this.#requireServer(input.serverId);
    const executionContext = createRuntimeExecutionContext(input.executionContext);
    if (record.server.protocolMode === 'frozen_v1')
      return this.#requireFrozenLifecycle().cancel({
        endpoint: record.server.endpoint,
        headers: this.#cipher.decrypt(record.encryptedCredential),
        remoteTaskId: input.remoteTaskId,
      });
    return this.#transport.cancelTask({
      endpoint: record.server.endpoint,
      headers: executionHeaders(this.#cipher.decrypt(record.encryptedCredential), executionContext),
      remoteTaskId: input.remoteTaskId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }

  async updateRemoteTask(
    input: Readonly<{
      serverId: string;
      remoteTaskId: string;
      inputResponses: Readonly<Record<string, unknown>>;
      executionContext: RuntimeExecutionContext;
      signal?: AbortSignal;
    }>,
  ): Promise<RemoteTaskOperationAck> {
    const record = await this.#requireServer(input.serverId);
    const executionContext = createRuntimeExecutionContext(input.executionContext);
    if (record.server.protocolMode === 'frozen_v1')
      return this.#requireFrozenLifecycle().update({
        endpoint: record.server.endpoint,
        headers: this.#cipher.decrypt(record.encryptedCredential),
        remoteTaskId: input.remoteTaskId,
        inputResponses: input.inputResponses,
      });
    return this.#transport.updateTask({
      endpoint: record.server.endpoint,
      headers: executionHeaders(this.#cipher.decrypt(record.encryptedCredential), executionContext),
      remoteTaskId: input.remoteTaskId,
      inputResponses: input.inputResponses,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }

  async checkTaskAvailability(
    input: Readonly<{
      serverId: string;
      requests: readonly TaskAvailabilityCheckRequest[];
      executionContext: RuntimeExecutionContext;
      signal?: AbortSignal;
    }>,
  ): Promise<TaskAvailabilityReadResult> {
    try {
      const record = await this.#requireServer(input.serverId);
      if (record.server.protocolMode === 'frozen_v1') {
        if (this.#frozenAvailability === undefined)
          return {
            kind: 'capability_missing',
            errorCode: 'MCP_TASK_AVAILABILITY_CAPABILITY_REQUIRED',
          };
        return await this.#frozenAvailability.check({
          endpoint: record.server.endpoint,
          headers: this.#cipher.decrypt(record.encryptedCredential),
          requests: input.requests,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
      }
      if (this.#transport.checkTaskAvailability === undefined)
        return {
          kind: 'capability_missing',
          errorCode: 'MCP_TASK_AVAILABILITY_CAPABILITY_REQUIRED',
        };
      const executionContext = createRuntimeExecutionContext(input.executionContext);
      const response = await this.#transport.checkTaskAvailability({
        endpoint: record.server.endpoint,
        headers: executionHeaders(
          this.#cipher.decrypt(record.encryptedCredential),
          executionContext,
        ),
        requests: input.requests,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      return { kind: 'results', ...response };
    } catch (error: unknown) {
      const code = stableErrorCode(error);
      if (
        code === 'MCP_TASK_AVAILABILITY_RESPONSE_INVALID' ||
        code === 'MCP_TASK_AVAILABILITY_RESPONSE_TOO_LARGE' ||
        code === 'MCP_TASK_AVAILABILITY_RESERVATION_INVALID'
      )
        return { kind: 'contract_invalid', errorCode: code };
      if (code === 'MCP_TASK_CAPABILITY_REQUIRED')
        return { kind: 'capability_missing', errorCode: code };
      if (code === 'MCP_TASK_PROTOCOL_REVISION_UNSUPPORTED' || code === 'MCP_SERVER_NOT_FOUND')
        return { kind: 'provider_protocol', errorCode: code };
      return {
        kind: 'provider_unreachable',
        errorCode: 'MCP_TASK_AVAILABILITY_PROVIDER_UNREACHABLE',
      };
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

  async updateToolExecutionSemantics(
    serverId: string,
    toolName: string,
    values: McpToolExecutionSemanticsValues,
  ): Promise<void> {
    await this.#requireServer(serverId);
    const tool = (await this.#repository.listTools(serverId)).find(
      (candidate) => candidate.toolName === toolName,
    );
    if (tool === undefined)
      throw new McpRegistryError('MCP_TOOL_NOT_FOUND', 'MCP Tool was not found.');
    const adminOverride = createMcpToolExecutionSemantics(values, 'admin_override');
    const updated = withMcpToolAdminExecutionSemanticsOverride(tool, adminOverride);
    const operation = this.#createManagementOperation(
      serverId,
      'tool_semantics_override',
      {
        effectiveSource: updated.executionSemantics.source,
        retainedForRefresh: true,
      },
      toolName,
    );
    const saved = await this.#repository.updateToolExecutionSemantics(
      serverId,
      toolName,
      adminOverride,
      updated.executionSemantics,
      operation,
    );
    if (!saved) throw new McpRegistryError('MCP_TOOL_NOT_FOUND', 'MCP Tool was not found.');
  }

  async #auditManagementOperation(
    serverId: string,
    operationType: McpManagementOperationType,
    summary: Readonly<Record<string, unknown>>,
    target?: string,
  ): Promise<void> {
    await this.#repository.saveManagementOperation(
      this.#createManagementOperation(serverId, operationType, summary, target),
    );
  }

  #createManagementOperation(
    serverId: string,
    operationType: McpManagementOperationType,
    summary: Readonly<Record<string, unknown>>,
    target?: string,
  ): McpManagementOperation {
    return {
      operationId: this.#ids.nextManagementOperationId(),
      serverId,
      operationType,
      actor: 'anonymous-management',
      ...(target === undefined ? {} : { target }),
      summary,
      occurredAt: this.#clock.now(),
    };
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
        ...(tool.declaredExecutionSemantics === undefined
          ? {}
          : {
              declaredExecutionSemantics: createMcpToolExecutionSemantics(
                tool.declaredExecutionSemantics,
                'mcp_declared',
              ),
            }),
        ...(tool.taskExecution === undefined ? {} : { taskExecution: tool.taskExecution }),
        discoveredAt: timestamp,
      });
    });
    const previousByName = new Map(previous.map((tool) => [tool.toolName, tool]));
    return Promise.all(
      registered.map(async (tool) => {
        const previousTool = previousByName.get(tool.toolName);
        const existing = previousTool?.enhancement;
        const enhanced = createMcpTool({
          serverId: tool.serverId,
          toolName: tool.toolName,
          ...(tool.title === undefined ? {} : { title: tool.title }),
          ...(tool.description === undefined ? {} : { description: tool.description }),
          inputSchema: tool.inputSchema,
          enhancement: existing ?? (await this.#enhancer.enhance(tool)),
          ...(tool.declaredExecutionSemantics === undefined
            ? {}
            : { declaredExecutionSemantics: tool.declaredExecutionSemantics }),
          ...(tool.taskExecution === undefined ? {} : { taskExecution: tool.taskExecution }),
          discoveredAt: tool.discoveredAt,
        });
        return previousTool?.adminExecutionSemanticsOverride === undefined
          ? enhanced
          : withMcpToolAdminExecutionSemanticsOverride(
              enhanced,
              previousTool.adminExecutionSemanticsOverride,
            );
      }),
    );
  }

  async #requireServer(serverId: string) {
    const record = await this.#repository.findServer(serverId);
    if (record === undefined)
      throw new McpRegistryError('MCP_SERVER_NOT_FOUND', 'MCP Server was not found.');
    return record;
  }

  #requireFrozenLifecycle(): FrozenTaskLifecycleRuntimePort {
    if (this.#frozenLifecycle === undefined)
      throw new McpRegistryError(
        'MCP_FROZEN_RUNTIME_UNAVAILABLE',
        'Frozen MCP lifecycle runtime is not composed.',
      );
    return this.#frozenLifecycle;
  }
}

function invocationRecord(
  input: Readonly<{
    invocationId: string;
    context: McpCallContext;
    serverId: string;
    toolName: string;
    executionSemantics: McpInvocation['executionSemantics'];
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
    executionSemantics: input.executionSemantics,
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
  | 'MCP_FROZEN_RUNTIME_UNAVAILABLE'
  | 'MCP_FROZEN_PROTOCOL_SNAPSHOT_REQUIRED'
  | 'MCP_FROZEN_TOOL_PROFILE_REQUIRED'
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
