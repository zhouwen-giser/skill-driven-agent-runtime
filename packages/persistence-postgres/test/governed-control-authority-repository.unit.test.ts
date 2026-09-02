import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import type {
  GovernedControlConfirmation,
  GovernedControlConfirmationConsumption,
  TaskAvailabilityBatchReader,
} from '../../application/src/index.js';
import { hashCanonicalEvidenceJson } from '../../domain/src/index.js';
import { selectedUgvTaskOperation } from '../../../apps/server/test/ugv-move-workflow-test-fixture.js';
import {
  PostgresGovernedControlAuthorityRepository,
  PostgresUgvGovernedControlAuthorityReader,
} from '../src/index.js';

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
      'physical_control',
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

  it('lists confirmation evidence with the frozen Task Capability input', async () => {
    const query = vi.fn((text: string, values?: readonly unknown[]) => {
      expect(text).toContain('JOIN task_capability_binding');
      expect(text).toContain('confirmation.task_id=$1');
      expect(values).toEqual(['task-control-1']);
      return Promise.resolve({
        rows: [
          {
            ...confirmationRow(),
            input_snapshot: {
              resourceId: 'vehicle:ugv1',
              targetId: 'target-17',
              engagementMode: 'single',
              requireConfirmation: true,
            },
          },
        ],
      });
    });
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(repository.listByTask('task-control-1')).resolves.toEqual([
      {
        confirmation: confirmation(),
        inputSnapshot: {
          resourceId: 'vehicle:ugv1',
          targetId: 'target-17',
          engagementMode: 'single',
          requireConfirmation: true,
        },
      },
    ]);
  });

  it('issues once and replays the exact existing confirmation after a lost response', async () => {
    const candidate = confirmation();
    let queryCount = 0;
    const query = vi.fn((text: string, values?: readonly unknown[]) => {
      queryCount += 1;
      void values;
      if (queryCount === 1) {
        expect(text).toContain('ON CONFLICT (confirmation_id) DO NOTHING');
        return Promise.resolve({ rows: [] });
      }
      expect(text).toContain('AND actor_roles_json=$19::jsonb');
      expect(text).toContain('AND reason=$20');
      return Promise.resolve({ rows: [confirmationRow()] });
    });
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(repository.issueOnce(candidate)).resolves.toEqual({
      confirmation: candidate,
      replayed: true,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[1]).toEqual([
      candidate.confirmationId,
      'physical_control',
      candidate.taskId,
      candidate.capabilityBindingId,
      candidate.capabilityId,
      candidate.capabilityVersion,
      candidate.capabilityAttemptId,
      candidate.planId,
      candidate.planHash,
      candidate.skillId,
      candidate.skillVersion,
      candidate.providerBindingId,
      candidate.serverId,
      candidate.toolName,
      candidate.argumentsHash,
      candidate.actorId,
      candidate.actorKind,
      candidate.authenticationMethod,
      JSON.stringify(candidate.actorRoles),
      candidate.reason,
    ]);
  });

  it('rejects a deterministic-id collision with different immutable scope', async () => {
    const query = vi.fn(() => Promise.resolve({ rows: [] }));
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(repository.issueOnce(confirmation())).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_CONFIRMATION_ISSUE_CONFLICT',
    });
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
        readinessArgumentsHash: 'd'.repeat(64),
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
    expect(query.mock.calls[0]?.[0]).toContain('CASE WHEN current_confirmation.revoked_at IS NULL');
    expect(query.mock.calls[0]?.[0]).toContain('AND current_confirmation.consumed_at IS NULL');
    expect(query.mock.calls[0]?.[0]).toContain('THEN 0 ELSE 1 END');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'task-control-1',
      'provider-control',
      'light_set_state',
      'b'.repeat(64),
      'provider-binding-control',
      'capability-attempt-control',
      'd'.repeat(64),
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
        readinessArgumentsHash: 'd'.repeat(64),
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

  it('finds the one complete consumed confirmation by exact invocation id', async () => {
    const consumption = confirmationConsumption();
    const query = vi.fn((text: string, values?: readonly unknown[]) => {
      void text;
      void values;
      return Promise.resolve({
        rows: [
          {
            ...confirmationRow(),
            consumed_invocation_id: consumption.invocationId,
            consumed_dispatch_hash: consumption.dispatchHash,
            consumed_at: consumption.consumedAt,
          },
        ],
      });
    });
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(
      repository.findConsumedByInvocation(consumption.invocationId),
    ).resolves.toMatchObject({
      confirmationId: 'control-confirmation-1',
      consumedInvocationId: consumption.invocationId,
      consumedDispatchHash: consumption.dispatchHash,
      consumedAt: consumption.consumedAt,
    });
    expect(query.mock.calls[0]?.[0]).toContain('WHERE consumed_invocation_id=$1');
    expect(query.mock.calls[0]?.[0]).toContain('consumed_at IS NOT NULL');
    expect(query.mock.calls[0]?.[0]).toContain('consumed_dispatch_hash IS NOT NULL');
    expect(query.mock.calls[0]?.[0]).toContain('revoked_at IS NULL');
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT 2');
    expect(query.mock.calls[0]?.[1]).toEqual([consumption.invocationId]);
  });

  it('returns undefined when no consumed confirmation has the invocation id', async () => {
    const query = vi.fn(() => Promise.resolve({ rows: [] }));
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(
      repository.findConsumedByInvocation('unknown-invocation'),
    ).resolves.toBeUndefined();
  });

  it('fails closed if persisted state returns more than one consumed confirmation', async () => {
    const consumption = confirmationConsumption();
    const consumed = {
      ...confirmationRow(),
      consumed_invocation_id: consumption.invocationId,
      consumed_dispatch_hash: consumption.dispatchHash,
      consumed_at: consumption.consumedAt,
    };
    const query = vi.fn(() =>
      Promise.resolve({ rows: [consumed, { ...consumed, confirmation_id: 'ambiguous' }] }),
    );
    const repository = new PostgresGovernedControlAuthorityRepository({ query } as unknown as Pool);

    await expect(
      repository.findConsumedByInvocation(consumption.invocationId),
    ).rejects.toMatchObject({
      code: 'UGV_GOVERNED_CONTROL_PERSISTED_AUTHORITY_INVALID',
    });
  });
});

