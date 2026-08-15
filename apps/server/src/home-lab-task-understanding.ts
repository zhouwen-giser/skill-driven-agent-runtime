import type {
  SkillTaskBinding,
  TaskAvailabilityArguments,
} from '../../../packages/domain/src/index.js';

import type { ServerRuntimeOptions } from './runtime.js';

export const HOME_LAB_READ_ONLY_COMPOSITE_CAPABILITY_ID = 'home.living-room.read-state';
const HOME_LAB_READ_ONLY_TASK_TYPE_ID = 'task-type.home-lab-living-room-read-state';
const HOME_LAB_READ_ONLY_TASK_TYPE_VERSION = 1;

export const HOME_LAB_GOVERNED_LIGHT_PROFILE = 'home_lab_governed_light_control';
export const HOME_LAB_GOVERNED_LIGHT_READ_CAPABILITY_ID = 'home.light.read-state';
export const HOME_LAB_GOVERNED_LIGHT_CONTROL_CAPABILITY_ID = 'home.light.set-power';
export const HOME_LAB_GOVERNED_LIGHT_SERVER_ID = 'home-lab-light-mcp-g09';
export const HOME_LAB_GOVERNED_LIGHT_BINDING_ID = 'mcp-binding-ha-light-g09';
export const HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID = 'living-room-main-light';
const HOME_LAB_GOVERNED_LIGHT_READ_TASK_TYPE_ID = 'task-type.home-lab-main-light-read-state';
const HOME_LAB_GOVERNED_LIGHT_CONTROL_TASK_TYPE_ID = 'task-type.home-lab-main-light-set-power';
const HOME_LAB_GOVERNED_LIGHT_TASK_TYPE_VERSION = 2;

type HomeLabReadOnlyRuntimeConfigurationInput = Pick<
  ServerRuntimeOptions,
  | 'taskUnderstanding'
  | 'capabilityAuthorityReader'
  | 'currentMcpProviderBindingAuthorityReader'
  | 'skillSelection'
>;

type HomeLabGovernedLightRuntimeConfigurationInput = Pick<
  ServerRuntimeOptions,
  | 'taskUnderstanding'
  | 'capabilityAuthorityReader'
  | 'currentMcpProviderBindingAuthorityReader'
  | 'skillSelection'
  | 'frozenMcpTasks'
  | 'governedControlPrincipalResolver'
>;

export function homeLabReadOnlyTaskUnderstandingConfiguration(): NonNullable<
  ServerRuntimeOptions['taskUnderstanding']
> {
  return Object.freeze({
    profile: 'home_lab_read_only' as const,
    entryPolicy: 'all_requests' as const,
    skillSelectionMode: 'exact_compatible_only' as const,
    taskTypes: Object.freeze([
      Object.freeze({
        taskTypeId: HOME_LAB_READ_ONLY_TASK_TYPE_ID,
        version: HOME_LAB_READ_ONLY_TASK_TYPE_VERSION,
        title: 'Read living-room light and climate state',
        recognitionHints: Object.freeze([
          '客厅主灯',
          '客厅空调',
          'living-room light',
          'living-room climate',
        ]),
        requiredDimensions: Object.freeze([]),
        capabilityRequirements: Object.freeze([HOME_LAB_READ_ONLY_COMPOSITE_CAPABILITY_ID]),
        risks: Object.freeze([]),
      }),
    ]),
    lowRiskUserPreferences: Object.freeze([
      'Return only structured current-state evidence for the allowlisted living-room resources.',
    ]),
    interactiveGoalBudgets: Object.freeze({
      maxClarificationRounds: 2,
      maxContractRevisions: 2,
      maxElapsedMs: 300_000,
    }),
  });
}

export function homeLabGovernedLightTaskUnderstandingConfiguration(): NonNullable<
  ServerRuntimeOptions['taskUnderstanding']
