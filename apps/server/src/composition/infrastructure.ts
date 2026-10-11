import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  ArtifactOutboxConsumer,
  ArtifactRegistryProjectionEventHandler,
  ArtifactRegistryService,
  InMemoryArtifactActiveIndexProjection,
  InMemoryTaskStateNotifier,
  ModelRuntimeBootstrapService,
  parseArtifactFeatureFlags,
  type SkillUsageSlotChoice,
} from '../../../../packages/application/src/index.js';
import { Aes256GcmSecretCipher } from '../../../../packages/crypto-adapter/src/index.js';
import {
  type AgentTask,
  type GoalExecutionContract,
  type SkillUsageSelectionContext,
  type SkillVersion,
} from '../../../../packages/domain/src/index.js';
import {
  FrozenV1McpClient,
  createMcpOutboundFetch,
} from '../../../../packages/mcp-adapter/src/index.js';
import { PostgresGowmDeviceContextReader } from '../../../../packages/persistence-postgres/src/gowm-device-context.js';
import {
  gowmSharedPoolConfiguration,
  verifyGowmStorageContract,
} from '../../../../packages/persistence-postgres/src/gowm-storage-contract.js';
import {
  PostgresAgentTaskCommandContext,
  PostgresAgentTaskRepository,
  PostgresArtifactOutboxConsumerRepository,
  PostgresArtifactRepository,
  PostgresConversationContextRepository,
  PostgresEvolutionExperienceRepository,
  PostgresEvolutionPolicyRepository,
  PostgresGoalRepository,
  PostgresMcpRegistryRepository,
  PostgresModelRuntimeBootstrapRepository,
  PostgresRuntimeEventPublisher,
  PostgresSkillDraftRepository,
  PostgresSkillGraphRepository,
  PostgresSkillRepository,
  PostgresSkillSelectionRepository,
  PostgresTaskInputRepository,
  PostgresTemporarySkillRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  BullMqContextTaskQueue,
  ContextSerialExecutor,
} from '../../../../packages/runtime-redis/src/index.js';
import { createGowmTaskOwnershipResolver } from '.././gowm-task-ownership.js';
import {
  HOME_LAB_GOVERNED_LIGHT_PROFILE,
  assertHomeLabGovernedLightRuntimeConfiguration,
  assertHomeLabReadOnlyRuntimeConfiguration,
} from '.././home-lab-task-understanding.js';
import { assertManagedCapabilityRuntimeConfiguration } from '.././managed-capability-task-understanding.js';
import {
  UGV_AGENT_PROFILE_ID,
  UgvAgentProfileSkillRepositoryView,
  assertUgvAgentProfileRuntimeConfiguration,
} from '.././ugv-agent-profile.js';
import { snapshotUgvMovePositionPolicy } from '.././ugv-move-position-result.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import {
  applyRuntimeMigrations,
  assertV122RuntimeReady,
  conservativeSkillUsageSelectionContext,
} from './runtime-support.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
export interface composeInfrastructureDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly artifactOutboxConsumer: RuntimeValueRef<ArtifactOutboxConsumer | undefined>;
  readonly artifactRegistry: RuntimeValueRef<ArtifactRegistryService | undefined>;
}
export async function composeInfrastructure(dependencies: composeInfrastructureDependencies) {
  dependencies.artifactRegistry.value = undefined;
  dependencies.artifactOutboxConsumer.value = undefined;
  const { cleanupScope, options } = dependencies;
  assertHomeLabReadOnlyRuntimeConfiguration(options);
  assertHomeLabGovernedLightRuntimeConfiguration(options);
  assertManagedCapabilityRuntimeConfiguration(options);
  assertUgvAgentProfileRuntimeConfiguration(options);
  const homeLabReadOnlyProfile = options.taskUnderstanding?.profile === 'home_lab_read_only';
  const homeLabGovernedLightProfile =
    options.taskUnderstanding?.profile === HOME_LAB_GOVERNED_LIGHT_PROFILE;
  const managedCapabilityProfile = options.taskUnderstanding?.profile === 'managed_capability';
  const ugvAgentProfile = options.taskUnderstanding?.profile === UGV_AGENT_PROFILE_ID;
  const ugvMovePositionPolicy = ugvAgentProfile
    ? snapshotUgvMovePositionPolicy(options.ugvMovePositionPolicy)
    : undefined;
  const mcpOutboundFetch = createMcpOutboundFetch({
    allowedAuthorities: options.outboundEndpointPolicy?.mcpAllowedAuthorities,
    unsafeTestOpen: options.outboundEndpointPolicy?.unsafeTestOpen === true,
  });
  const frozenMcpClient = new FrozenV1McpClient(mcpOutboundFetch);
  if (options.businessEvents !== undefined && options.frozenMcpTasks === undefined)
    throw new Error('BUSINESS_EVENTS_REQUIRES_FROZEN_MCP_TASKS_RUNTIME');
  // Deployment controls are parsed before opening infrastructure connections so
  // malformed values fail closed without partially starting the runtime.
  const artifactFlags = parseArtifactFeatureFlags(process.env);
  const pool = new Pool(
    options.gowmStorage === undefined
      ? { connectionString: options.postgresUrl, max: 10 }
      : gowmSharedPoolConfiguration(options.gowmStorage.databaseUrl),
  );
  const originalPoolEnd = pool.end.bind(pool);
  Object.defineProperty(pool, 'end', { value: cleanupScope.register(() => originalPoolEnd()) });

  const taskStateNotifier = new InMemoryTaskStateNotifier();
  taskStateNotifier.close = cleanupScope.registerSync(
    taskStateNotifier.close.bind(taskStateNotifier),
  );

  const publishTaskState = (task: AgentTask) => {
    taskStateNotifier.publish(task);
  };
  if (options.gowmStorage !== undefined) {
    try {
      const client = await pool.connect();
      try {
        await verifyGowmStorageContract(client, options.gowmStorage.contractDirectory);
      } finally {
        client.release();
      }
    } catch (error: unknown) {
      await pool.end();
      throw error;
    }
  } else if (options.applyMigrations === true) {
    await applyRuntimeMigrations(pool);
  } else if (options.frozenMcpTasks !== undefined) {
    await assertV122RuntimeReady(pool);
  }
  const clock = { now: () => new Date().toISOString() };
  const secretCipher = new Aes256GcmSecretCipher(options.masterKeyBase64);
  if (options.modelBootstrap !== undefined) {
    const report = await new ModelRuntimeBootstrapService({
      repository: new PostgresModelRuntimeBootstrapRepository(pool),
      cipher: secretCipher,
      clock,
    }).reconcile(options.modelBootstrap);
    process.stdout.write(
      `${JSON.stringify({
        event: 'model_runtime.bootstrap_reconciled',
        providerId: report.providerId,
        providerRegistered: report.providerRegistered,
        routeCountCreated: report.routesCreated.length,
      })}\n`,
    );
  }
  const artifactAuthorityReady = await pool.query<{
    installed: boolean;
  }>(`SELECT EXISTS(
       SELECT 1 FROM schema_migration WHERE version='0125_v13_artifact_authority'
     ) AS installed`);
  const experienceCompilationReady = await pool.query<{
    installed: boolean;
  }>(`SELECT EXISTS(
       SELECT 1 FROM schema_migration WHERE version='0126_v13_experience_compilation'
     ) AS installed`);
  const candidateGenerationReady = await pool.query<{
    installed: boolean;
  }>(`SELECT EXISTS(
       SELECT 1 FROM schema_migration WHERE version='0128_v13_candidate_generation_runtime'
     ) AS installed`);
  const artifactReplayValidationReady = await pool.query<{
    installed: boolean;
  }>(`SELECT EXISTS(
       SELECT 1 FROM schema_migration WHERE version='0129_v13_artifact_replay_validation'
     ) AS installed`);
  const artifactShadowGovernanceReady = await pool.query<{
    installed: boolean;
  }>(`SELECT EXISTS(
       SELECT 1 FROM schema_migration WHERE version='0130_v13_artifact_shadow_governance'
     ) AS installed`);
  const artifactManagementReady = await pool.query<{
    installed: boolean;
  }>(`SELECT EXISTS(
       SELECT 1 FROM schema_migration WHERE version='0134_v13_artifact_management_projection'
     ) AS installed`);
  if (artifactAuthorityReady.rows[0]?.installed === true && artifactFlags.registryEnabled) {
    dependencies.artifactRegistry.value = new ArtifactRegistryService({
      repository: new PostgresArtifactRepository(pool),
      projection: new InMemoryArtifactActiveIndexProjection(),
    });
    await dependencies.artifactRegistry.value.rebuildProjection();
    dependencies.artifactOutboxConsumer.value = new ArtifactOutboxConsumer({
      consumerName: 'artifact-active-index',
      repository: new PostgresArtifactOutboxConsumerRepository(pool),
      handler: new ArtifactRegistryProjectionEventHandler(dependencies.artifactRegistry.value),
      clock: { now: () => new Date().toISOString() },
    });
    while ((await dependencies.artifactOutboxConsumer.value.consume(500)) === 500) {
      // Bounded page drain; each event is acknowledged transactionally after projection rebuild.
    }
  }
  const contexts = new PostgresConversationContextRepository(pool);
  const goals = new PostgresGoalRepository(pool);
  const taskCommands = new PostgresAgentTaskCommandContext().bindPool(pool);
  const deviceWorkScope =
    options.gowmStorage === undefined
      ? undefined
      : {
          allowedDeviceIds: options.gowmStorage.allowedDeviceIds,
          sdarServiceKey: options.gowmStorage.serviceKey,
          includeNonDevice: options.gowmStorage.includeNonDevice,
        };
  const tasks = new PostgresAgentTaskRepository(
    pool,
    publishTaskState,
    taskCommands,
    deviceWorkScope,
  );
  const resolveDeviceOwnership =
    options.gowmStorage === undefined || deviceWorkScope === undefined
      ? undefined
      : createGowmTaskOwnershipResolver(
          options.gowmStorage,
          new PostgresGowmDeviceContextReader(pool, deviceWorkScope),
        );
  const taskInputs = new PostgresTaskInputRepository(
    pool,
    publishTaskState,
    taskCommands,
    deviceWorkScope,
  );
  const events = new PostgresRuntimeEventPublisher(pool, taskCommands);
  const skillDrafts = new PostgresSkillDraftRepository(pool);
  const skills = new PostgresSkillRepository(pool);
  const profileSkills = ugvAgentProfile
    ? new UgvAgentProfileSkillRepositoryView(
        skills,
        options.ugvAgentProfileSkillScope ??
          (options.evidenceEnvironment === 'development' ? 'all_enabled' : 'profile_reviewed'),
      )
    : skills;
  const skillGraphRepository = new PostgresSkillGraphRepository(pool);
  const skillSelectionRepository = new PostgresSkillSelectionRepository(pool);
  const resolveSkillUsageContext = (
    goalContract: GoalExecutionContract,
    task?: AgentTask,
  ): Promise<SkillUsageSelectionContext> =>
    Promise.resolve(
      options.skillUsageContext?.resolve({
        goalContract,
        ...(task === undefined ? {} : { task }),
      }) ?? conservativeSkillUsageSelectionContext(),
    );
  const resolveSkillUsageSlotChoices = (
    goalContract: GoalExecutionContract,
    skill: SkillVersion,
    value: unknown,
    task?: AgentTask,
  ): Promise<readonly SkillUsageSlotChoice[]> =>
    Promise.resolve(
      options.skillUsageComposition?.resolveSlotChoices({
        goalContract,
        skill,
        value,
        ...(task === undefined ? {} : { task }),
      }) ?? [],
    );
  const mcpRepository = new PostgresMcpRegistryRepository(pool, deviceWorkScope);
  const temporarySkillRepository = new PostgresTemporarySkillRepository(pool, deviceWorkScope);
  const evolutionPolicyRepository = new PostgresEvolutionPolicyRepository(pool);
  const evolutionExperienceRepository = new PostgresEvolutionExperienceRepository(pool);
  const queueName = options.queueName ?? 'sdar-context-tasks';
  const queue = new BullMqContextTaskQueue({ connection: options.redis, queueName });
  queue.close = cleanupScope.register(queue.close.bind(queue));

  const contextSerial = new ContextSerialExecutor();
  const ids = { nextId: (kind: 'context' | 'task' | 'event') => `${kind}-${randomUUID()}` };
  return {
    pool,
    clock,
    deviceWorkScope,
    profileSkills,
    ugvAgentProfile,
    evolutionExperienceRepository,
    evolutionPolicyRepository,
    publishTaskState,
    taskInputs,
    queue,
    mcpRepository,
    taskCommands,
    secretCipher,
    experienceCompilationReady,
    artifactFlags,
    candidateGenerationReady,
    skills,
    artifactReplayValidationReady,
    artifactShadowGovernanceReady,
    artifactManagementReady,
    homeLabReadOnlyProfile,
    homeLabGovernedLightProfile,
    managedCapabilityProfile,
    tasks,
    skillGraphRepository,
    skillDrafts,
    frozenMcpClient,
    skillSelectionRepository,
    contextSerial,
    ugvMovePositionPolicy,
    resolveSkillUsageContext,
    resolveSkillUsageSlotChoices,
    goals,
    contexts,
    artifactAuthorityReady,
    resolveDeviceOwnership,
    events,
    ids,
    temporarySkillRepository,
    mcpOutboundFetch,
    queueName,
    taskStateNotifier,
  };
}
