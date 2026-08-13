import {
  createRuntimeExecutionContext,
  LIVE_RUNTIME_EXECUTION_CONTEXT,
  createMcpToolExecutionSemantics,
  withMcpToolAdminExecutionSemanticsOverride,
  createMcpToolEnhancement,
  createRemoteTaskAuthoritySnapshot,
  type McpInvocation,
  type McpInvocationOutcome,
  type McpProtocolContractSnapshot,
  type McpTaskBehavior,
  type RemoteTaskOperationAck,
  type RemoteTaskAuthoritySnapshot,
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
  CurrentMcpProviderBindingAuthorityPort,
  JsonSchemaValidator,
  McpRegistryRepository,
  RemoteTaskReadResult,
  SecretCipher,
} from './ports.js';
import {
  McpRuntimeBindingAuthorityVerifier,
  type CurrentMcpProviderBindingAuthority,
  type RuntimeMcpCatalogAuthority,
} from './mcp-runtime-binding-authority.js';
import {
  HARD_DENIED_CONTROL_TOOLS,
  type GovernedControlDispatchReceipt,
  type GovernedControlInvocationAuthorityPort,
} from './governed-control-authority.js';

export interface McpCallContext {
  readonly taskId?: string;
  readonly capabilityAttemptId?: string;
  readonly contextId?: string;
  readonly providerBindingId?: string;
  readonly providerId?: string;
  readonly executionContext?: RuntimeExecutionContext;
  readonly taskExecution?: ResolvedMcpTaskExecution;
  readonly preTransportFence?: Readonly<{
    invocationId: string;
    signal: AbortSignal;
    enter(input: Readonly<{ dispatchId: string; dispatchHash: string }>): Promise<void>;
  }>;
  /**
   * Durable journal for a Provider call that may create a remote Task. The journal owns the
   * invocation write for a remote receipt so the receipt and its audit record commit together.
   */
  readonly remoteAdmissionJournal?: Readonly<{
    invocationId: string;
    markDispatching(
      input: Readonly<{ invocationId: string; dispatchHash: string; at: string }>,
    ): Promise<void>;
    recordRemoteReceipt(
      input: Readonly<{
        invocation: McpInvocation;
        outcome: Extract<McpInvocationOutcome, { kind: 'remote_task' }>;
        credentialRevision: string;
        sessionRevision: string;
        protocolContract: McpProtocolContractSnapshot;
        taskBehavior: McpTaskBehavior;
        authoritySnapshot: RemoteTaskAuthoritySnapshot;
        at: string;
      }>,
    ): Promise<void>;
    close(
      input: Readonly<{
        invocationId: string;
        reasonCode: string;
        at: string;
      }>,
    ): Promise<void>;
    markUncertain(
      input: Readonly<{
        invocationId: string;
        reasonCode: string;
        at: string;
      }>,
    ): Promise<void>;
  }>;
}

