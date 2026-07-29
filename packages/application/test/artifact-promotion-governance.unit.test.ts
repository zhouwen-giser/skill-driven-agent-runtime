import { describe, expect, it, vi } from 'vitest';

import {
  ArtifactPromotionGovernanceService,
  type ArtifactPromotionGovernanceStore,
  type ArtifactPermission,
  type CognitiveManagementActionGate,
  type OperatorIdentityPort,
} from '../src/index.js';
import type { ArtifactActivationRecord } from '../../domain/src/index.js';

const now = '2026-07-29T04:00:00.000Z';
const hash = `sha256:${'a'.repeat(64)}`;

describe('P06 promotion governance', () => {
  it('uses one store transaction for the P02 transition and P06 revalidation trigger', async () => {
    const calls: string[] = [];
    const service = new ArtifactPromotionGovernanceService({
      identity: identity(['artifact.revalidate']),
      audit: directAudit(),
      store: {
        recordApproval: vi.fn(),
        activateApproved: vi.fn(),
        recordRevalidationTrigger: vi.fn(() => {
          calls.push('p06-trigger');
          return Promise.resolve();
        }),
        requestRevalidationAtomically: vi.fn(() => {
          calls.push('p02-and-p06-atomic');
          return Promise.resolve();
        }),
      } satisfies ArtifactPromotionGovernanceStore,
    });

    await service.requestRevalidation(trigger('normal'), validationCommand());

    expect(calls).toEqual(['p02-and-p06-atomic']);
  });

  it('requires kill-switch permission before a critical trigger can deprecate an active artifact', async () => {
    const service = new ArtifactPromotionGovernanceService({
      identity: identity(['artifact.revalidate']),
      audit: directAudit(),
      store: {
        recordApproval: vi.fn(),
        activateApproved: vi.fn(),
        recordRevalidationTrigger: vi.fn(),
        requestRevalidationAtomically: vi.fn(),
      },
    });

    await expect(
      service.requestRevalidation(trigger('critical'), validationCommand()),
    ).rejects.toMatchObject({
      code: 'ARTIFACT_PERMISSION_DENIED',
    });
  });

  it('returns the durable activation from an idempotent audit retry without repeating activation', async () => {
    const durable: ArtifactActivationRecord = {
      activationId: 'activation-1',
      artifactRef: 'artifact-1:1',
      artifactHash: hash,
      approvalRef: 'approval-1',
      approvalHash: hash,
      activePointerVersion: 1,
      activatedBy: 'operator-1',
      activatedAt: now,
    };
    const activateApproved = vi.fn();
    const service = new ArtifactPromotionGovernanceService({
      identity: identity(['artifact.activate']),
      audit: replayedAudit(durable),
      store: {
        recordApproval: vi.fn(),
        activateApproved,
        recordRevalidationTrigger: vi.fn(),
        requestRevalidationAtomically: vi.fn(),
      },
    });

    await expect(
      service.activate({
        activationId: durable.activationId,
        artifactId: 'artifact-1',
        artifactVersion: 1,
        artifactKey: 'artifact-key-1',
        approvalId: durable.approvalRef,
        approvalHash: durable.approvalHash,
        promotionPackageHash: hash,
        context: { operatorId: 'operator-1', tenantId: 'tenant-1' },
        expectedVersion: 1,
        expectedLockVersion: 0,
        idempotencyKey: 'activation-1',
        reason: 'The durable approval is already recorded.',
        occurredAt: now,
      }),
    ).resolves.toEqual(durable);
    expect(activateApproved).not.toHaveBeenCalled();
  });

  it('never accepts a worker identity as a promotion approver', async () => {
    const recordApproval = vi.fn();
    const service = new ArtifactPromotionGovernanceService({
      identity: identity(['artifact.approve'], 'worker:shadow-1'),
      audit: directAudit(),
      store: {
        recordApproval,
        activateApproved: vi.fn(),
        recordRevalidationTrigger: vi.fn(),
        requestRevalidationAtomically: vi.fn(),
      },
    });

    await expect(
      service.recordApproval({
        approvalId: 'approval-1',
        artifactId: 'artifact-1',
        artifactVersion: 1,
        promotionPackageId: 'promotion-1',
        promotionPackageHash: hash,
        validationSummaryHash: hash,
        decision: 'approved',
        reason: 'Human review is required.',
        context: { operatorId: 'worker:shadow-1' },
        expectedVersion: 1,
        idempotencyKey: 'approval-1',
        occurredAt: now,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_OPERATOR_REQUIRED' });
    expect(recordApproval).not.toHaveBeenCalled();
  });
});

function identity(
  permissions: readonly ArtifactPermission[],
  operatorId = 'operator-1',
): OperatorIdentityPort {
  return {
    requireIdentity: () =>
      Promise.resolve({ operatorId, permissions: new Set(permissions), tenantId: 'tenant-1' }),
    requirePermission: (_identity, permission) =>
      permissions.includes(permission)
        ? Promise.resolve()
        : Promise.reject(
            Object.assign(new Error('ARTIFACT_PERMISSION_DENIED'), {
              code: 'ARTIFACT_PERMISSION_DENIED',
            }),
          ),
    getTenantScope: () => Promise.resolve('tenant-1'),
  };
}

function directAudit(): CognitiveManagementActionGate {
  return {
    execute: (_input: unknown, action: () => Promise<unknown>) => action(),
  } as unknown as CognitiveManagementActionGate;
}

function replayedAudit(value: unknown): CognitiveManagementActionGate {
  return {
    execute: () => Promise.resolve(value),
  } as unknown as CognitiveManagementActionGate;
}

function trigger(severity: 'normal' | 'critical') {
  return {
    triggerId: `trigger-${severity}`,
    artifactRef: 'artifact-1:1',
    triggerType: 'operator_request' as const,
    sourceRefs: ['operator-request-1'],
    severity,
    createdAt: now,
  };
}

function validationCommand() {
  return {
    artifactId: 'artifact-1',
    version: 1,
    validationRunId: 'validation-1',
    validationType: 'revalidation' as const,
    datasetRef: 'dataset-1:1',
    context: { operatorId: 'operator-1', tenantId: 'tenant-1' },
    expectedVersion: 1,
    idempotencyKey: 'revalidation-1',
    reason: 'An operator requested a fresh validation.',
    occurredAt: now,
  };
}