> {
  return Object.freeze({
    profile: HOME_LAB_GOVERNED_LIGHT_PROFILE,
    entryPolicy: 'all_requests' as const,
    skillSelectionMode: 'exact_compatible_only' as const,
    taskTypes: Object.freeze([
      Object.freeze({
        taskTypeId: HOME_LAB_GOVERNED_LIGHT_READ_TASK_TYPE_ID,
        version: HOME_LAB_GOVERNED_LIGHT_TASK_TYPE_VERSION,
        title: 'Read the governed living-room main light state',
        recognitionHints: Object.freeze([
          '读取主灯基线',
          '查询主灯状态',
          'read main light baseline',
          'read main light state',
        ]),
        requiredDimensions: Object.freeze([]),
        capabilityRequirements: Object.freeze([HOME_LAB_GOVERNED_LIGHT_READ_CAPABILITY_ID]),
        risks: Object.freeze([]),
      }),
      Object.freeze({
        taskTypeId: HOME_LAB_GOVERNED_LIGHT_CONTROL_TASK_TYPE_ID,
        version: HOME_LAB_GOVERNED_LIGHT_TASK_TYPE_VERSION,
        title: 'Set the governed living-room main light power',
        recognitionHints: Object.freeze([
          '设置主灯电源',
          '恢复主灯电源',
          'set main light power',
          'restore main light power',
        ]),
        requiredDimensions: Object.freeze([]),
        capabilityRequirements: Object.freeze([HOME_LAB_GOVERNED_LIGHT_CONTROL_CAPABILITY_ID]),
        risks: Object.freeze(['physical_side_effect', 'explicit_confirmation_required']),
      }),
    ]),
    lowRiskUserPreferences: Object.freeze([
      'Use only the public living-room main-light resource and the exact G09 Provider Binding.',
      'Never dispatch a physical control before both immutable-plan and governed-control confirmation.',
    ]),
    interactiveGoalBudgets: Object.freeze({
      maxClarificationRounds: 2,
      maxContractRevisions: 2,
      maxElapsedMs: 300_000,
    }),
  });
}

export function assertHomeLabReadOnlyRuntimeConfiguration(
  options: HomeLabReadOnlyRuntimeConfigurationInput,
): void {
  const configuration = options.taskUnderstanding;
  if (configuration?.profile !== 'home_lab_read_only') return;

  const taskTypes: unknown = configuration.taskTypes;
  const taskType =
    Array.isArray(taskTypes) && taskTypes.length === 1
      ? (taskTypes as readonly unknown[])[0]
      : undefined;
  if (
    configuration.entryPolicy !== 'all_requests' ||
    configuration.skillSelectionMode !== 'exact_compatible_only' ||
    !isCanonicalHomeLabReadOnlyTaskType(taskType)
  )
    throw new Error('HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID');
  if (options.currentMcpProviderBindingAuthorityReader === undefined)
    throw new Error('HOME_LAB_READ_ONLY_PROVIDER_BINDING_AUTHORITY_REQUIRED');
  if (options.capabilityAuthorityReader === undefined)
    throw new Error('HOME_LAB_READ_ONLY_CAPABILITY_AUTHORITY_REQUIRED');
  if (options.skillSelection !== undefined)
    throw new Error('HOME_LAB_READ_ONLY_SKILL_SELECTION_CONFIGURATION_CONFLICT');
}

export function assertHomeLabGovernedLightRuntimeConfiguration(
  options: HomeLabGovernedLightRuntimeConfigurationInput,
): void {
  const configuration = options.taskUnderstanding;
  if (configuration?.profile !== HOME_LAB_GOVERNED_LIGHT_PROFILE) return;
  const taskTypes: unknown = configuration.taskTypes;
  if (
    configuration.entryPolicy !== 'all_requests' ||
    configuration.skillSelectionMode !== 'exact_compatible_only' ||
    !Array.isArray(taskTypes) ||
    taskTypes.length !== 2 ||
    !isCanonicalHomeLabGovernedLightTaskType(
      taskTypes[0],
      HOME_LAB_GOVERNED_LIGHT_READ_TASK_TYPE_ID,
      HOME_LAB_GOVERNED_LIGHT_READ_CAPABILITY_ID,
      false,
    ) ||
    !isCanonicalHomeLabGovernedLightTaskType(
      taskTypes[1],
      HOME_LAB_GOVERNED_LIGHT_CONTROL_TASK_TYPE_ID,
      HOME_LAB_GOVERNED_LIGHT_CONTROL_CAPABILITY_ID,
      true,
    )
  )
    throw new Error('HOME_LAB_GOVERNED_LIGHT_PROFILE_CONFIGURATION_INVALID');
  if (options.currentMcpProviderBindingAuthorityReader === undefined)
    throw new Error('HOME_LAB_GOVERNED_LIGHT_PROVIDER_BINDING_AUTHORITY_REQUIRED');
  if (options.capabilityAuthorityReader === undefined)
    throw new Error('HOME_LAB_GOVERNED_LIGHT_CAPABILITY_AUTHORITY_REQUIRED');
  if (options.skillSelection !== undefined)
    throw new Error('HOME_LAB_GOVERNED_LIGHT_SKILL_SELECTION_CONFIGURATION_CONFLICT');
  if (options.frozenMcpTasks === undefined)
    throw new Error('HOME_LAB_GOVERNED_LIGHT_FROZEN_MCP_TASKS_REQUIRED');
  if (options.governedControlPrincipalResolver === undefined)
    throw new Error('HOME_LAB_GOVERNED_LIGHT_CONTROL_IDENTITY_REQUIRED');
}

