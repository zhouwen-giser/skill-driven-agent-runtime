import { describe, expect, it, vi } from 'vitest';

import { createSelectedTaskOperation, hashCanonicalEvidenceJson } from '../../domain/src/index.js';

import {
  GovernedControlConfirmationService,
  UgvGovernedControlConfirmationService,
  UgvGovernedControlInvocationAuthorizer,
  UgvGovernedControlManagementService,
  ugvGovernedControlConfirmationId,
  type GovernedControlConfirmation,
  type GovernedControlConfirmationConsumption,
  type UgvGovernedControlAuthoritySnapshot,
  type UgvGovernedControlDispatchAuthoritySnapshot,
  type UgvGovernedControlConfirmationIssueInput,
} from '../src/index.js';

const now = '2026-08-21T01:01:00.000Z';
const validUntil = '2026-08-21T01:10:00.000Z';
const planHash = 'a'.repeat(64);
const packageChecksum = 'b'.repeat(64);
const manifestHash = 'c'.repeat(64);
const catalogChecksum = 'd'.repeat(64);
const bindingHash = 'e'.repeat(64);
const arguments_ = Object.freeze({
  resourceId: 'vehicle:ugv1',
  mission: Object.freeze({
    type: 'point',
    target: Object.freeze({ longitude: 116.397, latitude: 39.908 }),
  }),
  stopOnObstacle: true,
});