export interface RecordedMcpInvocationOutcome {
  readonly invocationId: string;
  readonly outcome: McpInvocationOutcome;
  readonly credentialRevision: string;
  readonly sessionRevision: string;
  readonly protocolContract?: McpProtocolContractSnapshot;
  readonly taskBehavior?: McpTaskBehavior;
  readonly authoritySnapshot: RemoteTaskAuthoritySnapshot;
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
  readonly #providerBindings: CurrentMcpProviderBindingAuthorityPort | undefined;
  readonly #controlAuthority: GovernedControlInvocationAuthorityPort | undefined;
  readonly #runtimeBindingAuthority: McpRuntimeBindingAuthorityVerifier;
  readonly #ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: McpRegistryRepository;
      cipher: SecretCipher;
      schemas: JsonSchemaValidator;
      frozenAvailability?: FrozenTaskAvailabilityRuntimePort;
      frozenLifecycle?: FrozenTaskLifecycleRuntimePort;
      providerBindings?: CurrentMcpProviderBindingAuthorityPort;
      controlAuthority?: GovernedControlInvocationAuthorityPort;
      runtimeBindingAuthority?: McpRuntimeBindingAuthorityVerifier;
      clock: Clock;
      ids: Readonly<{ nextInvocationId(): string; nextManagementOperationId(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#cipher = dependencies.cipher;
    this.#schemas = dependencies.schemas;
    this.#frozenAvailability = dependencies.frozenAvailability;
    this.#frozenLifecycle = dependencies.frozenLifecycle;
    this.#providerBindings = dependencies.providerBindings;
    this.#controlAuthority = dependencies.controlAuthority;
    this.#runtimeBindingAuthority =
      dependencies.runtimeBindingAuthority ??
      new McpRuntimeBindingAuthorityVerifier({
        repository: dependencies.repository,
        clock: dependencies.clock,
      });
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
    const runtimeAuthority = await this.#runtimeBindingAuthority.loadRuntimeAuthority(serverId);
    const { record, tools } = runtimeAuthority;
    const tool = tools.find((item) => item.toolName === toolName);
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
    assertNoHomeAssistantEntityIdentity(arguments_);
    // Frozen discovery is invocation authority, not post-call evidence. Resolve it before
    // allocating an invocation or crossing the Provider transport boundary so a stale or
    // incomplete registration cannot cause an externally visible call followed by a retryable
    // local failure.
    const frozenAuthority = this.#frozenInvocationAuthority(runtimeAuthority, tool);
    const providerBindingAuthority = await this.#assertCurrentProviderBinding(
      runtimeAuthority,
      context.providerBindingId,
      context.providerId,
    );
    const invocationId =
      context.remoteAdmissionJournal?.invocationId ??
      context.preTransportFence?.invocationId ??
      this.#ids.nextInvocationId();
    if (
      context.remoteAdmissionJournal !== undefined &&
      context.preTransportFence !== undefined &&
      context.remoteAdmissionJournal.invocationId !== context.preTransportFence.invocationId
    )
      throw new McpRegistryError(
        'MCP_REMOTE_ADMISSION_INVOCATION_CONFLICT',
        'Remote admission and deterministic dispatch must share one invocation identity.',
      );
    const startedAt = this.#clock.now();
    const authoritySnapshot = remoteTaskAuthoritySnapshot(
      runtimeAuthority,
      providerBindingAuthority,
      startedAt,
    );
    const executionContext = createRuntimeExecutionContext(
      context.executionContext ?? LIVE_RUNTIME_EXECUTION_CONTEXT,
    );
    const dispatchHash = createMcpProviderDispatchHash({
      invocationId,
      ...(context.taskId === undefined ? {} : { taskId: context.taskId }),
      ...(context.contextId === undefined ? {} : { contextId: context.contextId }),
      ...(context.providerBindingId === undefined
        ? {}
        : { providerBindingId: context.providerBindingId }),
      ...(context.providerId === undefined ? {} : { providerId: context.providerId }),
      serverId,
      toolName,
      arguments: arguments_,
    });
    let outcome: McpInvocationOutcome;
    const transportSignal =
      signal === undefined
        ? context.preTransportFence?.signal
        : context.preTransportFence === undefined
          ? signal
          : AbortSignal.any([signal, context.preTransportFence.signal]);
    const lifecycle = this.#requireFrozenLifecycle();
    const transportInput = {
      endpoint: record.server.endpoint,
      headers: withExecutionHeaders(
        this.#cipher.decrypt(record.encryptedCredential),
        executionContext,
      ),
      toolName,
      arguments: arguments_,
      outputValidator: this.#schemas,
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      ...(transportSignal === undefined ? {} : { signal: transportSignal }),
    };
    // Acquire deterministic ownership before consuming the one-shot human confirmation. A
    // rejected or already-aborted fence must leave the confirmation reusable by the owner that
    // actually obtained dispatch authority.
    let controlAuthority: GovernedControlDispatchReceipt | undefined;
    try {
      throwIfAborted(transportSignal);
      if (context.preTransportFence !== undefined) {
        await context.preTransportFence.enter({
          dispatchId: invocationId,
          dispatchHash,
        });
      }
      throwIfAborted(transportSignal);
      controlAuthority = await this.#assertControlAuthority(
        tool,
        arguments_,
        context,
        invocationId,
        dispatchHash,
      );
      if (context.remoteAdmissionJournal !== undefined)
        await context.remoteAdmissionJournal.markDispatching({
          invocationId,
          dispatchHash,
          at: this.#clock.now(),
        });
    } catch (error: unknown) {
      await context.remoteAdmissionJournal?.close({
        invocationId,
        reasonCode: stableErrorCode(error) ?? 'MCP_REMOTE_ADMISSION_PRETRANSPORT_REJECTED',
        at: this.#clock.now(),
      });
      throw error;
    }
    try {
      throwIfAborted(transportSignal);
      outcome = await lifecycle.call(transportInput);
      assertNoHomeAssistantEntityIdentity(outcome);
    } catch (error: unknown) {
      const completedAt = this.#clock.now();
      const canceled = transportSignal?.aborted === true;
      const invocation = invocationRecord({
        invocationId,
        context,
        ...(controlAuthority === undefined ? {} : { controlAuthority }),
        serverId,
        toolName,
        executionSemantics: tool.executionSemantics,
        arguments: arguments_,
        status: canceled ? 'canceled' : 'failed',
        errorCode: canceled ? 'MCP_CALL_CANCELED' : (stableErrorCode(error) ?? 'MCP_CALL_FAILED'),
        errorMessage: canceled ? 'MCP Tool call was canceled.' : 'MCP Tool call failed.',
        startedAt,
        completedAt,
      });
      await this.#repository.saveInvocation(invocation);
      await context.remoteAdmissionJournal?.markUncertain({
        invocationId,
        reasonCode: 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
        at: completedAt,
      });
      throw error;
    }
    const completedAt = this.#clock.now();
    const invocationResult =
      outcome.kind === 'immediate' ? outcome.result : { remoteTask: outcome.task };
    const businessRejected = outcome.kind === 'immediate' && outcome.result.isError;
    const invocation = invocationRecord({
      invocationId,
      context,
      ...(controlAuthority === undefined ? {} : { controlAuthority }),
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
    });
    if (outcome.kind === 'remote_task' && context.remoteAdmissionJournal !== undefined) {
      await context.remoteAdmissionJournal.recordRemoteReceipt({
        invocation,
        outcome,
        credentialRevision: record.server.updatedAt,
        sessionRevision: `${outcome.task.protocolRevision}/${outcome.task.tasksSchemaRevision}`,
        protocolContract: frozenAuthority.protocolContract,
        taskBehavior: frozenAuthority.taskBehavior,
        authoritySnapshot,
        at: completedAt,
      });
    } else {
      await this.#repository.saveInvocation(invocation);
      await context.remoteAdmissionJournal?.close({
        invocationId,
        reasonCode: 'MCP_REMOTE_ADMISSION_NOT_REQUIRED',
        at: completedAt,
      });
    }
    return {
      invocationId,
      outcome,
      credentialRevision: record.server.updatedAt,
      sessionRevision:
        outcome.kind === 'remote_task'
          ? `${outcome.task.protocolRevision}/${outcome.task.tasksSchemaRevision}`
          : String(record.server.toolRevision),
      protocolContract: frozenAuthority.protocolContract,
      taskBehavior: frozenAuthority.taskBehavior,
      authoritySnapshot,
    };
  }

  async #assertControlAuthority(
    tool: McpTool,
    arguments_: Readonly<Record<string, unknown>>,
    context: McpCallContext,
    invocationId: string,
    dispatchHash: string,
  ): Promise<GovernedControlDispatchReceipt | undefined> {
    if (
      HARD_DENIED_CONTROL_TOOLS.includes(
        tool.toolName as (typeof HARD_DENIED_CONTROL_TOOLS)[number],
      )
    )
      throw new McpRegistryError(
        'MCP_CONTROL_TOOL_HARD_DENIED',
        'vehicle_fire_weapon has no execution authority in this Runtime.',
      );
    if (tool.executionSemantics.effect === 'read_only') return undefined;
    if (tool.executionSemantics.effect !== 'side_effecting')
      throw new McpRegistryError(
        'MCP_CONTROL_SEMANTICS_NOT_EXPLICIT',
        'Unknown Tool effect cannot cross the Provider transport boundary.',
      );
    if (
      this.#controlAuthority === undefined ||
      context.taskId === undefined ||
      context.capabilityAttemptId === undefined ||
      context.providerBindingId === undefined
    )
      throw new McpRegistryError(
        'MCP_CONTROL_AUTHORITY_REQUIRED',
        'Side-effecting Tool invocation requires exact governed Task authority.',
      );
    return this.#controlAuthority.authorizeAndConsume({
      invocationId,
      dispatchHash,
      taskId: context.taskId,
      capabilityAttemptId: context.capabilityAttemptId,
      providerBindingId: context.providerBindingId,
      serverId: tool.serverId,
      toolName: tool.toolName,
      arguments: arguments_,
      executionSemantics: tool.executionSemantics,
    });
  }

  #frozenInvocationAuthority(
    runtimeAuthority: RuntimeMcpCatalogAuthority,
    tool: McpTool,
  ): Readonly<{
    protocolContract: McpProtocolContractSnapshot;
    taskBehavior: McpTaskBehavior;
    catalogAuthority: Readonly<{
      catalogRevision: string;
      catalogChecksum: string;
      operationCount: number;
    }>;
  }> {
    const { snapshot, catalogAuthority } = runtimeAuthority;
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
      catalogAuthority,
    };
  }

  async #assertCurrentProviderBinding(
    runtimeAuthority: RuntimeMcpCatalogAuthority,
    bindingId: string | undefined,
    providerId: string | undefined,
  ): Promise<CurrentMcpProviderBindingAuthority | undefined> {
    if (this.#providerBindings === undefined && bindingId === undefined && providerId === undefined)
      return undefined;
    if (this.#providerBindings === undefined)
      throw new McpRegistryError(
        'MCP_PROVIDER_BINDING_AUTHORITY_UNAVAILABLE',
        'Current MCP Provider Binding authority is not configured.',
      );
    let authority: Awaited<
      ReturnType<CurrentMcpProviderBindingAuthorityPort['loadCurrentMcpProviderBinding']>
    >;
    try {
      authority = await this.#providerBindings.loadCurrentMcpProviderBinding({
        ...(bindingId === undefined ? {} : { bindingId }),
        localServerId: runtimeAuthority.record.server.serverId,
      });
    } catch {
      throw new McpRegistryError(
        'MCP_PROVIDER_BINDING_NOT_CURRENT',
        'Current MCP Provider Binding authority could not be established.',
      );
    }
    try {
      await this.#runtimeBindingAuthority.assertCurrent({
        authority,
        bindingId: bindingId ?? authority.binding.bindingId,
        localServerId: runtimeAuthority.record.server.serverId,
        ...(providerId === undefined ? {} : { providerId }),
        runtimeAuthority,
      });
    } catch {
      throw new McpRegistryError(
        'MCP_PROVIDER_BINDING_NOT_CURRENT',
        'Current MCP Provider Binding authority differs from the Runtime invocation target.',
      );
    }
    return authority;
  }

  async #assertRemoteTaskReadAuthority(
    input: Readonly<{
      serverId: string;
      operationName: string;
      authoritySnapshot?: RemoteTaskAuthoritySnapshot;
      credentialRevision: string;
      protocolContract: McpProtocolContractSnapshot;
    }>,
    runtime: RuntimeMcpCatalogAuthority,
  ): Promise<void> {
    try {
      const snapshot =
        input.authoritySnapshot === undefined
          ? undefined
          : createRemoteTaskAuthoritySnapshot(input.authoritySnapshot);
      if (snapshot === undefined)
        throw new Error('LEGACY_REMOTE_TASK_CATALOG_AUTHORITY_UNPROVABLE');
      const frozenRuntime = snapshot.runtime;
      if (
        frozenRuntime.serverId !== input.serverId ||
        frozenRuntime.serverId !== runtime.record.server.serverId ||
        frozenRuntime.endpoint !== runtime.record.server.endpoint ||
        frozenRuntime.serverUpdatedAt !== runtime.record.server.updatedAt ||
        frozenRuntime.serverUpdatedAt !== input.credentialRevision ||
        frozenRuntime.toolRevision !== runtime.record.server.toolRevision ||
        frozenRuntime.protocolSnapshotId !== runtime.snapshot.snapshotId ||
        frozenRuntime.protocolSnapshotId !== input.protocolContract.serverDiscoverySnapshotId ||
        frozenRuntime.catalogRevision !== runtime.catalogAuthority.catalogRevision ||
        frozenRuntime.catalogChecksum !== runtime.catalogAuthority.catalogChecksum ||
        frozenRuntime.operationCount !== runtime.catalogAuthority.operationCount ||
        !runtime.tools.some((tool) => tool.toolName === input.operationName)
      )
        throw new Error('REMOTE_TASK_RUNTIME_AUTHORITY_DRIFT');

      const frozenProvider = snapshot.providerBinding;
      if (this.#providerBindings === undefined) {
        if (frozenProvider !== undefined)
          throw new Error('REMOTE_TASK_PROVIDER_AUTHORITY_UNAVAILABLE');
        return;
      }
      if (frozenProvider === undefined)
        throw new Error('REMOTE_TASK_PROVIDER_AUTHORITY_NOT_FROZEN');
      const current = await this.#providerBindings.loadCurrentMcpProviderBinding({
        bindingId: frozenProvider.bindingId,
        localServerId: input.serverId,
      });
      if (
        current.binding.bindingId !== frozenProvider.bindingId ||
        current.binding.localServerId !== input.serverId ||
        current.binding.revision < frozenProvider.revision ||
        current.binding.originType !== frozenProvider.originType ||
        current.binding.providerId !== frozenProvider.providerId ||
        current.binding.externalServerId !== frozenProvider.externalServerId ||
        current.sourceCandidateLineage?.smppSourceId !== frozenProvider.smppSourceId ||
        current.sourceCandidateLineage?.externalServerId !== frozenProvider.externalServerId ||
        current.binding.endpointRef !== frozenProvider.endpointRef ||
        (current.binding.revision === frozenProvider.revision &&
          current.binding.catalogRevision !== frozenProvider.catalogRevision) ||
        current.binding.catalogChecksum !== frozenProvider.catalogChecksum ||
        current.binding.operationCount !== frozenProvider.operationCount ||
        Date.parse(current.binding.availabilityValidUntil) <= Date.parse(this.#clock.now())
      )
        throw new Error('REMOTE_TASK_PROVIDER_AUTHORITY_DRIFT');
    } catch {
      throw new McpRegistryError(
        'MCP_REMOTE_TASK_AUTHORITY_CHANGED',
        'Remote Task polling authority differs from the exact Runtime and Provider Binding admitted before dispatch.',
      );
    }
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
      authoritySnapshot?: RemoteTaskAuthoritySnapshot;
      credentialRevision: string;
      protocolContract: McpProtocolContractSnapshot;
    }>,
  ): Promise<RemoteTaskReadResult> {
    try {
      const runtimeAuthority = await this.#runtimeBindingAuthority.loadRuntimeAuthority(
        input.serverId,
      );
      await this.#assertRemoteTaskReadAuthority(input, runtimeAuthority);
      const { record, tools } = runtimeAuthority;
      const executionContext = createRuntimeExecutionContext(input.executionContext);
      const tool = tools.find((candidate) => candidate.toolName === input.operationName);
      if (tool === undefined)
        throw new McpRegistryError('MCP_TOOL_NOT_FOUND', 'MCP Tool was not found.');
      const snapshot = await this.#requireFrozenLifecycle().get({
        endpoint: record.server.endpoint,
        headers: withExecutionHeaders(
          this.#cipher.decrypt(record.encryptedCredential),
          executionContext,
        ),
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
        code === 'MCP_SERVER_NOT_FOUND' ||
        code === 'MCP_SERVER_NOT_ENABLED' ||
        code === 'MCP_FROZEN_PROTOCOL_SNAPSHOT_REQUIRED' ||
        code === 'MCP_REMOTE_TASK_AUTHORITY_CHANGED'
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
    return this.#requireFrozenLifecycle().cancel({
      endpoint: record.server.endpoint,
      headers: withExecutionHeaders(
        this.#cipher.decrypt(record.encryptedCredential),
        executionContext,
      ),
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
    const executionContext = createRuntimeExecutionContext(input.executionContext);
    return this.#requireFrozenLifecycle().update({
      endpoint: record.server.endpoint,
      headers: withExecutionHeaders(
        this.#cipher.decrypt(record.encryptedCredential),
        executionContext,
      ),
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
      const runtimeAuthority = await this.#runtimeBindingAuthority.loadRuntimeAuthority(
        input.serverId,
      );
      const { record } = runtimeAuthority;
      await this.#assertCurrentProviderBinding(runtimeAuthority, undefined, undefined);
      if (this.#frozenAvailability === undefined)
        return {
          kind: 'capability_missing',
          errorCode: 'MCP_TASK_AVAILABILITY_CAPABILITY_REQUIRED',
        };
      const executionContext = createRuntimeExecutionContext(input.executionContext);
      return await this.#frozenAvailability.check({
        endpoint: record.server.endpoint,
        headers: withExecutionHeaders(
          this.#cipher.decrypt(record.encryptedCredential),
          executionContext,
        ),
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
      if (
        code === 'MCP_TASK_PROTOCOL_REVISION_UNSUPPORTED' ||
        code === 'MCP_SERVER_NOT_FOUND' ||
        code === 'MCP_SERVER_NOT_ENABLED' ||
        code === 'MCP_FROZEN_PROTOCOL_SNAPSHOT_REQUIRED' ||
        code === 'MCP_PROVIDER_BINDING_AUTHORITY_UNAVAILABLE' ||
        code === 'MCP_PROVIDER_BINDING_NOT_CURRENT'
      )
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function remoteTaskAuthoritySnapshot(
  runtime: RuntimeMcpCatalogAuthority,
  provider: CurrentMcpProviderBindingAuthority | undefined,
  capturedAt: string,
): RemoteTaskAuthoritySnapshot {
  return createRemoteTaskAuthoritySnapshot({
    schemaVersion: '1.0',
    capturedAt,
    runtime: {
      serverId: runtime.record.server.serverId,
      endpoint: runtime.record.server.endpoint,
      serverUpdatedAt: runtime.record.server.updatedAt,
      toolRevision: runtime.record.server.toolRevision,
      protocolSnapshotId: runtime.snapshot.snapshotId,
      catalogRevision: runtime.catalogAuthority.catalogRevision,
      catalogChecksum: runtime.catalogAuthority.catalogChecksum,
      operationCount: runtime.catalogAuthority.operationCount,
    },
    ...(provider === undefined
      ? {}
      : {
          providerBinding: {
            bindingId: provider.binding.bindingId,
            revision: provider.binding.revision,
            originType: provider.binding.originType,
            providerId: provider.binding.providerId,
            ...(provider.binding.externalServerId === undefined
              ? {}
              : { externalServerId: provider.binding.externalServerId }),
            ...(provider.sourceCandidateLineage === undefined
              ? {}
              : { smppSourceId: provider.sourceCandidateLineage.smppSourceId }),
            endpointRef: provider.binding.endpointRef,
            catalogRevision: provider.binding.catalogRevision,
            catalogChecksum: provider.binding.catalogChecksum,
            operationCount: provider.binding.operationCount,
            availabilityValidUntil: provider.binding.availabilityValidUntil,
            observedAt: provider.observedAt,
          },
        }),
  });
}

export function createMcpProviderDispatchHash(
  input: Readonly<{
    invocationId: string;
    taskId?: string;
    contextId?: string;
    providerBindingId?: string;
    providerId?: string;
    serverId: string;
    toolName: string;
    arguments: Readonly<Record<string, unknown>>;
  }>,
): string {
  const value = canonicalJson([
    input.invocationId,
    input.taskId ?? null,
    input.contextId ?? null,
    input.providerBindingId ?? null,
    input.providerId ?? null,
    input.serverId,
    input.toolName,
    input.arguments,
  ]);
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function invocationRecord(
  input: Readonly<{
    invocationId: string;
    context: McpCallContext;
    controlAuthority?: GovernedControlDispatchReceipt;
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
    ...(input.context.capabilityAttemptId === undefined
      ? {}
      : { capabilityAttemptId: input.context.capabilityAttemptId }),
    ...(input.controlAuthority === undefined
      ? {}
      : {
          controlConfirmationId: input.controlAuthority.confirmationId,
          controlProviderBindingId: input.controlAuthority.providerBindingId,
          controlArgumentsHash: input.controlAuthority.argumentsHash,
          controlDispatchHash: input.controlAuthority.dispatchHash,
        }),
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

function withExecutionHeaders(
  credentials: Readonly<Record<string, string>>,
  executionContext: RuntimeExecutionContext,
): Readonly<Record<string, string>> {
  return {
    ...credentials,
    [SDAR_EXECUTION_MODE_HEADER]: executionContext.mode,
    ...(executionContext.simulationId === undefined
      ? {}
      : { [SDAR_SIMULATION_ID_HEADER]: executionContext.simulationId }),
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

const ALLOWED_HOME_ASSISTANT_SEMANTIC_EVIDENCE_TYPES = new Set([
  'light.state.observation',
  'light.brightness.observation',
  'climate.state.observation',
  'climate.hvac_mode.observation',
  'climate.target_temperature.observation',
]);

const HOME_ASSISTANT_ENTITY_ID =
  /(?:^|[^a-z0-9_])(?:automation|binary_sensor|button|climate|cover|device_tracker|event|fan|humidifier|input_boolean|input_button|input_datetime|input_number|input_select|light|lock|media_player|number|person|remote|scene|script|select|sensor|siren|switch|update|vacuum|water_heater)\.[a-z0-9_]+(?:$|[^a-z0-9_])/u;

/**
 * Provider data is untrusted even after Frozen schema validation. Home Assistant physical
 * identifiers must never enter Runtime persistence, including inside evidence subjectRef,
 * producer or metadata fields that are outside a Tool's structured output schema.
 */
function assertNoHomeAssistantEntityIdentity(value: unknown): void {
  const pending: unknown[] = [value];
  let inspected = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    inspected += 1;
    if (inspected > 20_000)
      throw new McpRegistryError(
        'MCP_PROVIDER_RESULT_TOO_COMPLEX',
        'MCP Provider result exceeds the bounded physical-identity inspection budget.',
      );
    if (typeof current === 'string') {
      if (
        !ALLOWED_HOME_ASSISTANT_SEMANTIC_EVIDENCE_TYPES.has(current) &&
        HOME_ASSISTANT_ENTITY_ID.test(current)
      )
        throw new McpRegistryError(
          'HOME_ASSISTANT_ENTITY_ID_FORBIDDEN',
          'MCP Provider results must not contain Home Assistant entity IDs.',
        );
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current as unknown[]) pending.push(item);
      continue;
    }
    if (typeof current !== 'object' || current === null) continue;
    for (const [key, item] of Object.entries(current)) {
      if (/^(?:entity_?id|physical_?resource_?id)$/iu.test(key))
        throw new McpRegistryError(
          'HOME_ASSISTANT_ENTITY_ID_FORBIDDEN',
          'MCP Provider results must not contain Home Assistant entity ID fields.',
        );
      pending.push(item);
    }
  }
}

export type McpRegistryErrorCode =
  | 'MCP_ARGUMENT_SCHEMA_MISMATCH'
  | 'HOME_ASSISTANT_ENTITY_ID_FORBIDDEN'
  | 'MCP_CONTROL_AUTHORITY_REQUIRED'
  | 'MCP_CONTROL_SEMANTICS_NOT_EXPLICIT'
  | 'MCP_CONTROL_TOOL_HARD_DENIED'
  | 'MCP_PROVIDER_RESULT_TOO_COMPLEX'
  | 'MCP_PROVIDER_BINDING_AUTHORITY_UNAVAILABLE'
  | 'MCP_PROVIDER_BINDING_NOT_CURRENT'
  | 'MCP_REMOTE_ADMISSION_INVOCATION_CONFLICT'
  | 'MCP_REMOTE_TASK_AUTHORITY_CHANGED'
  | 'MCP_SERVER_ALREADY_EXISTS'
  | 'MCP_SERVER_NOT_ENABLED'
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
import { createHash } from 'node:crypto';
