import type {
  SkillRepository,
  TaskTypeDefinition,
} from '../../../packages/application/src/index.js';
import type { MissingDimensionKind, SkillVersion } from '../../../packages/domain/src/index.js';

import type { ServerRuntimeOptions } from './runtime.js';
import {
  UGV_AGENT_CAPABILITY_CATALOG,
  UGV_PUBLIC_SKILL_IDS,
  UGV_RESOURCE_ID,
  isHistoricalUgvPointSkill,
  ugvCapabilityForSkill,
} from './ugv-agent-profile-catalog.js';
import { snapshotUgvMovePositionPolicy } from './ugv-move-position-result.js';

export const UGV_AGENT_PROFILE_ID = 'ugv-agent-profile' as const;
export const UGV_AGENT_PROFILE_SKILL_ID = 'embodied.move_to' as const;
export const UGV_AGENT_PROFILE_SKILL_VERSION = 1 as const;
export const UGV_AGENT_PROFILE_SKILL_REF = 'embodied.move_to@1' as const;
export const UGV_AGENT_PROFILE_CAPABILITY_ID = 'embodied.move' as const;
export const UGV_AGENT_PROFILE_EXPOSURE_ID = 'a2a.embodied.move' as const;
export const UGV_AGENT_PROFILE_TASK_TYPE_ID = 'task-type.ugv-point-navigation' as const;
export type UgvAgentProfileSkillScope = 'all_enabled' | 'profile_reviewed';

const UGV_AGENT_PROFILE_TASK_TYPES: readonly TaskTypeDefinition[] = Object.freeze(
  UGV_AGENT_CAPABILITY_CATALOG.map((declaration) =>
    Object.freeze({
      taskTypeId: declaration.taskTypeId,
      version: 1,
      title: declaration.title,
      recognitionHints: declaration.recognitionHints,
      requiredDimensions: requiredDimensionsFor(declaration.kind),
      capabilityRequirements: Object.freeze([declaration.capabilityId]),
      risks: Object.freeze(
        declaration.kind === 'read_only'
          ? []
          : declaration.kind === 'weapon_control'
            ? ['critical_side_effect', 'explicit_plan_confirmation', 'weapon_confirmation']
            : declaration.kind === 'emergency_stop'
              ? ['safety_critical_side_effect', 'exact_intent_required']
              : ['physical_side_effect', 'explicit_plan_confirmation'],
      ),
    }),
  ),
);

function requiredDimensionsFor(
  kind: (typeof UGV_AGENT_CAPABILITY_CATALOG)[number]['kind'],
): readonly MissingDimensionKind[] {
  if (kind === 'read_only') return Object.freeze([]);
  if (kind === 'weapon_control')
    return Object.freeze(['target', 'side_effect_authorization', 'human_confirmation_policy']);
  if (kind === 'emergency_stop') return Object.freeze(['target', 'side_effect_authorization']);
  return Object.freeze(['side_effect_authorization']);
}

/**
 * Deployment composition policy only. Provider discovery never mutates this declaration or creates a
 * Skill. Provider discovery never grants authority; only reviewed, published Skill versions enter
 * this projection.
 */
export const UGV_AGENT_PROFILE_OPERATION_POLICY = Object.freeze({
  profileId: UGV_AGENT_PROFILE_ID,
  resourceId: UGV_RESOURCE_ID,
  publicSkillAllowlist: UGV_PUBLIC_SKILL_IDS,
  reviewedCapabilities: UGV_AGENT_CAPABILITY_CATALOG,
  emergencyStopAuthority: 'explicit_human_instruction_or_physical_confirmation' as const,
  weaponAuthority: 'plan_then_exact_weapon_confirmation' as const,
});

