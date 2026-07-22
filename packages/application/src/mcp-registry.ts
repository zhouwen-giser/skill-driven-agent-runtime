import {
  createRuntimeExecutionContext,
  LIVE_RUNTIME_EXECUTION_CONTEXT,
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
  RemoteTaskReadResult,
  SecretCipher,
} from './ports.js';

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

export class McpRegistryService {
  readonly #repository: McpRegistryRepository;
  readonly #cipher: SecretCipher;
  readonly #schemas: JsonSchemaValidator;
  readonly #clock: Clock;
  readonly #frozenAvailability: FrozenTaskAvailabilityRuntimePort | undefined;
  readonly #frozenLifecycle: FrozenTaskLifecycleRuntimePort | undefined;
  readonly #ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: McpRegistryRepository;
      cipher: SecretCipher;
      schemas: JsonSchemaValidator;
      frozenAvailability?: FrozenTaskAvailabilityRuntimePort;
      frozenLifecycle?: FrozenTaskLifecycleRuntimePort;
      clock: Clock;
      ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#cipher = dependencies.cipher;
    this.#schemas = dependencies.schemas;
    this.#frozenAvailability = dependencies.frozenAvailability;
    this.#frozenLifecycle = dependencies.frozenLifecycle;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
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
    createRuntimeExecutionContext(context.executionContext ?? LIVE_RUNTIME_EXECUTION_CONTEXT);
    let outcome: McpInvocationOutcome;
    try {
      outcome = await this.#requireFrozenLifecycle().call({
        endpoint: record.server.endpoint,
        headers: this.#cipher.decrypt(record.encryptedCredential),
        toolName,
        arguments: arguments_,
        outputValidator: this.#schemas,
        ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
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
      ...(await this.#frozenInvocationAuthority(serverId, tool)),
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
    const headers = this.#cipher.decrypt(record.encryptedCredential);
    this.#frozenLifecycle?.disconnect?.({ endpoint: record.server.endpoint, headers });
    await this.#repository.deleteServer(serverId);
    await this.#auditManagementOperation(serverId, 'delete', { disconnected: true });
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
      createRuntimeExecutionContext(input.executionContext);
      const tool = (await this.#repository.listTools(input.serverId)).find(
        (candidate) => candidate.toolName === input.operationName,
      );
      if (tool === undefined)
        throw new McpRegistryError('MCP_TOOL_NOT_FOUND', 'MCP Tool was not found.');
      const snapshot = await this.#requireFrozenLifecycle().get({
        endpoint: record.server.endpoint,
        headers: this.#cipher.decrypt(record.encryptedCredential),
        remoteTaskId: input.remoteTaskId,
        outputValidator: this.#schemas,
        ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
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
    createRuntimeExecutionContext(input.executionContext);
    return this.#requireFrozenLifecycle().cancel({
      endpoint: record.server.endpoint,
      headers: this.#cipher.decrypt(record.encryptedCredential),
      remoteTaskId: input.remoteTaskId,
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
    createRuntimeExecutionContext(input.executionContext);
    return this.#requireFrozenLifecycle().update({
      endpoint: record.server.endpoint,
      headers: this.#cipher.decrypt(record.encryptedCredential),
      remoteTaskId: input.remoteTaskId,
      inputResponses: input.inputResponses,
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
      if (this.#frozenAvailability === undefined)
        return {
          kind: 'capability_missing',
          errorCode: 'MCP_TASK_AVAILABILITY_CAPABILITY_REQUIRED',
        };
      createRuntimeExecutionContext(input.executionContext);
      return await this.#frozenAvailability.check({
        endpoint: record.server.endpoint,
        headers: this.#cipher.decrypt(record.encryptedCredential),
        requests: input.requests,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
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
