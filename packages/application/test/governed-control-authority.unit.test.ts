import { describe, expect, it, vi } from 'vitest';

import {
  GovernedControlConfirmationService,
  GovernedControlInvocationAuthorizer,
  governedControlSnapshotHash,
  type CurrentGovernedCapabilityAuthority,
  type GovernedControlConfirmation,
  type GovernedControlConfirmationConsumption,
  type GovernedControlRuntimeAuthoritySnapshot,
} from '../src/index.js';

const confirmedAt = '2026-08-13T01:00:00.000Z';
const expiresAt = '2026-08-13T01:05:00.000Z';
const taskId = 'task-control-1';
const capabilityId = 'vehicle.ugv.track-target';
const capabilityVersion = 1;
const planId = 'plan-control-1';
const skillId = 'ugv.track-target';
const skillVersion = 3;
const serverId = 'smpp-ugv-provider';
const toolName = 'vehicle_track_target';
const providerBindingId = 'provider-binding-ugv';
const arguments_ = Object.freeze({ resourceId: 'ugv-1', targetId: 'target-1' });
const invocationId = 'invocation-control-1';
const dispatchHash = `sha256:${'d'.repeat(64)}`;
const planDefinition = Object.freeze({ nodes: [{ id: 'set', type: 'mcp_tool' }] });
const planHash = governedControlSnapshotHash(planDefinition);

describe('GovernedControlConfirmationService', () => {
  it('persists a bounded human confirmation bound to Task, Capability, Skill, and Plan', async () => {
    let persisted: GovernedControlConfirmation | undefined;
    const service = new GovernedControlConfirmationService({
      store: {
        saveConfirmation: (confirmation) => {
          persisted = confirmation;
          return Promise.resolve(confirmation);
        },
        revokeConfirmation: () => Promise.resolve(undefined),
      },
      clock: { now: () => confirmedAt },
      ids: { nextConfirmationId: () => 'control-confirmation-1' },
    });

    await expect(service.issue(confirmationInput())).resolves.toMatchObject({
      confirmationId: 'control-confirmation-1',
      taskId,
      capabilityId,
      planId,
      planHash,
      skillId,
      actorId: 'human:operator-1',
      expiresAt,
    });
    expect(persisted).toBeDefined();
  });

  it.each([
    ['LLM actor', { actorId: 'llm:planner' }],
    ['anonymous authentication', { authenticationMethod: 'none' }],
    ['missing approver role', { actorRoles: ['viewer'] }],
  ])('rejects an untrusted confirmation from %s', async (_case, override) => {
    const service = confirmationService();

    await expect(service.issue({ ...confirmationInput(), ...override })).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_CONFIRMATION_ACTOR_UNTRUSTED',
    });
  });

  it('rejects an unbounded or already expired confirmation', async () => {
    const service = confirmationService();

    await expect(
      service.issue({ ...confirmationInput(), expiresAt: '2026-08-13T02:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_EXPIRY_INVALID' });
  });
});