type UgvAgentProfileRuntimeConfigurationInput = Pick<
  ServerRuntimeOptions,
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
    taskTypes: UGV_AGENT_PROFILE_TASK_TYPES,
    lowRiskUserPreferences: Object.freeze([
      'Use only the exact UGV Capability selected from the active Agent Card and current Provider Binding.',
      'Never treat Provider health, opaque target data or model prose as control authority.',
      'Do not report completion until the selected Capability evidence policy is satisfied.',
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
    configuration.entryPolicy !== 'all_requests' ||
    configuration.skillSelectionMode !== 'exact_compatible_only' ||
    !sameTaskTypes(configuration.taskTypes, UGV_AGENT_PROFILE_TASK_TYPES)
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
  scope: UgvAgentProfileSkillScope = 'profile_reviewed',
): readonly SkillVersion[] {
  const projected = enabledSkills.filter((skill) => {
    if (
      skill.status !== 'enabled' ||
      (scope === 'profile_reviewed' && !UGV_PUBLIC_SKILL_IDS.includes(skill.skillId))
    )
      return false;
    if (scope === 'profile_reviewed' && skill.skillId === UGV_AGENT_PROFILE_SKILL_ID)
      return skill.version === UGV_AGENT_PROFILE_SKILL_VERSION;
    return true;
  });
  const identities = new Set<string>();
  for (const skill of projected) {
    const identity = `${skill.skillId}@${String(skill.version)}`;
    if (identities.has(identity)) throw new Error('UGV_AGENT_PROFILE_EXACT_SKILL_AMBIGUOUS');
    identities.add(identity);
    if (scope === 'profile_reviewed') assertUgvAgentProfileSkillDeclaration(skill);
  }
  return Object.freeze([...projected].sort(compareSkills));
}

/** A read-only exact-version view used by selection; the formal Skill Registry remains authoritative. */
export class UgvAgentProfileSkillRepositoryView implements SkillRepository {
  readonly #source: SkillRepository;
  readonly #scope: UgvAgentProfileSkillScope;

  constructor(source: SkillRepository, scope: UgvAgentProfileSkillScope = 'profile_reviewed') {
    this.#source = source;
    this.#scope = scope;
  }

  async find(skillId: string) {
    if (!this.#includes(skillId)) return undefined;
    const skill = await this.#source.find(skillId);
    if (skill === undefined) return undefined;
    if (
      this.#scope === 'profile_reviewed' &&
      skillId === UGV_AGENT_PROFILE_SKILL_ID &&
      skill.currentVersion !== UGV_AGENT_PROFILE_SKILL_VERSION
    )
      return undefined;
    return skill;
  }

  async findCurrentVersion(skillId: string) {
    if (!this.#includes(skillId)) return undefined;
    const skill = await this.#source.findCurrentVersion(skillId);
    if (skill?.status !== 'enabled') return undefined;
    if (
      this.#scope === 'profile_reviewed' &&
      skillId === UGV_AGENT_PROFILE_SKILL_ID &&
      skill.version !== UGV_AGENT_PROFILE_SKILL_VERSION
    )
      return undefined;
    if (this.#scope === 'profile_reviewed') assertUgvAgentProfileSkillDeclaration(skill);
    return skill;
  }

  async findVersion(skillId: string, version: number) {
    if (!this.#includes(skillId)) return undefined;
    if (
      this.#scope === 'profile_reviewed' &&
      skillId === UGV_AGENT_PROFILE_SKILL_ID &&
      version !== UGV_AGENT_PROFILE_SKILL_VERSION
    )
      return undefined;
    const skill = await this.#source.findVersion(skillId, version);
    if (skill !== undefined && this.#scope === 'profile_reviewed')
      assertUgvAgentProfileSkillDeclaration(skill);
    return skill;
  }

  async listVersions(skillId: string) {
    if (!this.#includes(skillId)) return Object.freeze([]);
    return Object.freeze(
      (await this.#source.listVersions(skillId)).filter(
        (skill) =>
          this.#scope === 'all_enabled' ||
          skillId !== UGV_AGENT_PROFILE_SKILL_ID ||
          skill.version === UGV_AGENT_PROFILE_SKILL_VERSION,
      ),
    );
  }

  async listEnabledVersions() {
    return projectUgvAgentProfileEnabledSkills(
      await this.#source.listEnabledVersions(),
      this.#scope,
    );
  }

  async listCurrentVersions() {
    return Object.freeze(
      (await this.#source.listCurrentVersions()).filter(
        (skill) =>
          this.#includes(skill.skillId) &&
          (this.#scope === 'all_enabled' ||
            skill.skillId !== UGV_AGENT_PROFILE_SKILL_ID ||
            skill.version === UGV_AGENT_PROFILE_SKILL_VERSION),
      ),
    );
  }

  #includes(skillId: string): boolean {
    return this.#scope === 'all_enabled' || UGV_PUBLIC_SKILL_IDS.includes(skillId);
  }

  saveVersionAndSetCurrent(
    ...arguments_: Parameters<SkillRepository['saveVersionAndSetCurrent']>
  ): Promise<void> {
    void arguments_;
    return Promise.reject(new Error('UGV_AGENT_PROFILE_SKILL_CATALOG_READ_ONLY'));
  }
}

export function useManagedAgentCardForProfile(profile: string | undefined): boolean {
  void profile;
  return true;
}

function assertUgvAgentProfileSkillDeclaration(skill: SkillVersion): void {
  const declaration = ugvCapabilityForSkill(skill.skillId);
  if (declaration === undefined) throw new Error('UGV_AGENT_PROFILE_SKILL_DECLARATION_INVALID');
  if (isHistoricalUgvPointSkill(skill.skillId, skill.version)) {
    assertHistoricalPointSkill(skill);
    return;
  }
  const usage = skill.usageSpecification;
  const bindings = usage?.taskBindings ?? [];
  if (
    !skill.capabilities.includes(declaration.capabilityId) ||
    usage?.visibility.userSelectable !== true ||
    usage.visibility.internalOnly ||
    bindings.length === 0 ||
    bindings.some((binding) => binding.taskType !== declaration.toolName) ||
    !usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence
  )
    throw new Error('UGV_AGENT_PROFILE_SKILL_DECLARATION_INVALID');
}

function assertHistoricalPointSkill(skill: SkillVersion): void {
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

function sameTaskTypes(
  actual: NonNullable<ServerRuntimeOptions['taskUnderstanding']>['taskTypes'],
  expected: NonNullable<ServerRuntimeOptions['taskUnderstanding']>['taskTypes'],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((taskType, index) => {
      const canonical = expected[index];
      return (
        taskType.taskTypeId === canonical?.taskTypeId &&
        taskType.version === canonical.version &&
        sameStrings(taskType.requiredDimensions, canonical.requiredDimensions) &&
        sameStrings(taskType.capabilityRequirements, canonical.capabilityRequirements) &&
        sameStrings(taskType.risks, canonical.risks)
      );
    })
  );
}

function compareSkills(left: SkillVersion, right: SkillVersion): number {
  return left.skillId.localeCompare(right.skillId) || left.version - right.version;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
