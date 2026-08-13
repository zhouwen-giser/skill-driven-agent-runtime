import { describe, expect, it, vi } from 'vitest';

import {
  GovernedControlConfirmationService,
  GovernedControlInvocationAuthorizer,
  governedControlSnapshotHash,
  type CurrentGovernedCapabilityAuthority,
  type GovernedControlConfirmation,
  type GovernedControlRuntimeAuthoritySnapshot,
} from '../src/index.js';

const confirmedAt = '2026-08-13T01:00:00.000Z';
const expiresAt = '2026-08-13T01:05:00.000Z';
const taskId = 'task-control-1';
const capabilityId = 'vehicle.light.control';
const capabilityVersion = 1;
const planId = 'plan-control-1';
const skillId = 'skill-light-control';
const skillVersion = 3;
const serverId = 'provider-control';
const toolName = 'light_set_state';
const providerBindingId = 'provider-binding-control';
const arguments_ = Object.freeze({ resourceId: 'living-room-main-light', state: 'off' });
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
  it('authorizes an exact current physical-control chain without calling any Provider', async () => {
    const fixture = authorizerFixture();

    await expect(fixture.authorizer.authorize(invocation())).resolves.toBeUndefined();
    expect(fixture.store.load).toHaveBeenCalledExactlyOnceWith({
      taskId,
      serverId,
      toolName,
      argumentsHash: governedControlSnapshotHash(arguments_),
    });
    expect(fixture.capabilities.load).toHaveBeenCalledExactlyOnceWith(
      capabilityId,
      capabilityVersion,
    );
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it('rejects a discovered control when the TaskCapabilityBinding authority is absent', async () => {
    const fixture = authorizerFixture({ snapshot: undefined });

    await expect(fixture.authorizer.authorize(invocation())).rejects.toMatchObject({
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

    await expect(fixture.authorizer.authorize(invocation())).rejects.toMatchObject({
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

    await expect(fixture.authorizer.authorize(invocation())).rejects.toMatchObject({
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

    await expect(fixture.authorizer.authorize(invocation())).rejects.toMatchObject({
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

    await expect(fixture.authorizer.authorize(invocation())).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_RUNTIME_AUTHORITY_INVALID',
    });
    expect(fixture.physicalDeviceWrites).toBe(0);
  });

  it('rejects vehicle_fire_weapon before querying any authority', async () => {
    const fixture = authorizerFixture();

    await expect(
      fixture.authorizer.authorize({ ...invocation(), toolName: 'vehicle_fire_weapon' }),
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
    planId,
    planHash,
    skillId,
    skillVersion,
    actorId: 'human:operator-1',
    actorKind: 'human' as const,
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Approve shutdown of the bounded lab light.',
    expiresAt,
  };
}

function invocation() {
  return {
    taskId,
    capabilityAttemptId: 'capability-attempt-control',
    providerBindingId,
    serverId,
    toolName,
    arguments: arguments_,
    executionSemantics: {
      effect: 'side_effecting' as const,
      execution: 'synchronous' as const,
      cancellation: 'unsupported' as const,
      idempotency: 'client_request_key' as const,
      replay: 'forbidden' as const,
      source: 'mcp_declared' as const,
    },
  };
}

function authorizerFixture(
  options: Readonly<{
    snapshot?: GovernedControlRuntimeAuthoritySnapshot | undefined;
    capability?: CurrentGovernedCapabilityAuthority;
  }> = {},
) {
  const snapshot = Object.hasOwn(options, 'snapshot') ? options.snapshot : currentSnapshot();
  const store = {
    load: vi.fn(() => Promise.resolve(snapshot)),
  };
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
        sideEffectPolicy: { sideEffecting: true, confirmation: 'required' },
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
      riskLevel: 'high',
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
      risk_level: 'high',
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
      },
    ],
  };
}

function controlConstraints() {
  return [
    {
      type: 'authorization',
      effect: 'physical_control',
      requiredActorRole: 'physical_control_approver',
      allowedActorIds: ['human:operator-1'],
    },
    {
      type: 'confirmation_policy',
      required: true,
      stage: 'pre_dispatch',
      trustedActorRequired: true,
    },
    { type: 'side_effect_policy', sideEffecting: true, effectClass: 'physical_control' },
    {
      type: 'provider_binding_policy',
      mcpProviderBindingId: providerBindingId,
      localServerId: serverId,
      mcpToolName: toolName,
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    },
    {
      type: 'resource_policy',
      allowedResourceIds: ['living-room-main-light'],
    },
    {
      type: 'exact_skill_version',
      skillId,
      skillVersion,
      taskType: toolName,
    },
  ];
}
