import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import type {
  GovernedControlConfirmation,
  GovernedControlConfirmationConsumption,
} from '../../application/src/index.js';
import { PostgresGovernedControlAuthorityRepository } from '../src/index.js';

const confirmedAt = '2026-08-13T01:00:00.000Z';
const expiresAt = '2026-08-13T01:05:00.000Z';

describe('PostgresGovernedControlAuthorityRepository', () => {
  it('persists and rehydrates exact confirmation identity', async () => {
    const query = vi.fn((text: string, values?: readonly unknown[]) => {
      void text;
      void values;
      return Promise.resolve({ rows: [confirmationRow()] });
    });
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(repository.saveConfirmation(confirmation())).resolves.toEqual(confirmation());
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO governed_control_confirmation');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'control-confirmation-1',
      'task-control-1',
      'capability-binding-control',
      'vehicle.light.control',
      1,
      'capability-attempt-control',
      'plan-control-1',
      'a'.repeat(64),
      'skill-light-control',
      3,
      'provider-binding-control',
      'provider-control',
      'light_set_state',
      'b'.repeat(64),
      'human:operator-1',
      'human',
      'oidc-mfa',
      '["physical_control_approver"]',
      'Approve bounded lab control.',
      confirmedAt,
      expiresAt,
    ]);
  });

  it('loads an exact durable authority snapshot suitable for restart recheck', async () => {
    const query = vi.fn((text: string, values?: readonly unknown[]) => {
      void text;
      void values;
      return Promise.resolve({ rows: [authorityRow()] });
    });
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(
      repository.load({
        taskId: 'task-control-1',
        capabilityAttemptId: 'capability-attempt-control',
        providerBindingId: 'provider-binding-control',
        serverId: 'provider-control',
        toolName: 'light_set_state',
        argumentsHash: 'b'.repeat(64),
      }),
    ).resolves.toMatchObject({
      task: { taskId: 'task-control-1', phase: 'executing', planId: 'plan-control-1' },
      binding: {
        bindingId: 'capability-binding-control',
        capabilityId: 'vehicle.light.control',
      },
      attempt: { attemptId: 'capability-attempt-control', status: 'running' },
      plan: { planId: 'plan-control-1', confirmationStatus: 'confirmed' },
      skill: { skillId: 'skill-light-control', skillVersion: 3, currentVersion: 3 },
      readiness: {
        checkPhase: 'pre_invocation',
        operationName: 'light_set_state',
        argumentsHash: 'b'.repeat(64),
      },
      confirmation: { confirmationId: 'control-confirmation-1', actorKind: 'human' },
    });
    expect(query.mock.calls[0]?.[0]).toContain('JOIN task_capability_binding');
    expect(query.mock.calls[0]?.[0]).toContain('JOIN LATERAL');
    expect(query.mock.calls[0]?.[0]).toContain('FROM governed_control_confirmation');
    expect(query.mock.calls[0]?.[0]).toContain('current_confirmation.revoked_at IS NULL');
    expect(query.mock.calls[0]?.[0]).toContain('current_confirmation.consumed_at IS NULL');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'task-control-1',
      'provider-control',
      'light_set_state',
      'b'.repeat(64),
      'provider-binding-control',
      'capability-attempt-control',
    ]);
  });

  it('returns no authority when any exact durable join is absent', async () => {
    const query = vi.fn((text: string, values?: readonly unknown[]) => {
      void text;
      void values;
      return Promise.resolve({ rows: [] });
    });
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(
      repository.load({
        taskId: 'task-with-discovery-only',
        capabilityAttemptId: 'capability-attempt-control',
        providerBindingId: 'provider-binding-control',
        serverId: 'provider-control',
        toolName: 'vehicle_fire_weapon',
        argumentsHash: 'c'.repeat(64),
      }),
    ).resolves.toBeUndefined();
  });

  it('persists one-way revocation and rehydrates it after restart', async () => {
    const query = vi.fn((text: string, values?: readonly unknown[]) => {
      void text;
      void values;
      return Promise.resolve({
        rows: [
          {
            ...confirmationRow(),
            revoked_at: '2026-08-13T01:01:00.000Z',
            revoked_by: 'human:operator-2',
          },
        ],
      });
    });
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(
      repository.revokeConfirmation(
        'control-confirmation-1',
        'human:operator-2',
        '2026-08-13T01:01:00.000Z',
      ),
    ).resolves.toMatchObject({
      revokedAt: '2026-08-13T01:01:00.000Z',
      revokedBy: 'human:operator-2',
    });
    expect(query.mock.calls[0]?.[0]).toContain('UPDATE governed_control_confirmation');
    expect(query.mock.calls[0]?.[0]).toContain('revoked_at IS NULL');
    expect(query.mock.calls[0]?.[0]).toContain('consumed_at IS NULL');
  });

  it('atomically consumes an exact confirmation once and rejects every retry identity', async () => {
    const consumption = confirmationConsumption();
    let queryCount = 0;
    const query = vi.fn((text: string, values?: readonly unknown[]) => {
      queryCount += 1;
      void text;
      void values;
      return Promise.resolve({
        rows:
          queryCount === 1
            ? [
                {
                  ...confirmationRow(),
                  consumed_invocation_id: consumption.invocationId,
                  consumed_dispatch_hash: consumption.dispatchHash,
                  consumed_at: consumption.consumedAt,
                },
              ]
            : [],
      });
    });
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(repository.consumeConfirmation(consumption)).resolves.toMatchObject({
      confirmationId: 'control-confirmation-1',
      consumedInvocationId: consumption.invocationId,
      consumedDispatchHash: consumption.dispatchHash,
      consumedAt: consumption.consumedAt,
    });
    expect(query.mock.calls[0]?.[0]).toContain('UPDATE governed_control_confirmation');
    expect(query.mock.calls[0]?.[0]).toContain('consumed_invocation_id=$9');
    expect(query.mock.calls[0]?.[0]).toContain('consumed_dispatch_hash=$10');
    expect(query.mock.calls[0]?.[0]).not.toContain('UNION ALL');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'control-confirmation-1',
      'task-control-1',
      'capability-binding-control',
      'capability-attempt-control',
      'provider-binding-control',
      'provider-control',
      'light_set_state',
      'b'.repeat(64),
      'invocation-control-1',
      `sha256:${'d'.repeat(64)}`,
      '2026-08-13T01:01:00.000Z',
    ]);
    await expect(repository.consumeConfirmation(consumption)).resolves.toBeUndefined();
  });
});