describe('UGV governed-control profile authority', () => {
  it('issues one deterministic confirmation from persisted Selected and current authority', async () => {
    const authority = currentAuthority();
    let persisted: GovernedControlConfirmation | undefined;
    const store = {
      issueOnce: vi.fn((candidate: GovernedControlConfirmation) => {
        if (persisted === undefined) {
          persisted = candidate;
          return Promise.resolve({ confirmation: candidate, replayed: false });
        }
        return Promise.resolve({ confirmation: persisted, replayed: true });
      }),
      findExact: vi.fn(() => Promise.resolve(persisted)),
    };
    const issueAuthority = vi.fn(() => Promise.resolve(authority));
    const confirmations = new UgvGovernedControlConfirmationService({
      store,
      clock: { now: () => now },
    });
    const management = new UgvGovernedControlManagementService({
      authority: { loadForIssue: issueAuthority },
      confirmations,
      clock: { now: () => now },
    });
    const command = {
      taskId: authority.task.taskId,
      reason: 'Operator reviewed the point route and approves this exact simulation.',
      ttlMs: 60_000,
      principal: {
        actorId: 'human:operator-1',
        kind: 'human' as const,
        authenticationMethod: 'oidc-mfa',
        permissions: new Set(['physical_control.confirm' as const]),
        requestId: 'request-1',
      },
    };

    const first = await management.issue(command);
    const retry = await management.issue(command);

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.confirmation.confirmationId).toBe(first.confirmation.confirmationId);
    expect(first.confirmation).toMatchObject({
      planHash,
      skillId: 'embodied.move_to',
      providerBindingId: 'binding-smpp-ugv',
      serverId: 'smpp-ugv-provider',
      toolName: 'vehicle_navigate',
      argumentsHash: authority.selectedTaskOperation.argumentsHash.slice('sha256:'.length),
    });
    expect(first.confirmation.confirmationId).toBe(
      ugvGovernedControlConfirmationId(issueInput(authority)),
    );
    expect(issueAuthority).toHaveBeenCalledTimes(2);
    expect(authority.skill.runtimePolicy.maxMcpCalls).toBe(8);
    expect(authority.capability.dispatchMaximum).toBe(1);
    expect('toolPolicy' in authority.skill).toBe(false);
  });

  it('captures confirmation time after refreshed readiness and uses that same time for TTL', async () => {
    const refreshedAt = '2026-08-21T01:01:01.000Z';
    let currentTime = now;
    const authority = currentAuthority();
    const refreshedAuthority: UgvGovernedControlAuthoritySnapshot = Object.freeze({
      ...authority,
      readiness: Object.freeze({ ...authority.readiness, checkedAt: refreshedAt }),
    });
    let persisted: GovernedControlConfirmation | undefined;
    const clock = { now: vi.fn(() => currentTime) };
    const confirmations = new UgvGovernedControlConfirmationService({
      store: {
        issueOnce(candidate) {
          persisted = candidate;
          return Promise.resolve({ confirmation: candidate, replayed: false });
        },
        findExact: () => Promise.resolve(persisted),
      },
      clock,
    });
    const management = new UgvGovernedControlManagementService({
      authority: {
        loadForIssue: () => {
          currentTime = refreshedAt;
          return Promise.resolve(refreshedAuthority);
        },
      },
      confirmations,
      clock,
    });

    const result = await management.issue({
      taskId: authority.task.taskId,
      reason: 'Operator approves the exact refreshed UGV authority.',
      ttlMs: 60_000,
      principal: {
        actorId: 'human:operator-1',
        kind: 'human',
        authenticationMethod: 'oidc-mfa',
        permissions: new Set(['physical_control.confirm']),
        requestId: 'request-refreshed-readiness',
      },
    });

    expect(result.confirmation).toMatchObject({
      confirmedAt: refreshedAt,
      expiresAt: '2026-08-21T01:02:01.000Z',
    });
    expect(clock.now).toHaveBeenCalledTimes(2);
  });

  it('keeps the legacy random-id confirmation issuer compatible', async () => {
    const saveConfirmation = vi.fn((value: GovernedControlConfirmation) => Promise.resolve(value));
    const legacy = new GovernedControlConfirmationService({
      store: { saveConfirmation, revokeConfirmation: () => Promise.resolve(undefined) },
      clock: { now: () => now },
      ids: { nextConfirmationId: () => 'legacy-random-id' },
    });
    const authority = currentAuthority();
    const input = issueInput(authority);

    await expect(
      legacy.issue({
        ...input,
        expiresAt: '2026-08-21T01:02:00.000Z',
      }),
    ).resolves.toMatchObject({ confirmationId: 'legacy-random-id' });
    expect(saveConfirmation).toHaveBeenCalledOnce();
  });

  it('refreshes exact current authority and atomically consumes only one navigate dispatch', async () => {
    const authority = currentAuthority();
    const confirmation = confirmed(authority);
    const snapshot: UgvGovernedControlDispatchAuthoritySnapshot = {
      ...authority,
      task: { ...authority.task, phase: 'executing' },
      plan: { ...authority.plan, confirmationStatus: 'confirmed' },
      confirmation,
    };
    const loadForPreInvocation = vi.fn(() => Promise.resolve(snapshot));
    let consumed = false;
    const consumeConfirmation = vi.fn((consumption: GovernedControlConfirmationConsumption) => {
      if (consumed) return Promise.resolve(undefined);
      consumed = true;
      return Promise.resolve({
        ...confirmation,
        consumedInvocationId: consumption.invocationId,
        consumedDispatchHash: consumption.dispatchHash,
        consumedAt: consumption.consumedAt,
      });
    });
    const assertAuthorized = vi.fn(() => Promise.resolve());
    const authorizer = new UgvGovernedControlInvocationAuthorizer({
      authority: { loadForPreInvocation },
      confirmations: { consumeConfirmation },
      simulationSideEffectGate: { assertAuthorized },
      clock: { now: () => now },
    });
    const invocation = {
      invocationId: 'invocation-1',
      dispatchHash: `sha256:${'f'.repeat(64)}` as const,
      taskId: authority.task.taskId,
      capabilityAttemptId: authority.attempt.capabilityAttemptId,
      providerBindingId: authority.selectedTaskOperation.providerBinding.bindingId,
      serverId: authority.selectedTaskOperation.server.serverId,
      toolName: authority.selectedTaskOperation.operation.operationName,
      arguments: arguments_,
      executionSemantics: authority.selectedTaskOperation.operation.executionSemantics,
    };

    await expect(authorizer.authorizeAndConsume(invocation)).resolves.toMatchObject({
      confirmationId: confirmation.confirmationId,
      argumentsHash: authority.selectedTaskOperation.argumentsHash.slice('sha256:'.length),
      invocationId: 'invocation-1',
    });
    await expect(
      authorizer.authorizeAndConsume({ ...invocation, invocationId: 'invocation-2' }),
    ).rejects.toMatchObject({ code: 'UGV_GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED' });
    expect(loadForPreInvocation).toHaveBeenCalledTimes(2);
    expect(assertAuthorized).toHaveBeenCalledTimes(2);
    expect(assertAuthorized).toHaveBeenCalledWith({
      taskId: authority.task.taskId,
      simulationId: 'ugv-simulation-1',
      selectedSnapshotHash: authority.selectedTaskOperation.snapshotHash,
    });
    expect(consumeConfirmation).toHaveBeenCalledTimes(2);
  });

  it('uses the independent live deployment gate for replay-forbidden execution', async () => {
    const simulated = selectedTaskOperation();
    const { snapshotHash, ...draft } = simulated;
    expect(snapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const selected = createSelectedTaskOperation({
      ...draft,
      operation: {
        ...draft.operation,
        executionSemantics: { ...draft.operation.executionSemantics, replay: 'forbidden' },
      },
      execution: {
        mode: 'live',
        confirmation: 'existing_outer_plan_confirmation',
        confirmationRequired: true,
      },
    });
    const authority = currentAuthority(selected);
    const confirmation = confirmed(authority);
    const liveAuthorized = vi.fn(() => Promise.resolve());
    const simulationAuthorized = vi.fn(() => Promise.resolve());
    const consumeConfirmation = vi.fn((consumption: GovernedControlConfirmationConsumption) =>
      Promise.resolve({
        ...confirmation,
        consumedInvocationId: consumption.invocationId,
        consumedDispatchHash: consumption.dispatchHash,
        consumedAt: consumption.consumedAt,
      }),
    );
    const authorizer = new UgvGovernedControlInvocationAuthorizer({
      authority: {
        loadForPreInvocation: () =>
          Promise.resolve({
            ...authority,
            task: { ...authority.task, phase: 'executing' },
            plan: { ...authority.plan, confirmationStatus: 'confirmed' },
            confirmation,
          }),
      },
      confirmations: { consumeConfirmation },
      simulationSideEffectGate: { assertAuthorized: simulationAuthorized },
      liveSideEffectGate: { assertAuthorized: liveAuthorized },
      clock: { now: () => now },
    });

    await expect(
      authorizer.authorizeAndConsume({
        invocationId: 'invocation-live-1',
        dispatchHash: `sha256:${'e'.repeat(64)}`,
        taskId: authority.task.taskId,
        capabilityAttemptId: authority.attempt.capabilityAttemptId,
        providerBindingId: selected.providerBinding.bindingId,
        serverId: selected.server.serverId,
        toolName: selected.operation.operationName,
        arguments: arguments_,
        executionSemantics: selected.operation.executionSemantics,
      }),
    ).resolves.toMatchObject({ invocationId: 'invocation-live-1' });
    expect(liveAuthorized).toHaveBeenCalledWith({
      taskId: authority.task.taskId,
      selectedSnapshotHash: selected.snapshotHash,
    });
    expect(simulationAuthorized).not.toHaveBeenCalled();
  });

  it('uses refreshed pre-invocation readiness after the persisted selection availability expires', async () => {
    const authority = currentAuthority();
    const { snapshotHash, ...selectedDraft } = authority.selectedTaskOperation;
    const selected = createSelectedTaskOperation({
      ...selectedDraft,
      availability: {
        ...selectedDraft.availability,
        validUntil: '2026-08-21T01:00:59.999Z',
      },
    });
    expect(selected.snapshotHash).not.toBe(snapshotHash);
    const refreshedAuthority: UgvGovernedControlAuthoritySnapshot = Object.freeze({
      ...authority,
      selectedTaskOperation: selected,
      binding: Object.freeze({
        ...authority.binding,
        selectedTaskOperationSnapshotHash: selected.snapshotHash,
      }),
      plan: Object.freeze({
        ...authority.plan,
        selectedTaskOperationSnapshotHash: selected.snapshotHash,
      }),
      readiness: Object.freeze({
        ...authority.readiness,
        selectedTaskOperationSnapshotHash: selected.snapshotHash,
      }),
    });
    const confirmation = confirmed(refreshedAuthority);
    const snapshot: UgvGovernedControlDispatchAuthoritySnapshot = Object.freeze({
      ...refreshedAuthority,
      task: Object.freeze({ ...refreshedAuthority.task, phase: 'executing' }),
      plan: Object.freeze({
        ...refreshedAuthority.plan,
        confirmationStatus: 'confirmed',
      }),
      confirmation,
    });
    const consumeConfirmation = vi.fn((consumption: GovernedControlConfirmationConsumption) =>
      Promise.resolve({
        ...confirmation,
        consumedInvocationId: consumption.invocationId,
        consumedDispatchHash: consumption.dispatchHash,
        consumedAt: consumption.consumedAt,
      }),
    );
    const authorizer = new UgvGovernedControlInvocationAuthorizer({
      authority: { loadForPreInvocation: () => Promise.resolve(snapshot) },
      confirmations: { consumeConfirmation },
      simulationSideEffectGate: { assertAuthorized: () => Promise.resolve() },
      clock: { now: () => now },
    });

    await expect(
      authorizer.authorizeAndConsume({
        invocationId: 'invocation-refreshed-readiness',
        dispatchHash: `sha256:${'f'.repeat(64)}`,
        taskId: snapshot.task.taskId,
        capabilityAttemptId: snapshot.attempt.capabilityAttemptId,
        providerBindingId: selected.providerBinding.bindingId,
        serverId: selected.server.serverId,
        toolName: selected.operation.operationName,
        arguments: selected.resolvedArguments,
        executionSemantics: selected.operation.executionSemantics,
      }),
    ).resolves.toMatchObject({ invocationId: 'invocation-refreshed-readiness' });
    expect(consumeConfirmation).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'adapted arguments tamper',
      (snapshot: UgvGovernedControlDispatchAuthoritySnapshot) => snapshot,
      { ...arguments_, stopOnObstacle: false },
      'UGV_GOVERNED_CONTROL_ARGUMENTS_TAMPERED',
    ],
    [
      'Provider Binding revision drift',
      (snapshot: UgvGovernedControlDispatchAuthoritySnapshot) => ({
        ...snapshot,
        providerBinding: { ...snapshot.providerBinding, revision: 8 },
      }),
      arguments_,
      'UGV_GOVERNED_CONTROL_CURRENT_AUTHORITY_DRIFT',
    ],
    [
      'Catalog checksum drift',
      (snapshot: UgvGovernedControlDispatchAuthoritySnapshot) => ({
        ...snapshot,
        catalog: { ...snapshot.catalog, catalogChecksum: '0'.repeat(64) },
      }),
      arguments_,
      'UGV_GOVERNED_CONTROL_CURRENT_AUTHORITY_DRIFT',
    ],
    [
      'Plan Selected snapshot drift',
      (snapshot: UgvGovernedControlDispatchAuthoritySnapshot) => ({
        ...snapshot,
        plan: {
          ...snapshot.plan,
          selectedTaskOperationSnapshotHash: `sha256:${'0'.repeat(64)}` as const,
        },
      }),
      arguments_,
      'UGV_GOVERNED_CONTROL_CURRENT_AUTHORITY_DRIFT',
    ],
    [
      'expired readiness',
      (snapshot: UgvGovernedControlDispatchAuthoritySnapshot) => ({
        ...snapshot,
        readiness: { ...snapshot.readiness, validUntil: now },
      }),
      arguments_,
      'UGV_GOVERNED_CONTROL_READINESS_STALE',
    ],
  ])(
    'rejects %s before confirmation consumption',
    async (_case, mutate, invocationArguments, code) => {
      const authority = currentAuthority();
      const confirmation = confirmed(authority);
      const snapshot = mutate({
        ...authority,
        task: { ...authority.task, phase: 'executing' },
        plan: { ...authority.plan, confirmationStatus: 'confirmed' },
        confirmation,
      });
      const consumeConfirmation = vi.fn(() => Promise.resolve(confirmation));
      const authorizer = new UgvGovernedControlInvocationAuthorizer({
        authority: { loadForPreInvocation: () => Promise.resolve(snapshot) },
        confirmations: { consumeConfirmation },
        simulationSideEffectGate: { assertAuthorized: () => Promise.resolve() },
        clock: { now: () => now },
      });

      await expect(
        authorizer.authorizeAndConsume({
          invocationId: 'invocation-1',
          dispatchHash: `sha256:${'f'.repeat(64)}`,
          taskId: authority.task.taskId,
          capabilityAttemptId: authority.attempt.capabilityAttemptId,
          providerBindingId: authority.selectedTaskOperation.providerBinding.bindingId,
          serverId: authority.selectedTaskOperation.server.serverId,
          toolName: authority.selectedTaskOperation.operation.operationName,
          arguments: invocationArguments,
          executionSemantics: authority.selectedTaskOperation.operation.executionSemantics,
        }),
      ).rejects.toMatchObject({ code });
      expect(consumeConfirmation).not.toHaveBeenCalled();
    },
  );

  it('rejects a tampered persisted Selected self-hash before consumption', async () => {
    const authority = currentAuthority();
    const tamperedSelected = {
      ...authority.selectedTaskOperation,
      resolvedArguments: { ...arguments_, stopOnObstacle: false },
    };
    const tamperedAuthority = {
      ...authority,
      task: { ...authority.task, phase: 'executing' },
      plan: { ...authority.plan, confirmationStatus: 'confirmed' },
      selectedTaskOperation: tamperedSelected,
      confirmation: confirmed(authority),
    } as UgvGovernedControlDispatchAuthoritySnapshot;
    const consumeConfirmation = vi.fn(() => Promise.resolve(undefined));
    const authorizer = new UgvGovernedControlInvocationAuthorizer({
      authority: { loadForPreInvocation: () => Promise.resolve(tamperedAuthority) },
      confirmations: { consumeConfirmation },
      simulationSideEffectGate: { assertAuthorized: () => Promise.resolve() },
      clock: { now: () => now },
    });

    await expect(
      authorizer.authorizeAndConsume({
        invocationId: 'invocation-1',
        dispatchHash: `sha256:${'f'.repeat(64)}`,
        taskId: authority.task.taskId,
        capabilityAttemptId: authority.attempt.capabilityAttemptId,
        providerBindingId: authority.selectedTaskOperation.providerBinding.bindingId,
        serverId: authority.selectedTaskOperation.server.serverId,
        toolName: authority.selectedTaskOperation.operation.operationName,
        arguments: arguments_,
        executionSemantics: authority.selectedTaskOperation.operation.executionSemantics,
      }),
    ).rejects.toMatchObject({ code: 'UGV_GOVERNED_CONTROL_SELECTED_OPERATION_INVALID' });
    expect(consumeConfirmation).not.toHaveBeenCalled();
  });

  it('fails closed without the server simulation gate and rejects caller-supplied target drift', async () => {
    const authority = currentAuthority();
    const confirmation = confirmed(authority);
    const snapshot: UgvGovernedControlDispatchAuthoritySnapshot = {
      ...authority,
      task: { ...authority.task, phase: 'executing' },
      plan: { ...authority.plan, confirmationStatus: 'confirmed' },
      confirmation,
    };
    const consumeConfirmation = vi.fn(() => Promise.resolve(confirmation));
    const withoutGate = new UgvGovernedControlInvocationAuthorizer({
      authority: { loadForPreInvocation: () => Promise.resolve(snapshot) },
      confirmations: { consumeConfirmation },
      clock: { now: () => now },
    });
    const invocation = {
      invocationId: 'invocation-1',
      dispatchHash: `sha256:${'f'.repeat(64)}`,
      taskId: authority.task.taskId,
      capabilityAttemptId: authority.attempt.capabilityAttemptId,
      providerBindingId: authority.selectedTaskOperation.providerBinding.bindingId,
      serverId: authority.selectedTaskOperation.server.serverId,
      toolName: authority.selectedTaskOperation.operation.operationName,
      arguments: arguments_,
      executionSemantics: authority.selectedTaskOperation.operation.executionSemantics,
    };

    await expect(withoutGate.authorizeAndConsume(invocation)).rejects.toMatchObject({
      code: 'UGV_GOVERNED_CONTROL_SIMULATION_SIDE_EFFECT_NOT_AUTHORIZED',
    });
    const withGate = new UgvGovernedControlInvocationAuthorizer({
      authority: { loadForPreInvocation: () => Promise.resolve(snapshot) },
      confirmations: { consumeConfirmation },
      simulationSideEffectGate: { assertAuthorized: () => Promise.resolve() },
      clock: { now: () => now },
    });
    await expect(
      withGate.authorizeAndConsume({ ...invocation, providerBindingId: 'caller-invented-binding' }),
    ).rejects.toMatchObject({ code: 'UGV_GOVERNED_CONTROL_ARGUMENTS_TAMPERED' });
    expect(consumeConfirmation).not.toHaveBeenCalled();
  });

  it('rejects deterministic confirmation tamper and expiry before atomic consumption', async () => {
    const authority = currentAuthority();
    const valid = confirmed(authority);
    const consumeConfirmation = vi.fn(() => Promise.resolve(valid));
    const invoke = (confirmation: GovernedControlConfirmation, clock = now) =>
      new UgvGovernedControlInvocationAuthorizer({
        authority: {
          loadForPreInvocation: () =>
            Promise.resolve({
              ...authority,
              task: { ...authority.task, phase: 'executing' },
              plan: { ...authority.plan, confirmationStatus: 'confirmed' },
              confirmation,
            }),
        },
        confirmations: { consumeConfirmation },
        simulationSideEffectGate: { assertAuthorized: () => Promise.resolve() },
        clock: { now: () => clock },
      }).authorizeAndConsume({
        invocationId: 'invocation-1',
        dispatchHash: `sha256:${'f'.repeat(64)}`,
        taskId: authority.task.taskId,
        capabilityAttemptId: authority.attempt.capabilityAttemptId,
        providerBindingId: authority.selectedTaskOperation.providerBinding.bindingId,
        serverId: authority.selectedTaskOperation.server.serverId,
        toolName: authority.selectedTaskOperation.operation.operationName,
        arguments: arguments_,
        executionSemantics: authority.selectedTaskOperation.operation.executionSemantics,
      });

    await expect(
      invoke({ ...valid, confirmationId: 'ugv-control-tampered' }),
    ).rejects.toMatchObject({
      code: 'UGV_GOVERNED_CONTROL_CONFIRMATION_INVALID',
    });
    await expect(invoke(valid, '2026-08-21T01:03:00.000Z')).rejects.toMatchObject({
      code: 'UGV_GOVERNED_CONTROL_CONFIRMATION_INVALID',
    });
    expect(consumeConfirmation).not.toHaveBeenCalled();
  });
});

