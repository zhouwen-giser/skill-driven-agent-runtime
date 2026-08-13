import { describe, expect, it } from 'vitest';

import {
  assertManagedCapabilityRuntimeConfiguration,
  managedCapabilityTaskUnderstandingConfiguration,
} from '../src/managed-capability-task-understanding.js';

type StartupConfiguration = Parameters<typeof assertManagedCapabilityRuntimeConfiguration>[0];

const capabilityAuthorityReader: NonNullable<StartupConfiguration['capabilityAuthorityReader']> = {
  load: () => Promise.reject(new Error('validation must not perform an authority read')),
};
const bindingAuthorityReader: NonNullable<
  StartupConfiguration['currentMcpProviderBindingAuthorityReader']
> = {
  loadCurrentMcpProviderBinding: () =>
    Promise.reject(new Error('validation must not perform an authority read')),
};
const customSkillSelection: NonNullable<StartupConfiguration['skillSelection']> = {
  embeddings: { embed: () => Promise.resolve({ providerId: 'unused', vector: [1] }) },
};
const validConfiguration = Object.freeze({
  taskUnderstanding: managedCapabilityTaskUnderstandingConfiguration(),
  capabilityAuthorityReader,
  currentMcpProviderBindingAuthorityReader: bindingAuthorityReader,
}) satisfies StartupConfiguration;

describe('managed Capability Task Understanding composition', () => {
  it('declares the generic vehicle Task Types without a deployment resource identifier', () => {
    const configuration = managedCapabilityTaskUnderstandingConfiguration();

    expect(configuration).toMatchObject({
      profile: 'managed_capability',
      entryPolicy: 'all_requests',
      skillSelectionMode: 'model_ranked',
    });
    expect(configuration.taskTypes.map((definition) => definition.taskTypeId)).toEqual([
      'task-type.vehicle.read-state',
      'task-type.vehicle.read-capabilities',
      'task-type.vehicle.read-targets',
      'task-type.vehicle.navigate',
      'task-type.vehicle.recon',
      'task-type.vehicle.track-target',
      'task-type.vehicle.control-gimbal',
      'task-type.vehicle.emergency-stop',
    ]);
    expect(JSON.stringify(configuration)).not.toContain('vehicle:ugv');
    expect(configuration.taskTypes[0]?.recognitionHints).toContain('无人车当前状态');
    expect(configuration.taskTypes[1]?.recognitionHints).toContain('无人车当前能力');
    expect(
      configuration.taskTypes.find(
        (definition) => definition.taskTypeId === 'task-type.vehicle.navigate',
      ),
    ).toMatchObject({
      capabilityRequirements: ['vehicle.ugv.navigate'],
      risks: ['physical_side_effect', 'explicit_plan_confirmation'],
    });
  });

  it('uses only explicit emergency-stop recognition hints', () => {
    const emergencyStop = managedCapabilityTaskUnderstandingConfiguration().taskTypes.find(
      (definition) => definition.taskTypeId === 'task-type.vehicle.emergency-stop',
    );

    expect(emergencyStop).toMatchObject({
      capabilityRequirements: ['vehicle.ugv.emergency-stop'],
      risks: ['safety_critical_side_effect', 'exact_intent_required', 'explicit_plan_confirmation'],
    });
    expect(emergencyStop?.recognitionHints).not.toContain('stop');
    expect(emergencyStop?.recognitionHints).not.toContain('停');
  });

  it('requires both Node Control authorities and reserves semantic selection composition', () => {
    expect(() => {
      assertManagedCapabilityRuntimeConfiguration(validConfiguration);
    }).not.toThrow();
    expect(() => {
      assertManagedCapabilityRuntimeConfiguration({
        taskUnderstanding: validConfiguration.taskUnderstanding,
        currentMcpProviderBindingAuthorityReader: bindingAuthorityReader,
      });
    }).toThrow('MANAGED_CAPABILITY_CAPABILITY_AUTHORITY_REQUIRED');
    expect(() => {
      assertManagedCapabilityRuntimeConfiguration({
        taskUnderstanding: validConfiguration.taskUnderstanding,
        capabilityAuthorityReader,
      });
    }).toThrow('MANAGED_CAPABILITY_PROVIDER_BINDING_AUTHORITY_REQUIRED');
    expect(() => {
      assertManagedCapabilityRuntimeConfiguration({
        ...validConfiguration,
        skillSelection: customSkillSelection,
      });
    }).toThrow('MANAGED_CAPABILITY_SKILL_SELECTION_CONFIGURATION_CONFLICT');
  });

  it('rejects Task Type or policy drift but leaves other profiles unchanged', () => {
    const canonical = managedCapabilityTaskUnderstandingConfiguration();
    const navigate = canonical.taskTypes.find(
      (definition) => definition.taskTypeId === 'task-type.vehicle.navigate',
    );
    if (navigate === undefined) throw new Error('managed navigate Task Type missing');
    expect(() => {
      assertManagedCapabilityRuntimeConfiguration({
        ...validConfiguration,
        taskUnderstanding: { ...canonical, entryPolicy: 'ambiguous_only' },
      });
    }).toThrow('MANAGED_CAPABILITY_PROFILE_CONFIGURATION_INVALID');
    expect(() => {
      assertManagedCapabilityRuntimeConfiguration({
        ...validConfiguration,
        taskUnderstanding: {
          ...canonical,
          taskTypes: canonical.taskTypes.map((definition) =>
            definition.taskTypeId === navigate.taskTypeId
              ? { ...definition, capabilityRequirements: ['vehicle.ugv.fire-weapon'] }
              : definition,
          ),
        },
      });
    }).toThrow('MANAGED_CAPABILITY_PROFILE_CONFIGURATION_INVALID');
    expect(() => {
      assertManagedCapabilityRuntimeConfiguration({
        taskUnderstanding: { taskTypes: [], entryPolicy: 'ambiguous_only' },
        skillSelection: customSkillSelection,
      });
    }).not.toThrow();
  });
});
