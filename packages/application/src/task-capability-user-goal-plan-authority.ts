import type { SkillRepository } from './ports.js';
import type { TaskCapabilityAcceptanceStore } from './task-capability.js';
import type {
  UserGoalPlanCandidateAuthority,
  UserGoalPlanCandidateAuthorityResolver,
} from './user-goal-planning.js';

export class TaskCapabilityUserGoalPlanAuthorityResolver implements UserGoalPlanCandidateAuthorityResolver {
  readonly #bindings: Pick<TaskCapabilityAcceptanceStore, 'findBinding'>;
  readonly #skills: Pick<SkillRepository, 'findVersion'>;

  constructor(
    dependencies: Readonly<{
      bindings: Pick<TaskCapabilityAcceptanceStore, 'findBinding'>;
      skills: Pick<SkillRepository, 'findVersion'>;
    }>,
  ) {
    this.#bindings = dependencies.bindings;
    this.#skills = dependencies.skills;
  }

  async resolve(taskId: string): Promise<UserGoalPlanCandidateAuthority | undefined> {
    const binding = await this.#bindings.findBinding(taskId);
    if (binding === undefined) return undefined;
    const references = binding.initialImplementationRefs.map(parseExactSkillReference);
    if (references.length !== 1)
      invalid('The Task Capability must select exactly one Skill implementation for planning.');
    const reference = references[0];
    if (reference === undefined) invalid('The Task Capability Skill reference is missing.');
    const skill = await this.#skills.findVersion(reference.skillId, reference.skillVersion);
    if (
      skill?.status !== 'enabled' ||
      !skill.capabilities.includes(binding.requestedCapabilityId) ||
      skill.outcomeSpecification === undefined
    )
      invalid('The exact Task Capability Skill implementation is not enabled and complete.');
    const evidenceRequirements = binding.evidenceRequirementSnapshot.map((requirement) => {
      const evidenceType = requirement['evidenceType'];
      if (typeof evidenceType !== 'string' || evidenceType.trim() === '')
        return invalid('The Task Capability evidence requirement is invalid.');
      return evidenceType;
    });
    if (
      evidenceRequirements.length === 0 ||
      evidenceRequirements.some(
        (evidenceType) => !skill.outcomeSpecification?.evidence.includes(evidenceType),
      )
    )
      invalid('The Task Capability evidence is not provided by the exact Skill implementation.');
    return Object.freeze({
      capabilityNeeds: Object.freeze([binding.requestedCapabilityId]),
      requiredEffectRefs: Object.freeze([...skill.outcomeSpecification.effects]),
      evidenceRequirements: Object.freeze([...evidenceRequirements]),
      artifactRequirements: Object.freeze([...skill.outcomeSpecification.artifacts]),
    });
  }
}

function parseExactSkillReference(reference: string): Readonly<{
  skillId: string;
  skillVersion: number;
}> {
  const match = /^skill:([^:]+):([1-9]\d*)$/u.exec(reference);
  if (match === null) return invalid('The Task Capability implementation reference is invalid.');
  const skillId = match[1];
  const skillVersion = Number(match[2]);
  if (skillId === undefined || !Number.isSafeInteger(skillVersion))
    return invalid('The Task Capability implementation reference is invalid.');
  return Object.freeze({ skillId, skillVersion });
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), {
    code: 'TASK_CAPABILITY_USER_GOAL_PLAN_AUTHORITY_INVALID' as const,
  });
}