function confirmation(): GovernedControlConfirmation {
  return {
    confirmationId: 'control-confirmation-1',
    taskId: 'task-control-1',
    capabilityBindingId: 'capability-binding-control',
    capabilityId: 'vehicle.light.control',
    capabilityVersion: 1,
    capabilityAttemptId: 'capability-attempt-control',
    planId: 'plan-control-1',
    planHash: 'a'.repeat(64),
    skillId: 'skill-light-control',
    skillVersion: 3,
    providerBindingId: 'provider-binding-control',
    serverId: 'provider-control',
    toolName: 'light_set_state',
    argumentsHash: 'b'.repeat(64),
    actorId: 'human:operator-1',
    actorKind: 'human',
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Approve bounded lab control.',
    confirmedAt,
    expiresAt,
  };
}

function confirmationRow() {
  return {
    confirmation_id: 'control-confirmation-1',
    task_id: 'task-control-1',
    capability_binding_id: 'capability-binding-control',
    capability_id: 'vehicle.light.control',
    capability_version: 1,
    capability_attempt_id: 'capability-attempt-control',
    plan_id: 'plan-control-1',
    plan_hash: 'a'.repeat(64),
    skill_id: 'skill-light-control',
    skill_version: 3,
    provider_binding_id: 'provider-binding-control',
    server_id: 'provider-control',
    tool_name: 'light_set_state',
    arguments_hash: 'b'.repeat(64),
    actor_id: 'human:operator-1',
    actor_kind: 'human' as const,
    authentication_method: 'oidc-mfa',
    actor_roles_json: ['physical_control_approver'],
    reason: 'Approve bounded lab control.',
    confirmed_at: confirmedAt,
    expires_at: expiresAt,
    revoked_at: null,
    revoked_by: null,
    consumed_invocation_id: null,
    consumed_dispatch_hash: null,
    consumed_at: null,
  };
}