describe('GovernedControlInvocationAuthorizer', () => {
  it('authorizes and consumes an exact published UGV control chain without calling a Provider', async () => {
    const fixture = authorizerFixture();

    await expect(fixture.authorizer.authorizeAndConsume(invocation())).resolves.toMatchObject({
      confirmationId: 'control-confirmation-1',
      providerBindingId,
      argumentsHash: governedControlSnapshotHash(arguments_),
      invocationId,
      dispatchHash,
    });
    expect(fixture.store.load).toHaveBeenCalledExactlyOnceWith({
      taskId,
      capabilityAttemptId: 'capability-attempt-control',
      providerBindingId,
      serverId,
      toolName,
      argumentsHash: governedControlSnapshotHash(arguments_),
    });
    expect(fixture.capabilities.load).toHaveBeenCalledExactlyOnceWith(
      capabilityId,
      capabilityVersion,
    );
    expect(fixture.store.consumeConfirmation).toHaveBeenCalledExactlyOnceWith({
      confirmationId: 'control-confirmation-1',
      taskId,
      capabilityBindingId: 'capability-binding-control',
      capabilityAttemptId: 'capability-attempt-control',
      providerBindingId,
      serverId,
      toolName,
      argumentsHash: governedControlSnapshotHash(arguments_),
      invocationId,
      dispatchHash,
      consumedAt: '2026-08-13T01:01:00.000Z',
    });
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it('authorizes an exact two-metre navigate dispatch under the five-call Task budget', async () => {
    const authority = navigateAuthority({
      resourceId: 'ugv-1',
      mission: { type: 'distance', direction: 'forward', distanceM: 2 },
    });
    const fixture = authorizerFixture({
      snapshot: authority.snapshot,
      capability: authority.capability,
    });

    await expect(
      fixture.authorizer.authorizeAndConsume(authority.invocation),
    ).resolves.toMatchObject({
      confirmationId: 'control-confirmation-1',
      argumentsHash: governedControlSnapshotHash(authority.invocation.arguments),
    });
    expect(fixture.store.consumeConfirmation).toHaveBeenCalledOnce();
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it('interprets movement values and nested argument paths only from frozen authority', async () => {
    const authority = navigateAuthority({
      resourceId: 'ugv-1',
      movement: { kind: 'linear', heading: 'north', metres: 1.5 },
    });
    const genericConstraints = authority.snapshot.binding.constraintSnapshot.map((constraint) =>
      constraint['type'] === 'bounded_movement_policy'
        ? {
            ...constraint,
            missionType: 'linear',
            missionTypeArgumentPath: ['movement', 'kind'],
            directionArgumentPath: ['movement', 'heading'],
            distanceArgumentPath: ['movement', 'metres'],
            allowedDirections: ['north'],
            exactDirection: 'north',
            exactDistancePerDispatch: 1.5,
            exactTotalDistance: 7.5,
          }
        : constraint,
    );
    const fixture = authorizerFixture({
      snapshot: {
        ...authority.snapshot,
        binding: {
          ...authority.snapshot.binding,
          constraintSnapshot: genericConstraints,
        },
      },
      capability: {
        ...authority.capability,
        definition: {
          ...authority.capability.definition,
          constraints: genericConstraints,
        },
      },
    });

    await expect(
      fixture.authorizer.authorizeAndConsume(authority.invocation),
    ).resolves.toMatchObject({ confirmationId: 'control-confirmation-1' });
    expect(fixture.store.consumeConfirmation).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'zero distance',
      { resourceId: 'ugv-1', mission: { type: 'distance', direction: 'forward', distanceM: 0 } },
    ],
    [
      'distance above two metres',
      {
        resourceId: 'ugv-1',
        mission: { type: 'distance', direction: 'forward', distanceM: 2.001 },
      },
    ],
    [
      'direction outside the exact sequence',
      { resourceId: 'ugv-1', mission: { type: 'distance', direction: 'backward', distanceM: 2 } },
    ],
    [
      'non-distance mission',
      {
        resourceId: 'ugv-1',
        mission: { type: 'point', target: { latitude: 1, longitude: 2 } },
      },
    ],
  ])('rejects bounded navigate %s before consuming confirmation', async (_case, arguments_) => {
    const authority = navigateAuthority(arguments_);
    const fixture = authorizerFixture({
      snapshot: authority.snapshot,
      capability: authority.capability,
    });

    await expect(
      fixture.authorizer.authorizeAndConsume(authority.invocation),
    ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_ARGUMENTS_OUT_OF_BOUNDS' });
    expect(fixture.store.consumeConfirmation).not.toHaveBeenCalled();
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it('rejects an internally inconsistent exact movement constraint', async () => {
    const authority = navigateAuthority({
      resourceId: 'ugv-1',
      mission: { type: 'distance', direction: 'forward', distanceM: 2 },
    });
    const widened = authority.snapshot.binding.constraintSnapshot.map((constraint) =>
      constraint['type'] === 'bounded_movement_policy'
        ? { ...constraint, exactTotalDistance: 11 }
        : constraint,
    );
    const fixture = authorizerFixture({
      snapshot: {
        ...authority.snapshot,
        binding: { ...authority.snapshot.binding, constraintSnapshot: widened },
      },
      capability: {
        ...authority.capability,
        definition: { ...authority.capability.definition, constraints: widened },
      },
    });

    await expect(
      fixture.authorizer.authorizeAndConsume(authority.invocation),
    ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONSTRAINTS_INVALID' });
    expect(fixture.store.consumeConfirmation).not.toHaveBeenCalled();
  });

  it('rejects a confirmation already consumed by a different invocation or dispatch hash', async () => {
    const fixture = authorizerFixture();
    const snapshot = currentSnapshot();
    fixture.store.consumeConfirmation.mockResolvedValue({
      ...snapshot.confirmation,
      consumedInvocationId: 'invocation-control-other',
      consumedDispatchHash: `sha256:${'e'.repeat(64)}`,
      consumedAt: '2026-08-13T01:00:59.000Z',
    });

    await expect(fixture.authorizer.authorizeAndConsume(invocation())).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED',
    });
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it('permits exactly one dispatch admission for the same confirmation and invocation identity', async () => {
    const fixture = authorizerFixture();

    await expect(fixture.authorizer.authorizeAndConsume(invocation())).resolves.toMatchObject({
      confirmationId: 'control-confirmation-1',
      invocationId,
    });
    await expect(fixture.authorizer.authorizeAndConsume(invocation())).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED',
    });
    expect(fixture.store.consumeConfirmation).toHaveBeenCalledTimes(2);
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it('rejects a discovered control when the TaskCapabilityBinding authority is absent', async () => {
    const fixture = authorizerFixture({ snapshot: undefined });

    await expect(fixture.authorizer.authorizeAndConsume(invocation())).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_AUTHORITY_NOT_FOUND',
    });
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it('rejects read-only Task authority attempting a control Tool', async () => {
    const snapshot = currentSnapshot();
    const fixture = authorizerFixture({
      snapshot: {
        ...snapshot,
        skill: {
          ...snapshot.skill,
          outcomeSpecification: {
            sideEffectPolicy: { sideEffecting: false, confirmation: 'not_required' },
          },
        },
      },
    });

    await expect(fixture.authorizer.authorizeAndConsume(invocation())).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_RUNTIME_AUTHORITY_INVALID',
    });
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it.each([
    ['expired', { expiresAt: '2026-08-13T00:59:59.000Z' }],
    ['revoked', { revokedAt: '2026-08-13T01:00:30.000Z', revokedBy: 'human:operator-2' }],
    ['wrong plan', { planHash: 'f'.repeat(64) }],
  ])('rejects a %s confirmation after restart rehydration', async (_case, confirmationOverride) => {
    const snapshot = currentSnapshot();
    const fixture = authorizerFixture({
      snapshot: {
        ...snapshot,
        confirmation: { ...snapshot.confirmation, ...confirmationOverride },
      },
    });

    await expect(fixture.authorizer.authorizeAndConsume(invocation())).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_CONFIRMATION_INVALID',
    });
  });

  it('rejects stale readiness before dispatch', async () => {
    const snapshot = currentSnapshot();
    const fixture = authorizerFixture({
      snapshot: {
        ...snapshot,
        readiness: { ...snapshot.readiness, validUntil: '2026-08-13T00:59:59.000Z' },
      },
    });

    await expect(fixture.authorizer.authorizeAndConsume(invocation())).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_READINESS_STALE',
    });
  });

  it('rejects ambiguous or mismatched Provider binding authority', async () => {
    const snapshot = currentSnapshot();
    const fixture = authorizerFixture({
      snapshot: {
        ...snapshot,
        attempt: {
          ...snapshot.attempt,
          providerBindingRefs: ['provider-binding-stale', providerBindingId],
        },
      },
    });

    await expect(fixture.authorizer.authorizeAndConsume(invocation())).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_RUNTIME_AUTHORITY_INVALID',
    });
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it('rejects vehicle_fire_weapon before querying any authority', async () => {
    const fixture = authorizerFixture();

    await expect(
      fixture.authorizer.authorizeAndConsume({
        ...invocation(),
        toolName: 'vehicle_fire_weapon',
      }),
    ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_TOOL_HARD_DENIED' });
    expect(fixture.store.load).not.toHaveBeenCalled();
    expect(fixture.capabilities.load).not.toHaveBeenCalled();
    expect(fixture.physicalDeviceWrites).toBe(0);
  });
});

function confirmationService() {
  return new GovernedControlConfirmationService({
    store: {
      saveConfirmation: (confirmation) => Promise.resolve(confirmation),
      revokeConfirmation: () => Promise.resolve(undefined),
    },
    clock: { now: () => confirmedAt },
    ids: { nextConfirmationId: () => 'control-confirmation-1' },
  });
}

function confirmationInput() {
  return {
    taskId,
    capabilityBindingId: 'capability-binding-control',
    capabilityId,
    capabilityVersion,
    capabilityAttemptId: 'capability-attempt-control',
    planId,
    planHash,
    skillId,
    skillVersion,
    providerBindingId,
    serverId,
    toolName,
    argumentsHash: governedControlSnapshotHash(arguments_),
    actorId: 'human:operator-1',
    actorKind: 'human' as const,
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Approve one bounded UGV target-tracking task.',
    expiresAt,
  };
}

function invocation() {
  return {
    invocationId,
    dispatchHash,
    taskId,
    capabilityAttemptId: 'capability-attempt-control',
    providerBindingId,
    serverId,
    toolName,
    arguments: arguments_,
    executionSemantics: controlExecutionSemantics(),
  };
}

function authorizerFixture(
  options: Readonly<{
    snapshot?: GovernedControlRuntimeAuthoritySnapshot | undefined;
    capability?: CurrentGovernedCapabilityAuthority;
  }> = {},
) {
  const snapshot = Object.hasOwn(options, 'snapshot') ? options.snapshot : currentSnapshot();
  let consumed = false;
  const store = {
    load: vi.fn(() => Promise.resolve(snapshot)),
    consumeConfirmation: vi.fn((input: GovernedControlConfirmationConsumption) =>
      Promise.resolve(
        snapshot === undefined || consumed
          ? undefined
          : {
              ...snapshot.confirmation,
              consumedInvocationId: input.invocationId,
              consumedDispatchHash: input.dispatchHash,
              consumedAt: input.consumedAt,
            },
      ),
    ),
  };
  store.consumeConfirmation.mockImplementation((input: GovernedControlConfirmationConsumption) => {
    if (snapshot === undefined || consumed) return Promise.resolve(undefined);
    consumed = true;
    return Promise.resolve({
      ...snapshot.confirmation,
      consumedInvocationId: input.invocationId,
      consumedDispatchHash: input.dispatchHash,
      consumedAt: input.consumedAt,
    });
  });
  const capabilities = {
    load: vi.fn(() => Promise.resolve(options.capability ?? currentCapability())),
  };
  const physicalDeviceWrites = 0;
  return {
    store,
    capabilities,
    physicalDeviceWrites,
    authorizer: new GovernedControlInvocationAuthorizer({
      store,
      capabilities,
      clock: { now: () => '2026-08-13T01:01:00.000Z' },
    }),
  };
}

function currentSnapshot(): GovernedControlRuntimeAuthoritySnapshot {
  const constraints = controlConstraints();
  return {
    task: {
      taskId,
      phase: 'executing',
      planId,
      selectedSkillId: skillId,
      selectedSkillVersion: skillVersion,
    },
    binding: {
      bindingId: 'capability-binding-control',
      capabilityId,
      capabilityVersion,
      inputSnapshot: arguments_,
      constraintSnapshot: constraints,
      evidenceRequirementSnapshot: [{ type: 'state_confirmation', required: true }],
      initialImplementationRefs: [`skill:${skillId}:${String(skillVersion)}`],
      bindingHash: governedControlSnapshotHash({ capabilityId, arguments_, constraints }),
    },
    attempt: {
      attemptId: 'capability-attempt-control',
      status: 'running',
      planId,
      skillVersionRefs: [`skill:${skillId}:${String(skillVersion)}`],
      providerBindingRefs: [providerBindingId],
    },
    plan: { planId, confirmationStatus: 'confirmed', definitionHash: planHash },
    skill: {
      skillId,
      skillVersion,
      currentVersion: skillVersion,
      status: 'enabled',
      validationPassed: true,
      capabilities: [capabilityId],
      toolPolicy: {
        required: [{ serverId, toolName }],
        optional: [],
        forbidden: [{ serverId, toolName: 'vehicle_fire_weapon' }],
      },
      runtimePolicy: { autoConfirmPlan: false, maxMcpCalls: 1 },
      outcomeSpecification: {
        sideEffectPolicy: {
          sideEffecting: true,
          confirmation: 'required_before_execution',
          autoConfirmPlan: false,
          allowRealSideEffectsEnv: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
          realTestRunIdEnv: 'REAL_UGV_TEST_RUN_ID',
          exactResourceRequired: true,
          remoteTaskIdentityRequired: true,
          terminalObservationRequired: true,
          redispatchAfterUncertain: false,
        },
      },
    },
    readiness: {
      readinessId: 'readiness-control',
      workflowPlanId: planId,
      checkPhase: 'pre_invocation',
      dslHash: planHash,
      disposition: 'ready',
      guardAction: 'proceed',
      confirmationRequired: false,
      serverId,
      operationName: toolName,
      argumentsHash: governedControlSnapshotHash(arguments_),
      availability: 'available',
      riskLevel: 'medium',
      validUntil: '2026-08-13T01:02:00.000Z',
      checkedAt: '2026-08-13T01:00:30.000Z',
    },
    confirmation: {
      confirmationId: 'control-confirmation-1',
      ...confirmationInput(),
      confirmedAt,
    },
  };
}

function currentCapability(): CurrentGovernedCapabilityAuthority {
  return {
    definition: {
      capability_id: capabilityId,
      version: capabilityVersion,
      status: 'published',
      risk_level: 'medium',
      supported_modes: ['plan_confirmed', 'remote_task'],
      constraints: controlConstraints(),
    },
    implementationBindings: [
      {
        capability_id: capabilityId,
        capability_version: capabilityVersion,
        implementation_type: 'skill',
        implementation_id: skillId,
        implementation_version: String(skillVersion),
        role: 'primary',
        status: 'active',
        provider_policy_override: {
          selection: 'required',
          mcpProviderBindingId: providerBindingId,
          localServerId: serverId,
          mcpToolName: toolName,
          allowedResourceIds: ['ugv-1'],
          requireActive: true,
          requireAvailable: true,
          requireUnexpiredFreshness: true,
          denyFallback: true,
        },
      },
    ],
  };
}

function controlConstraints() {
  return [
    {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: ['ugv-1'],
      downstreamResourceBinding: 'forbidden',
    },
    {
      type: 'provider_binding_policy',
      mcpProviderBindingId: providerBindingId,
      localServerId: serverId,
      mcpToolName: toolName,
      allowedResourceIds: ['ugv-1'],
      executionSemantics: controlExecutionSemantics(),
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    },
    {
      type: 'exact_skill_version',
      skillId,
      skillVersion,
      taskType: toolName,
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
      allowEnvironment: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
      runIdEnvironment: 'REAL_UGV_TEST_RUN_ID',
      dispatchMaximum: 1,
      uncertainDispatchPolicy: 'reconcile_never_redispatch',
      remoteTaskTerminalEvidenceRequired: true,
    },
  ];
}

function controlExecutionSemantics() {
  return {
    effect: 'side_effecting' as const,
    execution: 'task_required' as const,
    cancellation: 'task_cancel' as const,
    idempotency: 'server_managed' as const,
    replay: 'forbidden' as const,
    source: 'mcp_declared' as const,
  };
}

function navigateAuthority(arguments_: Readonly<Record<string, unknown>>) {
  const navigateSkillId = 'ugv.navigate';
  const navigateCapabilityId = 'vehicle.ugv.navigate';
  const navigateToolName = 'vehicle_navigate';
  const constraints = [
    ...controlConstraints().map((constraint) => {
      if (constraint.type === 'provider_binding_policy')
        return { ...constraint, mcpToolName: navigateToolName };
      if (constraint.type === 'exact_skill_version')
        return {
          ...constraint,
          skillId: navigateSkillId,
          taskType: navigateToolName,
        };
      if (constraint.type === 'physical_side_effect_policy')
        return { ...constraint, dispatchMaximum: 5 };
      return constraint;
    }),
    {
      type: 'bounded_movement_policy',
      constraintId: 'vehicle-navigate-distance-per-dispatch',
      toolName: navigateToolName,
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
  ];
  const base = currentSnapshot();
  const argumentsHash = governedControlSnapshotHash(arguments_);
  const snapshot: GovernedControlRuntimeAuthoritySnapshot = {
    ...base,
    task: {
      ...base.task,
      selectedSkillId: navigateSkillId,
    },
    binding: {
      ...base.binding,
      capabilityId: navigateCapabilityId,
      inputSnapshot: arguments_,
      constraintSnapshot: constraints,
      initialImplementationRefs: [`skill:${navigateSkillId}:${String(skillVersion)}`],
      bindingHash: governedControlSnapshotHash({
        capabilityId: navigateCapabilityId,
        arguments_,
        constraints,
      }),
    },
    attempt: {
      ...base.attempt,
      skillVersionRefs: [`skill:${navigateSkillId}:${String(skillVersion)}`],
    },
    skill: {
      ...base.skill,
      skillId: navigateSkillId,
      capabilities: [navigateCapabilityId],
      toolPolicy: {
        required: [{ serverId, toolName: navigateToolName }],
        optional: [],
        forbidden: [{ serverId, toolName: 'vehicle_fire_weapon' }],
      },
      runtimePolicy: { autoConfirmPlan: false, maxMcpCalls: 5 },
      outcomeSpecification: {
        sideEffectPolicy: {
          sideEffecting: true,
          confirmation: 'required_before_execution',
          autoConfirmPlan: false,
          allowRealSideEffectsEnv: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
          realTestRunIdEnv: 'REAL_UGV_TEST_RUN_ID',
          exactResourceRequired: true,
          remoteTaskIdentityRequired: true,
          terminalObservationRequired: true,
          redispatchAfterUncertain: false,
          dispatchMaximum: 5,
          requiredArgumentConstraintIds: ['vehicle-navigate-distance-per-dispatch'],
        },
      },
    },
    readiness: {
      ...base.readiness,
      operationName: navigateToolName,
      argumentsHash,
    },
    confirmation: {
      ...base.confirmation,
      capabilityId: navigateCapabilityId,
      skillId: navigateSkillId,
      toolName: navigateToolName,
      argumentsHash,
    },
  };
  const baseCapability = currentCapability();
  const implementation = baseCapability.implementationBindings[0];
  if (implementation === undefined) throw new Error('TEST_CONTROL_IMPLEMENTATION_MISSING');
  const providerPolicy = implementation['provider_policy_override'];
  const capability: CurrentGovernedCapabilityAuthority = {
    definition: {
      ...baseCapability.definition,
      capability_id: navigateCapabilityId,
      constraints,
    },
    implementationBindings: [
      {
        ...implementation,
        capability_id: navigateCapabilityId,
        implementation_id: navigateSkillId,
        provider_policy_override: {
          ...(typeof providerPolicy === 'object' && providerPolicy !== null ? providerPolicy : {}),
          mcpToolName: navigateToolName,
        },
      },
    ],
  };
  return {
    snapshot,
    capability,
    invocation: {
      ...invocation(),
      toolName: navigateToolName,
      arguments: arguments_,
    },
  };
}
