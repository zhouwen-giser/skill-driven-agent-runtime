import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { canonicalHash } from '../../application/src/index.js';
import { PostgresGovernedControlManagementAuthorityReader } from '../src/index.js';

describe('PostgresGovernedControlManagementAuthorityReader', () => {
  it('derives exact issue authority from the current UGV frozen constraint shape', async () => {
    const query = vi.fn(() => Promise.resolve({ rows: [authorityRow()] }));
    const reader = new PostgresGovernedControlManagementAuthorityReader({
      query,
    } as unknown as Pool);

    await expect(reader.issueAuthority('task-1')).resolves.toEqual({
      taskId: 'task-1',
      capabilityBindingId: 'binding-1',
      capabilityId: 'embodied.move',
      capabilityVersion: 1,
      capabilityAttemptId: 'attempt-1',
      planId: 'plan-1',
      planHash: canonicalHash({ steps: [{ toolName: 'embodied_move' }] }),
      skillId: 'embodied.move',
      skillVersion: 1,
      providerBindingId: 'provider-binding-1',
      serverId: 'fake-ugv',
      toolName: 'embodied_move',
      arguments: { resourceId: 'ugv-1', destination: 'dock' },
      argumentsHash: canonicalHash({ resourceId: 'ugv-1', destination: 'dock' }),
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY current_attempt.attempt_no DESC'),
      ['task-1'],
    );
  });

  it('fails closed when provider references are not bound to the latest attempt', async () => {
    const row = authorityRow();
    const query = vi.fn(() =>
      Promise.resolve({ rows: [{ ...row, attempt_provider_binding_refs: ['different-binding'] }] }),
    );
    const reader = new PostgresGovernedControlManagementAuthorityReader({
      query,
    } as unknown as Pool);

    await expect(reader.issueAuthority('task-1')).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID',
      status: 409,
    });
  });

  it('derives navigate confirmation authority for the exact five-dispatch bounded Skill', async () => {
    const query = vi.fn(() => Promise.resolve({ rows: [navigateAuthorityRow()] }));
    const reader = new PostgresGovernedControlManagementAuthorityReader({
      query,
    } as unknown as Pool);

    await expect(reader.issueAuthority('task-1')).resolves.toMatchObject({
      capabilityId: 'vehicle.ugv.navigate',
      skillId: 'ugv.navigate',
      toolName: 'vehicle_navigate',
      arguments: {
        resourceId: 'ugv-1',
        mission: { type: 'distance', direction: 'forward', distanceM: 2 },
      },
    });
  });

  it('does not treat a five-dispatch budget as generic control authority', async () => {
    const row = authorityRow();
    const query = vi.fn(() =>
      Promise.resolve({
        rows: [
          {
            ...row,
            constraint_snapshot: (row.constraint_snapshot as Record<string, unknown>[]).map(
              (constraint) =>
                constraint['type'] === 'physical_side_effect_policy'
                  ? { ...constraint, dispatchMaximum: 5 }
                  : constraint,
            ),
            skill_runtime_policy: { autoConfirmPlan: false, maxMcpCalls: 5 },
          },
        ],
      }),
    );
    const reader = new PostgresGovernedControlManagementAuthorityReader({
      query,
    } as unknown as Pool);

    await expect(reader.issueAuthority('task-1')).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID',
    });
  });

  it('rejects navigate confirmation authority above the frozen per-dispatch distance', async () => {
    const row = navigateAuthorityRow();
    const query = vi.fn(() =>
      Promise.resolve({
        rows: [
          {
            ...row,
            input_snapshot: {
              resourceId: 'ugv-1',
              mission: { type: 'distance', direction: 'forward', distanceM: 10 },
            },
          },
        ],
      }),
    );
    const reader = new PostgresGovernedControlManagementAuthorityReader({
      query,
    } as unknown as Pool);

    await expect(reader.issueAuthority('task-1')).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID',
    });
  });

  it('never derives confirmation authority for the hard-denied fire tool', async () => {
    const row = authorityRow();
    const constraints = (row.constraint_snapshot as Record<string, unknown>[]).map((constraint) =>
      constraint['type'] === 'provider_binding_policy'
        ? { ...constraint, mcpToolName: 'vehicle_fire_weapon' }
        : constraint['type'] === 'exact_skill_version'
          ? { ...constraint, taskType: 'vehicle_fire_weapon' }
          : constraint,
    );
    const query = vi.fn(() =>
      Promise.resolve({
        rows: [
          {
            ...row,
            constraint_snapshot: constraints,
            skill_tool_policy: {
              ...row.skill_tool_policy,
              required: [{ serverId: 'fake-ugv', toolName: 'vehicle_fire_weapon' }],
            },
          },
        ],
      }),
    );
    const reader = new PostgresGovernedControlManagementAuthorityReader({
      query,
    } as unknown as Pool);

    await expect(reader.issueAuthority('task-1')).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_AUTHORITY_SCOPE_INVALID',
      status: 409,
    });
  });
});

