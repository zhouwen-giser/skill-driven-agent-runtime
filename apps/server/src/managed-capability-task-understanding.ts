import type { ServerRuntimeOptions } from './runtime.js';

const MANAGED_TASK_TYPE_VERSION = 1;

const MANAGED_CAPABILITY_TASK_TYPES = Object.freeze([
  taskType(
    'task-type.vehicle.read-state',
    'Read vehicle state',
    ['无人车当前状态', '无人车状态', 'UGV state', '车辆状态', 'vehicle state'],
    'vehicle.ugv.read-state',
    [],
  ),
  taskType(
    'task-type.vehicle.read-capabilities',
    'Read vehicle capabilities',
    ['无人车当前能力', '无人车能力', 'UGV capabilities', '车辆能力', 'vehicle capabilities'],
    'vehicle.ugv.read-capabilities',
    [],
  ),
  taskType(
    'task-type.vehicle.read-targets',
    'Read vehicle targets',
    ['无人车目标列表', 'UGV targets', '车辆目标列表', 'vehicle targets', '目标列表'],
    'vehicle.ugv.read-targets',
    [],
  ),
  taskType(
    'task-type.vehicle.navigate',
    'Navigate a vehicle',
    ['无人车导航', 'UGV navigate', '车辆导航', '向前移动', '前进一米'],
    'vehicle.ugv.navigate',
    ['physical_side_effect', 'explicit_plan_confirmation'],
  ),
  taskType(
    'task-type.vehicle.recon',
    'Run vehicle reconnaissance',
    ['无人车侦察', 'UGV recon', '车辆侦察', '区域侦察'],
    'vehicle.ugv.recon',
    ['physical_side_effect', 'explicit_plan_confirmation'],
  ),
  taskType(
    'task-type.vehicle.track-target',
    'Track a target with a vehicle',
    ['无人车跟踪目标', 'UGV track target', '车辆跟踪目标', '跟踪目标', '追踪目标'],
    'vehicle.ugv.track-target',
    ['physical_side_effect', 'explicit_plan_confirmation'],
  ),
  taskType(
    'task-type.vehicle.control-gimbal',
    'Control a vehicle gimbal',
    ['无人车控制云台', 'UGV gimbal', '车辆控制云台', '控制云台'],
    'vehicle.ugv.control-gimbal',
    ['physical_side_effect', 'explicit_plan_confirmation'],
  ),
  taskType(
    'task-type.vehicle.emergency-stop',
    'Emergency-stop a vehicle',
    ['无人车急停', 'UGV emergency stop', '车辆急停', '紧急停止', 'emergency stop'],
    'vehicle.ugv.emergency-stop',
    ['safety_critical_side_effect', 'exact_intent_required', 'explicit_plan_confirmation'],
  ),
]);

type ManagedCapabilityRuntimeConfigurationInput = Pick<
  ServerRuntimeOptions,
  | 'taskUnderstanding'
  | 'capabilityAuthorityReader'
  | 'currentMcpProviderBindingAuthorityReader'
  | 'skillSelection'
>;

export function managedCapabilityTaskUnderstandingConfiguration(): NonNullable<
  ServerRuntimeOptions['taskUnderstanding']
> {
  return Object.freeze({
    profile: 'managed_capability' as const,
    entryPolicy: 'all_requests' as const,
    skillSelectionMode: 'model_ranked' as const,
    taskTypes: MANAGED_CAPABILITY_TASK_TYPES,
    lowRiskUserPreferences: Object.freeze([
      'Use only exact public resource identifiers supplied by the user or by a single-value governed schema.',
      'Never interpret ambiguous stop language as an emergency-stop authorization.',
    ]),
    interactiveGoalBudgets: Object.freeze({
      maxClarificationRounds: 4,
      maxContractRevisions: 4,
      maxElapsedMs: 900_000,
    }),
  });
}

export function assertManagedCapabilityRuntimeConfiguration(
  options: ManagedCapabilityRuntimeConfigurationInput,
): void {
  const configuration = options.taskUnderstanding;
  if (configuration?.profile !== 'managed_capability') return;
  if (
    configuration.entryPolicy !== 'all_requests' ||
    configuration.skillSelectionMode !== 'model_ranked' ||
    !isCanonicalManagedTaskTypeSet(configuration.taskTypes)
  ) {
    throw new Error('MANAGED_CAPABILITY_PROFILE_CONFIGURATION_INVALID');
  }
  if (options.capabilityAuthorityReader === undefined) {
    throw new Error('MANAGED_CAPABILITY_CAPABILITY_AUTHORITY_REQUIRED');
  }
  if (options.currentMcpProviderBindingAuthorityReader === undefined) {
    throw new Error('MANAGED_CAPABILITY_PROVIDER_BINDING_AUTHORITY_REQUIRED');
  }
  if (options.skillSelection !== undefined) {
    throw new Error('MANAGED_CAPABILITY_SKILL_SELECTION_CONFIGURATION_CONFLICT');
  }
}

function taskType(
  taskTypeId: string,
  title: string,
  recognitionHints: readonly string[],
  capabilityId: string,
  risks: readonly string[],
) {
  return Object.freeze({
    taskTypeId,
    version: MANAGED_TASK_TYPE_VERSION,
    title,
    recognitionHints: Object.freeze([...recognitionHints]),
    requiredDimensions: Object.freeze([]),
    capabilityRequirements: Object.freeze([capabilityId]),
    risks: Object.freeze([...risks]),
  });
}

function isCanonicalManagedTaskTypeSet(
  taskTypes: NonNullable<ServerRuntimeOptions['taskUnderstanding']>['taskTypes'],
): boolean {
  if (taskTypes.length !== MANAGED_CAPABILITY_TASK_TYPES.length) return false;
  const expected = new Map(
    MANAGED_CAPABILITY_TASK_TYPES.map((definition) => [definition.taskTypeId, definition]),
  );
  return taskTypes.every((definition) => {
    const canonical = expected.get(definition.taskTypeId);
    if (canonical === undefined) return false;
    return (
      definition.version === canonical.version &&
      definition.requiredDimensions.length === 0 &&
      definition.capabilityRequirements.length === 1 &&
      definition.capabilityRequirements[0] === canonical.capabilityRequirements[0] &&
      sameStrings(definition.risks, canonical.risks) &&
      // Emergency-stop admission uses only explicit phrases; a generic "stop"/"停" hint is unsafe.
      (definition.taskTypeId !== 'task-type.vehicle.emergency-stop' ||
        definition.recognitionHints.every((hint) => !['stop', '停'].includes(hint.trim())))
    );
  });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
