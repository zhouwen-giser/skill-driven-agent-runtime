import { UGV_TASK_BUSINESS_OPERATION_POLICY } from '../../../../packages/ugv-profile/src/ugv-task-business-operation-policy.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type {
  GovernedControlConfirmationService,
  McpRegistryService,
  McpRuntimeBindingAuthorityVerifier,
  MemoryService,
  ModelRuntimeService,
  RemoteTaskInputService,
} from '../../../../packages/application/src/index.js';
import {
  FrozenRemoteTaskNotificationService,
  RemoteTaskAdmissionService,
  RemoteTaskCancellationReconciler,
  RemoteTaskCancellationService,
  RemoteTaskCancellationWorker,
  RemoteTaskPollingService,
  RemoteTaskReconciler,
  StructuredExecutionExceptionDecider,
  TaskBusinessCommandService,
  TaskBusinessSyncService,
  assertTaskBusinessCurrentCapability,
  type CognitiveManagementActionLeaseGuard,
} from '../../../../packages/application/src/index.js';
import type { Aes256GcmSecretCipher } from '../../../../packages/crypto-adapter/src/index.js';
import { TaskBusinessError, type AgentTask } from '../../../../packages/domain/src/index.js';
import type { AjvJsonSchemaValidator } from '../../../../packages/json-schema-adapter/src/index.js';
import { type DeterministicCapabilityExecutionInput } from '../../../../packages/management-api/src/index.js';
import type { FrozenV1McpClient } from '../../../../packages/mcp-adapter/src/index.js';
import { FrozenV1RuntimeNotificationAdapter } from '../../../../packages/mcp-adapter/src/index.js';
import type {
  PostgresAgentTaskCommandContext,
  PostgresMcpRegistryRepository,
  PostgresTaskBusinessRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  PostgresGovernedControlManagementAuthorityReader,
  PostgresRemoteTaskAdmissionIntentStore,
  PostgresRemoteTaskCancellationRepository,
  PostgresRemoteTaskLifecycleQuery,
  PostgresRemoteTaskProviderExecutionLinkStore,
  PostgresRemoteTaskReconciliationAttemptStore,
  PostgresRemoteTaskRepository,
  PostgresSkillCallWorkflowRepository,
  PostgresTaskBusinessCommandRepository,
  PostgresWorkflowPlanRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import type { ContextSerialExecutor } from '../../../../packages/runtime-redis/src/index.js';
import {
  BullMqRemoteTaskCancellationQueue,
  BullMqRemoteTaskContinuationQueue,
  BullMqRemoteTaskPollQueue,
} from '../../../../packages/runtime-redis/src/index.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import { canonicalJson, runtimeErrorCode } from './runtime-support.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
export interface composeRemoteTasksDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly pool: Pool;
  readonly deviceWorkScope:
    { allowedDeviceIds: string[]; sdarServiceKey: string; includeNonDevice: boolean } | undefined;
  readonly mcpRepository: PostgresMcpRegistryRepository;
  readonly secretCipher: Aes256GcmSecretCipher;
  readonly clock: { now: () => string };
  readonly frozenMcpClient: FrozenV1McpClient;
  readonly schemaValidator: AjvJsonSchemaValidator;
  readonly contextSerial: ContextSerialExecutor;
  readonly taskBusinessRepository: PostgresTaskBusinessRepository;
  readonly mcpRegistry: McpRegistryService;
  readonly governedControlConfirmationService: GovernedControlConfirmationService;
  readonly runtimeMcpBindingAuthority: McpRuntimeBindingAuthorityVerifier;
  readonly taskCommands: PostgresAgentTaskCommandContext;
  readonly modelRuntime: ModelRuntimeService;
  readonly memories: MemoryService;
  readonly ugvAgentProfile: boolean;
  readonly remoteTaskInput: RuntimeValueRef<RemoteTaskInputService | undefined>;
}
export function composeRemoteTasks(dependencies: composeRemoteTasksDependencies) {
  dependencies.remoteTaskInput.value = undefined;
  const {
    cleanupScope,
    options,
    pool,
    deviceWorkScope,
    mcpRepository,
    secretCipher,
    clock,
    frozenMcpClient,
    schemaValidator,
    contextSerial,
    taskBusinessRepository,
    mcpRegistry,
    governedControlConfirmationService,
    runtimeMcpBindingAuthority,
    taskCommands,
    modelRuntime,
    memories,
    ugvAgentProfile,
  } = dependencies;
  const remoteTaskRepository =
    options.frozenMcpTasks === undefined
      ? undefined
      : new PostgresRemoteTaskRepository(pool, deviceWorkScope);
  const remoteTaskAdmissionIntents =
    options.frozenMcpTasks === undefined
      ? undefined
      : new PostgresRemoteTaskAdmissionIntentStore(pool, deviceWorkScope);
  const remoteTaskReconciliationAttempts =
    options.frozenMcpTasks === undefined
      ? undefined
      : new PostgresRemoteTaskReconciliationAttemptStore(pool, deviceWorkScope);
  const remoteTaskProviderExecutionLinks =
    options.frozenMcpTasks === undefined
      ? undefined
      : new PostgresRemoteTaskProviderExecutionLinkStore(pool, deviceWorkScope);
  const frozenTaskNotifications =
    remoteTaskRepository === undefined
      ? undefined
      : new FrozenRemoteTaskNotificationService({
          registry: mcpRepository,
          remoteTasks: remoteTaskRepository,
          cipher: secretCipher,
          runtime: new FrozenV1RuntimeNotificationAdapter({
            now: clock.now,
            client: frozenMcpClient,
          }),
          schemas: schemaValidator,
          serial: contextSerial,
          clock,
          nextObservationId: () => `remote-task-observation-${randomUUID()}`,
          nextControlEventId: () => `remote-task-control-${randomUUID()}`,
          hash: (value) => createHash('sha256').update(canonicalJson(value)).digest('hex'),
          onError: (serverId, error) =>
            process.stderr.write(
              `${JSON.stringify({ event: 'frozen_task_notification.failed', serverId, error: error instanceof Error ? error.message : String(error) })}\n`,
            ),
        });
  const remoteTaskQueue =
    options.frozenMcpTasks === undefined
      ? undefined
      : new BullMqRemoteTaskPollQueue({
          connection: options.redis,
          ...(options.frozenMcpTasks.queueName === undefined
            ? {}
            : { queueName: options.frozenMcpTasks.queueName }),
        });
  if (remoteTaskQueue !== undefined) {
    remoteTaskQueue.close = cleanupScope.register(remoteTaskQueue.close.bind(remoteTaskQueue));
  }

  const remoteTaskContinuationQueueName =
    options.frozenMcpTasks?.queueName === undefined
      ? undefined
      : `${options.frozenMcpTasks.queueName}-continuations`;
  const remoteTaskContinuationQueue =
    options.frozenMcpTasks === undefined
      ? undefined
      : new BullMqRemoteTaskContinuationQueue({
          connection: options.redis,
          ...(remoteTaskContinuationQueueName === undefined
            ? {}
            : { queueName: remoteTaskContinuationQueueName }),
        });
  if (remoteTaskContinuationQueue !== undefined) {
    remoteTaskContinuationQueue.close = cleanupScope.register(
      remoteTaskContinuationQueue.close.bind(remoteTaskContinuationQueue),
    );
  }

  const remoteTaskCancellationQueueName =
    options.frozenMcpTasks?.queueName === undefined
      ? undefined
      : `${options.frozenMcpTasks.queueName}-cancellations`;
  const remoteTaskCancellationQueue =
    options.frozenMcpTasks === undefined
      ? undefined
      : new BullMqRemoteTaskCancellationQueue({
          connection: options.redis,
          ...(remoteTaskCancellationQueueName === undefined
            ? {}
            : { queueName: remoteTaskCancellationQueueName }),
        });
  if (remoteTaskCancellationQueue !== undefined) {
    remoteTaskCancellationQueue.close = cleanupScope.register(
      remoteTaskCancellationQueue.close.bind(remoteTaskCancellationQueue),
    );
  }

  const taskBusinessSync =
    options.frozenMcpTasks === undefined
      ? undefined
      : new TaskBusinessSyncService({
          repository: taskBusinessRepository,
          reader: mcpRegistry,
          clock,
        });
  if (taskBusinessSync !== undefined) {
    taskBusinessSync.stop = cleanupScope.register(taskBusinessSync.stop.bind(taskBusinessSync));
  }

  const hydrateTaskBusiness = async (bindingId: string): Promise<void> => {
    try {
      await taskBusinessSync?.refresh(bindingId);
    } catch (error: unknown) {
      process.stderr.write(
        `${JSON.stringify({ event: 'task_business.hydration_failed', bindingId, errorCode: runtimeErrorCode(error) })}\n`,
      );
    }
  };
  const taskBusinessCommandsRepository = new PostgresTaskBusinessCommandRepository(
    pool,
    deviceWorkScope,
  );
  const taskBusinessCommands =
    taskBusinessSync === undefined
      ? undefined
      : new TaskBusinessCommandService({
          operationPolicy: UGV_TASK_BUSINESS_OPERATION_POLICY,
          repository: taskBusinessCommandsRepository,
          business: taskBusinessRepository,
          sync: taskBusinessSync,
          reader: mcpRegistry,
          transport: mcpRegistry,
          confirmations: governedControlConfirmationService,
          revocations: new PostgresGovernedControlManagementAuthorityReader(pool),
          schemas: schemaValidator,
          clock,
          authority: {
            async load(taskId) {
              if (
                options.capabilityAuthorityReader === undefined ||
                options.currentMcpProviderBindingAuthorityReader === undefined
              )
                throw new TaskBusinessError('TASK_BUSINESS_CONTROL_AUTHORITY_REQUIRED');
              const native = await taskBusinessCommandsRepository.loadAuthority(taskId);
              const resource = z
                .object({ resourceId: z.string().min(1) })
                .loose()
                .parse(native.inputSnapshot);
              assertTaskBusinessCurrentCapability({
                authority: await options.capabilityAuthorityReader.load(
                  native.scope.capabilityId,
                  native.scope.capabilityVersion,
                ),
                scope: native.scope,
                constraints: native.constraints,
                resourceId: resource.resourceId,
              });
              return { scope: native.scope, policy: native.policy };
            },
            async assertCurrent(target, scope) {
              if (
                options.currentMcpProviderBindingAuthorityReader === undefined ||
                target.binding.serverId !== scope.serverId ||
                target.binding.operationName !== scope.toolName ||
                target.binding.authoritySnapshot?.providerBinding?.bindingId !==
                  scope.providerBindingId
              )
                throw new TaskBusinessError('TASK_BUSINESS_CONTROL_SCOPE_INVALID');
              const authority =
                await options.currentMcpProviderBindingAuthorityReader.loadCurrentMcpProviderBinding(
                  { bindingId: scope.providerBindingId, localServerId: scope.serverId },
                );
              await runtimeMcpBindingAuthority.assertCurrent({
                authority,
                bindingId: scope.providerBindingId,
                localServerId: scope.serverId,
                providerId: target.providerId,
              });
            },
          },
        });
  const remoteTaskPolling =
    remoteTaskRepository === undefined || remoteTaskQueue === undefined
      ? undefined
      : new RemoteTaskPollingService({
          repository: remoteTaskRepository,
          queue: remoteTaskQueue,
          reader: mcpRegistry,
          serial: contextSerial,
          clock,
          ids: {
            nextObservationId: () => `remote-task-observation-${randomUUID()}`,
            nextControlEventId: () => `remote-task-control-${randomUUID()}`,
            nextClaimToken: () => `remote-task-claim-${randomUUID()}`,
            nextProtocolAttemptId: () => `remote-task-protocol-attempt-${randomUUID()}`,
          },
          hash: (value) => createHash('sha256').update(canonicalJson(value)).digest('hex'),
          onSnapshot: hydrateTaskBusiness,
          ...(options.frozenMcpTasks?.polling === undefined
            ? {}
            : { options: options.frozenMcpTasks.polling }),
        });
  const remoteTaskAdmission =
    remoteTaskRepository === undefined || remoteTaskQueue === undefined
      ? undefined
      : new RemoteTaskAdmissionService({
          repository: remoteTaskRepository,
          queue: remoteTaskQueue,
          nextObservationId: () => `remote-task-observation-${randomUUID()}`,
          onAdmitted: hydrateTaskBusiness,
        });
  const remoteTaskReconciler =
    remoteTaskRepository === undefined || remoteTaskQueue === undefined
      ? undefined
      : new RemoteTaskReconciler({
          repository: remoteTaskRepository,
          queue: remoteTaskQueue,
          clock,
        });
  const remoteTaskCancellations =
    remoteTaskRepository === undefined || remoteTaskCancellationQueue === undefined
      ? undefined
      : new PostgresRemoteTaskCancellationRepository(pool, deviceWorkScope);
  const remoteTaskCancellation =
    remoteTaskRepository === undefined ||
    remoteTaskCancellations === undefined ||
    remoteTaskCancellationQueue === undefined
      ? undefined
      : new RemoteTaskCancellationService({
          remoteTasks: remoteTaskRepository,
          cancellations: remoteTaskCancellations,
          queue: remoteTaskCancellationQueue,
          clock,
          ids: {
            nextRequestId: () => `remote-task-cancel-request-${randomUUID()}`,
            nextAttemptId: () => `remote-task-cancel-attempt-${randomUUID()}`,
            nextClaimToken: () => `remote-task-cancel-claim-${randomUUID()}`,
          },
        });
  const remoteTaskCancellationProcessor =
    remoteTaskRepository === undefined || remoteTaskCancellations === undefined
      ? undefined
      : new RemoteTaskCancellationWorker({
          remoteTasks: remoteTaskRepository,
          cancellations: remoteTaskCancellations,
          sender: mcpRegistry,
          serial: contextSerial,
          clock,
          ids: {
            nextAttemptId: () => `remote-task-cancel-attempt-${randomUUID()}`,
            nextClaimToken: () => `remote-task-cancel-claim-${randomUUID()}`,
          },
        });
  const remoteTaskCancellationReconciler =
    remoteTaskCancellations === undefined || remoteTaskCancellationQueue === undefined
      ? undefined
      : new RemoteTaskCancellationReconciler({
          cancellations: remoteTaskCancellations,
          queue: remoteTaskCancellationQueue,
          clock,
        });
  const workflowPlans = new PostgresWorkflowPlanRepository(pool, taskCommands, deviceWorkScope);
  const skillCallWorkflows = new PostgresSkillCallWorkflowRepository(pool, deviceWorkScope);
  const executionExceptionDecider = new StructuredExecutionExceptionDecider(modelRuntime, memories);
  const workflowAncestry = new AsyncLocalStorage<readonly string[]>();
  const skillCallAncestry = new AsyncLocalStorage<readonly string[]>();
  const workflowTaskAuthority = new AsyncLocalStorage<AgentTask>();
  const deterministicCapabilityLease = new AsyncLocalStorage<
    Readonly<{
      input: DeterministicCapabilityExecutionInput;
      lease: CognitiveManagementActionLeaseGuard;
    }>
  >();
  const ugvRemoteTaskLifecycle = ugvAgentProfile
    ? new PostgresRemoteTaskLifecycleQuery(pool, deviceWorkScope)
    : undefined;
  return {
    workflowTaskAuthority,
    deterministicCapabilityLease,
    workflowPlans,
    skillCallWorkflows,
    remoteTaskAdmission,
    remoteTaskAdmissionIntents,
    remoteTaskReconciliationAttempts,
    ugvRemoteTaskLifecycle,
    remoteTaskRepository,
    skillCallAncestry,
    workflowAncestry,
    executionExceptionDecider,
    remoteTaskProviderExecutionLinks,
    remoteTaskCancellation,
    remoteTaskQueue,
    remoteTaskContinuationQueue,
    taskBusinessCommands,
    remoteTaskReconciler,
    taskBusinessSync,
    remoteTaskPolling,
    remoteTaskContinuationQueueName,
    remoteTaskCancellationProcessor,
    remoteTaskCancellationQueueName,
    remoteTaskCancellationReconciler,
    frozenTaskNotifications,
    remoteTaskCancellationQueue,
  };
}