describe('PostgresUgvGovernedControlAuthorityReader', () => {
  it('combines one persisted Selected/confirmation snapshot with refreshed mutable authority', async () => {
    const selected = selectedUgvTaskOperation();
    const constraint = {
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      dispatchMaximum: 1,
    };
    const query = vi.fn((text: string) => {
      void text;
      return Promise.resolve({ rows: [ugvAuthorityRow(selected, constraint)] });
    });
    const loadCurrentMcpProviderBinding = vi.fn(() =>
      Promise.resolve({
        observedAt: '2026-08-21T12:01:00.000Z',
        binding: {
          bindingId: selected.providerBinding.bindingId,
          revision: selected.providerBinding.revision,
          localServerId: selected.server.serverId,
          originType: 'smpp_registry' as const,
          providerId: selected.provider.providerId,
          externalServerId: 'external-ugv',
          endpointRef: 'http://127.0.0.1:10070/mcp',
          catalogRevision: selected.server.catalogRevision,
          catalogChecksum: selected.server.catalogChecksum,
          operationCount: 2,
          availabilityStatus: 'available' as const,
          availabilityValidUntil: '2026-08-21T12:05:00.000Z',
        },
      }),
    );
    const runtime = {
      record: {
        server: {
          serverId: selected.server.serverId,
          name: 'UGV',
          endpoint: 'http://127.0.0.1:10070/mcp',
          transport: 'streamable_http' as const,
          status: 'enabled' as const,
          toolRevision: selected.server.toolRevision,
          protocolMode: 'frozen_v1' as const,
          currentProtocolSnapshotId: selected.server.discoverySnapshotId,
          createdAt: selected.selectedAt,
          updatedAt: selected.selectedAt,
        },
        encryptedCredential: '',
      },
      snapshot: {
        snapshotId: selected.server.discoverySnapshotId,
        serverId: selected.server.serverId,
        protocolMode: 'frozen_v1' as const,
        protocolVersion: '2025-03-26',
        baselineSha256: 'f'.repeat(64),
        supportedVersions: ['2025-03-26'],
        capabilities: {},
        serverInfo: { name: 'UGV', version: '1.0.0' },
        providerCatalog: selected.provider,
        taskNotifications: true,
        discoveredAt: selected.selectedAt,
        validUntil: '2026-08-21T12:05:00.000Z',
        toolRevision: selected.server.toolRevision,
      },
      tools: [
        {
          serverId: selected.server.serverId,
          toolName: selected.operation.operationName,
          inputSchema: selected.operation.inputSchema,
          outputSchema: selected.operation.outputSchema,
          protocolMode: 'frozen_v1' as const,
          executionSemantics: selected.operation.executionSemantics,
          taskExecutionProfile: selected.operation.taskExecutionProfile,
          discoveredAt: selected.selectedAt,
        },
        {
          serverId: selected.server.serverId,
          toolName: selected.finalStateRead.operationName,
          inputSchema: selected.finalStateRead.inputSchema,
          outputSchema: selected.finalStateRead.outputSchema,
          protocolMode: 'frozen_v1' as const,
          executionSemantics: selected.finalStateRead.executionSemantics,
          taskExecutionProfile: selected.finalStateRead.taskExecutionProfile,
          discoveredAt: selected.selectedAt,
        },
      ],
      catalogAuthority: {
        catalogRevision: selected.server.catalogRevision,
        catalogChecksum: selected.server.catalogChecksum,
        operationCount: 2,
      },
    };
    const assertCurrent = vi.fn(() => Promise.resolve());
    const adapt = vi.fn(adaptUgvBindingInput);
    const checkTaskAvailability = vi.fn<TaskAvailabilityBatchReader['checkTaskAvailability']>(() =>
      Promise.resolve({
        kind: 'results' as const,
        protocolRevision: selected.availability.protocolRevision,
        availabilitySchemaRevision: selected.availability.schemaRevision,
        results: [
          {
            nodeId: 'ugv-governed-control:task-uap-p2-b03:attempt-uap-p2-b03',
            operationName: selected.operation.operationName,
            availability: 'available' as const,
            riskLevel: 'high' as const,
            validUntil: '2026-08-21T12:04:00.000Z',
            nextAvailableWindows: [],
            reservationMode: 'none' as const,
            possibleEffects: ['task_pause' as const],
          },
        ],
      }),
    );
    const reader = new PostgresUgvGovernedControlAuthorityReader({
      pool: { query } as unknown as Pool,
      capabilities: {
        load: () =>
          Promise.resolve({
            definition: {
              capability_id: 'embodied.move',
              version: 1,
              status: 'published',
              risk_level: 'high',
              supported_modes: ['plan_confirmed', 'remote_task'],
              constraints: [constraint],
            },
            implementationBindings: [
              {
                capability_id: 'embodied.move',
                capability_version: 1,
                implementation_type: 'skill',
                implementation_id: 'embodied.move_to',
                implementation_version: '1',
                role: 'primary',
                status: 'active',
                provider_policy_override: {
                  selection: 'required',
                  mcpProviderBindingId: selected.providerBinding.bindingId,
                  localServerId: selected.server.serverId,
                  mcpToolName: selected.operation.operationName,
                  requireActive: true,
                  requireAvailable: true,
                  requireUnexpiredFreshness: true,
                  denyFallback: true,
                },
              },
            ],
          }),
      },
      providerBindings: { loadCurrentMcpProviderBinding },
      runtimeBindings: {
        loadRuntimeAuthority: () => Promise.resolve(runtime),
        assertCurrent,
      },
      availability: { checkTaskAvailability },
      inputAdapter: { adapt },
      unknownAvailabilityPolicy: { decide: () => 'explicitly_not_ready' },
      clock: { now: () => '2026-08-21T12:01:00.000Z' },
    });

    await expect(reader.loadForIssue('task-uap-p2-b03')).resolves.toMatchObject({
      selectedTaskOperation: { snapshotHash: selected.snapshotHash },
      capability: { dispatchMaximum: 1 },
      skill: { runtimePolicy: { maxMcpCalls: 8 } },
      readiness: { argumentsHash: selected.argumentsHash, disposition: 'ready' },
    });
    await expect(
      reader.loadForPreInvocation({
        taskId: 'task-uap-p2-b03',
        capabilityAttemptId: 'attempt-uap-p2-b03',
      }),
    ).resolves.toMatchObject({
      confirmation: { confirmationId: 'ugv-control-confirmation' },
    });
    expect(loadCurrentMcpProviderBinding).toHaveBeenCalledTimes(2);
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(checkTaskAvailability).toHaveBeenCalledTimes(2);
    expect(adapt).toHaveBeenCalledTimes(2);
    expect(adapt).toHaveBeenCalledWith(ugvBindingInput());
    expect(query.mock.calls[0]?.[0]).toContain('binding.input_snapshot');
    expect(query.mock.calls[0]?.[0]).toContain(
      'count(*) OVER()::integer AS selected_reference_count',
    );
    expect(query.mock.calls[0]?.[0]).toContain('count(*) OVER()::integer AS confirmation_count');

    checkTaskAvailability.mockResolvedValueOnce({
      kind: 'results',
      protocolRevision: selected.availability.protocolRevision,
      availabilitySchemaRevision: selected.availability.schemaRevision,
      results: [
        {
          nodeId: 'ugv-governed-control:task-uap-p2-b03:attempt-uap-p2-b03',
          operationName: selected.operation.operationName,
          availability: 'unknown',
          riskLevel: 'medium',
          reasonCode: 'UGV_TOOL_RECOVERING',
          validUntil: '2026-08-21T12:04:00.000Z',
          nextAvailableWindows: [],
          reservationMode: 'none',
          possibleEffects: [],
        },
      ],
    });
    await expect(reader.loadForIssue('task-uap-p2-b03')).resolves.toMatchObject({
      readiness: {
        availability: 'unknown',
        availabilityDecision: 'provider_denied',
        disposition: 'blocked',
        guardAction: 'abort',
      },
    });
  });

  it('rejects raw Binding target A against persisted Selected target B before mutable reads', async () => {
    const selected = selectedUgvTaskOperation();
    const constraint = {
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      dispatchMaximum: 1,
    };
    const inputSnapshot = ugvBindingInput(113, 29);
    const query = vi.fn(() =>
      Promise.resolve({ rows: [ugvAuthorityRow(selected, constraint, inputSnapshot)] }),
    );
    const loadCapability = vi.fn(() => Promise.reject(new Error('must not load Capability')));
    const loadProviderBinding = vi.fn(() => Promise.reject(new Error('must not load Binding')));
    const loadRuntimeAuthority = vi.fn(() => Promise.reject(new Error('must not load Catalog')));
    const assertCurrent = vi.fn(() => Promise.reject(new Error('must not revalidate Binding')));
    const checkTaskAvailability = vi.fn(() =>
      Promise.reject(new Error('must not check readiness')),
    );
    const adapt = vi.fn(adaptUgvBindingInput);
    const reader = new PostgresUgvGovernedControlAuthorityReader({
      pool: { query } as unknown as Pool,
      capabilities: { load: loadCapability },
      providerBindings: { loadCurrentMcpProviderBinding: loadProviderBinding },
      runtimeBindings: { loadRuntimeAuthority, assertCurrent },
      availability: { checkTaskAvailability },
      inputAdapter: { adapt },
      unknownAvailabilityPolicy: { decide: () => 'explicitly_not_ready' },
      clock: { now: () => '2026-08-21T12:01:00.000Z' },
    });

    await expect(reader.loadForIssue('task-uap-p2-b03')).rejects.toMatchObject({
      code: 'UGV_GOVERNED_CONTROL_PERSISTED_AUTHORITY_INVALID',
    });
    expect(adapt).toHaveBeenCalledWith(inputSnapshot);
    expect(loadCapability).not.toHaveBeenCalled();
    expect(loadProviderBinding).not.toHaveBeenCalled();
    expect(loadRuntimeAuthority).not.toHaveBeenCalled();
    expect(assertCurrent).not.toHaveBeenCalled();
    expect(checkTaskAvailability).not.toHaveBeenCalled();
  });
});

