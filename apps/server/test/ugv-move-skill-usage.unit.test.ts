import { describe, expect, it, vi } from 'vitest';

import type { TaskCapabilitySkillUsageAuthority } from '../../../packages/application/src/index.js';
import {
  createTaskCapabilityBinding,
  hashCanonicalEvidenceJson,
  type SkillTaskBinding,
  type TaskCapabilityBinding,
} from '../../../packages/domain/src/index.js';
import {
  createUgvSimulationTargetPolicy,
  projectUgvMoveSkillUsageContext,
  resolveUgvMoveSkillUsageContext,
  UgvMoveSkillTaskReadinessAdapter,
} from '../src/ugv-move-skill-usage.js';

import { selectedUgvTaskOperation } from './ugv-move-workflow-test-fixture.js';

describe('UGV move formal Skill Usage adapter', () => {
  it('projects the exact alias resolution into formal ready Task binding evidence', async () => {
    const selected = selectedUgvTaskOperation();
    const resolve = vi.fn().mockResolvedValue({
      selected,
      adaptedInput: {
        resourceId: selected.resource.resourceId,
        target: { longitude: 112, latitude: 28, frame: 'WGS84' },
        providerArguments: selected.resolvedArguments,
        argumentsHash: selected.argumentsHash,
      },
    });
    const adapter = new UgvMoveSkillTaskReadinessAdapter({ resolve });

    const readiness = await adapter.inspect({
      skillId: 'embodied.move_to',
      skillVersion: 1,
      taskBindings: [binding()],
      allowPreferredProviderFallback: false,
      arguments: { unresolved: false, value: skillInput() },
      executionContext: { mode: 'simulation', simulationId: 'sim-uap-p2-b03' },
    });

    expect(resolve).toHaveBeenCalledWith({
      skillInput: skillInput(),
      executionContext: { mode: 'simulation', simulationId: 'sim-uap-p2-b03' },
    });
    expect(readiness).toEqual({
      overall: 'ready',
      bindings: [
        expect.objectContaining({
          bindingId: 'move-resource',
          taskType: 'embodied.move',
          disposition: 'ready',
          confirmationRequired: true,
          selectedProviderId: 'ugv-runtime-1',
          selectedOperationName: 'vehicle_navigate',
          selectedProtocolMode: 'frozen_v1',
          candidates: [
            expect.objectContaining({
              providerId: 'ugv-runtime-1',
              operationName: 'vehicle_navigate',
              disposition: 'ready',
              selected: true,
              attributes: expect.arrayContaining([
                'task_behavior:task_required',
                'observations',
                'task_notifications',
              ]),
            }),
          ],
        }),
      ],
    });
  });

  it('fails before readiness for unresolved input, fallback, live mode, or a different binding', async () => {
    const resolve = vi.fn();
    const adapter = new UgvMoveSkillTaskReadinessAdapter({ resolve });
    const baseline = {
      skillId: 'embodied.move_to',
      skillVersion: 1,
      taskBindings: [binding()],
      allowPreferredProviderFallback: false,
      arguments: { unresolved: false as const, value: skillInput() },
      executionContext: { mode: 'simulation' as const, simulationId: 'sim-uap-p2-b03' },
    };

    await expect(
      adapter.inspect({
        ...baseline,
        arguments: { unresolved: true, knownArguments: {}, unresolvedPaths: ['$'] },
      }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    await expect(
      adapter.inspect({ ...baseline, allowPreferredProviderFallback: true }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    await expect(
      adapter.inspect({ ...baseline, executionContext: { mode: 'live' } }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    await expect(
      adapter.inspect({
        ...baseline,
        taskBindings: [{ ...binding(), taskType: 'vehicle_navigate' }],
      }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolves planning context from immutable Task and Provider authority without an MCP receipt', () => {
    const binding = capabilityBinding();
    const authority = capabilityAuthority(binding);

    const resolved = resolveUgvMoveSkillUsageContext({ authority, binding });

    const providerContextHash = hashCanonicalEvidenceJson(authority.context.observations);
    const targetPolicy = binding.constraintSnapshot.find(
      (constraint) => constraint['type'] === 'ugv_simulation_target_policy',
    );
    expect(targetPolicy).toEqual({
      type: 'ugv_simulation_target_policy',
      policyId: POLICY_ID,
      revision: 2,
      executionMode: 'simulation',
      resourceId: 'vehicle:ugv1',
      frame: 'WGS84',
      targetAuthority: 'task_capability_input_snapshot',
      targetDerivation: 'forbidden',
      distanceLimit: 'none',
      altitudePolicy: 'not_commanded_not_terminally_evaluated',
      forbiddenRegions: [],
    });
    expect(resolved.observations).toEqual([
      {
        requirementId: 'current-position',
        source: 'authoritative_context',
        status: 'available',
        evidenceRef: `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}:provider-context-hash:${providerContextHash}:workflow-read:vehicle_get_state:context:current-position`,
      },
      {
        requirementId: 'resource-state',
        source: 'authoritative_context',
        status: 'available',
        evidenceRef: `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}:provider-context-hash:${providerContextHash}:workflow-read:vehicle_get_state:context:resource-state`,
      },
      {
        requirementId: 'permission-context',
        source: 'authoritative_context',
        status: 'available',
        evidenceRef: `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}:policy-id:${POLICY_ID}:revision:2:policy-hash:${hashCanonicalEvidenceJson(targetPolicy)}:context:permission-context`,
      },
    ]);
    expect(resolved.taskAvailabilityArguments).toEqual({
      unresolved: false,
      value: binding.inputSnapshot,
    });
    expect(resolved.humanConfirmation).toBe('pending');
    expect(resolved.systemPolicy).toEqual({
      allowedModes: ['template', 'procedure'],
      preferredMode: 'procedure',
      requireProcedureForHighRisk: true,
      allowGuidanceWithIncompleteContext: false,
    });
  });

  it('fails closed for missing, duplicate, or drifted permission policy', () => {
    for (const binding of [
      capabilityBinding({ omitTargetPolicy: true }),
      capabilityBinding({ duplicateTargetPolicy: true }),
      capabilityBinding({ policy: { ...targetPolicy(), targetAuthority: 'request_metadata' } }),
    ]) {
      expect(() =>
        resolveUgvMoveSkillUsageContext({ authority: capabilityAuthority(binding), binding }),
      ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' }));
    }
  });

  it('keeps the former context-only projector fail closed', () => {
    expect(() =>
      projectUgvMoveSkillUsageContext(capabilityAuthority(capabilityBinding()).context),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' }));
  });
});

function binding(): SkillTaskBinding {
  return Object.freeze({
    bindingId: 'move-resource',
    taskType: 'embodied.move',
    providerPolicy: Object.freeze({
      selection: 'dynamic',
      preferredProviderIds: Object.freeze([]),
      forbiddenProviderIds: Object.freeze([]),
      requiredAttributes: Object.freeze(['observations', 'task_notifications']),
    }),
  });
}

function skillInput() {
  return Object.freeze({
    resourceId: 'vehicle:ugv1',
    target: Object.freeze({ x: 112, y: 28, frame: 'WGS84' }),
  });
}

const RUN_ID = 'uap-p3-b02-run-1';
const SERVER_ID = 'ugv-runtime-1';
const PROVIDER_BINDING_ID = 'binding-ugv-runtime-1';
const POLICY_ID = 'ugv-agent-profile/explicit-wgs84-target';

function deriveTarget() {
  return Object.freeze({ x: 106.8134463, y: 29.72034353, frame: 'WGS84' as const });
}

function targetPolicy() {
  return createUgvSimulationTargetPolicy({ policyId: POLICY_ID, revision: 2 });
}

function capabilityBinding(
  options: Readonly<{
    target?: Readonly<{ x: number; y: number; frame: 'WGS84' }>;
    policy?: Readonly<Record<string, unknown>>;
    omitTargetPolicy?: boolean;
    duplicateTargetPolicy?: boolean;
    boundAt?: string;
  }> = {},
): TaskCapabilityBinding {
  const policy = options.policy ?? targetPolicy();
  const constraints: Readonly<Record<string, unknown>>[] = [
    {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: ['vehicle:ugv1'],
      downstreamResourceBinding: 'forbidden',
    },
    {
      type: 'provider_binding_policy',
      mcpProviderBindingId: PROVIDER_BINDING_ID,
      localServerId: SERVER_ID,
      mcpToolName: 'vehicle_navigate',
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    },
    {
      type: 'exact_skill_version',
      skillId: 'embodied.move_to',
      skillVersion: 1,
      taskType: 'embodied.move',
    },
    { type: 'confirmation_policy', required: true, stage: 'before_execution' },
    {
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      dispatchMaximum: 1,
      uncertainDispatchPolicy: 'reconcile_never_redispatch',
      remoteTaskTerminalEvidenceRequired: true,
    },
    { type: 'runtime_execution_mode_policy', mode: 'simulation', simulationId: RUN_ID },
    ...(options.omitTargetPolicy ? [] : [policy]),
    ...(options.duplicateTargetPolicy ? [policy] : []),
  ];
  return createTaskCapabilityBinding({
    bindingId: 'capability-binding-1',
    taskId: 'task-1',
    requestedCapabilityId: 'embodied.move',
    capabilityVersion: 2,
    inputSnapshot: Object.freeze({
      resourceId: 'vehicle:ugv1',
      target: Object.freeze({ ...(options.target ?? deriveTarget()) }),
    }),
    successCriteriaSnapshot: Object.freeze([
      Object.freeze({ type: 'output_schema_valid', required: true }),
    ]),
    evidenceRequirementSnapshot: Object.freeze([
      Object.freeze({
        type: 'required_evidence',
        evidenceType: 'position.observation',
        required: true,
        hardGate: true,
      }),
    ]),
    constraintSnapshot: Object.freeze(constraints),
    initialImplementationRefs: Object.freeze(['skill:embodied.move_to:1']),
    providerPolicySnapshot: Object.freeze({
      currentProviderBindings: Object.freeze([
        Object.freeze({
          binding: Object.freeze({ bindingId: PROVIDER_BINDING_ID, localServerId: SERVER_ID }),
        }),
      ]),
    }),
    boundAt: options.boundAt ?? '2026-08-21T12:00:02.000Z',
  });
}

function capabilityAuthority(binding: TaskCapabilityBinding): TaskCapabilitySkillUsageAuthority {
  return Object.freeze({
    skillId: 'embodied.move_to',
    skillVersion: 1,
    context: Object.freeze({
      observations: Object.freeze([
        Object.freeze({
          requirementId: 'public-resource-id',
          source: 'authoritative_context' as const,
          status: 'available' as const,
          evidenceRef: `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}`,
        }),
        Object.freeze({
          requirementId: 'provider-binding-freshness',
          source: 'authoritative_context' as const,
          status: 'available' as const,
          evidenceRef: `node-control-provider-binding:${PROVIDER_BINDING_ID}:revision:7:observed-at:2026-08-21T12:00:02.500Z`,
        }),
      ]),
      risk: 'high',
      humanConfirmation: 'pending',
      taskAvailabilityArguments: Object.freeze({
        unresolved: false as const,
        value: binding.inputSnapshot as Readonly<Record<string, unknown>>,
      }),
      runtimeExecutionContext: Object.freeze({ mode: 'simulation', simulationId: RUN_ID }),
      systemPolicy: Object.freeze({
        allowedModes: Object.freeze(['guidance', 'template', 'procedure'] as const),
        requireProcedureForHighRisk: true,
        allowGuidanceWithIncompleteContext: false,
      }),
    }),
  });
}