function currentAuthority(selected = selectedTaskOperation()): UgvGovernedControlAuthoritySnapshot {
  const navigate = {
    operationName: selected.operation.operationName,
    toolRevision: selected.server.toolRevision,
    inputSchemaHash: selected.operation.inputSchemaHash,
    outputSchemaHash: selected.operation.outputSchemaHash,
    executionSemantics: selected.operation.executionSemantics,
    taskExecutionProfile: selected.operation.taskExecutionProfile,
  };
  const finalStateRead = {
    operationName: selected.finalStateRead.operationName,
    toolRevision: selected.server.toolRevision,
    inputSchemaHash: selected.finalStateRead.inputSchemaHash,
    outputSchemaHash: selected.finalStateRead.outputSchemaHash,
    executionSemantics: selected.finalStateRead.executionSemantics,
    taskExecutionProfile: selected.finalStateRead.taskExecutionProfile,
  };
  return Object.freeze({
    selectedTaskOperation: selected,
    task: Object.freeze({
      taskId: 'task-ugv-1',
      phase: 'planning',
      planId: 'plan-ugv-1',
      selectedSkillId: 'embodied.move_to',
      selectedSkillVersion: 1,
    }),
    capability: Object.freeze({
      capabilityId: 'embodied.move',
      capabilityVersion: 1,
      status: 'published',
      riskLevel: 'high',
      supportedModes: Object.freeze(['plan_confirmed', 'remote_task']),
      implementationSkillId: 'embodied.move_to',
      implementationSkillVersion: 1,
      dispatchMaximum: 1,
    }),
    binding: Object.freeze({
      capabilityBindingId: 'capability-binding-ugv-1',
      capabilityId: 'embodied.move',
      capabilityVersion: 1,
      providerBindingId: selected.providerBinding.bindingId,
      providerBindingRevision: selected.providerBinding.revision,
      selectedTaskOperationSnapshotHash: selected.snapshotHash,
      bindingHash,
    }),
    attempt: Object.freeze({
      capabilityAttemptId: 'capability-attempt-ugv-1',
      status: 'prepared',
      planId: 'plan-ugv-1',
      skillVersionRefs: Object.freeze(['skill:embodied.move_to:1']),
      providerBindingRefs: Object.freeze([selected.providerBinding.bindingId]),
    }),
    plan: Object.freeze({
      planId: 'plan-ugv-1',
      definitionHash: planHash,
      confirmationStatus: 'awaiting_confirmation',
      selectedTaskOperationSnapshotHash: selected.snapshotHash,
    }),
    skill: Object.freeze({
      skillId: 'embodied.move_to',
      skillVersion: 1,
      currentVersion: 1,
      status: 'enabled',
      validationPassed: true,
      packageChecksum,
      capabilities: Object.freeze(['embodied.move']),
      runtimePolicy: Object.freeze({ autoConfirmPlan: false, maxMcpCalls: 8 }),
      outcome: Object.freeze({
        effects: Object.freeze(['effect.final_position']),
        evidence: Object.freeze(['evidence.final_position']),
        finalPositionHardGate: true,
        rejectSuccessWithoutRequiredEvidence: true,
      }),
    }),
    providerBinding: Object.freeze({
      bindingId: selected.providerBinding.bindingId,
      revision: selected.providerBinding.revision,
      status: 'active',
      availability: 'available',
      availabilityValidUntil: validUntil,
      providerId: selected.provider.providerId,
      providerType: selected.provider.providerType,
      providerVersion: selected.provider.providerVersion,
      manifestHash: selected.provider.manifestHash,
      serverId: selected.server.serverId,
      catalogRevision: selected.server.catalogRevision,
      catalogChecksum: selected.server.catalogChecksum,
    }),
    catalog: Object.freeze({
      providerId: selected.provider.providerId,
      providerType: selected.provider.providerType,
      providerVersion: selected.provider.providerVersion,
      manifestHash: selected.provider.manifestHash,
      serverId: selected.server.serverId,
      discoverySnapshotId: selected.server.discoverySnapshotId,
      catalogRevision: selected.server.catalogRevision,
      catalogChecksum: selected.server.catalogChecksum,
      navigate: Object.freeze(navigate),
      finalStateRead: Object.freeze(finalStateRead),
    }),
    readiness: Object.freeze({
      checkPhase: 'pre_invocation',
      disposition: 'ready',
      guardAction: 'proceed',
      confirmationRequired: false,
      providerBindingId: selected.providerBinding.bindingId,
      providerBindingRevision: selected.providerBinding.revision,
      serverId: selected.server.serverId,
      providerId: selected.provider.providerId,
      operationName: selected.operation.operationName,
      resourceId: selected.resource.resourceId,
      argumentsHash: selected.argumentsHash,
      selectedTaskOperationSnapshotHash: selected.snapshotHash,
      catalogRevision: selected.server.catalogRevision,
      catalogChecksum: selected.server.catalogChecksum,
      toolRevision: selected.server.toolRevision,
      availability: 'available',
      riskLevel: 'high',
      checkedAt: '2026-08-21T01:00:30.000Z',
      validUntil,
    }),
  });
}