function authorityRow() {
  return {
    task_id: 'task-1',
    task_phase: 'awaiting_plan_confirmation',
    task_plan_id: 'plan-1',
    selected_skill_id: 'embodied.move',
    selected_skill_version: 1,
    binding_id: 'binding-1',
    capability_id: 'embodied.move',
    capability_version: 1,
    input_snapshot: { resourceId: 'ugv-1', destination: 'dock' },
    constraint_snapshot: [
      {
        type: 'resource_policy',
        identifierAuthority: 'public_smpp_tool_schema',
        selection: 'exact_value',
        allowedResourceIds: ['ugv-1'],
        downstreamResourceBinding: 'forbidden',
      },
      {
        type: 'provider_binding_policy',
        mcpProviderBindingId: 'provider-binding-1',
        localServerId: 'fake-ugv',
        mcpToolName: 'embodied_move',
        requiredStatus: 'active',
        requiredAvailabilityStatus: 'available',
        requiredFreshness: 'unexpired',
        fallback: 'deny',
      },
      {
        type: 'exact_skill_version',
        skillId: 'embodied.move',
        skillVersion: 1,
        taskType: 'embodied_move',
      },
      {
        type: 'confirmation_policy',
        required: true,
        stage: 'before_execution',
        autoConfirmPlan: false,
      },
      {
        type: 'physical_side_effect_policy',
        sideEffecting: true,
        dispatchMaximum: 1,
        uncertainDispatchPolicy: 'reconcile_never_redispatch',
        remoteTaskTerminalEvidenceRequired: true,
      },
    ],
    initial_implementation_refs: ['skill:embodied.move:1'],
    attempt_id: 'attempt-1',
    attempt_status: 'prepared',
    attempt_plan_id: 'plan-1',
    attempt_skill_version_refs: ['skill:embodied.move:1'],
    attempt_provider_binding_refs: ['provider-binding-1'],
    plan_id: 'plan-1',
    plan_confirmation_status: 'awaiting_confirmation',
    plan_definition: { steps: [{ toolName: 'embodied_move' }] },
    skill_id: 'embodied.move',
    skill_version: 1,
    current_skill_version: 1,
    skill_status: 'enabled',
    skill_validation_passed: true,
    skill_capabilities: ['embodied.move'],
    skill_tool_policy: {
      required: [{ serverId: 'fake-ugv', toolName: 'embodied_move' }],
      optional: [],
      forbidden: [{ serverId: 'fake-ugv', toolName: 'vehicle_fire_weapon' }],
    },
    skill_runtime_policy: { autoConfirmPlan: false, maxMcpCalls: 1 },
    skill_outcome_specification: {
      sideEffectPolicy: {
        sideEffecting: true,
        confirmation: 'required_before_execution',
      },
    },
  };
}

function navigateAuthorityRow() {
  const row = authorityRow();
  const skillId = 'ugv.navigate';
  const capabilityId = 'vehicle.ugv.navigate';
  const toolName = 'vehicle_navigate';
  const arguments_ = {
    resourceId: 'ugv-1',
    mission: { type: 'distance', direction: 'forward', distanceM: 2 },
  };
  return {
    ...row,
    selected_skill_id: skillId,
    binding_id: 'binding-navigate',
    capability_id: capabilityId,
    input_snapshot: arguments_,
    constraint_snapshot: [
      ...(row.constraint_snapshot as Record<string, unknown>[]).map((constraint) => {
        if (constraint['type'] === 'provider_binding_policy')
          return { ...constraint, mcpToolName: toolName };
        if (constraint['type'] === 'exact_skill_version')
          return { ...constraint, skillId, taskType: toolName };
        if (constraint['type'] === 'physical_side_effect_policy')
          return { ...constraint, dispatchMaximum: 5 };
        return constraint;
      }),
      {
        type: 'bounded_movement_policy',
        constraintId: 'vehicle-navigate-distance-per-dispatch',
        toolName,
        missionType: 'distance',
        missionTypeArgumentPath: ['mission', 'type'],
        directionArgumentPath: ['mission', 'direction'],
        distanceArgumentPath: ['mission', 'distanceM'],
        allowedDirections: ['backward', 'forward', 'left', 'right'],
        exclusiveMinimum: 0,
        maximumInclusive: 2,
        unit: 'm',
        scope: 'per_dispatch',
        exactDirection: 'forward',
        exactDistancePerDispatch: 2,
        exactDispatchCount: 5,
        exactTotalDistance: 10,
        strictSequential: true,
        terminalBeforeNext: true,
      },
    ],
    initial_implementation_refs: [`skill:${skillId}:1`],
    attempt_skill_version_refs: [`skill:${skillId}:1`],
    plan_definition: { steps: [{ toolName }] },
    skill_id: skillId,
    skill_capabilities: [capabilityId],
    skill_tool_policy: {
      required: [{ serverId: 'fake-ugv', toolName }],
      optional: [],
      forbidden: [{ serverId: 'fake-ugv', toolName: 'vehicle_fire_weapon' }],
    },
    skill_runtime_policy: { autoConfirmPlan: false, maxMcpCalls: 5 },
    skill_outcome_specification: {
      sideEffectPolicy: {
        sideEffecting: true,
        confirmation: 'required_before_execution',
        dispatchMaximum: 5,
        requiredArgumentConstraintIds: ['vehicle-navigate-distance-per-dispatch'],
      },
    },
  };
}
