import { describe, expect, it, vi } from 'vitest';

import {
  A2AArtifactProjectionService,
  ArtifactManagementCommandService,
  ArtifactManagementError,
  ArtifactManagementQueryService,
  CognitiveManagementActionGate,
  type ArtifactManagementQueryRepository,
  type ManagementPrincipal,
  type ManagementRole,
} from '../src/index.js';
import type { ArtifactGovernancePort } from '../src/compiler/artifact-governance.js';

const NOW = '2026-07-30T03:00:00.000Z';

describe('P12 Artifact management policy', () => {
  it('derives tenant scope from the principal, redacts secrets and audits reads', async () => {
    const audits: unknown[] = [];
    const repository = repositoryStub({
      listArtifacts: (input) => {
        expect(input).toMatchObject({ tenantId: 'tenant-a', includeGlobal: false });
        return Promise.resolve({
          items: [
            {
              artifact_id: 'artifact-a',
              credential: 'provider-secret',
              definition: { safe: true, apiKey: 'secret' },
            },
          ],
        });
      },
      recordReadAudit: (input) => {
        audits.push(input);
        return Promise.resolve();
      },
    });
    const service = new ArtifactManagementQueryService({
      repository,
      clock: { now: () => NOW },
    });
    const result = (await service.list(principal(['viewer']), {
      limit: 50,
      sort: 'created_desc',
    })) as { items: readonly Record<string, unknown>[] };

    expect(result.items[0]).toEqual({
      artifact_id: 'artifact-a',
      credential: '[redacted]',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: 'operator-a',
      tenantId: 'tenant-a',
      operation: 'artifact.list',
    });
  });

  it('preserves PostgreSQL timestamps as ISO strings while redacting query results', async () => {
    const createdAt = new Date(NOW);
    const service = new ArtifactManagementQueryService({
      repository: repositoryStub({
        listArtifacts: () =>
          Promise.resolve({
            items: [{ artifact_id: 'artifact-a', created_at: createdAt }],
          }),
      }),
      clock: { now: () => NOW },
    });

    const result = (await service.list(principal(['reviewer']), {
      limit: 50,
      sort: 'created_desc',
    })) as { items: readonly Record<string, unknown>[] };

    expect(result.items[0]).toEqual({
      artifact_id: 'artifact-a',
      created_at: NOW,
    });
  });

  it('requires elevated read role for audit and rejects cross-role commands', async () => {
    const service = new ArtifactManagementQueryService({
      repository: repositoryStub(),
      clock: { now: () => NOW },
    });
    await expect(service.view(principal(['viewer']), 'artifact-a', 'audit')).rejects.toMatchObject({
      code: 'MANAGEMENT_PERMISSION_DENIED',
      status: 403,
    });

    const commands = new ArtifactManagementCommandService({
      governance: governanceStub(),
      clock: { now: () => NOW },
    });
    await expect(
      commands.execute(principal(['operator']), 'approve', commandInput()),
    ).rejects.toBeInstanceOf(ArtifactManagementError);
  });

  it('delegates approval with identity-derived context and denies service-principal approval', async () => {
    const recordApproval = vi.fn(() => Promise.resolve());
    const governance = governanceStub({ recordApproval });
    const service = new ArtifactManagementCommandService({
      governance,
      clock: { now: () => NOW },
    });
    await service.execute(principal(['approver']), 'approve', commandInput());
    expect(recordApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          operatorId: 'operator-a',
          tenantId: 'tenant-a',
          permissions: ['artifact.approve'],
        },
        decision: 'approved',
      }),
    );
    await expect(
      service.execute({ ...principal(['approver']), kind: 'service' }, 'approve', commandInput()),
    ).rejects.toMatchObject({ code: 'MANAGEMENT_SERVICE_PRINCIPAL_DENIED' });
  });

  it('applies a release operation policy before governance writes while preserving safety commands', async () => {
    const recordApproval = vi.fn(() => Promise.resolve());
    const rollback = vi.fn(() => Promise.resolve());
    const service = new ArtifactManagementCommandService({
      governance: governanceStub({ recordApproval, rollback }),
      operationPolicy: {
        isEnabled: (operation) =>
          !['build-promotion-package', 'approve', 'reject', 'activate'].includes(operation),
      },
      clock: { now: () => NOW },
    });

    await expect(
      service.execute(principal(['approver']), 'approve', commandInput()),
    ).rejects.toMatchObject({
      code: 'ARTIFACT_OPERATION_DISABLED',
      status: 503,
    });
    expect(recordApproval).not.toHaveBeenCalled();

    await service.execute(principal(['security_operator']), 'kill-switch-disable', {
      ...commandInput(),
      artifactKey: 'artifact-key-a',
      expectedLockVersion: 4,
      targetArtifactId: 'artifact-safe',
      targetVersion: 2,
    });
    expect(rollback).toHaveBeenCalledOnce();
  });

  it('applies the shadow policy to validation-type aliases before governance writes', async () => {
    const requestValidation = vi.fn(() => Promise.resolve());
    const service = new ArtifactManagementCommandService({
      governance: governanceStub({ requestValidation }),
      operationPolicy: {
        isEnabled: (operation) => !['shadow', 'revalidate'].includes(operation),
      },
      clock: { now: () => NOW },
    });

    for (const validationType of ['shadow', 'revalidation'] as const) {
      await expect(
        service.execute(principal(['operator']), 'validate', {
          ...commandInput(),
          validationRunId: `validation-${validationType}`,
          validationType,
          datasetRef: `dataset-${validationType}`,
        }),
      ).rejects.toMatchObject({
        code: 'ARTIFACT_OPERATION_DISABLED',
        status: 503,
      });
    }
    expect(requestValidation).not.toHaveBeenCalled();
  });

  it('closes a kill switch only through an evidence-bound rollback', async () => {
    const rollback = vi.fn(() => Promise.resolve());
    const service = new ArtifactManagementCommandService({
      governance: governanceStub({ rollback }),
      clock: { now: () => NOW },
    });
    await service.execute(principal(['security_operator']), 'kill-switch-disable', {
      ...commandInput(),
      artifactKey: 'artifact-key-a',
      expectedLockVersion: 4,
      targetArtifactId: 'artifact-safe',
      targetVersion: 2,
    });
    expect(rollback).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactKey: 'artifact-key-a',
        targetArtifactId: 'artifact-safe',
        targetVersion: 2,
        expectedLockVersion: 4,
        reason: 'kill-switch-disable:Reviewed evidence.',
        context: expect.objectContaining({ permissions: ['artifact.rollback'] }),
      }),
    );
  });

  it('builds a promotion package through the formal P06 service after tenant authorization', async () => {
    const createPackage = vi.fn(() => Promise.resolve(undefined as never));
    const service = new ArtifactManagementCommandService({
      governance: governanceStub(),
      promotionPackages: { createPackage },
      authorizationQueries: {
        getArtifact: (_artifactId, authorizedScope) => {
          expect(authorizedScope).toEqual({ tenantId: 'tenant-a', includeGlobal: false });
          return Promise.resolve({ artifact_id: 'artifact-a' });
        },
      },
      audit: new CognitiveManagementActionGate({
        repository: {
          claim: () => Promise.resolve({ disposition: 'claimed' }),
          complete: () => Promise.resolve(),
          fail: () => Promise.resolve(),
          list: () => Promise.resolve([]),
        },
        clock: { now: () => NOW },
      }),
      clock: { now: () => NOW },
    });
    const hash = `sha256:${'b'.repeat(64)}`;
    await service.execute(principal(['reviewer']), 'build-promotion-package', {
      ...commandInput(),
      promotionPackage: {
        promotionPackageId: 'promotion-a',
        artifactRef: 'artifact-a:1',
        artifactHash: hash,
        validationSummaryRef: 'validation-a',
        validationSummaryHash: hash,
        shadowSummaryRef: 'shadow-a',
        shadowSummaryHash: hash,
        counterexampleSummaryRef: 'counterexample-a',
        counterexampleSummaryHash: hash,
        riskReviewRef: 'risk-a',
        riskReviewHash: hash,
        dependencySnapshotRef: 'dependency-a',
        dependencySnapshotHash: hash,
      },
    });
    expect(createPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        promotionPackageId: 'promotion-a',
        artifactRef: 'artifact-a:1',
        createdAt: NOW,
      }),
    );
  });

  it('allowlists public A2A capabilities and redacts internal evidence', () => {
    const projection = new A2AArtifactProjectionService().project({
      capabilities: [
        'validated-planning-templates',
        'internal-model-route',
        'interactive-confirmation',
      ],
      inputRequired: true,
      confirmation: true,
      formalTaskState: 'TASK_STATE_INPUT_REQUIRED',
      evidence: {
        routeType: 'template_adapt',
        credential: 'secret',
        internalPrompt: 'private',
      },
    });
    expect(projection.publicCapabilitySummary).toEqual([
      'interactive-confirmation',
      'validated-planning-templates',
    ]);
    expect(projection.safeEvidence).toEqual({
      routeType: 'template_adapt',
      credential: '[redacted]',
      internalPrompt: '[redacted]',
    });
    expect(projection.formalTaskState).toBe('TASK_STATE_INPUT_REQUIRED');
  });
});

