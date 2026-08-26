import type { SkillRepository } from '../../../packages/application/src/index.js';
import type { SkillVersion } from '../../../packages/domain/src/index.js';

import type { ServerRuntimeOptions } from './runtime.js';
import { snapshotUgvMovePositionPolicy } from './ugv-move-position-result.js';

export const UGV_AGENT_PROFILE_ID = 'ugv-agent-profile' as const;
export const UGV_AGENT_PROFILE_SKILL_ID = 'embodied.move_to' as const;
export const UGV_AGENT_PROFILE_SKILL_VERSION = 1 as const;
export const UGV_AGENT_PROFILE_SKILL_REF = 'embodied.move_to@1' as const;
export const UGV_AGENT_PROFILE_CAPABILITY_ID = 'embodied.move' as const;
export const UGV_AGENT_PROFILE_TASK_TYPE_ID = 'task-type.ugv-point-navigation' as const;

const UGV_AGENT_PROFILE_TASK_TYPE = Object.freeze({
  taskTypeId: UGV_AGENT_PROFILE_TASK_TYPE_ID,
  version: 1,
  title: 'Move the UGV to one permitted WGS84 point',
  recognitionHints: Object.freeze([
    '无人车移动到目标点',
    '无人车点导航',
    'move the UGV to a point',
    'UGV point navigation',
  ]),
  requiredDimensions: Object.freeze(['target', 'side_effect_authorization'] as const),
  capabilityRequirements: Object.freeze([UGV_AGENT_PROFILE_CAPABILITY_ID]),
  risks: Object.freeze(['physical_side_effect', 'explicit_plan_confirmation']),
});

/**
 * Deployment composition policy only. Provider discovery never mutates this declaration or creates a
 * Skill. Read operations supply context/evidence; the sole public control is point navigation.
 */
export const UGV_AGENT_PROFILE_OPERATION_POLICY = Object.freeze({
  profileId: UGV_AGENT_PROFILE_ID,
  resourceId: 'vehicle:ugv1',
  publicSkillAllowlist: Object.freeze([UGV_AGENT_PROFILE_SKILL_REF]),
  contextAndEvidenceReadOperations: Object.freeze([
    Object.freeze({ operationName: 'vehicle_get_state', purpose: 'initial_context' as const }),
    Object.freeze({
      operationName: 'vehicle_get_state',
      purpose: 'final_position_evidence' as const,
    }),
  ]),
  governedControlOperations: Object.freeze([
    Object.freeze({
      operationName: 'vehicle_navigate',
      missionType: 'point' as const,
      confirmation: 'existing_outer_plan_confirmation' as const,
    }),
  ]),
  forbiddenPlannerOperations: Object.freeze([
    'vehicle_area_recon',
    'vehicle_track_target',
    'vehicle_control_gimbal',
    'vehicle_fire_weapon',
    'vehicle_emergency_stop',
  ]),
  emergencyStopAuthority: 'manual_operator_only' as const,
});

type UgvAgentProfileRuntimeConfigurationInput = Pick<
  ServerRuntimeOptions,
  | 'ugvExecutionMode'
  | 'runtimeBindingScope'
  | 'taskUnderstanding'
  | 'capabilityAuthorityReader'
  | 'currentMcpProviderBindingAuthorityReader'
  | 'skillSelection'
  | 'frozenMcpTasks'
  | 'governedControlPrincipalResolver'
  | 'evidenceEnvironment'
  | 'ugvMovePositionPolicy'
>;

export function ugvAgentProfileTaskUnderstandingConfiguration(): NonNullable<
  ServerRuntimeOptions['taskUnderstanding']
> {
  return Object.freeze({
    profile: UGV_AGENT_PROFILE_ID,
    entryPolicy: 'all_requests' as const,
    skillSelectionMode: 'exact_compatible_only' as const,
    taskTypes: Object.freeze([UGV_AGENT_PROFILE_TASK_TYPE]),
    lowRiskUserPreferences: Object.freeze([
      'Use vehicle_get_state only for authoritative context and final-position evidence.',
      'Expose only governed point navigation; never infer reconnaissance, tracking, gimbal, fire, or emergency-stop authority.',
      'Do not report completion until fresh final-position evidence satisfies the configured distance tolerance.',
    ]),
    interactiveGoalBudgets: Object.freeze({
      maxClarificationRounds: 2,
      maxContractRevisions: 2,
      maxElapsedMs: 600_000,
    }),
  });
}

