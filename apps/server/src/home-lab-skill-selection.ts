import {
  FrozenSkillTaskReadinessAdapter,
  SkillApplicabilityAssessor,
  SkillContextRequirementResolver,
  SkillModeSelector,
  SkillSelectionService,
  SkillUsageCandidateAssessor,
} from '../../../packages/application/src/index.js';

import {
  HOME_LAB_GOVERNED_LIGHT_BINDING_ID,
  HOME_LAB_GOVERNED_LIGHT_SERVER_ID,
  resolveHomeLabGovernedLightTaskAvailabilityArguments,
  resolveHomeLabReadOnlyTaskAvailabilityArguments,
} from './home-lab-task-understanding.js';

type SelectionDependencies = ConstructorParameters<typeof SkillSelectionService>[0];
type ReadinessDependencies = ConstructorParameters<typeof FrozenSkillTaskReadinessAdapter>[0];

export interface HomeLabReadOnlySkillSelectionDependencies {
  readonly skills: SelectionDependencies['skills'];
  readonly graph: SelectionDependencies['graph'];
  readonly records: SelectionDependencies['records'];
  readonly mcpWarnings: NonNullable<SelectionDependencies['mcpWarnings']>;
  readonly operations: ReadinessDependencies['operations'];
  readonly availability: ReadinessDependencies['availability'];
  readonly providerBindings: NonNullable<ReadinessDependencies['providerBindings']>;
  readonly clock: SelectionDependencies['clock'];
  readonly ids: SelectionDependencies['ids'];
}

/** Explicit production profile composition; it does not replace normal semantic/model selection. */
export function createHomeLabReadOnlySkillSelectionService(
  dependencies: HomeLabReadOnlySkillSelectionDependencies,
): SkillSelectionService {
  const exactProviderBindings: NonNullable<ReadinessDependencies['providerBindings']> = {
    async loadCurrentMcpProviderBinding(input) {
      const bindingId =
        input.localServerId === 'home-lab-light-mcp'
          ? 'mcp-binding-ha-light-lab'
          : input.localServerId === 'home-lab-climate-mcp'
            ? 'mcp-binding-ha-climate-lab'
            : undefined;
      if (bindingId === undefined) throw new Error('HOME_LAB_READ_ONLY_PROVIDER_NOT_EXACT');
      const authority = await dependencies.providerBindings.loadCurrentMcpProviderBinding({
        bindingId,
        localServerId: input.localServerId,
      });
      if (
        authority.binding.bindingId !== bindingId ||
        authority.binding.localServerId !== input.localServerId
      )
        throw new Error('HOME_LAB_READ_ONLY_PROVIDER_BINDING_NOT_EXACT');
      return authority;
    },
  };
  const readiness = new FrozenSkillTaskReadinessAdapter({
    operations: dependencies.operations,
    availability: dependencies.availability,
    clock: dependencies.clock,
    providerBindings: exactProviderBindings,
    resolveArguments: resolveHomeLabReadOnlyTaskAvailabilityArguments,
  });
  const usage = new SkillUsageCandidateAssessor({
    applicability: new SkillApplicabilityAssessor({
      contexts: new SkillContextRequirementResolver(),
      readiness,
    }),
    modes: new SkillModeSelector(),
  });
  return new SkillSelectionService({
    skills: dependencies.skills,
    graph: dependencies.graph,
    records: dependencies.records,
    retriever: {
      score: (_goalContract, candidates) =>
        Promise.resolve(
          Object.freeze(Object.fromEntries(candidates.map((candidate) => [candidate.skillId, 1]))),
        ),
    },
    decider: {
      decide: ({ candidates }) => {
        const candidate = candidates[0];
        if (candidate === undefined || candidates.length !== 1)
          throw new Error('HOME_LAB_READ_ONLY_SKILL_SELECTION_NOT_EXACT');
        return Promise.resolve({
          selectedSkillId: candidate.skillId,
          decisionSummary:
            'The explicit home-lab profile selected its sole compatible ready Skill.',
        });
      },
    },
    mcpWarnings: dependencies.mcpWarnings,
    usage,
    clock: dependencies.clock,
    ids: dependencies.ids,
  });
}

/** Exact G09 selection over the two compatible v3 light Skills; capability admission narrows to one. */
export function createHomeLabGovernedLightSkillSelectionService(
  dependencies: HomeLabReadOnlySkillSelectionDependencies,
): SkillSelectionService {
  const exactProviderBindings: NonNullable<ReadinessDependencies['providerBindings']> = {
    async loadCurrentMcpProviderBinding(input) {
      if (input.localServerId !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID)
        throw new Error('HOME_LAB_GOVERNED_LIGHT_PROVIDER_NOT_EXACT');
      const authority = await dependencies.providerBindings.loadCurrentMcpProviderBinding({
        bindingId: HOME_LAB_GOVERNED_LIGHT_BINDING_ID,
        localServerId: HOME_LAB_GOVERNED_LIGHT_SERVER_ID,
      });
      if (
        authority.binding.bindingId !== HOME_LAB_GOVERNED_LIGHT_BINDING_ID ||
        authority.binding.localServerId !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID
      )
        throw new Error('HOME_LAB_GOVERNED_LIGHT_PROVIDER_BINDING_NOT_EXACT');
      return authority;
    },
  };
  const readiness = new FrozenSkillTaskReadinessAdapter({
    operations: dependencies.operations,
    availability: dependencies.availability,
    clock: dependencies.clock,
    providerBindings: exactProviderBindings,
    resolveArguments: resolveHomeLabGovernedLightTaskAvailabilityArguments,
  });
  const usage = new SkillUsageCandidateAssessor({
    applicability: new SkillApplicabilityAssessor({
      contexts: new SkillContextRequirementResolver(),
      readiness,
    }),
    modes: new SkillModeSelector(),
  });
  return new SkillSelectionService({
    skills: dependencies.skills,
    graph: dependencies.graph,
    records: dependencies.records,
    retriever: {
      score: (_goalContract, candidates) =>
        Promise.resolve(
          Object.freeze(Object.fromEntries(candidates.map((candidate) => [candidate.skillId, 1]))),
        ),
    },
    decider: {
      decide: ({ candidates }) => {
        const candidate = candidates[0];
        if (candidate === undefined || candidates.length !== 1)
          throw new Error('HOME_LAB_GOVERNED_LIGHT_SKILL_SELECTION_NOT_EXACT');
        return Promise.resolve({
          selectedSkillId: candidate.skillId,
          decisionSummary:
            'The G09 profile selected the sole exact compatible v3 main-light Skill.',
        });
      },
    },
    mcpWarnings: dependencies.mcpWarnings,
    usage,
    clock: dependencies.clock,
    ids: dependencies.ids,
  });
}
