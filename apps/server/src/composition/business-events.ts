import { randomUUID } from 'node:crypto';
import type {
  RemoteTaskReconciler,
  TaskBusinessSyncService,
  TaskService,
  WorkflowExecutionService,
} from '../../../../packages/application/src/index.js';
import {
  BusinessEventIngressWorker,
  BusinessEventRelationResolver,
  BusinessEventSubscriptionService,
  ContinuityImpactService,
  EventImpactRecoveryService,
  ProviderSubscriptionCoordinator,
  TaskBusinessEventProcessor,
  TaskImpactAssessmentService,
} from '../../../../packages/application/src/index.js';
import type { Aes256GcmSecretCipher } from '../../../../packages/crypto-adapter/src/index.js';
import {
  FrozenBusinessEventsClient,
  FrozenBusinessEventsRuntimeAdapter,
} from '../../../../packages/mcp-adapter/src/index.js';
import type { McpOutboundFetch as CompositionMcpOutboundFetch } from '../../../../packages/mcp-adapter/src/outbound-endpoint-policy.js';
import type {
  PostgresAgentTaskRepository,
  PostgresMcpRegistryRepository,
  PostgresRemoteTaskRepository,
  PostgresTaskBusinessRepository,
  PostgresUserGoalRuntimeRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import { businessEventHash, runtimeErrorCode } from './runtime-support.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
export interface composeBusinessEventsDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly userGoalRuntimeRepository: PostgresUserGoalRuntimeRepository;
  readonly mcpOutboundFetch: CompositionMcpOutboundFetch;
  readonly clock: { now: () => string };
  readonly remoteTaskReconciler: RemoteTaskReconciler | undefined;
  readonly workflowExecution: WorkflowExecutionService;
  readonly tasks: PostgresAgentTaskRepository;
  readonly service: RuntimeValueRef<TaskService>;
  readonly remoteTaskRepository: PostgresRemoteTaskRepository | undefined;
  readonly mcpRepository: PostgresMcpRegistryRepository;
  readonly secretCipher: Aes256GcmSecretCipher;
  readonly taskBusinessSync: TaskBusinessSyncService | undefined;
  readonly taskBusinessRepository: PostgresTaskBusinessRepository;
}
export async function composeBusinessEvents(dependencies: composeBusinessEventsDependencies) {
  const {
    cleanupScope,
    options,
    userGoalRuntimeRepository,
    mcpOutboundFetch,
    clock,
    remoteTaskReconciler,
    workflowExecution,
    tasks,
    remoteTaskRepository,
    mcpRepository,
    secretCipher,
    taskBusinessSync,
    taskBusinessRepository,
  } = dependencies;
  const businessEventRepository =
    options.businessEvents === undefined ? undefined : userGoalRuntimeRepository;
  const businessEventRuntime =
    options.businessEvents === undefined
      ? undefined
      : new FrozenBusinessEventsRuntimeAdapter({
          client: new FrozenBusinessEventsClient(mcpOutboundFetch),
        });
  const continuityImpact =
    businessEventRepository === undefined
      ? undefined
      : new ContinuityImpactService({
          events: businessEventRepository,
          clock,
          nextIncidentId: () => `business-event-incident-${randomUUID()}`,
          hash: businessEventHash,
        });
  const businessEventRelations =
    businessEventRepository === undefined || businessEventRuntime === undefined
      ? undefined
      : new BusinessEventRelationResolver({
          runtime: businessEventRuntime,
          repository: businessEventRepository,
          clock,
          nextProjectionId: () => `business-event-relation-${randomUUID()}`,
          hash: businessEventHash,
        });
  const eventImpactRecovery =
    businessEventRepository === undefined
      ? undefined
      : new EventImpactRecoveryService({
          plans: businessEventRepository,
          events: businessEventRepository,
          controls: {
            async reconcileRemoteTasks(): Promise<void> {
              if (remoteTaskReconciler === undefined)
                throw new Error('BUSINESS_EVENT_REMOTE_TASK_RECONCILER_UNAVAILABLE');
              await remoteTaskReconciler.reconcile();
            },
            async pauseAttempts(bindings): Promise<void> {
              await Promise.all(
                [...new Set(bindings.map((binding) => binding.workflowPlanId))].map((planId) =>
                  workflowExecution.pauseForPlan(planId),
                ),
              );
            },
            async cancelAttempts(bindings): Promise<void> {
              await Promise.all(
                [...new Set(bindings.map((binding) => binding.workflowPlanId))].map((planId) =>
                  workflowExecution.cancelForPlan(planId),
                ),
              );
            },
            async createIncidentTask(input): Promise<string> {
              const taskId = `business-event-incident-task-${input.dedupeKey.slice(7, 39)}`;
              const existing = await tasks.findById(taskId);
              if (existing !== undefined) return existing.taskId;
              const result = await dependencies.service.value.submit({
                taskId,
                contextId: input.contextId,
                messageText: input.summary,
                metadata: {
                  source: 'business_event_incident',
                  ...(input.deviceIdentity === undefined
                    ? {}
                    : input.deviceIdentity === null
                      ? { 'io.sdar/nonDevice': true }
                      : { 'io.sdar/deviceId': input.deviceIdentity.deviceId }),
                  dedupeKey: input.dedupeKey,
                  relatedGoalIds: input.relatedGoalIds,
                  requiresPlanConfirmation: true,
                },
              });
              return result.task.taskId;
            },
          },
          clock,
          nextPlanId: () => `business-event-plan-${randomUUID()}`,
          nextSkillGoalId: () => `business-event-skill-goal-${randomUUID()}`,
          nextDependencyId: () => `business-event-dependency-${randomUUID()}`,
          nextIncidentId: () => `business-event-incident-${randomUUID()}`,
          hash: businessEventHash,
        });
  const eventImpact =
    businessEventRepository === undefined ||
    remoteTaskRepository === undefined ||
    businessEventRelations === undefined ||
    eventImpactRecovery === undefined
      ? undefined
      : new TaskImpactAssessmentService({
          events: businessEventRepository,
          bindings: remoteTaskRepository,
          plans: businessEventRepository,
          relations: {
            async resolve(record, event, subscription) {
              const provider = await mcpRepository.findServer(subscription.providerId);
              if (provider === undefined) throw new Error('BUSINESS_EVENT_PROVIDER_NOT_REGISTERED');
              return businessEventRelations.resolve({
                endpoint: provider.server.endpoint,
                headers: secretCipher.decrypt(provider.encryptedCredential),
                inboxId: record.inboxId,
                event,
              });
            },
          },
          recovery: eventImpactRecovery,
          clock,
          nextAssessmentId: () => `business-event-impact-${randomUUID()}`,
        });
  const businessEventIngress =
    businessEventRepository === undefined || eventImpact === undefined
      ? undefined
      : new BusinessEventIngressWorker({
          repository: businessEventRepository,
          processor:
            taskBusinessSync === undefined ||
            remoteTaskRepository === undefined ||
            businessEventRelations === undefined
              ? eventImpact
              : new TaskBusinessEventProcessor({
                  impact: eventImpact,
                  events: businessEventRepository,
                  bindings: remoteTaskRepository,
                  sync: taskBusinessSync,
                  repository: taskBusinessRepository,
                  relations: {
                    async resolve(record, event, subscription) {
                      const provider = await mcpRepository.findServer(subscription.providerId);
                      if (provider === undefined)
                        throw new Error('BUSINESS_EVENT_PROVIDER_NOT_REGISTERED');
                      return businessEventRelations.resolve({
                        endpoint: provider.server.endpoint,
                        headers: secretCipher.decrypt(provider.encryptedCredential),
                        inboxId: record.inboxId,
                        event,
                      });
                    },
                  },
                }),
          clock,
        });
  const businessEventSubscriptions =
    businessEventRepository === undefined || businessEventRuntime === undefined
      ? undefined
      : new BusinessEventSubscriptionService({
          runtime: businessEventRuntime,
          repository: businessEventRepository,
          clock,
          nextSubscriptionId: () => `business-event-subscription-${randomUUID()}`,
          nextInboxId: () => `business-event-inbox-${randomUUID()}`,
          nextContinuityId: () => `business-event-continuity-${randomUUID()}`,
          hash: businessEventHash,
          ...(continuityImpact === undefined
            ? {}
            : {
                onContinuity: (record, providerId) =>
                  continuityImpact.handle(record, providerId).then(() => undefined),
              }),
        });
  const businessEventCoordinator =
    businessEventSubscriptions === undefined
      ? undefined
      : new ProviderSubscriptionCoordinator({
          subscriptions: businessEventSubscriptions,
          clock,
          ...(options.businessEvents?.reconnectDelayMs === undefined
            ? {}
            : { reconnectDelayMs: options.businessEvents.reconnectDelayMs }),
        });
  if (businessEventCoordinator !== undefined)
    businessEventCoordinator.close = cleanupScope.registerSync(
      businessEventCoordinator.close.bind(businessEventCoordinator),
    );

  const businessEventStartedProviders = new Set<string>();
  const startBusinessEventsProvider = async (
    serverId: string,
  ): Promise<'disabled' | 'started' | 'already_running'> => {
    if (businessEventCoordinator === undefined) return 'disabled';
    const provider = await mcpRepository.findServer(serverId);
    if (provider === undefined) throw new Error('BUSINESS_EVENT_PROVIDER_NOT_REGISTERED');
    if (provider.server.protocolMode !== 'frozen_v1')
      throw new Error('BUSINESS_EVENT_PROVIDER_FROZEN_MODE_REQUIRED');
    const channels = await userGoalRuntimeRepository.listBusinessEventDeviceChannels(serverId);
    if (channels.length === 0) return 'disabled';
    const keys = channels.map((identity) => JSON.stringify([serverId, identity ?? null]));
    if (
      businessEventStartedProviders.size +
        keys.filter((key) => !businessEventStartedProviders.has(key)).length >
      (options.businessEvents?.maxSubscriptions ?? 256)
    )
      throw new Error('BUSINESS_EVENTS_MAX_SUBSCRIPTIONS_EXCEEDED');
    let disposition: 'started' | 'already_running' = 'already_running';
    for (const [index, deviceIdentity] of channels.entries()) {
      const current = businessEventCoordinator.start({
        providerId: serverId,
        endpoint: provider.server.endpoint,
        headers: secretCipher.decrypt(provider.encryptedCredential),
        ...(deviceIdentity === undefined ? {} : { deviceIdentity }),
      });
      if (current === 'started') disposition = 'started';
      const key = keys[index];
      if (key !== undefined) businessEventStartedProviders.add(key);
    }
    return disposition;
  };
  let businessEventIngressRunning = false;
  const businessEventIngressTimer =
    businessEventIngress === undefined
      ? undefined
      : setInterval(() => {
          if (businessEventIngressRunning) return;
          businessEventIngressRunning = true;
          void businessEventIngress
            .runOnce()
            .catch((error: unknown) => {
              process.stderr.write(
                `${JSON.stringify({ event: 'business_event_ingress.failed', errorCode: runtimeErrorCode(error), summary: error instanceof Error ? error.message : String(error) })}\n`,
              );
            })
            .finally(() => {
              businessEventIngressRunning = false;
            });
        }, options.businessEvents?.processingIntervalMs ?? 500);
  cleanupScope.registerSync(() => {
    clearInterval(businessEventIngressTimer);
  });

  businessEventIngressTimer?.unref();
  if (businessEventCoordinator !== undefined) {
    const providers = (await mcpRepository.listServers()).filter(
      (provider) => provider.status === 'enabled' && provider.protocolMode === 'frozen_v1',
    );
    if (options.businessEvents?.requiredForRuntimeReady === true && providers.length === 0)
      throw new Error('BUSINESS_EVENTS_REQUIRED_PROVIDER_UNAVAILABLE');
    let started = 0;
    for (const provider of providers) {
      if ((await startBusinessEventsProvider(provider.serverId)) !== 'disabled') started++;
    }
    if (options.businessEvents?.requiredForRuntimeReady === true && started === 0)
      throw new Error('BUSINESS_EVENTS_REQUIRED_PROVIDER_UNAVAILABLE');
  }
  return { businessEventCoordinator, startBusinessEventsProvider, businessEventIngressTimer };
}