function confirmation(): GovernedControlConfirmation {
  return {
    confirmationId: 'control-confirmation-1',
    authorityKind: 'physical_control',
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
    authority_kind: 'physical_control' as const,
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

function ugvAuthorityRow(
  selected: ReturnType<typeof selectedUgvTaskOperation>,
  constraint: Readonly<Record<string, unknown>>,
  inputSnapshot: unknown = ugvBindingInput(),
) {
  return {
    task_id: 'task-uap-p2-b03',
    task_phase: 'executing',
    task_plan_id: 'plan-uap-p2-b03',
    selected_skill_id: 'embodied.move_to',
    selected_skill_version: 1,
    binding_id: 'capability-binding-uap-p2-b03',
    capability_id: 'embodied.move',
    capability_version: 1,
    input_snapshot: inputSnapshot,
    constraint_snapshot: [constraint],
    binding_hash: 'e'.repeat(64),
    attempt_id: 'attempt-uap-p2-b03',
    attempt_status: 'running',
    attempt_plan_id: 'plan-uap-p2-b03',
    skill_version_refs: ['skill:embodied.move_to:1'],
    provider_binding_refs: [selected.providerBinding.bindingId],
    plan_id: 'plan-uap-p2-b03',
    plan_confirmation_status: 'confirmed',
    plan_definition: { workflowDefinitionId: 'workflow-uap-p2-b03' },
    skill_id: 'embodied.move_to',
    skill_version: 1,
    current_skill_version: 1,
    skill_status: 'enabled',
    skill_validation_passed: true,
    skill_capabilities: ['embodied.move', 'embodied.navigation'],
    skill_runtime_policy: { autoConfirmPlan: false, maxMcpCalls: 8 },
    skill_usage_specification: {
      evidencePolicy: {
        requirements: [
          {
            requirementId: 'final-position',
            evidenceType: 'position.observation',
            required: true,
            hardGate: true,
          },
        ],
        rejectSuccessWithoutRequiredEvidence: true,
      },
    },
    skill_outcome_specification: {
      effects: ['effect.final_position'],
      evidence: ['evidence.final_position'],
    },
    package_checksum: selected.skill.packageChecksum,
    selected_reference_count: 1,
    selected_reference_kind: 'remote_task_binding',
    selected_reference_id: selected.snapshotHash,
    selected_reference_type: 'ugv.selected_task_operation/v1',
    selected_reference_source_system: 'ugv-agent-profile',
    selected_reference_checksum: selected.snapshotHash.slice('sha256:'.length),
    selected_reference_produced_at: selected.selectedAt,
    selected_reference_producer_refs: [
      selected.skill.packageChecksum,
      selected.provider.manifestHash,
      selected.server.catalogChecksum,
    ],
    selected_reference_metadata: {
      schemaVersion: 'ugv.selected_task_operation/v1',
      snapshot: selected,
    },
    confirmation_count: 1,
    ugv_confirmation_id: 'ugv-control-confirmation',
    ugv_confirmation_task_id: 'task-uap-p2-b03',
    ugv_confirmation_capability_binding_id: 'capability-binding-uap-p2-b03',
    ugv_confirmation_capability_id: 'embodied.move',
    ugv_confirmation_capability_version: 1,
    ugv_confirmation_capability_attempt_id: 'attempt-uap-p2-b03',
    ugv_confirmation_plan_id: 'plan-uap-p2-b03',
    ugv_confirmation_plan_hash: 'a'.repeat(64),
    ugv_confirmation_skill_id: 'embodied.move_to',
    ugv_confirmation_skill_version: 1,
    ugv_confirmation_provider_binding_id: selected.providerBinding.bindingId,
    ugv_confirmation_server_id: selected.server.serverId,
    ugv_confirmation_tool_name: selected.operation.operationName,
    ugv_confirmation_arguments_hash: selected.argumentsHash.slice('sha256:'.length),
    ugv_confirmation_actor_id: 'human:operator-1',
    ugv_confirmation_actor_kind: 'human' as const,
    ugv_confirmation_authentication_method: 'oidc-mfa',
    ugv_confirmation_actor_roles: ['physical_control_approver'],
    ugv_confirmation_reason: 'Approve exact UGV point navigation.',
    ugv_confirmation_confirmed_at: '2026-08-21T12:00:30.000Z',
    ugv_confirmation_expires_at: '2026-08-21T12:02:00.000Z',
    ugv_confirmation_revoked_at: null,
    ugv_confirmation_revoked_by: null,
    ugv_confirmation_consumed_invocation_id: null,
    ugv_confirmation_consumed_dispatch_hash: null,
    ugv_confirmation_consumed_at: null,
  };
}

function ugvBindingInput(longitude = 112, latitude = 28) {
  return Object.freeze({
    resourceId: 'vehicle:ugv1',
    target: Object.freeze({ x: longitude, y: latitude, frame: 'WGS84' as const }),
  });
}

function adaptUgvBindingInput(input: unknown) {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('invalid fixture input');
  const record = input as Readonly<Record<string, unknown>>;
  const targetValue = record['target'];
  if (typeof targetValue !== 'object' || targetValue === null || Array.isArray(targetValue))
    throw new Error('invalid fixture target');
  const target = targetValue as Readonly<Record<string, unknown>>;
  const longitude = target['x'];
  const latitude = target['y'];
  if (typeof longitude !== 'number' || typeof latitude !== 'number')
    throw new Error('invalid fixture coordinates');
  const providerArguments = Object.freeze({
    resourceId: record['resourceId'],
    mission: Object.freeze({
      type: 'point' as const,
      target: Object.freeze({ longitude, latitude }),
    }),
    stopOnObstacle: true as const,
  });
  return Object.freeze({
    providerArguments,
    argumentsHash: hashCanonicalEvidenceJson(providerArguments),
  });
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