export function resolveHomeLabReadOnlyTaskAvailabilityArguments(
  binding: SkillTaskBinding,
): TaskAvailabilityArguments {
  const exactPolicies = Object.freeze([
    Object.freeze({
      taskType: 'light_get_state',
      providerId: 'home-lab-light-mcp',
      resourceId: 'living-room-main-light',
    }),
    Object.freeze({
      taskType: 'climate_get_state',
      providerId: 'home-lab-climate-mcp',
      resourceId: 'living-room-air-conditioner',
    }),
  ]);
  const policy = exactPolicies.find(
    (candidate) =>
      candidate.taskType === binding.taskType &&
      candidate.providerId === binding.providerPolicy.requiredProviderId,
  );
  if (
    policy === undefined ||
    binding.providerPolicy.selection !== 'required' ||
    binding.providerPolicy.preferredProviderIds.length !== 0 ||
    binding.providerPolicy.forbiddenProviderIds.length !== 0 ||
    binding.providerPolicy.requiredAttributes.length !== 1 ||
    binding.providerPolicy.requiredAttributes[0] !== 'task_behavior:synchronous_only'
  )
    throw new Error('HOME_LAB_READ_ONLY_SKILL_TASK_BINDING_NOT_EXACT');
  return Object.freeze({
    unresolved: false as const,
    value: Object.freeze({ resourceId: policy.resourceId }),
  });
}

export function resolveHomeLabGovernedLightTaskAvailabilityArguments(
  binding: SkillTaskBinding,
): TaskAvailabilityArguments {
  const policy = binding.providerPolicy;
  const taskBehavior =
    binding.taskType === 'light_get_state'
      ? 'synchronous_only'
      : binding.taskType === 'light_set_power'
        ? 'task_required'
        : undefined;
  if (
    taskBehavior === undefined ||
    policy.selection !== 'required' ||
    policy.requiredProviderId !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID ||
    policy.preferredProviderIds.length !== 0 ||
    policy.forbiddenProviderIds.length !== 0 ||
    policy.requiredAttributes.length !== 1 ||
    policy.requiredAttributes[0] !== `task_behavior:${taskBehavior}`
  )
    throw new Error('HOME_LAB_GOVERNED_LIGHT_SKILL_TASK_BINDING_NOT_EXACT');
  if (taskBehavior === 'synchronous_only')
    return Object.freeze({
      unresolved: false as const,
      value: Object.freeze({ resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID }),
    });
  return Object.freeze({
    unresolved: true as const,
    knownArguments: Object.freeze({ resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID }),
    unresolvedPaths: Object.freeze(['$.power']),
  });
}

function isCanonicalHomeLabReadOnlyTaskType(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const taskType = value as Readonly<Record<string, unknown>>;
  const requiredDimensions = taskType['requiredDimensions'];
  const capabilityRequirements = taskType['capabilityRequirements'];
  const risks = taskType['risks'];
  // Title and recognition hints guide the model; the authority discriminator is the exact
  // Task Type identity plus its empty dimensions/risks and sole composite Capability requirement.
  return (
    taskType['taskTypeId'] === HOME_LAB_READ_ONLY_TASK_TYPE_ID &&
    taskType['version'] === HOME_LAB_READ_ONLY_TASK_TYPE_VERSION &&
    Array.isArray(requiredDimensions) &&
    requiredDimensions.length === 0 &&
    Array.isArray(capabilityRequirements) &&
    capabilityRequirements.length === 1 &&
    capabilityRequirements[0] === HOME_LAB_READ_ONLY_COMPOSITE_CAPABILITY_ID &&
    Array.isArray(risks) &&
    risks.length === 0
  );
}

function isCanonicalHomeLabGovernedLightTaskType(
  value: unknown,
  taskTypeId: string,
  capabilityId: string,
  sideEffecting: boolean,
): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const taskType = value as Readonly<Record<string, unknown>>;
  const requiredDimensions = taskType['requiredDimensions'];
  const capabilityRequirements = taskType['capabilityRequirements'];
  const risks = taskType['risks'];
  return (
    taskType['taskTypeId'] === taskTypeId &&
    taskType['version'] === HOME_LAB_GOVERNED_LIGHT_TASK_TYPE_VERSION &&
    Array.isArray(requiredDimensions) &&
    requiredDimensions.length === 0 &&
    Array.isArray(capabilityRequirements) &&
    capabilityRequirements.length === 1 &&
    capabilityRequirements[0] === capabilityId &&
    Array.isArray(risks) &&
    (sideEffecting
      ? risks.length === 2 &&
        risks[0] === 'physical_side_effect' &&
        risks[1] === 'explicit_confirmation_required'
      : risks.length === 0)
  );
}
