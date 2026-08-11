import { describe, expect, it } from 'vitest';

import {
  HOME_LAB_READ_ONLY_COMPOSITE_CAPABILITY_ID,
  assertHomeLabReadOnlyRuntimeConfiguration,
  homeLabReadOnlyTaskUnderstandingConfiguration,
  resolveHomeLabReadOnlyTaskAvailabilityArguments,
} from '../src/home-lab-task-understanding.js';

type StartupConfiguration = Parameters<typeof assertHomeLabReadOnlyRuntimeConfiguration>[0];

const capabilityAuthorityReader: NonNullable<StartupConfiguration['capabilityAuthorityReader']> = {
  load: () => Promise.reject(new Error('must not load Capability authority during validation')),
};
const currentProviderBindingAuthorityReader: NonNullable<
  StartupConfiguration['currentMcpProviderBindingAuthorityReader']
> = {
  loadCurrentMcpProviderBinding: () =>
    Promise.reject(new Error('must not load Binding authority during validation')),
};
const configuredSkillSelection: NonNullable<StartupConfiguration['skillSelection']> = {
  embeddings: {
    embed: () => Promise.resolve({ providerId: 'unused', vector: [1] }),
  },
};

const validStartupConfiguration = Object.freeze({
  taskUnderstanding: homeLabReadOnlyTaskUnderstandingConfiguration(),
  capabilityAuthorityReader,
  currentMcpProviderBindingAuthorityReader: currentProviderBindingAuthorityReader,
}) satisfies StartupConfiguration;

function withTaskUnderstanding(overrides: Readonly<Record<string, unknown>>): StartupConfiguration {
  return {
    ...validStartupConfiguration,
    taskUnderstanding: {
      ...homeLabReadOnlyTaskUnderstandingConfiguration(),
      ...overrides,
    },
  };
}

function withStartupConfiguration(
  overrides: Readonly<Record<string, unknown>>,
): StartupConfiguration {
  return { ...validStartupConfiguration, ...overrides };
}

