import { describe, expect, it, vi } from 'vitest';

import {
  GovernedControlConfirmationService,
  GovernedControlManagementService,
  type GovernedControlConfirmation,
  type GovernedControlIssueAuthority,
  type GovernedControlPrincipal,
} from '../src/index.js';

const now = '2026-08-13T01:00:00.000Z';

describe('GovernedControlManagementService', () => {
  it('issues from exact server authority and authenticated human permission only', async () => {
    let saved: GovernedControlConfirmation | undefined;
    const service = fixture({
      save: (confirmation) => {
        saved = confirmation;
        return Promise.resolve(confirmation);
      },
    });

    const result = await service.issue({
      taskId: 'task-1',
      reason: 'Operator inspected the route and authorizes one dispatch.',
      ttlMs: 60_000,
      principal: humanPrincipal('physical_control.confirm'),
    });

    expect(result.authority).toEqual(authority);
    expect(saved).toMatchObject({
      taskId: 'task-1',
      capabilityBindingId: 'capability-binding-1',
      capabilityAttemptId: 'capability-attempt-1',
      planId: 'plan-1',
      skillId: 'embodied.move',
      providerBindingId: 'ugv-provider-binding-1',
      serverId: 'fake-ugv',
      toolName: 'embodied_move',
      argumentsHash: 'b'.repeat(64),
      actorId: 'human:operator-1',
      actorKind: 'human',
      authenticationMethod: 'configured_bearer',
      actorRoles: ['physical_control_approver'],
      expiresAt: '2026-08-13T01:01:00.000Z',
    });
  });

  it('denies service principals and principals without the exact action permission', async () => {
    const authorityReader = {
      issueAuthority: vi.fn(() => Promise.resolve(authority)),
      revocationAuthority: vi.fn(() =>
        Promise.resolve({ taskId: 'task-1', confirmationId: 'confirmation-1' }),
      ),
    };
    const service = fixture({ authorityReader });

    await expect(
      service.issue({
        taskId: 'task-1',
        reason: 'not trusted',
        principal: { ...humanPrincipal('physical_control.confirm'), kind: 'service' },
      }),
    ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_PERMISSION_DENIED', status: 403 });
    await expect(
      service.issue({
        taskId: 'task-1',
        reason: 'wrong permission',
        principal: humanPrincipal('physical_control.revoke'),
      }),
    ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_PERMISSION_DENIED', status: 403 });
    expect(authorityReader.issueAuthority).not.toHaveBeenCalled();
  });

  it('checks task binding before revocation and requires revoke permission', async () => {
    const revoke = vi.fn(() => Promise.resolve(undefined));
    const service = fixture({
      authorityReader: {
        issueAuthority: () => Promise.resolve(authority),
        revocationAuthority: () => Promise.resolve(undefined),
      },
      revoke,
    });

    await expect(
      service.revoke({
        taskId: 'different-task',
        confirmationId: 'confirmation-1',
        reason: 'Route changed before dispatch.',
        principal: humanPrincipal('physical_control.revoke'),
      }),
    ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_NOT_FOUND', status: 404 });
    expect(revoke).not.toHaveBeenCalled();
  });

  it('does not revoke a confirmation after it was consumed by a dispatch', async () => {
    const revoke = vi.fn(() => Promise.resolve(undefined));
    const service = fixture({
      authorityReader: {
        issueAuthority: () => Promise.resolve(authority),
        revocationAuthority: () =>
          Promise.resolve({
            taskId: 'task-1',
            confirmationId: 'confirmation-1',
            consumedAt: now,
          }),
      },
      revoke,
    });

    await expect(
      service.revoke({
        taskId: 'task-1',
        confirmationId: 'confirmation-1',
        reason: 'Too late.',
        principal: humanPrincipal('physical_control.revoke'),
      }),
    ).rejects.toMatchObject({
      code: 'GOVERNED_CONTROL_CONFIRMATION_NOT_REVOCABLE',
      status: 409,
    });
    expect(revoke).not.toHaveBeenCalled();
  });
});

const authority: GovernedControlIssueAuthority = Object.freeze({
  taskId: 'task-1',
  capabilityBindingId: 'capability-binding-1',
  capabilityId: 'embodied.move',
  capabilityVersion: 1,
  capabilityAttemptId: 'capability-attempt-1',
  planId: 'plan-1',
  planHash: 'a'.repeat(64),
  skillId: 'embodied.move',
  skillVersion: 1,
  providerBindingId: 'ugv-provider-binding-1',
  serverId: 'fake-ugv',
  toolName: 'embodied_move',
  arguments: { resourceId: 'ugv-1', destination: 'dock' },
  argumentsHash: 'b'.repeat(64),
});

function humanPrincipal(
  permission: 'physical_control.confirm' | 'physical_control.revoke',
): GovernedControlPrincipal {
  return Object.freeze({
    actorId: 'human:operator-1',
    kind: 'human',
    authenticationMethod: 'configured_bearer',
    permissions: new Set([permission]),
    requestId: 'request-1',
  });
}

function fixture(
  overrides: Readonly<{
    authorityReader?: {
      issueAuthority(taskId: string): Promise<GovernedControlIssueAuthority | undefined>;
      revocationAuthority(
        taskId: string,
        confirmationId: string,
      ): Promise<
        | { taskId: string; confirmationId: string; revokedAt?: string; consumedAt?: string }
        | undefined
      >;
    };
    save?: (confirmation: GovernedControlConfirmation) => Promise<GovernedControlConfirmation>;
    revoke?: (
      confirmationId: string,
      revokedBy: string,
      revokedAt: string,
    ) => Promise<GovernedControlConfirmation | undefined>;
  }> = {},
): GovernedControlManagementService {
  const confirmations = new GovernedControlConfirmationService({
    store: {
      saveConfirmation: overrides.save ?? ((confirmation) => Promise.resolve(confirmation)),
      revokeConfirmation: overrides.revoke ?? (() => Promise.resolve(undefined)),
    },
    clock: { now: () => now },
    ids: { nextConfirmationId: () => 'confirmation-1' },
  });
  return new GovernedControlManagementService({
    authority: overrides.authorityReader ?? {
      issueAuthority: () => Promise.resolve(authority),
      revocationAuthority: (taskId, confirmationId) => Promise.resolve({ taskId, confirmationId }),
    },
    confirmations,
    clock: { now: () => now },
  });
}
