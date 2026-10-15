import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import type { Pool } from 'pg';
import type {
  McpRuntimeBindingAuthorityVerifier,
  MemoryService,
  ModelRuntimeService,
} from '../../../../packages/application/src/index.js';
import {
  FrozenMcpRegistryService,
  FrozenSkillTaskReadinessAdapter,
  McpProtocolOperationsService,
  McpRegistryService,
  McpTaskReadinessService,
  PersistedSkillSemanticRetriever,
  SkillApplicabilityAssessor,
  SkillContextRequirementResolver,
  SkillModeSelector,
  SkillSelectionService,
  SkillUsageCandidateAssessor,
  StructuredSkillSelectionDecider,
  StructuredTaskRiskDecider,
  type TaskAvailabilityBatchReader,
} from '../../../../packages/application/src/index.js';
import type { Aes256GcmSecretCipher } from '../../../../packages/crypto-adapter/src/index.js';
import type { AjvJsonSchemaValidator } from '../../../../packages/json-schema-adapter/src/index.js';
import { type DeterministicCapabilityExecutionInput } from '../../../../packages/management-api/src/index.js';
import type { FrozenV1McpClient } from '../../../../packages/mcp-adapter/src/index.js';
import {
  createSmppTaskBusinessTransport,
  FrozenV1RegistryAdapter,
  FrozenV1RuntimeAvailabilityAdapter,
  FrozenV1RuntimeLifecycleAdapter,
} from '../../../../packages/mcp-adapter/src/index.js';
import type {
  PostgresAgentTaskRepository,
  PostgresMcpRegistryRepository,
  PostgresSkillGraphRepository,
  PostgresSkillRepository,
  PostgresSkillSelectionRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  PostgresExactSkillPackageAuthorityReader,
  PostgresSkillEmbeddingRepository,
  PostgresTaskAvailabilityEvidenceRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import { type CurrentMcpProviderBindingAuthoritySnapshot } from '../../../../packages/runtime-control-application/src/index.js';
import type {
  GovernedControlInvocationAuthorizer,
  UgvGovernedControlInvocationAuthorizer,
} from '../../../../packages/ugv-profile/src/index.js';
import { deterministicExecutionError } from '.././deterministic-capability-recovery.js';
import {
  createHomeLabGovernedLightSkillSelectionService,
  createHomeLabReadOnlySkillSelectionService,
} from '.././home-lab-skill-selection.js';
import { type ManagedDeterministicReadOnlyAdmission } from '.././managed-deterministic-capability-admission.js';
import { isHistoricalUgvPointSkill } from '.././ugv-agent-profile-catalog.js';
import type { UgvAgentProfileSkillRepositoryView } from '.././ugv-agent-profile.js';
import { UgvMoveTaskBindingResolver } from '.././ugv-move-binding.js';
import { UgvMoveSkillTaskReadinessAdapter } from '.././ugv-move-skill-usage.js';
import { UgvSimulationQualificationService } from '.././ugv-simulation-qualification.js';
import { UGV_UNKNOWN_AVAILABILITY_POLICY } from '.././ugv-unknown-availability-policy.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
export interface composeMcpDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly mcpRepository: PostgresMcpRegistryRepository;
  readonly secretCipher: Aes256GcmSecretCipher;
  readonly schemaValidator: AjvJsonSchemaValidator;
  readonly frozenMcpClient: FrozenV1McpClient;
  readonly clock: { now: () => string };
  readonly ugvAgentProfile: boolean;
  readonly ugvGovernedControlInvocationAuthorizer:
    UgvGovernedControlInvocationAuthorizer | undefined;
  readonly governedControlInvocationAuthorizer: GovernedControlInvocationAuthorizer | undefined;
  readonly tasks: PostgresAgentTaskRepository;
  readonly runtimeMcpBindingAuthority: McpRuntimeBindingAuthorityVerifier;
  readonly ugvAvailabilityTarget: RuntimeValueRef<TaskAvailabilityBatchReader | undefined>;
  readonly pool: Pool;
  readonly modelRuntime: ModelRuntimeService;
  readonly profileSkills: UgvAgentProfileSkillRepositoryView | PostgresSkillRepository;
  readonly skills: PostgresSkillRepository;
  readonly skillGraphRepository: PostgresSkillGraphRepository;
  readonly skillSelectionRepository: PostgresSkillSelectionRepository;
  readonly memories: MemoryService;
  readonly managedCapabilityProfile: boolean;
  readonly homeLabReadOnlyProfile: boolean;
  readonly homeLabGovernedLightProfile: boolean;
}
export function composeMcp(dependencies: composeMcpDependencies) {
  const {
    options,
    mcpRepository,
    secretCipher,
    schemaValidator,
    frozenMcpClient,
    clock,
    ugvAgentProfile,
    ugvGovernedControlInvocationAuthorizer,
    governedControlInvocationAuthorizer,
    tasks,
    runtimeMcpBindingAuthority,
    pool,
    modelRuntime,
    profileSkills,
    skills,
    skillGraphRepository,
    skillSelectionRepository,
    memories,
    managedCapabilityProfile,
    homeLabReadOnlyProfile,
    homeLabGovernedLightProfile,
  } = dependencies;
  const smppTaskBusinessTransport = createSmppTaskBusinessTransport({
    client: frozenMcpClient,
    now: clock.now,
  });
  const mcpRegistry = new McpRegistryService({
    repository: mcpRepository,
    cipher: secretCipher,
    schemas: schemaValidator,
    frozenAvailability: new FrozenV1RuntimeAvailabilityAdapter(frozenMcpClient),
    frozenLifecycle: new FrozenV1RuntimeLifecycleAdapter({
      now: clock.now,
      client: frozenMcpClient,
    }),
    frozenBusinessRead: smppTaskBusinessTransport.read,
    frozenBusinessMutation: smppTaskBusinessTransport.mutation,
    ...(options.currentMcpProviderBindingAuthorityReader === undefined
      ? {}
      : { providerBindings: options.currentMcpProviderBindingAuthorityReader }),
    ...(ugvAgentProfile
      ? ugvGovernedControlInvocationAuthorizer === undefined ||
        governedControlInvocationAuthorizer === undefined
        ? {}
        : {
            controlAuthority: {
              async authorizeAndConsume(input) {
                const task = await tasks.findById(input.taskId);
                return task?.selectedSkillId !== undefined &&
                  task.selectedSkillVersion !== undefined &&
                  isHistoricalUgvPointSkill(task.selectedSkillId, task.selectedSkillVersion)
                  ? ugvGovernedControlInvocationAuthorizer.authorizeAndConsume(input)
                  : governedControlInvocationAuthorizer.authorizeAndConsume(input);
              },
            },
          }
      : governedControlInvocationAuthorizer === undefined
        ? {}
        : { controlAuthority: governedControlInvocationAuthorizer }),
    ...(options.mcpExecutionModeHeaderPolicy === undefined
      ? {}
      : { executionModeHeaderPolicy: options.mcpExecutionModeHeaderPolicy }),
    ...(ugvAgentProfile ? { hardDeniedControlTools: Object.freeze([]) } : {}),
    runtimeBindingAuthority: runtimeMcpBindingAuthority,
    clock,
    ids: {
      nextInvocationId: () => `mcp-invocation-${randomUUID()}`,
      nextManagementOperationId: () => `mcp-management-operation-${randomUUID()}`,
    },
  });
  if (ugvAgentProfile) dependencies.ugvAvailabilityTarget.value = mcpRegistry;
  const mcpProtocolOperations = new McpProtocolOperationsService({
    repository: mcpRepository,
    expectedBaselineSha256: '9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708',
    notificationReconnectComposed: options.frozenMcpTasks !== undefined,
  });
  const frozenMcpRegistry = new FrozenMcpRegistryService({
    repository: mcpRepository,
    discovery: new FrozenV1RegistryAdapter(frozenMcpClient),
    cipher: secretCipher,
    clock,
    nextSnapshotId: () => `mcp-protocol-snapshot-${randomUUID()}`,
    baselineSha256: '9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708',
  });
  const taskAvailabilityEvidence =
    options.frozenMcpTasks === undefined
      ? undefined
      : new PostgresTaskAvailabilityEvidenceRepository(pool);
  const taskReadiness =
    taskAvailabilityEvidence === undefined
      ? undefined
      : new McpTaskReadinessService({
          operations: mcpRepository,
          provider: mcpRegistry,
          evidence: taskAvailabilityEvidence,
          riskDecider: new StructuredTaskRiskDecider(modelRuntime),
          clock,
          ids: {
            nextReadinessId: () => `task-readiness-${randomUUID()}`,
            nextSnapshotId: () => `task-availability-${randomUUID()}`,
          },
          ...(ugvAgentProfile
            ? { providerUnknownPreInvocationPolicy: UGV_UNKNOWN_AVAILABILITY_POLICY }
            : {}),
        });
  const ugvMoveBindingResolver =
    !ugvAgentProfile || options.currentMcpProviderBindingAuthorityReader === undefined
      ? undefined
      : new UgvMoveTaskBindingResolver({
          skills: profileSkills,
          packages: new PostgresExactSkillPackageAuthorityReader(pool),
          operations: mcpRepository,
          availability: mcpRegistry,
          providerBindings: options.currentMcpProviderBindingAuthorityReader,
          runtimeBindings: runtimeMcpBindingAuthority,
          schemas: schemaValidator,
          clock,
          reportReadinessRejection: (diagnostic) => {
            writeSync(2, `${JSON.stringify(diagnostic)}\n`);
          },
        });
  if (ugvAgentProfile && ugvMoveBindingResolver === undefined)
    throw new Error('UGV_AGENT_PROFILE_MOVE_BINDING_RUNTIME_REQUIRED');
  const ugvSimulationQualification =
    ugvMoveBindingResolver === undefined
      ? undefined
      : new UgvSimulationQualificationService({
          registry: mcpRegistry,
          authority: ugvMoveBindingResolver,
          clock,
        });
  const skillTaskReadiness = new FrozenSkillTaskReadinessAdapter({
    operations: mcpRepository,
    availability: mcpRegistry,
    clock,
    ...(options.currentMcpProviderBindingAuthorityReader === undefined
      ? {}
      : { providerBindings: options.currentMcpProviderBindingAuthorityReader }),
  });
  const skillUsage = new SkillUsageCandidateAssessor({
    applicability: new SkillApplicabilityAssessor({
      contexts: new SkillContextRequirementResolver(),
      readiness: skillTaskReadiness,
    }),
    modes: new SkillModeSelector(),
  });
  const ugvSkillUsage =
    ugvMoveBindingResolver === undefined
      ? undefined
      : new SkillUsageCandidateAssessor({
          applicability: new SkillApplicabilityAssessor({
            contexts: new SkillContextRequirementResolver(),
            readiness: new UgvMoveSkillTaskReadinessAdapter(ugvMoveBindingResolver),
          }),
          modes: new SkillModeSelector(),
        });
  const profileSkillUsage = {
    assess(
      skill: Parameters<SkillUsageCandidateAssessor['assess']>[0],
      context: Parameters<SkillUsageCandidateAssessor['assess']>[1],
    ) {
      return ugvSkillUsage !== undefined && isHistoricalUgvPointSkill(skill.skillId, skill.version)
        ? ugvSkillUsage.assess(skill, context)
        : skillUsage.assess(skill, context);
    },
  };
  const createDeterministicSkillSelection = (
    input: DeterministicCapabilityExecutionInput,
    contract: Pick<ManagedDeterministicReadOnlyAdmission, 'readinessAttributes'>,
    providerBinding: CurrentMcpProviderBindingAuthoritySnapshot,
  ) => {
    const exactReadiness = new FrozenSkillTaskReadinessAdapter({
      operations: {
        async listTaskOperationCandidates(taskType) {
          const candidates = await mcpRepository.listTaskOperationCandidates(taskType);
          return Object.freeze(
            candidates.map((candidate) =>
              candidate.providerId === input.serverId && candidate.operationName === input.toolName
                ? Object.freeze({
                    ...candidate,
                    attributes: Object.freeze([
                      ...new Set([...candidate.attributes, ...contract.readinessAttributes]),
                    ]),
                  })
                : candidate,
            ),
          );
        },
      },
      availability: mcpRegistry,
      clock,
      providerBindings: {
        loadCurrentMcpProviderBinding(authorityInput) {
          if (
            authorityInput.localServerId !== input.serverId ||
            (authorityInput.bindingId !== undefined &&
              authorityInput.bindingId !== input.mcpProviderBindingId) ||
            providerBinding.binding.bindingId !== input.mcpProviderBindingId ||
            providerBinding.binding.localServerId !== input.serverId
          )
            throw deterministicExecutionError(
              'DETERMINISTIC_PROVIDER_BINDING_NOT_CURRENT',
              'Readiness requires the exact already admitted current Provider Binding.',
            );
          return Promise.resolve(providerBinding);
        },
      },
      resolveArguments: (binding) => {
        if (
          binding.taskType !== input.toolName ||
          binding.providerPolicy.selection !== 'required' ||
          binding.providerPolicy.requiredProviderId !== input.serverId
        )
          throw deterministicExecutionError(
            'DETERMINISTIC_SKILL_TASK_BINDING_NOT_EXACT',
            'Resolved availability arguments require the exact governed Task binding.',
          );
        return Object.freeze({
          unresolved: false as const,
          value: Object.freeze({ resourceId: input.resourceId }),
        });
      },
    });
    const exactUsage = new SkillUsageCandidateAssessor({
      applicability: new SkillApplicabilityAssessor({
        contexts: new SkillContextRequirementResolver(),
        readiness: exactReadiness,
      }),
      modes: new SkillModeSelector(),
    });
    return new SkillSelectionService({
      skills,
      graph: skillGraphRepository,
      records: skillSelectionRepository,
      retriever: {
        score: (_goalContract, candidates) =>
          Promise.resolve(
            Object.freeze(
              Object.fromEntries(candidates.map((candidate) => [candidate.skillId, 1])),
            ),
          ),
      },
      decider: {
        decide: ({ candidates }) => {
          const candidate = candidates[0];
          if (candidate === undefined || candidates.length !== 1)
            throw deterministicExecutionError(
              'DETERMINISTIC_SKILL_SELECTION_NOT_EXACT',
              'Deterministic execution requires exactly one admitted Skill candidate.',
            );
          return Promise.resolve({
            selectedSkillId: candidate.skillId,
            decisionSummary:
              'Exact published Capability implementation selected deterministically.',
          });
        },
      },
      mcpWarnings: mcpRepository,
      usage: exactUsage,
      clock,
      ids: {
        nextSelectionId: () => `skill-selection-deterministic-${randomUUID()}`,
        nextReplacementPlanId: () => `skill-replacement-deterministic-${randomUUID()}`,
      },
    });
  };
  const createDefaultSkillSelection = () =>
    new SkillSelectionService({
      skills,
      graph: skillGraphRepository,
      records: skillSelectionRepository,
      retriever: new PersistedSkillSemanticRetriever({
        embeddings:
          options.skillSelection?.embeddings ??
          Object.freeze({
            embed: (text: string) => modelRuntime.embed('skill_selection', text),
          }),
        repository: new PostgresSkillEmbeddingRepository(pool),
        clock,
      }),
      decider:
        options.skillSelection?.decider ??
        new StructuredSkillSelectionDecider(modelRuntime, memories),
      mcpWarnings: mcpRepository,
      usage: skillUsage,
      clock,
      ids: {
        nextSelectionId: () => `skill-selection-${randomUUID()}`,
        nextReplacementPlanId: () => `skill-replacement-${randomUUID()}`,
      },
    });
  const skillSelection = ugvAgentProfile
    ? new SkillSelectionService({
        skills: profileSkills,
        graph: skillGraphRepository,
        records: skillSelectionRepository,
        retriever: {
          score: (_goalContract, candidates) =>
            Promise.resolve(
              Object.freeze(
                Object.fromEntries(candidates.map((candidate) => [candidate.skillId, 1])),
              ),
            ),
        },
        decider: {
          decide: ({ candidates }) => {
            const candidate = candidates[0];
            if (candidate === undefined || candidates.length !== 1)
              throw new Error('UGV_AGENT_PROFILE_SKILL_SELECTION_NOT_EXACT');
            return Promise.resolve({
              selectedSkillId: candidate.skillId,
              decisionSummary:
                'The UGV Agent Profile selected the exact Task Capability SkillVersion.',
            });
          },
        },
        mcpWarnings: mcpRepository,
        usage:
          ugvSkillUsage === undefined
            ? (() => {
                throw new Error('UGV_AGENT_PROFILE_SKILL_USAGE_RUNTIME_REQUIRED');
              })()
            : {
                assess(skill, context) {
                  return isHistoricalUgvPointSkill(skill.skillId, skill.version)
                    ? ugvSkillUsage.assess(skill, context)
                    : skillUsage.assess(skill, context);
                },
              },
        clock,
        ids: {
          nextSelectionId: () => `skill-selection-ugv-agent-profile-${randomUUID()}`,
          nextReplacementPlanId: () => `skill-replacement-ugv-agent-profile-${randomUUID()}`,
        },
      })
    : options.skillSelection !== undefined || managedCapabilityProfile
      ? createDefaultSkillSelection()
      : homeLabReadOnlyProfile || homeLabGovernedLightProfile
        ? (homeLabGovernedLightProfile
            ? createHomeLabGovernedLightSkillSelectionService
            : createHomeLabReadOnlySkillSelectionService)({
            skills,
            graph: skillGraphRepository,
            records: skillSelectionRepository,
            mcpWarnings: mcpRepository,
            operations: mcpRepository,
            availability: mcpRegistry,
            providerBindings:
              options.currentMcpProviderBindingAuthorityReader ??
              (() => {
                throw new Error(
                  homeLabGovernedLightProfile
                    ? 'HOME_LAB_GOVERNED_LIGHT_PROVIDER_BINDING_AUTHORITY_REQUIRED'
                    : 'HOME_LAB_READ_ONLY_PROVIDER_BINDING_AUTHORITY_REQUIRED',
                );
              })(),
            clock,
            ids: {
              nextSelectionId: () =>
                `skill-selection-${homeLabGovernedLightProfile ? 'home-lab-g09' : 'home-lab'}-${randomUUID()}`,
              nextReplacementPlanId: () =>
                `skill-replacement-${homeLabGovernedLightProfile ? 'home-lab-g09' : 'home-lab'}-${randomUUID()}`,
            },
          })
        : createDefaultSkillSelection();
  return {
    taskReadiness,
    mcpRegistry,
    skillUsage,
    profileSkillUsage,
    skillSelection,
    ugvMoveBindingResolver,
    frozenMcpRegistry,
    createDeterministicSkillSelection,
    mcpProtocolOperations,
    taskAvailabilityEvidence,
    ugvSimulationQualification,
  };
}