function selectedTaskOperation() {
  const navigateInputSchema = { type: 'object', title: 'VehicleNavigateInputV1' };
  const navigateOutputSchema = { type: 'object', title: 'VehicleTaskResultV1' };
  const stateInputSchema = { type: 'object', title: 'VehicleGetStateInputV1' };
  const stateOutputSchema = { type: 'object', title: 'VehicleStateV1' };
  const navigateSemantics = {
    effect: 'side_effecting' as const,
    execution: 'task_required' as const,
    cancellation: 'task_cancel' as const,
    idempotency: 'server_managed' as const,
    replay: 'simulation_only' as const,
    source: 'mcp_declared' as const,
  };
  const navigateProfile = {
    profileVersion: '1.0' as const,
    taskBehavior: 'task_required' as const,
    availability: 'dynamic' as const,
    supportsScheduling: true,
    supportsMaxElapsed: true,
    supportsCancellation: true,
    supportsPauseResume: true,
    supportsObservations: true,
    supportsInputRequired: false,
    idempotency: 'server_managed' as const,
  };
  const readSemantics = {
    effect: 'read_only' as const,
    execution: 'synchronous' as const,
    cancellation: 'unsupported' as const,
    idempotency: 'server_managed' as const,
    replay: 'allowed' as const,
    source: 'mcp_declared' as const,
  };
  const readProfile = {
    profileVersion: '1.0' as const,
    taskBehavior: 'synchronous_only' as const,
    availability: 'dynamic' as const,
    supportsScheduling: false,
    supportsMaxElapsed: false,
    supportsCancellation: false,
    supportsPauseResume: false,
    supportsObservations: false,
    supportsInputRequired: false,
    idempotency: 'server_managed' as const,
  };
  const stateArguments = Object.freeze({
    resourceId: 'vehicle:ugv1',
    include: Object.freeze(['chassis', 'health']),
  });
  return createSelectedTaskOperation({
    profileId: 'ugv-agent-profile',
    selectedAt: '2026-08-21T01:00:45.000Z',
    skill: Object.freeze({ skillId: 'embodied.move_to', version: 1, packageChecksum }),
    task: Object.freeze({
      semanticTaskType: 'embodied.move',
      operationAlias: 'vehicle_navigate',
      aliasRevision: 'ugv-agent-profile/embodied.move/v1',
      semanticBindingId: 'ugv-agent-profile/move-resource',
      skillBindingId: 'move-resource',
      bindingId: 'binding-smpp-ugv',
    }),
    providerBinding: Object.freeze({ bindingId: 'binding-smpp-ugv', revision: 7 }),
    provider: Object.freeze({
      providerId: 'isr.vehicle.ugv.ugv1',
      providerType: 'isr.vehicle.ugv',
      providerVersion: '1.0.0',
      manifestHash,
    }),
    server: Object.freeze({
      serverId: 'smpp-ugv-provider',
      protocolMode: 'frozen_v1',
      discoverySnapshotId: 'snapshot-smpp-ugv-9',
      toolRevision: 9,
      catalogRevision: 'catalog-revision-9',
      catalogChecksum,
    }),
    resource: Object.freeze({ resourceId: 'vehicle:ugv1', resourceType: 'vehicle' }),
    operation: Object.freeze({
      operationName: 'vehicle_navigate',
      inputSchema: navigateInputSchema,
      inputSchemaHash: hashCanonicalEvidenceJson(navigateInputSchema),
      outputSchema: navigateOutputSchema,
      outputSchemaHash: hashCanonicalEvidenceJson(navigateOutputSchema),
      executionSemantics: navigateSemantics,
      taskExecutionProfile: navigateProfile,
      taskNotifications: true,
    }),
    finalStateRead: Object.freeze({
      operationName: 'vehicle_get_state',
      serverId: 'smpp-ugv-provider',
      providerId: 'isr.vehicle.ugv.ugv1',
      resourceId: 'vehicle:ugv1',
      catalogChecksum,
      inputSchema: stateInputSchema,
      inputSchemaHash: hashCanonicalEvidenceJson(stateInputSchema),
      outputSchema: stateOutputSchema,
      outputSchemaHash: hashCanonicalEvidenceJson(stateOutputSchema),
      executionSemantics: readSemantics,
      taskExecutionProfile: readProfile,
      resolvedArguments: stateArguments,
      argumentsHash: hashCanonicalEvidenceJson(stateArguments),
    }),
    resolvedArguments: arguments_,
    argumentsHash: hashCanonicalEvidenceJson(arguments_),
    availability: Object.freeze({
      protocolRevision: 'smpp-task-execution/1.0',
      schemaRevision: 'smpp-availability/1.0',
      checkedAt: '2026-08-21T01:00:30.000Z',
      validUntil,
      disposition: 'ready',
      riskLevel: 'high',
      reservationMode: 'none',
      possibleEffects: Object.freeze(['task_pause' as const]),
    }),
    execution: Object.freeze({
      mode: 'simulation',
      simulationId: 'ugv-simulation-1',
      confirmation: 'existing_outer_plan_confirmation',
      confirmationRequired: true,
    }),
  });
}