describe('home-lab Task Understanding composition', () => {
  it('uses one exact composite read-only Task Type only under the explicit profile', () => {
    const configuration = homeLabReadOnlyTaskUnderstandingConfiguration();

    expect(configuration).toMatchObject({
      profile: 'home_lab_read_only',
      entryPolicy: 'all_requests',
      skillSelectionMode: 'exact_compatible_only',
      taskTypes: [
        {
          taskTypeId: 'task-type.home-lab-living-room-read-state',
          recognitionHints: ['客厅主灯', '客厅空调', 'living-room light', 'living-room climate'],
          requiredDimensions: [],
          capabilityRequirements: [HOME_LAB_READ_ONLY_COMPOSITE_CAPABILITY_ID],
          risks: [],
        },
      ],
    });
  });

  const canonicalTaskType = homeLabReadOnlyTaskUnderstandingConfiguration().taskTypes[0];
  if (canonicalTaskType === undefined) throw new Error('canonical Task Type missing');

  it.each([
    {
      name: 'accepts the canonical exact profile',
      input: validStartupConfiguration,
    },
    {
      name: 'accepts guidance-only title and recognition-hint changes',
      input: withTaskUnderstanding({
        taskTypes: [{ ...canonicalTaskType, title: 'Guidance only', recognitionHints: [] }],
      }),
    },
    {
      name: 'rejects a missing entry policy',
      input: withTaskUnderstanding({ entryPolicy: undefined }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects a wrong entry policy',
      input: withTaskUnderstanding({ entryPolicy: 'ambiguous_only' }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects a missing Skill selection mode',
      input: withTaskUnderstanding({ skillSelectionMode: undefined }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects a wrong Skill selection mode',
      input: withTaskUnderstanding({ skillSelectionMode: 'model_ranked' }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects missing Task Types',
      input: withTaskUnderstanding({ taskTypes: undefined }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects an empty Task Type list',
      input: withTaskUnderstanding({ taskTypes: [] }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects multiple Task Types',
      input: withTaskUnderstanding({ taskTypes: [canonicalTaskType, canonicalTaskType] }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects a wrong Task Type ID',
      input: withTaskUnderstanding({
        taskTypes: [{ ...canonicalTaskType, taskTypeId: 'task-type.other' }],
      }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects a wrong Task Type version',
      input: withTaskUnderstanding({ taskTypes: [{ ...canonicalTaskType, version: 2 }] }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects a wrong Capability requirement',
      input: withTaskUnderstanding({
        taskTypes: [{ ...canonicalTaskType, capabilityRequirements: ['home.other.read-state'] }],
      }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects non-empty required dimensions',
      input: withTaskUnderstanding({
        taskTypes: [{ ...canonicalTaskType, requiredDimensions: ['room'] }],
      }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects non-empty risks',
      input: withTaskUnderstanding({
        taskTypes: [{ ...canonicalTaskType, risks: ['side_effect'] }],
      }),
      error: 'HOME_LAB_READ_ONLY_PROFILE_CONFIGURATION_INVALID',
    },
    {
      name: 'rejects a missing current Binding authority reader',
      input: withStartupConfiguration({ currentMcpProviderBindingAuthorityReader: undefined }),
      error: 'HOME_LAB_READ_ONLY_PROVIDER_BINDING_AUTHORITY_REQUIRED',
    },
    {
      name: 'rejects a missing Capability authority reader',
      input: withStartupConfiguration({ capabilityAuthorityReader: undefined }),
      error: 'HOME_LAB_READ_ONLY_CAPABILITY_AUTHORITY_REQUIRED',
    },
    {
      name: 'rejects custom Skill selection composition',
      input: withStartupConfiguration({ skillSelection: configuredSkillSelection }),
      error: 'HOME_LAB_READ_ONLY_SKILL_SELECTION_CONFIGURATION_CONFLICT',
    },
    {
      name: 'leaves profile-off generic composition unchanged',
      input: {
        taskUnderstanding: { taskTypes: [], entryPolicy: 'ambiguous_only' },
        skillSelection: configuredSkillSelection,
      } satisfies StartupConfiguration,
    },
  ])('$name', ({ input, error }) => {
    if (error === undefined) {
      expect(() => {
        assertHomeLabReadOnlyRuntimeConfiguration(input);
      }).not.toThrow();
      return;
    }
    expect(() => {
      assertHomeLabReadOnlyRuntimeConfiguration(input);
    }).toThrow(error);
  });

  it('resolves availability only for both exact Task Type and Provider pairs', () => {
    const providerPolicy = (requiredProviderId: string) => ({
      selection: 'required' as const,
      preferredProviderIds: [],
      requiredProviderId,
      forbiddenProviderIds: [],
      requiredAttributes: ['task_behavior:synchronous_only'],
    });
    expect(
      resolveHomeLabReadOnlyTaskAvailabilityArguments({
        bindingId: 'light-binding',
        taskType: 'light_get_state',
        providerPolicy: providerPolicy('home-lab-light-mcp'),
      }),
    ).toEqual({ unresolved: false, value: { resourceId: 'living-room-main-light' } });
    expect(
      resolveHomeLabReadOnlyTaskAvailabilityArguments({
        bindingId: 'climate-binding',
        taskType: 'climate_get_state',
        providerPolicy: providerPolicy('home-lab-climate-mcp'),
      }),
    ).toEqual({ unresolved: false, value: { resourceId: 'living-room-air-conditioner' } });
    expect(() =>
      resolveHomeLabReadOnlyTaskAvailabilityArguments({
        bindingId: 'wrong-binding',
        taskType: 'light_get_state',
        providerPolicy: providerPolicy('home-lab-climate-mcp'),
      }),
    ).toThrow('HOME_LAB_READ_ONLY_SKILL_TASK_BINDING_NOT_EXACT');
  });
});
