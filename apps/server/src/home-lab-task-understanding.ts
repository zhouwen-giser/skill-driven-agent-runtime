import type {
  SkillTaskBinding,
  TaskAvailabilityArguments,
} from '../../../packages/domain/src/index.js';

import type { ServerRuntimeOptions } from './runtime.js';

export const HOME_LAB_READ_ONLY_COMPOSITE_CAPABILITY_ID = 'home.living-room.read-state';
const HOME_LAB_READ_ONLY_TASK_TYPE_ID = 'task-type.home-lab-living-room-read-state';
const HOME_LAB_READ_ONLY_TASK_TYPE_VERSION = 1;

type HomeLabReadOnlyRuntimeConfigurationInput = Pick<
  ServerRuntimeOptions,
  | 'taskUnderstanding'
  | 'capabilityAuthorityReader'
  | 'currentMcpProviderBindingAuthorityReader'
  | 'skillSelection'
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