export function assertUgvAgentProfileRuntimeConfiguration(
  options: UgvAgentProfileRuntimeConfigurationInput,
): void {
  const configuration = options.taskUnderstanding;
  if (configuration?.profile !== UGV_AGENT_PROFILE_ID) return;
  if (
    options.ugvExecutionMode === 'live'
      ? options.evidenceEnvironment !== 'development' ||
        options.runtimeBindingScope?.environment !== 'development'
      : options.evidenceEnvironment !== 'test' && options.evidenceEnvironment !== 'integration'
  )
    throw new Error('UGV_AGENT_PROFILE_SIMULATION_ENVIRONMENT_REQUIRED');
  const taskType = configuration.taskTypes[0];
  if (
    configuration.entryPolicy !== 'all_requests' ||
    configuration.skillSelectionMode !== 'exact_compatible_only' ||
    configuration.taskTypes.length !== 1 ||
    taskType?.taskTypeId !== UGV_AGENT_PROFILE_TASK_TYPE_ID ||
    taskType.version !== 1 ||
    !sameStrings(taskType.requiredDimensions, UGV_AGENT_PROFILE_TASK_TYPE.requiredDimensions) ||
    !sameStrings(
      taskType.capabilityRequirements,
      UGV_AGENT_PROFILE_TASK_TYPE.capabilityRequirements,
    ) ||
    !sameStrings(taskType.risks, UGV_AGENT_PROFILE_TASK_TYPE.risks)
  )
    throw new Error('UGV_AGENT_PROFILE_CONFIGURATION_INVALID');
  if (options.capabilityAuthorityReader === undefined)
    throw new Error('UGV_AGENT_PROFILE_CAPABILITY_AUTHORITY_REQUIRED');
  if (options.currentMcpProviderBindingAuthorityReader === undefined)
    throw new Error('UGV_AGENT_PROFILE_PROVIDER_BINDING_AUTHORITY_REQUIRED');
  if (options.skillSelection !== undefined)
    throw new Error('UGV_AGENT_PROFILE_SKILL_SELECTION_CONFIGURATION_CONFLICT');
  if (options.frozenMcpTasks === undefined)
    throw new Error('UGV_AGENT_PROFILE_FROZEN_MCP_TASKS_REQUIRED');
  if (options.governedControlPrincipalResolver === undefined)
    throw new Error('UGV_AGENT_PROFILE_CONTROL_IDENTITY_REQUIRED');
  snapshotUgvMovePositionPolicy(options.ugvMovePositionPolicy);
}

/**
 * Projects the deployment profile from PostgreSQL-authoritative enabled versions. Absence is a valid
 * empty projection so a normal disable + Capability rebuild removes the public declaration.
 */
export function projectUgvAgentProfileEnabledSkills(
  enabledSkills: readonly SkillVersion[],
): readonly SkillVersion[] {
  const exact = enabledSkills.filter(
    (skill) =>
      skill.skillId === UGV_AGENT_PROFILE_SKILL_ID &&
      skill.version === UGV_AGENT_PROFILE_SKILL_VERSION &&
      skill.status === 'enabled',
  );
  if (exact.length > 1) throw new Error('UGV_AGENT_PROFILE_EXACT_SKILL_AMBIGUOUS');
  const skill = exact[0];
  if (skill === undefined) return Object.freeze([]);
  assertUgvAgentProfileSkillDeclaration(skill);
  return Object.freeze([skill]);
}

/** A read-only exact-version view used by selection; the formal Skill Registry remains authoritative. */
export class UgvAgentProfileSkillRepositoryView implements SkillRepository {
  readonly #source: SkillRepository;

  constructor(source: SkillRepository) {
    this.#source = source;
  }

  async find(skillId: string) {
    if (skillId !== UGV_AGENT_PROFILE_SKILL_ID) return undefined;
    const skill = await this.#source.find(skillId);
    return skill?.currentVersion === UGV_AGENT_PROFILE_SKILL_VERSION ? skill : undefined;
  }

  async findCurrentVersion(skillId: string) {
    if (skillId !== UGV_AGENT_PROFILE_SKILL_ID) return undefined;
    const skill = await this.#source.findCurrentVersion(skillId);
    return skill?.version === UGV_AGENT_PROFILE_SKILL_VERSION ? skill : undefined;
  }

  async findVersion(skillId: string, version: number) {
    if (skillId !== UGV_AGENT_PROFILE_SKILL_ID || version !== UGV_AGENT_PROFILE_SKILL_VERSION)
      return undefined;
    return this.#source.findVersion(skillId, version);
  }

  async listVersions(skillId: string) {
    if (skillId !== UGV_AGENT_PROFILE_SKILL_ID) return Object.freeze([]);
    return Object.freeze(
      (await this.#source.listVersions(skillId)).filter(
        (skill) => skill.version === UGV_AGENT_PROFILE_SKILL_VERSION,
      ),
    );
  }

  async listEnabledVersions() {
    return projectUgvAgentProfileEnabledSkills(await this.#source.listEnabledVersions());
  }

  async listCurrentVersions() {
    return Object.freeze(
      (await this.#source.listCurrentVersions()).filter(
        (skill) =>
          skill.skillId === UGV_AGENT_PROFILE_SKILL_ID &&
          skill.version === UGV_AGENT_PROFILE_SKILL_VERSION,
      ),
    );
  }

  saveVersionAndSetCurrent(
    ...arguments_: Parameters<SkillRepository['saveVersionAndSetCurrent']>
  ): Promise<void> {
    void arguments_;
    return Promise.reject(new Error('UGV_AGENT_PROFILE_SKILL_CATALOG_READ_ONLY'));
  }
}

export function useManagedAgentCardForProfile(profile: string | undefined): boolean {
  return profile !== UGV_AGENT_PROFILE_ID;
}

function assertUgvAgentProfileSkillDeclaration(skill: SkillVersion): void {
  const usage = skill.usageSpecification;
  const binding = usage?.taskBindings[0];
  if (
    skill.capabilities.length !== 2 ||
    skill.capabilities[0] !== UGV_AGENT_PROFILE_CAPABILITY_ID ||
    skill.capabilities[1] !== 'embodied.navigation' ||
    usage?.visibility.userSelectable !== true ||
    usage.visibility.internalOnly ||
    usage.taskBindings.length !== 1 ||
    binding?.taskType !== UGV_AGENT_PROFILE_CAPABILITY_ID ||
    !usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence ||
    !usage.evidencePolicy.requirements.some(
      (requirement) =>
        requirement.required &&
        requirement.hardGate &&
        requirement.evidenceType === 'position.observation',
    )
  )
    throw new Error('UGV_AGENT_PROFILE_SKILL_DECLARATION_INVALID');
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
