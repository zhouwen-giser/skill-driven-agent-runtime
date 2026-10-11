import type { SkillVersion } from '../../domain/src/skill.js';
import type { RuntimeTaskCapabilityTerminalProof } from '../../domain/src/runtime-terminal-outcome.js';
import { TaskBusinessError, type TaskBusinessProjection } from '../../domain/src/task-business.js';
import { taskBusinessPredicateMatches } from '../../domain/src/task-business-evidence.js';

/** Native terminal proof from immutable published Skill policy and retained original Task facts. */
export function verifiedTaskBusinessOutcomeRefs(
  input: Readonly<{
    taskId: string;
    selectedSkillId?: string;
    selectedSkillVersion?: number;
    workflowSkillVersions: readonly Readonly<{ skillId: string; version: number }>[];
    proof?: RuntimeTaskCapabilityTerminalProof;
    skill: SkillVersion;
    result: unknown;
    projections: readonly TaskBusinessProjection[];
  }>,
) {
  const policy = input.skill.runtimePolicy.taskBusinessEvidencePolicy;
  if (policy === undefined) return undefined;
  const spec = input.skill.outcomeSpecification;
  const own = input.projections.filter((p) => p.identity.operationName === policy.operationName);
  if (
    input.skill.status !== 'enabled' ||
    input.selectedSkillId !== input.skill.skillId ||
    input.selectedSkillVersion !== input.skill.version ||
    !input.workflowSkillVersions.some(
      (version) =>
        version.skillId === input.skill.skillId && version.version === input.skill.version,
    ) ||
    input.proof?.taskId !== input.taskId ||
    !input.skill.capabilities.includes(input.proof.requestedCapabilityId) ||
    !input.skill.validationPassed ||
    spec?.skillId !== input.skill.skillId ||
    spec.skillVersion !== input.skill.version ||
    own.length === 0 ||
    input.projections.some((p) => p.taskId !== input.taskId) ||
    !taskBusinessPredicateMatches(input.result, policy.skillSuccess) ||
    own.some(
      (p) =>
        p.taskId !== input.taskId ||
        p.status !== 'current' ||
        !p.quality.currentStateComplete ||
        !p.quality.requiredObjectsResolved ||
        p.businessOutcome?.policySatisfied !== true ||
        p.businessOutcome.businessStatus !== 'success',
    )
  )
    throw new TaskBusinessError('TASK_BUSINESS_SKILL_SUCCESS_EVIDENCE_INCOMPLETE');
  const refs = own.flatMap((p) =>
    p.objects.flatMap((o) => (o.artifactRef === undefined ? [] : [o.artifactRef.uri])),
  );
  if (refs.length === 0)
    throw new TaskBusinessError('TASK_BUSINESS_SKILL_SUCCESS_EVIDENCE_INCOMPLETE');
  return Object.freeze({
    effectRefs: spec.effects,
    evidenceRefs: Object.freeze([...new Set(refs)]),
    artifactRefs: Object.freeze([...new Set(refs)]),
  });
}