function confirmationConsumption(): GovernedControlConfirmationConsumption {
  return {
    confirmationId: 'control-confirmation-1',
    taskId: 'task-control-1',
    capabilityBindingId: 'capability-binding-control',
    capabilityAttemptId: 'capability-attempt-control',
    providerBindingId: 'provider-binding-control',
    serverId: 'provider-control',
    toolName: 'light_set_state',
    argumentsHash: 'b'.repeat(64),
    invocationId: 'invocation-control-1',
    dispatchHash: `sha256:${'d'.repeat(64)}`,
    consumedAt: '2026-08-13T01:01:00.000Z',
  };
}

function authorityRow() {
  return {
    task_id: 'task-control-1',
    task_phase: 'executing',
    task_plan_id: 'plan-control-1',
    selected_skill_id: 'skill-light-control',
    selected_skill_version: 3,
    binding_id: 'capability-binding-control',
    capability_id: 'vehicle.light.control',
    capability_version: 1,
    input_snapshot: { resourceId: 'living-room-main-light', state: 'off' },
    constraint_snapshot: [{ type: 'authorization' }],
    evidence_requirement_snapshot: [{ type: 'state_confirmation' }],
    initial_implementation_refs: ['skill:skill-light-control:3'],
    binding_hash: 'd'.repeat(64),
    attempt_id: 'capability-attempt-control',
    attempt_status: 'running',
    attempt_plan_id: 'plan-control-1',
    skill_version_refs: ['skill:skill-light-control:3'],
    provider_binding_refs: ['provider-binding-control'],
    plan_id: 'plan-control-1',
    plan_confirmation_status: 'confirmed',
    plan_definition: { nodes: [] },
    skill_id: 'skill-light-control',
    skill_version: 3,
    current_skill_version: 3,
    skill_status: 'enabled',
    skill_validation_passed: true,
    skill_capabilities: ['vehicle.light.control'],
    skill_tool_policy: {
      required: [{ serverId: 'provider-control', toolName: 'light_set_state' }],
      optional: [],
    },
    skill_runtime_policy: { autoConfirmPlan: false },
    skill_outcome_specification: {
      sideEffectPolicy: { sideEffecting: true, confirmation: 'required' },
    },
    readiness_id: 'readiness-control',
    readiness_plan_id: 'plan-control-1',
    readiness_check_phase: 'pre_invocation',
    readiness_dsl_hash: 'e'.repeat(64),
    readiness_disposition: 'ready',
    readiness_guard_action: 'proceed',
    readiness_confirmation_required: false,
    readiness_server_id: 'provider-control',
    readiness_operation_name: 'light_set_state',
    readiness_arguments_hash: 'b'.repeat(64),
    readiness_availability: 'available',
    readiness_risk_level: 'high',
    readiness_valid_until: '2026-08-13T01:02:00.000Z',
    readiness_checked_at: '2026-08-13T01:00:30.000Z',
    confirmation_id: 'control-confirmation-1',
    confirmation_task_id: 'task-control-1',
    confirmation_capability_binding_id: 'capability-binding-control',
    confirmation_capability_id: 'vehicle.light.control',
    confirmation_capability_version: 1,
    confirmation_capability_attempt_id: 'capability-attempt-control',
    confirmation_plan_id: 'plan-control-1',
    confirmation_plan_hash: 'e'.repeat(64),
    confirmation_skill_id: 'skill-light-control',
    confirmation_skill_version: 3,
    confirmation_provider_binding_id: 'provider-binding-control',
    confirmation_server_id: 'provider-control',
    confirmation_tool_name: 'light_set_state',
    confirmation_arguments_hash: 'b'.repeat(64),
    confirmation_actor_id: 'human:operator-1',
    confirmation_actor_kind: 'human' as const,
    confirmation_authentication_method: 'oidc-mfa',
    confirmation_actor_roles: ['physical_control_approver'],
    confirmation_reason: 'Approve bounded lab control.',
    confirmation_confirmed_at: confirmedAt,
    confirmation_expires_at: expiresAt,
    confirmation_revoked_at: null,
    confirmation_revoked_by: null,
    confirmation_consumed_invocation_id: null,
    confirmation_consumed_dispatch_hash: null,
    confirmation_consumed_at: null,
  };
}
