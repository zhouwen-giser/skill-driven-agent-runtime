import { TaskCapabilityError } from './task-capability.js';
import type { SkillVersion, TaskCapabilityBinding } from '../../domain/src/index.js';
import type {
  SkillInputResolutionService,
  ResolveTopLevelSkillInput,
} from './skill-input-resolution.js';

export function admitCapabilitySkillVersions(
  binding: TaskCapabilityBinding | undefined,
  candidates: readonly SkillVersion[],
): readonly SkillVersion[] {
  if (binding === undefined) return candidates;
  const allowed = new Set(binding.initialImplementationRefs);
  return candidates.filter((skill) =>
    allowed.has(`skill:${skill.skillId}:${String(skill.version)}`),
  );
}

/** The durable admission input is user authority, including after a clarification/restart. */
export class CapabilityBoundSkillInputResolver {
  constructor(
    private readonly bindings: Readonly<{
      findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
    }>,
    private readonly delegate: Pick<SkillInputResolutionService, 'resolve' | 'resolveExact'>,
  ) {}
  async resolve(input: ResolveTopLevelSkillInput) {
    const binding = await this.bindings.findBinding(input.task.taskId);
    if (binding === undefined) return this.delegate.resolve(input);
    if (admitCapabilitySkillVersions(binding, [input.skill]).length !== 1)
      throw new TaskCapabilityError(
        'TASK_CAPABILITY_SKILL_NOT_ADMITTED',
        'The selected Skill version is outside the frozen capability binding.',
      );
    return this.delegate.resolveExact({
      ...input,
      structuredInput: binding.inputSnapshot,
      sourceRef: `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}`,
    });
  }
}