function issueInput(
  authority: UgvGovernedControlAuthoritySnapshot,
): UgvGovernedControlConfirmationIssueInput {
  const selected = authority.selectedTaskOperation;
  return {
    taskId: authority.task.taskId,
    capabilityBindingId: authority.binding.capabilityBindingId,
    capabilityId: authority.capability.capabilityId,
    capabilityVersion: authority.capability.capabilityVersion,
    capabilityAttemptId: authority.attempt.capabilityAttemptId,
    planId: authority.plan.planId,
    planHash: authority.plan.definitionHash,
    skillId: selected.skill.skillId,
    skillVersion: selected.skill.version,
    providerBindingId: selected.providerBinding.bindingId,
    serverId: selected.server.serverId,
    toolName: selected.operation.operationName,
    argumentsHash: selected.argumentsHash.slice('sha256:'.length),
    selectedTaskOperationSnapshotHash: selected.snapshotHash,
    actorId: 'human:operator-1',
    actorKind: 'human',
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Operator reviewed the point route and approves this exact simulation.',
    expiresAt: '2026-08-21T01:02:00.000Z',
  };
}

function confirmed(authority: UgvGovernedControlAuthoritySnapshot): GovernedControlConfirmation {
  const input = issueInput(authority);
  return Object.freeze({
    ...input,
    confirmationId: ugvGovernedControlConfirmationId(input),
    confirmedAt: now,
  });
}
