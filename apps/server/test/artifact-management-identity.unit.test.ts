import { describe, expect, it } from 'vitest';

import { ConfiguredBearerArtifactManagementIdentity } from '../src/artifact-management-identity.js';

const token = 'artifact-management-test-token-0001';

describe('ConfiguredBearerArtifactManagementIdentity', () => {
  it('accepts only the exact configured Bearer header and projects configured identity facts', async () => {
    const identity = configuredIdentity();

    const principal = await identity.managementPrincipalResolver.resolve({
      authorization: `Bearer ${token}`,
      requestId: 'request-1',
      sourceIp: '127.0.0.1',
    });
    expect(principal).toMatchObject({
      actorId: 'operator-1',
      tenantId: 'tenant-1',
      kind: 'human',
      requestId: 'request-1',
      sourceIp: '127.0.0.1',
    });
    expect([...principal.roles]).toEqual(['viewer', 'operator']);

    for (const authorization of [
      undefined,
      `Bearer ${token}-wrong`,
      `bearer ${token}`,
      `Bearer  ${token}`,
      `Bearer ${token} `,
      token,
    ]) {
      await expect(
        identity.managementPrincipalResolver.resolve({
          ...(authorization === undefined ? {} : { authorization }),
          requestId: 'request-invalid',
        }),
      ).rejects.toMatchObject({
        code: 'MANAGEMENT_AUTHENTICATION_REQUIRED',
        status: 401,
      });
    }
  });

  it('accepts only configured actor, tenant and role-derived permissions', async () => {
    const provider = configuredIdentity().externalOperatorIdentityProvider;

    const operator = await provider.resolve({
      operatorId: 'operator-1',
      tenantId: 'tenant-1',
      permissions: ['artifact.validate', 'artifact.revalidate'],
    });
    expect(operator).toMatchObject({
      operatorId: 'operator-1',
      tenantId: 'tenant-1',
    });
    expect([...(operator?.permissions ?? [])]).toEqual([
      'artifact.validate',
      'artifact.revalidate',
    ]);
    await expect(
      provider.resolve({
        operatorId: 'operator-1',
        tenantId: 'tenant-1',
        permissions: ['artifact.approve'],
      }),
    ).resolves.toBeUndefined();
    await expect(
      provider.resolve({
        operatorId: 'request-body-actor',
        tenantId: 'tenant-1',
        permissions: ['artifact.validate'],
      }),
    ).resolves.toBeUndefined();
    await expect(
      provider.resolve({
        operatorId: 'operator-1',
        tenantId: 'request-body-tenant',
        permissions: ['artifact.validate'],
      }),
    ).resolves.toBeUndefined();
  });

  it('uses a least-privilege fixed role-to-permission mapping', async () => {
    const viewer = new ConfiguredBearerArtifactManagementIdentity({
      token,
      actorId: 'viewer-1',
      kind: 'service',
      roles: ['viewer'],
    }).externalOperatorIdentityProvider;
    const security = new ConfiguredBearerArtifactManagementIdentity({
      token,
      actorId: 'security-1',
      kind: 'human',
      roles: ['security_operator'],
    }).externalOperatorIdentityProvider;
    const reviewer = new ConfiguredBearerArtifactManagementIdentity({
      token,
      actorId: 'reviewer-1',
      kind: 'human',
      roles: ['reviewer'],
    }).externalOperatorIdentityProvider;

    await expect(
      viewer.resolve({
        operatorId: 'viewer-1',
        permissions: ['artifact.validate'],
      }),
    ).resolves.toBeUndefined();
    const securityOperator = await security.resolve({
      operatorId: 'security-1',
      permissions: ['artifact.kill_switch', 'artifact.rollback'],
    });
    expect(securityOperator).toMatchObject({
      operatorId: 'security-1',
    });
    expect([...(securityOperator?.permissions ?? [])]).toEqual([
      'artifact.kill_switch',
      'artifact.rollback',
    ]);
    await expect(
      security.resolve({
        operatorId: 'security-1',
        permissions: ['artifact.activate'],
      }),
    ).resolves.toBeUndefined();
    await expect(
      reviewer.resolve({
        operatorId: 'reviewer-1',
        permissions: ['artifact.validate'],
      }),
    ).resolves.toMatchObject({
      operatorId: 'reviewer-1',
    });
    await expect(
      reviewer.resolve({
        operatorId: 'reviewer-1',
        permissions: ['artifact.approve'],
      }),
    ).resolves.toBeUndefined();
  });
});

function configuredIdentity(): ConfiguredBearerArtifactManagementIdentity {
  return new ConfiguredBearerArtifactManagementIdentity({
    token,
    actorId: 'operator-1',
    tenantId: 'tenant-1',
    kind: 'human',
    roles: ['viewer', 'operator'],
  });
}