function principal(roles: readonly ManagementRole[]): ManagementPrincipal {
  return {
    actorId: 'operator-a',
    tenantId: 'tenant-a',
    roles: new Set<ManagementRole>(roles),
    kind: 'human' as const,
    requestId: 'request-a',
    sourceIp: '127.0.0.1',
  };
}

function commandInput() {
  return {
    artifactId: 'artifact-a',
    version: 1,
    expectedVersion: 1,
    idempotencyKey: 'command-a',
    reason: 'Reviewed evidence.',
    approvalId: 'approval-a',
    validationSummaryHash: `sha256:${'a'.repeat(64)}`,
  };
}

function governanceStub(overrides: Partial<ArtifactGovernancePort> = {}): ArtifactGovernancePort {
  return {
    requestValidation: vi.fn(() => Promise.resolve()),
    recordApproval: vi.fn(() => Promise.resolve()),
    activate: vi.fn(() => Promise.resolve()),
    requestRevalidation: vi.fn(() => Promise.resolve()),
    deprecate: vi.fn(() => Promise.resolve()),
    rollback: vi.fn(() => Promise.resolve()),
    killSwitch: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function repositoryStub(
  overrides: Partial<ArtifactManagementQueryRepository> = {},
): ArtifactManagementQueryRepository {
  return {
    listArtifacts: () => Promise.resolve({ items: [] }),
    getArtifact: () => Promise.resolve(undefined),
    getArtifactView: () => Promise.resolve({ items: [] }),
    getRuntimeView: () => Promise.resolve({ items: [] }),
    getRuntimeDetail: () => Promise.resolve(undefined),
    listEvents: () => Promise.resolve([]),
    recordReadAudit: () => Promise.resolve(),
    ...overrides,
  };
}
